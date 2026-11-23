"""Readable opening headings on bright gameplay, blur and facecam layouts."""
import math
import camfx
KEYS=('hook_duration','hook_background','hook_enabled','fade_inout','hook_style')+camfx.KEYS
STYLES=('impact','neon','banner','box')
DEFAULT_STYLE='impact'
def style(body):
    """Look of the opening heading: impact (bold pop, default), neon (glow), banner (colour bar) or box (classic black box)."""
    value=body.get('hook_style')
    if value in (None,''):return DEFAULT_STYLE
    if value not in STYLES:raise ValueError('Choose a heading style: impact, neon, banner or box.')
    return value


STOP=set('the a an and or but for with from that this these those have has had not are was were you your they them their his her its our out into over under what when where which while would could should about because there then than just like very really actually also still more most some any only'.split())


def rounded(w,h,r):
    """ASS drawing of a rectangle with rounded corners (radius r), starting and ending at the top edge."""
    w,h=int(w),int(h);r=int(max(0,min(r,w//2,h//2)))
    if r<2:return f'm 0 0 l {w} 0 l {w} {h} l 0 {h}'
    return (f'm {r} 0 l {w-r} 0 b {w} 0 {w} 0 {w} {r} l {w} {h-r} b {w} {h} {w} {h} {w-r} {h} '
            f'l {r} {h} b 0 {h} 0 {h} 0 {h-r} l 0 {r} b 0 0 0 0 {r} 0')


def keyword(lines):
    """(line, word) of the word to accent: a number first, otherwise the longest meaningful word."""
    best=None
    for i,line in enumerate(lines):
        for j,word in enumerate(line.split()):
            core=''.join(ch for ch in word if ch.isalnum())
            if not core:continue
            score=(100 if any(ch.isdigit() for ch in core) else 0)+(len(core) if core.lower() not in STOP and len(core)>=4 else 0)
            if best is None or score>best[0]:best=(score,i,j)
    return (best[1],best[2]) if best and best[0]>0 else None


def fade_on(body):
    """Optional 0.3 s fade in/out of picture and sound."""
    value=body.get('fade_inout',False)
    if value is None:return False
    if not isinstance(value,bool):raise ValueError('Fade in/out must be on or off.')
    return value
def enabled(body):
    """Opening heading on (default) or off. Off means no heading text, no backing box and no local-model call."""
    value=body.get('hook_enabled',True)
    if value is None:return True
    if not isinstance(value,bool):raise ValueError('Opening heading must be on or off.')
    return value
def settings(body):
    value=body.get('hook_duration',8);duration=float(8 if value in (None,'') else value)
    if not math.isfinite(duration) or not 2<=duration<=60:raise ValueError('Hook duration must be 2–60 seconds.')
    enabled(body);fade_on(body);style(body);camfx.settings(body)
    background=body.get('hook_background',True)
    if not isinstance(background,bool):raise ValueError('Hook background must be on or off.')
    return duration,background

def events(lines,width,height,y,scale,body):
    """ASS background + text, separate layers; no alteration of the source footage."""
    from captions import BS,stamp,safe
    if not enabled(body):return []
    duration,background=settings(body)
    look=style(body)
    if look!='box':return _styled(lines,width,height,y,scale,duration,look,BS,stamp,safe)
    size=round((78 if len(lines)==1 else 72 if len(lines)==2 else 66)*scale)
    pad=max(8,round(26*scale));line_height=round(size*1.22)
    box_w=min(round(width*.94),round(max(len(line) for line in lines)*size*.67)+pad*2)
    box_h=line_height*len(lines)+pad*2
    x=(width-box_w)//2;y=max(pad,min(round(y),height-box_h-pad));end=stamp(duration,True)
    result=[]
    if background:
        shape=rounded(box_w,box_h,round(24*scale))
        tags='{'+BS+f'an7{BS}pos({x},{y}){BS}bord0{BS}shad0{BS}1c&H000000&{BS}1a&H20&{BS}p1'+'}'
        result.append(f'Dialogue: 2,0:00:00.00,{end},Main,,0,0,0,,{tags}{shape}')
    text=(BS+'N').join(safe(line).upper() for line in lines)
    tags='{'+BS+f'an8{BS}pos({width//2},{y+pad}){BS}fs{size}{BS}b1{BS}c&H00FFFFFF&{BS}3c&H00000000&{BS}bord2{BS}shad0{BS}fad(120,180)'+'}'
    result.append(f'Dialogue: 3,0:00:00.00,{end},Main,,0,0,0,,{tags}{text}')
    return result

def _styled(lines,width,height,y,scale,duration,look,BS,stamp,safe):
    """Impact / neon / banner headings: big bold text, one accent word, pop-in, optional glow or colour bar."""
    PINK,CYAN,LIME,YELLOW,WHITE,BLACK='&H00A54BFF&','&H00F7E858&','&H0058FBD4&','&H0000E5FF&','&H00FFFFFF&','&H00000000&'
    accent={'impact':YELLOW,'neon':LIME,'banner':LIME}[look]
    size=round(({1:100,2:92}.get(len(lines),80))*scale)
    line_h=round(size*1.14);pad=max(8,round(24*scale))
    key=keyword(lines)
    rows=[]
    for i,line in enumerate(lines):
        words=safe(line).upper().split()
        if key and key[0]==i and key[1]<len(words):
            words[key[1]]='{'+BS+'1c'+accent+'}'+words[key[1]]+'{'+BS+'1c'+WHITE+'}'
        rows.append(' '.join(words))
    text=(BS+'N').join(rows)
    longest=max(len(line) for line in lines)
    box_h=line_h*len(lines)
    y_top=max(pad,min(round(y),height-box_h-pad*4))
    end=stamp(duration,True);x=width//2;out=[]
    pop=BS+'fscx125'+BS+'fscy125'+BS+'t(0,150,'+BS+'fscx100'+BS+'fscy100)'
    if look=='banner':
        bar_h=box_h+pad*2;inset=pad*2;bar_w=width-inset*2
        out.append(f'Dialogue: 2,0:00:00.00,{end},Main,,0,0,0,,'+'{'+BS+f'an7{BS}pos({inset},{y_top-pad}){BS}bord0{BS}shad0{BS}1c{PINK}{BS}1a&H18&{BS}fad(60,180){BS}p1'+'}'+rounded(bar_w,bar_h,round(34*scale)))
    if look=='neon':
        glow=BS+'1a&HFF&'+BS+'3c'+PINK+BS+f'bord{round(14*scale)}{BS}blur{round(16*scale)}'
        out.append(f'Dialogue: 2,0:00:00.00,{end},Main,,0,0,0,,'+'{'+BS+f'an8{BS}pos({x},{y_top}){BS}fs{size}{BS}b1'+glow+BS+'fad(60,180)'+'}'+text)
    outline=({'impact':BLACK,'neon':CYAN,'banner':BLACK})[look]
    bord=round(({'impact':8,'neon':3,'banner':6})[look]*scale)
    shadow=round(4*scale) if look!='neon' else 0
    main='{'+BS+f'an8{BS}pos({x},{y_top}){BS}fs{size}{BS}b1{BS}1c{WHITE}{BS}3c{outline}{BS}bord{bord}{BS}shad{shadow}{BS}4c&H80000000&'+pop+BS+'fad(60,180)'+'}'+text
    out.append(f'Dialogue: 3,0:00:00.00,{end},Main,,0,0,0,,'+main)
    if look=='impact':
        bw=round(min(width*.5,max(160*scale,longest*size*.33)));bh=max(6,round(10*scale))
        by=y_top+box_h+round(8*scale);bx=(width-bw)//2
        out.append(f'Dialogue: 2,0:00:00.00,{end},Main,,0,0,0,,'+'{'+BS+f'an7{BS}pos({bx},{by}){BS}bord0{BS}shad0{BS}1c{PINK}{BS}fad(60,180){BS}p1'+'}'+rounded(bw,bh,bh//2))
    return out


def attach(app):
    from fastapi import HTTPException
    @app.post('/hooks/suggest')
    def suggest(body:dict):
        import smart,curation
        text=str(body.get('text','')).strip()
        if not 15<=len(text)<=30000:raise HTTPException(400,'Generate or import subtitles for the selected clip first.')
        model=smart._model(True)
        if not model:return {'hook':curation.extract_hook(text),'model':None,'evidence':'Extracted from the supplied transcript'}
        try:return {'hook':smart._heading(model,text),'model':model}
        except Exception as error:raise HTTPException(503,'The AI model failed. '+str(error)[-160:])
