"""Local caption appearance presets. No fonts or user data are uploaded."""
import json
import math
import re
import threading

KEYS=('caption_font','caption_size','caption_color','caption_active','caption_outline','caption_max_words')
FONTS=('Arial','Arial Black','Impact','Verdana','Georgia','Nirmala UI','DejaVu Sans','Liberation Sans')

def appearance(body):
    result={}
    for key in KEYS:
        value=body.get(key)
        if value in (None,''):continue
        if key=='caption_font':
            if not isinstance(value,str) or not re.fullmatch(r'[\w -]{1,80}',value):raise ValueError('Use a font family name with letters, numbers, spaces or hyphens.')
        elif key in ('caption_color','caption_active','caption_outline'):
            if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value):raise ValueError('Choose a six-digit caption colour.')
            value=value.upper()
        else:
            value=float(value)
            lo,hi=(24,140) if key=='caption_size' else (1,12)
            if not math.isfinite(value) or not lo<=value<=hi or value!=int(value):raise ValueError('Caption size must be 24–140; group size 1–12.')
            value=int(value)
        result[key]=value
    return result

def ass_color(value):
    value=value.lstrip('#')
    return '&H00'+value[4:6]+value[2:4]+value[:2]+'&'

def attach(app,data):
    from fastapi import HTTPException
    path=data/'preferences'/'caption-brands.json';lock=threading.Lock()
    def read():
        if not path.exists():return {}
        return json.loads(path.read_text(encoding='utf-8'))
    @app.get('/brands')
    def list_brands():
        with lock:return {'profiles':read(),'fonts':list(FONTS)}
    @app.post('/brands')
    def save_brand(body:dict):
        try:
            name=str(body.get('name','')).strip()
            if not 1<=len(name)<=60:raise ValueError('Use a profile name of 1–60 characters.')
            config=appearance(body.get('settings',{}))
            if not config:raise ValueError('Choose at least one custom caption setting.')
            with lock:
                profiles=read()
                if name not in profiles and len(profiles)>=50:raise ValueError('At most 50 profiles can be saved.')
                profiles[name]=config;path.parent.mkdir(parents=True,exist_ok=True)
                temp=path.with_suffix('.tmp');temp.write_text(json.dumps(profiles,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)
            return {'name':name,'settings':config}
        except (ValueError,TypeError,OverflowError,AttributeError) as error:raise HTTPException(400,str(error))
