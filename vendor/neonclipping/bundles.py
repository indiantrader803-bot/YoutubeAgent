"""Download saved clips, captions and post copy together without reprocessing media."""
import json
import re
import shutil
import time
import uuid
import zipfile
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse
from reedit import latest_file, read_record

def build_bundle(data, files, folder):
    data=Path(data);folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    files=list(dict.fromkeys(latest_file(data,file) for file in files))
    if not files or len(files)>100:raise HTTPException(400,'Choose 1 to 100 finished clips.')
    records=[(file,read_record(data,file)) for file in files]
    if any(not (data/(file+'.mp4')).exists() for file,_ in records):
        raise HTTPException(409,'A selected video is missing. Nothing was reprocessed.')
    required=sum((data/(file+'.mp4')).stat().st_size for file,_ in records)
    if shutil.disk_usage(folder).free<required+256*1024**2:
        raise HTTPException(507,'Not enough free storage to prepare this download.')
    token=uuid.uuid4().hex;path=folder/(token+'.zip');manifest=[];copy=[]
    try:
        # MP4 is already compressed: STORE avoids wasteful recompression and CPU load.
        with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
            for index,(file,record) in enumerate(records,1):
                settings=record['settings'];title=str(settings.get('title') or 'Clip')
                safe=re.sub(r'[^\w .-]','',title,flags=re.UNICODE).strip(' .')[:70] or 'clip'
                stem=f'{index:02d}-{safe}'
                for extension in ('.mp4','.srt','.ass','.vtt'):
                    source=data/(file+extension)
                    if source.exists() and (extension=='.mp4' or record['result'].get('caption_words',0)):
                        archive.write(source,stem+extension)
                try:
                    import cover
                    archive.write(cover.make(data,file,title,str(settings.get('hook') or ''),cover.hook_until(settings)),stem+'-cover.jpg')
                except Exception:
                    pass          # a missing cover never blocks the clips themselves
                item={'file':file,'download':stem+'.mp4','title':title,'hook':settings.get('hook',''),
                      'post_caption':settings.get('post_caption',''),'source_url':settings.get('source_url',''),
                      'saved_source_range':{'start':settings.get('start'),'end':settings.get('end')},
                      'layout':settings.get('layout'),'caption_style':settings.get('caption_style')}
                manifest.append(item)
                copy.append(f"{index:02d}. {title}\nHook: {item['hook']}\nPost caption: {item['post_caption']}\n")
            archive.writestr('clips.json',json.dumps({'app':'NeonClipping','clips':manifest},ensure_ascii=False,indent=2))
            archive.writestr('clips.txt','\n'.join(copy))
    except Exception:
        path.unlink(missing_ok=True);raise
    return {'bundle':token,'clips':len(files),'bytes':path.stat().st_size,'download':'/bundles/'+token}

def attach(app,data):
    folder=Path(data)/'bundles'
    @app.post('/bundles')
    def create(body:dict):
        files=body.get('files')
        if files is None:
            anchor=latest_file(data,str(body.get('file','')));record=read_record(data,anchor)
            files=app.reedit_video_files(anchor,record) if body.get('scope')=='video' else [anchor]
        if not isinstance(files,list) or any(not isinstance(file,str) for file in files):
            raise HTTPException(400,'Choose saved clips to download.')
        return build_bundle(data,files,folder)

    @app.get('/bundles/{token}')
    def download(token:str):
        if not re.fullmatch('[a-f0-9]{32}',token):raise HTTPException(404)
        path=folder/(token+'.zip')
        if not path.exists():raise HTTPException(404,'Download unavailable. Prepare the bundle again.')
        return FileResponse(path,media_type='application/zip',filename='NeonClipping-clips.zip')
