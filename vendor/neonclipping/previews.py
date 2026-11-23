"""Early selectable video frames, independent of full source download."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import io,json,subprocess,urllib.request
import ytdl
from PIL import Image

def prepare(url,job,data,probe,publish):
    folder=data/(job+'-preview');folder.mkdir(exist_ok=True)
    frames=[]
    def ready(file,t,meta,kind):
        frames.append({'url':f'/preview/{job}/{len(frames)}','time':round(t,1),'kind':kind})
        publish({'preview_status':'ready' if len(frames)>=4 else 'loading','preview_frames':list(frames),'preview_meta':meta})
    # Own source cache enables full-resolution previews without a new download.
    cached=None
    for f in data.glob('*.request.json'):
        try:
            if json.loads(f.read_text()).get('url')==url:
                p=data/(f.name.split('.')[0]+'.mp4')
                if p.exists():cached=p;break
        except (OSError,ValueError):pass
    if cached:
        meta=probe(cached)
        for i,fraction in enumerate((.08,.3,.6,.85)):
            t=meta['duration']*fraction;out=folder/f'{i}.jpg'
            subprocess.run(['ffmpeg','-y','-v','error','-ss',str(t),'-i',str(cached),'-frames:v','1','-vf','scale=960:-2',str(out)],capture_output=True,check=True,timeout=25)
            ready(out,t,meta,'cached source frame')
        return
    with ytdl.YDL({'quiet':True,'no_warnings':True,'skip_download':True,'socket_timeout':12,'retries':1}) as y:
        info=y.extract_info(url,download=False)
    duration=float(info.get('duration') or 0)
    if not duration:raise RuntimeError('Replay duration unavailable. Wait for download or upload an MP4.')
    meta={'w':info.get('width') or 1280,'h':info.get('height') or 720,'duration':duration,'title':info.get('title','Video')}
    boards=[f for f in info.get('formats',[]) if f.get('protocol')=='mhtml' and f.get('fragments') and f.get('fps')]
    if boards:
        board=max(boards,key=lambda f:f.get('width',0));cols=board.get('columns',1);rows=board.get('rows',1);tiles=cols*rows
        sheets={}
        for i,fraction in enumerate((.08,.3,.6,.85)):
            t=duration*fraction;index=int(t*board['fps']);sheet=min(index//tiles,len(board['fragments'])-1);cell=index%tiles
            if sheet not in sheets:
                req=urllib.request.Request(board['fragments'][sheet]['url'],headers={'User-Agent':'Mozilla/5.0'})
                with urllib.request.urlopen(req,timeout=12) as response:raw=response.read(12*1024*1024)
                sheets[sheet]=Image.open(io.BytesIO(raw)).convert('RGB')
            image=sheets[sheet];cw=image.width//cols;ch=image.height//rows;x=cell%cols*cw;y=cell//cols*ch
            out=folder/f'{i}.jpg';image.crop((x,y,x+cw,y+ch)).save(out,quality=93)
            ready(out,t,meta,'storyboard frame (low-resolution preview)')
        return
    # Non-storyboard providers: seek a few frames from their low-resolution stream.
    formats=[f for f in info.get('formats',[]) if f.get('vcodec') not in (None,'none') and f.get('url') and f.get('height',9999)<=480]
    if not formats:raise RuntimeError('Early frames unavailable for this provider. Download continues.')
    stream=max(formats,key=lambda f:f.get('height',0))
    for i,fraction in enumerate((.08,.3,.6,.85)):
        t=duration*fraction;out=folder/f'{i}.jpg'
        headers=''.join(f'{k}: {v}\r\n' for k,v in info.get('http_headers',{}).items())
        cmd=['ffmpeg','-y','-v','error','-rw_timeout','12000000']
        if headers:cmd+=['-headers',headers]
        subprocess.run(cmd+['-ss',str(t),'-i',stream['url'],'-frames:v','1','-vf','scale=640:-2',str(out)],capture_output=True,check=True,timeout=25)
        ready(out,t,meta,'remote source frame')
