"""Optional local image-model review of actual candidate frames.

Frame descriptions are model observations, not verified game-event labels.
No model weights are downloaded or images sent to a hosted provider.
"""
import base64
import hashlib
import json
import subprocess
import threading
import time
import urllib.request
import uuid
from pathlib import Path
OLLAMA='http://127.0.0.1:11434'
def clean_description(answer):
    try:
        decoded=json.loads(answer)
        if isinstance(decoded,dict) and isinstance(decoded.get('description'),str):answer=decoded['description']
    except (ValueError,TypeError):pass
    return str(answer).strip()[:1200]

def model():
    try:
        models=json.load(urllib.request.urlopen(OLLAMA+'/api/tags',timeout=3))['models']
        # Tested backend: installed Gemma4 supports completion + images. The installed
        # moondream tag rejects /api/generate and must not be advertised as working.
        for row in models:
            if not row['name'].startswith('gemma4:'):continue
            capabilities=row.get('capabilities')
            if capabilities is None:
                request=urllib.request.Request(OLLAMA+'/api/show',json.dumps({'model':row['name']}).encode(),{'Content-Type':'application/json'})
                capabilities=json.load(urllib.request.urlopen(request,timeout=3)).get('capabilities',[])
            if 'vision' in capabilities and 'completion' in capabilities:return row['name']
        return None
    except Exception:return None

def describe(name,jpeg):
    import smart
    prompt=('Describe only what is visibly present in this gameplay/video frame in one short sentence. '
            'Ignore webcam faces, subtitles, HUD and interface text. Name a vehicle/object only if clear. '
            'Do not infer a story, intent, outcome or an event between frames. If blank or unclear, say so.')
    payload=smart._payload(name,prompt,110,0)
    payload.pop('format',None)
    payload['images']=[base64.b64encode(jpeg).decode()]
    req=urllib.request.Request(OLLAMA+'/api/generate',json.dumps(payload).encode(),{'Content-Type':'application/json'})
    answer=clean_description(json.load(urllib.request.urlopen(req,timeout=120)).get('response',''))
    if not answer:raise ValueError('The visual model returned no description.')
    return answer[:1200]

def review(source,start,duration,data,report=lambda text:None):
    name=model()
    if not name:raise ValueError('Install a compatible local Gemma4 vision model in Ollama to use visual review.')
    frames=[];times=[]
    for fraction in (.15,.5,.85):
        at=start+duration*fraction
        image=subprocess.check_output(['ffmpeg','-v','error','-ss',str(at),'-i',str(source),'-frames:v','1','-vf','scale=640:-2','-f','image2pipe','-vcodec','mjpeg','-'],timeout=60)
        if not image:raise ValueError('Could not extract the visual review frames.')
        frames.append(image);times.append(round(at,3))
    key=hashlib.sha256(name.encode()+b'visual-v1'+json.dumps(times).encode()+b''.join(frames)).hexdigest();folder=data/'vision'/key;path=folder/'review.json'
    if path.exists():
        cached=json.loads(path.read_text(encoding='utf-8'))
        for frame in cached['frames']:frame['description']=clean_description(frame['description'])
        return {**cached,'cached':True}
    folder.mkdir(parents=True,exist_ok=True);observations=[];began=time.monotonic()
    for i,(at,jpeg) in enumerate(zip(times,frames)):
        report(f'Reading visual frame {i+1}/3 locally…')
        description=describe(name,jpeg);(folder/(str(i)+'.jpg')).write_bytes(jpeg)
        observations.append({'time':at,'description':description,'image':f'/vision/frame/{key}/{i}'})
    result={'key':key,'model':name,'frames':observations,'seconds':round(time.monotonic()-began,2),'cached':False}
    temp=path.with_suffix('.'+uuid.uuid4().hex+'.tmp');temp.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
    return result

def attach(app,data,state,probe):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    @app.get('/vision/status')
    def status():return {'model':model(),'local':True,'automatic_download':False}
    @app.get('/vision/frame/{key}/{index}')
    def frame(key:str,index:int):
        if len(key)!=64 or any(c not in '0123456789abcdef' for c in key) or index not in (0,1,2):raise HTTPException(404)
        path=data/'vision'/key/(str(index)+'.jpg')
        if not path.exists():raise HTTPException(404)
        return FileResponse(path,media_type='image/jpeg')
    @app.post('/vision/review')
    def request(body:dict):
        name=str(body.get('id',''))
        if not name.isalnum() or not (data/(name+'.mp4')).exists():raise HTTPException(400,'Load a source video first.')
        try:
            import math
            start,end=float(body.get('start',0)),float(body['end']);duration=float(probe(data/(name+'.mp4'))['duration'])
            if not all(map(math.isfinite,(start,end))) or not 0<=start<end<=duration+.1 or end-start>600:raise ValueError('Choose a source passage shorter than ten minutes.')
        except (ValueError,TypeError,KeyError) as error:raise HTTPException(400,str(error))
        if not model():raise HTTPException(409,'No compatible local Gemma4 vision model is available.')
        job=uuid.uuid4().hex;state[job]={'status':'running','message':'Starting local visual review…'}
        def work():
            try:state[job]={'status':'done','review':review(data/(name+'.mp4'),start,end-start,data,lambda text:state[job].update(message=text))}
            except Exception as error:state[job]={'status':'error','error':str(error)[-500:]}
        threading.Thread(target=work,daemon=True).start();return {'job':job}
