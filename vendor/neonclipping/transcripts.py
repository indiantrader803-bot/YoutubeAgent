"""Search a source transcript and choose passages without repeating highlight analysis."""
import hashlib
import json
import math
import threading
import unicodedata
import uuid

def cached_source(data,path,language=None):
    st=path.stat();key=hashlib.sha256(f'{path.stem}:{st.st_size}:{st.st_mtime_ns}:{language}'.encode()).hexdigest()
    cache=data/'transcripts'/(key+'.json')
    if cache.exists():return json.loads(cache.read_text(encoding='utf-8')).get('words')
    return None

def search(words,query='',limit=100,offset=0):
    """Phrase search across word/cue boundaries, with real source timestamps."""
    norm=lambda value:unicodedata.normalize('NFKC',str(value)).casefold()
    def tokens_for(value):
        return [token.strip('.,!?;:()[]{}"\'“”‘’…।') for token in norm(value).split()]
    tokens=[];owners=[]
    for index,word in enumerate(words):
        for token in tokens_for(word['text']):tokens.append(token);owners.append(index)
    target=tokens_for(query);hits=[]
    if not target:
        return [{'start':words[i]['start'],'end':words[min(i+19,len(words)-1)]['end'],'text':' '.join(w['text'] for w in words[i:i+20]),'first':i,'last':min(i+19,len(words)-1)} for i in range(offset*20,min(len(words),(offset+limit)*20),20)]
    skipped=0
    for i in range(len(tokens)-len(target)+1):
        if tokens[i:i+len(target)]!=target:continue
        if skipped<offset:skipped+=1;continue
        a,b=owners[i],owners[i+len(target)-1]
        left,right=max(0,a-6),min(len(words)-1,b+12)
        hits.append({'start':words[left]['start'],'end':words[right]['end'],'match_start':words[a]['start'],'match_end':words[b]['end'],'text':' '.join(w['text'] for w in words[left:right+1]),'first':left,'last':right})
        if len(hits)>=limit:break
    return hits

def attach(app,data,state,probe,transcribe):
    from fastapi import HTTPException
    folder=data/'transcripts';folder.mkdir(exist_ok=True)
    lock=threading.Lock();active={}
    def source(body):
        name=str(body.get('id',''))
        if not name.isalnum() or not (data/(name+'.mp4')).exists():raise HTTPException(400,'Load a source video first.')
        path=data/(name+'.mp4');duration=float(probe(path)['duration']);language=body.get('language') or None
        if language not in (None,'hi','hinglish','en'):raise HTTPException(400,'Choose a supported transcript language.')
        st=path.stat();key=hashlib.sha256(f'{name}:{st.st_size}:{st.st_mtime_ns}:{language}'.encode()).hexdigest()
        return name,path,duration,language,key
    def write(key,record):
        temp=folder/(key+'.tmp');temp.write_text(json.dumps(record,ensure_ascii=False),encoding='utf-8');temp.replace(folder/(key+'.json'))
    def read(key):
        if not key.isalnum():raise HTTPException(404,'Transcript not found.')
        p=folder/(key+'.json')
        if not p.exists():raise HTTPException(404,'Load or generate the source transcript first.')
        record=json.loads(p.read_text(encoding='utf-8'))
        src=data/(record['source_id']+'.mp4')
        if not src.exists():raise HTTPException(409,'The original source was removed.')
        st=src.stat();current=hashlib.sha256(f"{record['source_id']}:{st.st_size}:{st.st_mtime_ns}:{record.get('language')}".encode()).hexdigest()
        if current!=key:raise HTTPException(409,'The source was replaced. Load its new transcript.')
        return record
    @app.post('/transcripts/import')
    def import_track(body:dict):
        from subtitles import cues,validate_words,words_from
        name,path,duration,language,key=source(body)
        try:
            text=str(body.get('text',''))
            if len(text)>4_000_000:raise ValueError('Transcript is too large.')
            # Existing word-timed sources can retain exact timings through the API.
            words=validate_words(body['words'] if 'words' in body else words_from(text,0,duration),duration,200000)
            if not words:raise ValueError('No words fall within the source video.')
            with lock:write(key,{'key':key,'source_id':name,'duration':duration,'language':language,'words':words,'origin':'Imported word-timed transcript' if 'words' in body else 'Imported subtitles (estimated within-cue word timings)'})
            return read(key)
        except (ValueError,TypeError,KeyError,OverflowError) as error:raise HTTPException(400,str(error))
    @app.post('/transcripts/load')
    def load(body:dict):
        name,path,duration,language,key=source(body)
        with lock:
            if (folder/(key+'.json')).exists():return {'transcript':read(key),'cached':True}
            if key in active:return {'job':active[key]}
            if not body.get('generate'):return {'missing':True,'duration':duration}
            job=uuid.uuid4().hex;active[key]=job;state[job]={'status':'running','message':'Transcribing the full source locally. Long recordings can take time.'}
        def work():
            try:
                words=None;origin='Local speech recognition'
                request=data/(name+'.request.json')
                if request.exists():
                    try:
                        from standalone import allowed
                        from captions_yt import from_info
                        import ytdl
                        url=json.loads(request.read_text(encoding='utf-8')).get('url','')
                        if allowed(url) and ('youtu.be' in url or 'youtube.com' in url):
                            state[job].update(message='Reading the source YouTube captions before trying local recognition…')
                            with ytdl.YDL({'quiet':True,'no_warnings':True,'skip_download':True,'noplaylist':True,'socket_timeout':15,'retries':1}) as downloader:info=downloader.extract_info(url,download=False)
                            words=from_info(info)
                            if words and language=='hinglish':
                                from captions import ascii_fold
                                from translit import to_hinglish
                                words=[dict(word,text=ascii_fold(to_hinglish(word['text']))) for word in words]
                                words=[word for word in words if word['text'].strip()]
                            if words:origin='YouTube source captions'
                    except Exception:words=None
                if words is None:words=transcribe(path,0,duration,data,lambda message:state[job].update(message=message),language)['words']
                record={'key':key,'source_id':name,'duration':duration,'language':language,'words':words,'origin':origin}
                with lock:write(key,record)
                state[job]={'status':'done','transcript':record}
            except Exception as error:state[job]={'status':'error','error':str(error)[-500:]}
            finally:
                with lock:active.pop(key,None)
        threading.Thread(target=work,daemon=True).start();return {'job':job}
    @app.post('/transcripts/search')
    def find(body:dict):
        record=read(str(body.get('key','')));query=str(body.get('query',''))
        if len(query)>500:raise HTTPException(400,'Use a shorter search phrase.')
        try:offset=int(body.get('offset',0));assert 0<=offset<=200000
        except (ValueError,TypeError,AssertionError):raise HTTPException(400,'Invalid transcript page.')
        matches=search(record['words'],query,101,offset)
        return {'matches':matches[:100],'source_id':record['source_id'],'limit':100,'offset':offset,'has_more':len(matches)>100}

