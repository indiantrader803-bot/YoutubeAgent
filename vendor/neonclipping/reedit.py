"""Native saved-clip editing. Never download, discover moments or invoke ASR here."""
import json
import math
import threading
import time
import uuid
from pathlib import Path
from fastapi import HTTPException

CHANGE_KEYS = {'aspect','resolution','fps','layout','top','cam','game','caption_style','caption_y','captions','hook','title','post_caption'}
from styling import KEYS as STYLE_KEYS
from brands import KEYS as BRAND_KEYS,appearance
from hooks import KEYS as HOOK_KEYS,settings as hook_settings
CHANGE_KEYS = CHANGE_KEYS | set(STYLE_KEYS)
CHANGE_KEYS = CHANGE_KEYS | set(BRAND_KEYS)
CHANGE_KEYS = CHANGE_KEYS | set(HOOK_KEYS)

def trim_words(words, shift, length):
    """Move subtitle word times for a clip that now starts `shift` seconds later (negative = earlier) and lasts `length` seconds.
    Words that fall outside the new clip are dropped; words cut by an edge are shortened. Times are relative to the clip start."""
    out=[]
    for w in words or []:
        a=float(w['start'])-shift;z=float(w['end'])-shift
        if z<=0.02 or a>=length-0.02:continue
        a=max(0.0,a);z=min(length,z)
        if z-a>=0.02:out.append({**w,'start':round(a,3),'end':round(z,3)})
    return out

def latest_file(data, file):
    """If a clip was re-edited, its newer version is the one to work on (stale cards still point at the old file)."""
    seen=set()
    while isinstance(file,str) and file.isalnum() and file not in seen:
        seen.add(file);path=data/(file+'.json')
        try:newer=json.loads(path.read_text(encoding='utf-8')).get('superseded_by')
        except (OSError,ValueError):break
        if not newer:break
        file=newer
    return file

def ancestors(data, file):
    """Older file names that this clip replaced (result cards on screen may still hold one of them)."""
    out=[];todo=[file]
    while todo:
        cur=todo.pop()
        for path in data.glob('*.json'):
            if path.name.endswith(('.state.json','.words.json','.request.json')):continue
            try:
                if json.loads(path.read_text(encoding='utf-8')).get('superseded_by')==cur and path.stem not in out:
                    out.append(path.stem);todo.append(path.stem)
            except (OSError,ValueError):pass
    return out

def read_record(data, file):
    if not isinstance(file,str) or not file.isalnum():
        raise HTTPException(400,'Choose a saved clip.')
    path=data/(file+'.json')
    if not path.exists(): raise HTTPException(404,'Saved clip not found.')
    record=json.loads(path.read_text(encoding='utf-8'))
    if record.get('result',{}).get('status')!='done':
        raise HTTPException(400,'This clip has not finished exporting.')
    return record

def saved_words(data, file, record):
    settings=record.get('settings',{})
    if isinstance(settings.get('words'),list): return settings['words']
    # Recover old exports' existing SRT instead of silently transcribing again.
    path=data/(file+'.srt')
    if not path.exists():
        if record.get('result',{}).get('caption_words',0):
            raise HTTPException(409,'No saved subtitles for this older clip. Import its SRT or generate subtitles once.')
        return []
    def seconds(value):
        h,m,s=value.replace(',','.').split(':');return int(h)*3600+int(m)*60+float(s)
    words=[]
    for block in path.read_text(encoding='utf-8-sig').strip().split('\n\n'):
        lines=block.splitlines()
        if len(lines)<3 or '-->' not in lines[1]:continue
        a,b=lines[1].split('-->');a,b=seconds(a.strip()),seconds(b.strip())
        tokens=' '.join(lines[2:]).split()
        for i,text in enumerate(tokens):
            words.append({'start':a+(b-a)*i/len(tokens),'end':a+(b-a)*(i+1)/len(tokens),'text':text})
    return words

def attach(app,data,state,probe,export,save):
    # Legacy batches can be recovered from their persisted job records.
    def group_map():
        mapping={}
        for path in data.glob('*.state.json'):
            try:
                record=json.loads(path.read_text(encoding='utf-8'))
                for clip in record.get('clips',[]):
                    if clip.get('file'):
                        mapping[clip['file']]={'batch_id':path.name.split('.')[0],
                            'source_url':record.get('source',{}).get('url') or record.get('url','')}
            except (ValueError,OSError):pass
        return mapping

    def metadata(file,record,groups=None):
        settings=record['settings'];legacy=(groups or group_map()).get(file,{})
        return {'batch_id':settings.get('batch_id') or legacy.get('batch_id') or record.get('source'),
                'source_url':settings.get('source_url') or legacy.get('source_url','')}

    def video_files(anchor,base,groups=None):
        """Every finished, not-superseded clip made from the same video as `anchor`."""
        groups=groups or group_map();meta=metadata(anchor,base,groups);files=[]
        for path in data.glob('*.json'):
            if path.name.endswith(('.state.json','.words.json','.request.json')):continue
            try:
                record=read_record(data,path.stem)
                if record.get('superseded_by'):continue
                candidate=metadata(path.stem,record,groups)
                same_url=bool(meta['source_url']) and candidate['source_url']==meta['source_url']
                same_batch=candidate['batch_id']==meta['batch_id']
                # Uploaded / local videos have no link: the same saved source file is the same video.
                same_source=not meta['source_url'] and not candidate['source_url'] and record.get('source')==base.get('source')
                if same_url or same_batch or same_source:files.append(path.stem)
            except (HTTPException,ValueError,OSError,KeyError):pass
        if anchor not in files:files.append(anchor)
        return files

    app.reedit_video_files=video_files
    app.reedit_metadata=metadata
    app.reedit_groups=group_map

    @app.get('/clips/{file}/edit')
    def editor(file:str):
        file=latest_file(data,file);record=read_record(data,file);settings=record['settings'];source=record['source']
        if not source.isalnum() or not (data/(source+'.mp4')).exists():
            raise HTTPException(409,'Original source is unavailable. Restore it to edit this clip without downloading again.')
        return {'file':file,'settings':{**settings,'words':saved_words(data,file,record)},
                'source':{'id':source,**probe(data/(source+'.mp4'))},'video_clips':len(video_files(file,record)),**metadata(file,record)}

    @app.post('/clips/reedit')
    def apply(body:dict):
        anchor=latest_file(data,str(body.get('file','')));base=read_record(data,anchor)
        changes=body.get('changes',{})
        if not isinstance(changes,dict) or set(changes)-CHANGE_KEYS:
            raise HTTPException(400,'Choose supported layout or caption settings.')
        groups=group_map();meta=metadata(anchor,base,groups)
        files=body.get('files')
        if files is None:
            files=[anchor]
            if body.get('scope')=='video':files=video_files(anchor,base,groups)
        if not isinstance(files,list) or not files or len(files)>100 or any(not isinstance(x,str) for x in files):
            raise HTTPException(400,'Select between 1 and 100 saved clips.')
        files=list(dict.fromkeys(files));prepared=[]
        trim=body.get('trim')       # {'start','end'} in seconds of the saved video: cut the clip shorter (or a little longer)
        if trim is not None:
            try:trim_start=float(trim['start']);trim_end=float(trim['end'])
            except (KeyError,TypeError,ValueError):raise HTTPException(400,'Trim needs a start and an end in seconds.')
            if len(files)!=1:raise HTTPException(400,'Trim works on one clip at a time. Use "Only this clip".')
            if not (math.isfinite(trim_start) and math.isfinite(trim_end)) or trim_start<0 or not 3<=trim_end-trim_start<=180:
                raise HTTPException(400,'A clip must be between 3 and 180 seconds long.')
        for file in files:
            record=read_record(data,file);settings=dict(record['settings'])
            settings.update(changes)
            # Each clip keeps its own transcript, title, hook and timing in a batch.
            if len(files)>1:
                for key in ('title','hook','post_caption'):settings[key]=record['settings'].get(key,'')
            settings['words']=saved_words(data,file,record)
            if file==anchor and 'words' in body:
                if not isinstance(body['words'],list):raise HTTPException(400,'Invalid subtitle words.')
                settings['words']=body['words']
            settings['revision_of']=file
            settings.update(metadata(file,record,groups))
            source=record['source']
            if not source.isalnum() or not (data/(source+'.mp4')).exists():
                raise HTTPException(409,'A saved source is missing; no clips were changed.')
            settings['id']=source
            if trim is not None:
                have=probe(data/(source+'.mp4'))['duration']
                if trim_end>have+.05:raise HTTPException(400,f'The saved video is only {have:.1f}s long here, so the end cannot be later than that.')
                settings['words']=trim_words(settings['words'],trim_start-float(settings['start']),trim_end-trim_start)
                settings['start']=trim_start;settings['end']=trim_end
            # Validate all inputs synchronously before scheduling any work.
            from layouts import geometry, output_settings
            try:
                width,height,_=output_settings(settings)
                appearance(settings)
                hook_settings(settings)
                geometry(settings.get('layout','stack'),settings.get('top',.32),width,height)
                if settings.get('caption_style','gta') not in ('gta','bold','clean','hormozi','mrbeast'):raise ValueError()
                if not 400<=int(settings.get('caption_y',1450))<=1750:raise ValueError()
                for key in ('cam','game'):
                    vals=[float(settings[key][k]) for k in ('x','y','w','h')]
                    if not all(map(math.isfinite,vals)) or min(vals)<0 or min(vals[2:])<.01:raise ValueError()
                for word in settings['words']:
                    a,z=float(word['start']),float(word['end'])
                    if not math.isfinite(a) or not math.isfinite(z) or not 0<=a<z<=settings['end']-settings['start']+.1:raise ValueError()
                    if not isinstance(word['text'],str):raise ValueError()
            except (ValueError,KeyError,TypeError,OverflowError):raise HTTPException(400,'Check layout, caption timings and crop regions.')
            prepared.append((file,record,settings))
        job=uuid.uuid4().hex
        save(job,{'id':job,'kind':'reedit','status':'running','stage':'Applying saved edits','progress':0,'clips':[],
                  'reused':{'download':True,'highlights':True,'transcript':True},'total':len(prepared)})
        def work():
            began=time.monotonic();clips=[]
            try:
                for i,(file,old,settings) in enumerate(prepared):
                    child=export(settings)['job']
                    while state.get(child,{}).get('status')=='running':time.sleep(.2)
                    result=state[child]
                    if result['status']!='done':raise RuntimeError(result.get('error','Export failed'))
                    old['superseded_by']=child
                    path=data/(file+'.json');temp=path.with_suffix('.json.tmp')
                    temp.write_text(json.dumps(old,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
                    clips.append({'file':child,'previous':file,'was':ancestors(data,file),'title':settings.get('title','Edited clip'),'srt':result.get('srt')})
                    save(job,{'clips':clips,'progress':(i+1)/len(prepared),'stage':f'Updated {i+1}/{len(prepared)}'})
                save(job,{'status':'done','stage':'Edits applied','elapsed_seconds':round(time.monotonic()-began,2)})
            except Exception as error:save(job,{'status':'error','error':str(error)[-600:]})
        threading.Thread(target=work,daemon=True).start()
        return {'job':job,'clips':len(prepared)}
