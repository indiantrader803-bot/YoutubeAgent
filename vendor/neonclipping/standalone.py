from pathlib import Path
from urllib.parse import urlparse
import json
import uuid
import threading
import shutil
import time
import subprocess
import ytdl
import yt_dlp
from fastapi import HTTPException

SOURCE_HEIGHTS=(360,480,720,1080,1440,2160)
DEFAULT_SOURCE_HEIGHT=1080
def source_height(value):
    """Validated source download cap. Anything unknown falls back to 1080p."""
    try:h=int(value)
    except (TypeError,ValueError):return DEFAULT_SOURCE_HEIGHT
    return h if h in SOURCE_HEIGHTS else DEFAULT_SOURCE_HEIGHT
def source_format(h):
    """yt-dlp format for a source up to h pixels tall. YouTube serves H.264 only up to 1080p; above that it is VP9/AV1."""
    h=source_height(h)
    # Never fall back to a progressive mp4 early: YouTube's ready-made mp4 stops at 720p, which is how "1080p" silently became 720p.
    if h>1080:return f'bv*[height<={h}]+ba/b[height<={h}]/b'
    return f'bv*[height<={h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<={h}]+ba/b[height<={h}]/b'
def quality_label(h):return '4K' if h>=2160 else f'{h}p'
LONG_SECONDS=int(__import__('os').environ.get('NEONCLIPPING_LONG_SECONDS','7200'))   # a source longer than 2 h is never downloaded whole: the user picks the part (a 24 h stream is ~46 GB at 1080p)
MAX_RANGE=7200      # longest part that can be imported at once
class TooLong(RuntimeError):
    def __init__(self,duration,title=''):
        self.duration=duration;self.title=title
        super().__init__(f'This video is {duration/3600:.1f} hours long. Pick the part you need (up to {MAX_RANGE//3600} hours) instead of downloading all of it.')
def parse_range(body):
    """(start,end) in seconds from a request body, or None when no part was asked for. Raises ValueError with a readable message."""
    if body.get('start') in (None,'') and body.get('end') in (None,''):return None
    try:start=float(body.get('start') or 0);end=float(body.get('end'))
    except (TypeError,ValueError):raise ValueError('Start and end must be numbers of seconds.')
    if not (start==start and end==end) or start<0 or end<=start:raise ValueError('End must be after start.')
    if end-start>MAX_RANGE:raise ValueError(f'Pick at most {MAX_RANGE//3600} hours at once.')
    return start,end
from highlights import rank
import smart
from previews import prepare
from fastapi.responses import FileResponse

def allowed(url):
    parsed=urlparse(url);host=(parsed.hostname or '').lower()
    return parsed.scheme in ('http','https') and not parsed.username and not parsed.password and (host in ('youtu.be','youtube.com','www.youtube.com','m.youtube.com','twitch.tv','www.twitch.tv','clips.twitch.tv','kick.com','www.kick.com')) and parsed.port in (None,80,443)

def attach(app,DATA,state,probe):
    lock=threading.Lock()
    def save(job,record):
        with lock:
            record={**state.get(job,{}),**record}
            state[job]=record
            temp=DATA/(job+'.state.tmp');temp.write_text(json.dumps(record),encoding='utf-8');temp.replace(DATA/(job+'.state.json'))
    # Completed work survives a restart; active work reports interruption.
    for f in DATA.glob('*.state.json'):
        try:
            record=json.loads(f.read_text(encoding='utf-8'));job=f.name.split('.')[0]
            if record.get('status') in ('running','queued'):
                record.update(status='error',error='Studio restarted during processing. Please retry.')
            state[job]=record
        except (ValueError,OSError):pass
    def source_path(id):
        if not id or not id.isalnum():raise HTTPException(400,'Upload or import a video first.')
        p=DATA/(id+'.mp4')
        if not p.exists():raise HTTPException(404,'Source video is unavailable.')
        return p
    def download(url,job,height=DEFAULT_SOURCE_HEIGHT,window=None):
        height=source_height(height)
        # Reuse only this app's own import cache, and only if it was fetched at this quality or better (old caches were 720p).
        for f in DATA.glob('*.request.json'):
            try:
                rec=json.loads(f.read_text())
                if rec.get('url')==url and rec.get('height',720)>=height and rec.get('window')==(list(window) if window else None):
                    cached=DATA/(f.name.split('.')[0]+'.mp4')
                    if cached.exists():probe(cached);return cached.stem,cached
            except (OSError,ValueError,subprocess.SubprocessError):pass
        if not window:
            state.get(job,{}).update(stage='Checking video length…',message='Checking video length…')
            # Never pull a whole very long video: ask for the part instead.
            with ytdl.YDL({'quiet':True,'no_warnings':True,'skip_download':True,'socket_timeout':12,'retries':1,'noplaylist':True}) as y:info=y.extract_info(url,download=False)
            if float(info.get('duration') or 0)>LONG_SECONDS:raise TooLong(float(info['duration']),info.get('title',''))
        directory=DATA/job;directory.mkdir(exist_ok=True)
        target=DATA/(job+'.mp4')
        def progress(event):
            if event.get('status')=='downloading':
                got=event.get('downloaded_bytes',0);total=event.get('total_bytes') or event.get('total_bytes_estimate') or 0
                info=event.get('info_dict') or {};kind='video' if info.get('vcodec') not in (None,'none') else 'audio'
                shown=f"{info.get('height')}p" if info.get('height') else quality_label(height)
                speed=event.get('speed') or 0;eta=event.get('eta')
                msg=f'Downloading {shown} {kind}: {got/1048576:.0f}'+(f' / {total/1048576:.0f}' if total else '')+' MB'+(f' · {speed/1048576:.1f} MB/s' if speed else '')+(f' · {int(eta)//60}m {int(eta)%60:02d}s left' if eta else '')
                state[job].update(message=msg,stage=msg,progress=min(.3,got/total*.3) if total else .1)
            elif event.get('status')=='finished':state[job].update(message='Merging source video',stage='Merging source video')
        options={'noplaylist':True,'format':source_format(height),
                 'outtmpl':str(directory/'source.%(ext)s'),'merge_output_format':'mp4','socket_timeout':15,'retries':2,'fragment_retries':2,
                 'extractor_retries':1,'progress_hooks':[progress],'quiet':True,'no_warnings':True}
        if window:
            from yt_dlp.utils import download_range_func
            options['download_ranges']=download_range_func(None,[tuple(window)])
        beat={'t':time.monotonic(),'on':True,'pause':bool(window)}      # a ranged download is done by ffmpeg and reports no progress
        _progress=progress
        def progress(event):
            beat['t']=time.monotonic()
            if not window:beat['pause']=event.get('status')=='finished'      # merging a finished stream is not a stall
            _progress(event)
        options['progress_hooks']=[progress]
        def watchdog():
            while beat['on']:
                time.sleep(5);idle=time.monotonic()-beat['t']
                if beat['on'] and not beat['pause'] and idle>=45 and job in state:
                    msg=f'No data received for {int(idle)} s. The network or YouTube may be blocking this download. Wait, try again, or upload the MP4 instead.'
                    state[job].update(message=msg,stage=msg)
        threading.Thread(target=watchdog,daemon=True).start()
        try:
            with ytdl.YDL(options) as downloader:downloader.download([url])
        finally:beat['on']=False
        src=next((p for p in directory.iterdir() if p.suffix in ('.mp4','.mkv','.webm')),None)
        if src is None:raise RuntimeError('Download produced no playable file. Upload the original MP4 instead.')
        if src.suffix=='.mp4':shutil.move(str(src),str(target))
        else:
            # VP9/AV1 (4K) usually arrives as mkv/webm: remux without re-encoding first (fast, lossless); re-encode only if that fails.
            result=subprocess.run(['ffmpeg','-y','-v','error','-i',str(src),'-c','copy','-movflags','+faststart',str(target)],capture_output=True,text=True,timeout=3600)
            if result.returncode:
                target.unlink(missing_ok=True)
                result=subprocess.run(['ffmpeg','-y','-v','error','-i',str(src),'-c:v','libx264','-preset','fast','-crf','22','-c:a','aac','-movflags','+faststart',str(target)],capture_output=True,text=True,timeout=3600)
                if result.returncode:raise RuntimeError(result.stderr[-500:])
        probe(target)
        (DATA/(job+'.request.json')).write_text(json.dumps({'url':url,'height':height,'window':list(window) if window else None}),encoding='utf-8')
        return job,target

    def new_source(body):
        url=str(body.get('url','')).strip()
        if url:
            try:valid=allowed(url)
            except ValueError:valid=False
            if not valid:raise HTTPException(400,'Paste a full YouTube, Twitch or Kick video URL.')
            return url,None
        id=str(body.get('id',''));return '',source_path(id)

    app.neon={'download':download,'save':save,'new_source':new_source}

    @app.get('/healthz')
    def health():
        import compat
        return {'ok':True,'engine':'standalone','peakcut_required':False,'ffmpeg':compat.ffmpeg_ready()}

    @app.post('/link')
    def import_link(body:dict):
        url,_=new_source(body)
        if not url:raise HTTPException(400,'Paste a video link.')
        try:window=parse_range(body)
        except ValueError as error:raise HTTPException(400,str(error))
        job=uuid.uuid4().hex;save(job,{'status':'running','stage':'Import starting','message':'Getting preview frames; download runs in background','preview_status':'loading','url':url,'source_offset':window[0] if window else 0})
        def preview_work():
            try:prepare(url,job,DATA,probe,lambda fields:save(job,fields))
            except Exception as error:save(job,{'preview_status':'unavailable','preview_error':'Early frames unavailable; full download continues. '+str(error)[-150:]})
        threading.Thread(target=preview_work,daemon=True).start()
        def work():
            try:
                id,p=download(url,job,body.get('source_height'),window=window);save(job,{'status':'done','id':id,**probe(p)})
            except TooLong as error:save(job,{'status':'needs_range','duration_total':error.duration,'title':error.title,'message':str(error),'max_range':MAX_RANGE})
            except Exception as error:save(job,{'status':'error','error':'Import failed. Try the original MP4. '+str(error)[-500:]})
        threading.Thread(target=work,daemon=True).start();return {'job':job}

    @app.get('/preview/{job}/{index}')
    def preview_file(job:str,index:int):
        if not job.isalnum() or not 0<=index<4:raise HTTPException(404)
        p=DATA/(job+'-preview')/(str(index)+'.jpg')
        if not p.exists():raise HTTPException(404)
        return FileResponse(p,media_type='image/jpeg')

    @app.post('/analyze')
    def analyze(body:dict):
        url,src=new_source(body);b_lang=body.get('language') or None
        try:count=max(1,min(12,int(body.get('count',4))));length=max(5,min(120,float(body.get('length',30))))
        except (TypeError,ValueError):raise HTTPException(400,'Choose a valid clip count and length.')
        if not (5<=length<=120):raise HTTPException(400,'Choose a valid clip length.')
        job=uuid.uuid4().hex;save(job,{'id':job,'status':'running','stage':'Starting local analysis','progress':0,'source':{'url':url}})
        def work():
            began=time.monotonic()
            try:
                source_id,p=download(url,job,body.get('source_height')) if url else (src.stem,src)
                meta=probe(p)
                state[job].update(source_id=source_id,stage='Scanning movement and audio locally',progress=.3)
                def report(seconds):state[job].update(progress=min(.95,.3+.65*seconds/max(meta['duration'],1)),stage=f'Scanning movement + audio: {int(seconds)} / {int(meta["duration"])} seconds')
                clips,engine=smart.find(p,meta['duration'],count,length,lambda f,m:state[job].update(progress=f,stage=m),b_lang,DATA,float(body.get('min_len',length*.5)))
                save(job,{'id':job,'status':'done','stage':'Candidates ready','progress':1,'source_id':source_id,'source':{'url':url},
                          'title':'Imported video' if url else 'Uploaded video','clips':clips,'engine':engine,
                          'elapsed_seconds':round(time.monotonic()-began,2),'meta':meta})
            except Exception as error:save(job,{'id':job,'status':'error','error':str(error)[-700:]})
        threading.Thread(target=work,daemon=True).start();return {'job':job}

    @app.get('/analysis/{job}')
    def analysis_status(job:str):
        if job not in state:raise HTTPException(404,'Analysis unavailable after restart. Please retry.')
        return state[job]

    @app.get('/highlights')
    def highlights():return [dict(record,job=record['id']) for record in list(state.values()) if record.get('status')=='done' and record.get('clips')]

    @app.post('/highlight-source')
    def highlight_source(body:dict):
        record=state.get(str(body.get('job','')),{});id=record.get('source_id','');p=source_path(id)
        return {'id':id,**probe(p)}
