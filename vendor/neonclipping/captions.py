"""Independent word-timed ASR, editable transcript and styled ASS/SRT."""
from pathlib import Path
from translit import to_hinglish
import json,os,threading,subprocess
MODELS={}
ROMAN_PROMPT='Aaj hum GTA 6 ke baare mein baat karenge, yeh bahut mast hai. Kya haal hai bhai, chalo shuru karte hain. Matlab ekdum sahi hai, nahi yaar, bilkul.'
DEVA_PROMPT='यह हिंदी और अंग्रेज़ी में गेमिंग वीडियो है। GTA, गेमप्ले, क्लिपिंग, वीडियो, टूल।'

def large_v3():
    snaps=list((Path.home()/'.cache/huggingface/hub/models--Systran--faster-whisper-large-v3/snapshots').glob('*'))
    return str(snaps[0]) if snaps else 'large-v3'

def _best_hindi():
    """large-v3 is clearly better at Hindi than distilled turbo, but on a 6 GB GPU shared with other apps it measured
    ~6 minutes for a 40 s clip (memory spill). Auto-use it only when 3.4 GB of GPU memory is really free."""
    try:
        if os.environ.get('NEONCLIPPING_CPU')=='1':return ''
        free=int(subprocess.run(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5).stdout.split()[0])
        if free>=3400:return large_v3()
    except Exception:pass
    return ''

def _load(WhisperModel,spec,data):
    """GPU first (int8_float16, ~10x faster than CPU), CPU int8 as fallback. Never crashes on a missing CUDA runtime."""
    import sys
    site=Path(sys.prefix)/'Lib'/'site-packages'/'nvidia'
    for sub in ('cublas','cudnn'):
        b=site/sub/'bin'
        if b.exists():
            try:os.add_dll_directory(str(b))
            except (OSError,AttributeError):pass
            os.environ['PATH']=str(b)+os.pathsep+os.environ['PATH']
    big=('large-v3' in spec) and ('turbo' not in spec)
    if big:                       # large-v3 spilling out of a full 6 GB GPU measured 384 s vs 87 s on the CPU for a 30 s clip
        try:
            free=int(subprocess.run(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5).stdout.split()[0])
        except Exception:free=0
        big=free<3400
    try:                          # no NVIDIA/CUDA here (a Mac, a laptop without a GPU): skip the doomed GPU attempt
        import ctranslate2;has_cuda=ctranslate2.get_cuda_device_count()>0
    except Exception:has_cuda=True   # cannot tell: keep the old behaviour (try the GPU, fall back to CPU)
    if os.environ.get('NEONCLIPPING_CPU')!='1' and not big and has_cuda:
        try:
            m=WhisperModel(spec,device='cuda',compute_type='int8_float16',download_root=str(data/'models'))
            list(m.transcribe(__import__('numpy').zeros(16000,dtype='float32'))[0])   # prove cuDNN/cuBLAS really load
            return m
        except Exception:pass
    return WhisperModel(spec,device='cpu',compute_type='int8',cpu_threads=max(1,(os.cpu_count() or 4)-2),download_root=str(data/'models'))
def ascii_fold(text):
    """Hinglish is written in plain English letters: fold accents (nosga, funcao) and drop stray non-Latin symbols Whisper hallucinates."""
    import unicodedata
    folded=''.join(c for c in unicodedata.normalize('NFKD',text) if not unicodedata.combining(c))
    return ''.join(c for c in folded if ord(c)<128 or c in '’‘“”…।')

def collapse_repeats(words,limit=3):
    """Whisper sometimes loops on noisy audio ("chal chal chal chal chal ..."). A word said more than `limit` times in a row is cut back to `limit`
    (Hindi really does say "bhaag bhaag bhaag", so three in a row stay)."""
    out=[];run=0;prev=None
    for w in words:
        key=w['text'].lower().strip('.,!?;:')
        run=run+1 if key==prev else 1
        prev=key
        if key and run>limit:continue
        out.append(w)
    return out

TURBO_FILES=('model.bin','config.json','tokenizer.json','vocabulary.json')
def _turbo_spec():
    """Path of a COMPLETE large-v3-turbo snapshot. A half-finished download (only model.bin) used to fail every job with
    "Cannot load the vocabulary from the model directory", so an incomplete one is repaired (missing small files only)."""
    repo='mobiuslabsgmbh/faster-whisper-large-v3-turbo'
    snaps=Path.home()/('.cache/huggingface/hub/models--'+repo.replace('/','--')+'/snapshots')
    def complete():
        return [p for p in snaps.glob('*') if all((p/f).exists() for f in TURBO_FILES)]
    ok=complete()
    if not ok:
        try:
            from huggingface_hub import snapshot_download
            snapshot_download(repo)
            ok=complete()
        except Exception:pass
    return str(ok[0]) if ok else 'small'

LOCK=threading.Lock()

def _load_audio(path):
    """16 kHz mono WAV written by ffmpeg -> float32 numbers, so faster-whisper never has to open the file with PyAV."""
    import wave, numpy as np
    with wave.open(str(path), 'rb') as w:
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(source,start,end,data,report=lambda message:None,language=None,model=None):
    report('Loading local speech model (first use may download it)')
    from faster_whisper import WhisperModel
    spec=model or os.environ.get('FACECAM_ASR_MODEL','') or (_best_hindi() if language in ('hi','hinglish') else '')
    if not spec:
        spec=_turbo_spec()
    model_tag=Path(spec).name[:14]
    key=f'{source.stem}-{start:.2f}-{end:.2f}-{language or "auto"}-{model_tag}-v3'
    cached=data/(key+'.words.json')
    if cached.exists():return json.loads(cached.read_text(encoding='utf-8'))
    with LOCK:
        MODEL=MODELS.get(spec)
        if MODEL is None:
            MODEL=MODELS[spec]=_load(WhisperModel,spec,data)
        audio=data/(key+'.wav')
        subprocess.run(['ffmpeg','-y','-v','error','-ss',str(start),'-t',str(end-start),'-i',str(source),'-vn','-ac','1','-ar','16000',str(audio)],capture_output=True,check=True,timeout=300)
        try:
            report('Transcribing selected clip locally')
            # 'hinglish' = Hindi speech written in Roman letters (a Roman-script prompt steers Whisper to it)
            prompt=DEVA_PROMPT if language in ('hi','hinglish') else None
            segments,info=MODEL.transcribe(_load_audio(audio),beam_size=5,language=('hi' if language=='hinglish' else language) or None,initial_prompt=prompt,word_timestamps=True,vad_filter=True,condition_on_previous_text=False)
            words=[]
            for segment in segments:
                report(f'speech {int(segment.end)}/{int(end-start)} s')
                for w in segment.words or []:
                    text=w.word.strip()
                    if language=='hinglish':text=ascii_fold(to_hinglish(text)).strip()
                    if text and w.end>w.start:words.append({'start':round(max(0,w.start),3),'end':round(min(end-start,w.end),3),'text':text})
            words=collapse_repeats(words)
            result={'words':words,'language':info.language,'duration':end-start,'model':model_tag}
            cached.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8');return result
        finally:audio.unlink(missing_ok=True)

def stamp(t,ass=False):
    units=int(round(max(0,float(t))*(100 if ass else 1000)));h,units=divmod(units,(360000 if ass else 3600000));m,units=divmod(units,(6000 if ass else 60000));s,u=divmod(units,(100 if ass else 1000))
    return f'{h}:{m:02}:{s:02}.{u:02}' if ass else f'{h:02}:{m:02}:{s:02},{u:03}'

# style -> (rest colour, active colour, outline/shadow tags, font size, pop scale %). ASS colours are BGR.
STYLES={
 'gta':('&H00EFFF43&','&H00A845FF&',r'\bord4\3c&H00560C31&\shad5\4c&H00FFCC00&\blur0.7',72,0),
 'bold':('&H00FFFFFF&','&H003DF3CB&',r'\bord6\shad4',72,0),
 'hormozi':('&H00FFFFFF&','&H00FFFF00&',r'\bord7\3c&H00000000&\shad4\4c&H80000000&',84,112),
 'mrbeast':('&H0000FFFF&','&H000066FF&',r'\bord9\3c&H00000000&\shad5\4c&H00000000&',90,112),
}
STYLE_NAMES=tuple(STYLES)+('clean',)

def safe(text):return str(text).replace('\\','/').replace('{','(').replace('}',')').replace('\n',' ')

def group_words(words,max_words=4,max_chars=24,gap=0.45):
    """2-4 word caption groups that follow the speech: break after punctuation or a pause, never mid-phrase padding."""
    groups=[];cur=[]
    for i,w in enumerate(words):
        cur.append(w)
        nxt=words[i+1] if i+1<len(words) else None
        text=w['text'].rstrip()
        chars=sum(len(x['text'])+1 for x in cur)
        stop=nxt is None or len(cur)>=max_words or (len(cur)>=2 and (text[-1:] in '.?!,;:।…' or nxt['start']-w['end']>gap)) or (len(cur)>=2 and chars+len(nxt['text'])>max_chars)
        if stop:groups.append(cur);cur=[]
    # a lone trailing word reads badly: merge it into the previous group when that stays <=4 words
    if len(groups)>1 and len(groups[-1])==1 and len(groups[-2])<max_words and groups[-1][0]['start']-groups[-2][-1]['end']<gap:
        lone=groups.pop();groups[-1]+=lone       # (groups[-2]+=groups.pop() stored into the wrong group after the pop)
    if max_words>1 and len(groups)>1 and len(groups[-1])==1 and len(groups[-2])>=max_words:     # 4+1 -> 3+2
        groups[-1].insert(0,groups[-2].pop())
    return groups

def hook_lines(hook,width=17,max_lines=3):
    """Whole words only, 1-3 short centred lines (the old fixed-position hook ran off both screen edges)."""
    import textwrap
    words=safe(hook).split()
    text=' '.join(words)
    if len(text)>60:
        text=text[:60].rsplit(' ',1)[0]
    lines=textwrap.wrap(text,width=width) or ['']
    return lines[:max_lines]

BS=chr(92)
ANIMS=('highlight','pop_in','pop_in_line','one_by_one','build_up','full_line')

def write(words,style,folder,name,hook='',position=1450,hook_y=300,width=1080,height=1920,anim='highlight',appearance=None):
    from brands import appearance as validate_appearance,ass_color
    custom=validate_appearance(appearance or {})
    scale=min(width/1080,height/1920)
    # Font fallback resolves Hindi through installed Windows Nirmala UI.
    ass=['[Script Info]','ScriptType: v4.00+',f'PlayResX: {width}',f'PlayResY: {height}','WrapStyle: 2',
         '[V4+ Styles]','Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
         'Style: Main,Arial,72,&H00FFFFFF,&H0000FFFF,&H00100B18,&H99000000,-1,0,0,0,100,100,0,0,1,5,2,5,50,50,0,1',
         '[Events]','Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text']
    if custom.get('caption_font'):ass[7]=ass[7].replace('Main,Arial,','Main,'+custom['caption_font']+',')
    font_size=custom.get('caption_size',STYLES.get(style,('','','',58,0))[3])
    srt=[];groups=group_words(words,max_words=custom.get('caption_max_words',4),max_chars=int((width-100*width/1080)/(font_size*scale*0.62)))
    for i,group in enumerate(groups):
        if not group:continue
        begin=group[0]['start'];end=group[-1]['end']
        line=' '.join(safe(w['text']) for w in group)
        srt.append(f'{i+1}\n{stamp(begin)} --> {stamp(end)}\n{line}\n')
        rest,active,extra,size,pop=(('&H00FFFFFF&','&H00FFFFFF&',BS+'bord3',58,0) if style=='clean' else STYLES[style])
        rest=ass_color(custom['caption_color']) if 'caption_color' in custom else rest
        active=ass_color(custom['caption_active']) if 'caption_active' in custom else active
        if 'caption_outline' in custom:extra+=BS+'3c'+ass_color(custom['caption_outline'])
        size=round(custom.get('caption_size',size)*scale)
        cs=(lambda v:v.lower()) if style=='clean' else (lambda v:v.upper())
        pos=BS+'pos('+str(width//2)+','+str(position)+')'+BS+'fs'+str(size)+extra
        if anim=='full_line' or (style=='clean' and anim=='highlight' and 'caption_active' not in custom):
            text='{'+pos+BS+'c'+rest+BS+'fad(90,0)}'+' '.join(cs(safe(w['text'])) for w in group)
            ass.append(f'Dialogue: 1,{stamp(begin,True)},{stamp(end,True)},Main,,0,0,0,,{text}')
            continue
        for n,word in enumerate(group):
            a=max(begin,word['start']);b=group[n+1]['start'] if n+1<len(group) else end
            if n+1<len(group):b=min(b,max(word['end'],a)+0.8)      # quiet part: the line goes away instead of hanging on screen
            if b<=a:continue
            if anim=='one_by_one':visible=[n]
            elif anim in ('build_up','pop_in'):visible=list(range(n+1))
            else:visible=list(range(len(group)))          # highlight, pop_in_line
            chunks=[]
            for k in visible:
                t=cs(safe(group[k]['text']));newest=(k==n)
                if newest and (pop or anim in ('pop_in','one_by_one')):
                    pp=str(pop or 118)
                    chunks.append('{'+BS+'c'+active+BS+'fscx100'+BS+'fscy100'+BS+'t(0,110,'+BS+'fscx'+pp+BS+'fscy'+pp+')'+BS+'t(110,230,'+BS+'fscx100'+BS+'fscy100)}'+t+'{'+BS+'fscx100'+BS+'fscy100}')
                else:chunks.append('{'+BS+'c'+(active if newest else rest)+'}'+t)
            lead=(BS+'fscx82'+BS+'fscy82'+BS+'t(0,140,'+BS+'fscx100'+BS+'fscy100)'+BS+'fad(80,0)') if (anim=='pop_in_line' and n==0) else ''
            text='{'+pos+lead+'}'+' '.join(chunks)
            ass.append(f'Dialogue: 1,{stamp(a,True)},{stamp(b,True)},Main,,0,0,0,,{text}')
    if hook.strip():
        import hooks
        lines=hook_lines(hook,width=max(12,int(width/(82*scale*.6))))
        ass.extend(hooks.events(lines,width,height,hook_y,scale,appearance or {}))
    (folder/(name+'.ass')).write_text('\n'.join(ass),encoding='utf-8')
    (folder/(name+'.srt')).write_text('\n'.join(srt),encoding='utf-8')
    return name+'.ass',name+'.srt'
