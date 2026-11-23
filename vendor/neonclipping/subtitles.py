"""Import captions from an .srt or .ass file: cue times are spread over the words of each cue (by letter count)
and shifted so they are relative to the clip start, ready for the caption editor / export."""
import math
import re
import html

def validate_track(items, duration=None, allow_overlap=False):
    previous=0.0
    if not isinstance(items,list) or not items or len(items)>10000:
        raise ValueError('Provide between 1 and 10000 subtitle cues.')
    result=[]
    for index,item in enumerate(items):
        if not isinstance(item,dict):raise ValueError(f'Cue {index+1} must be an object.')
        start,end=float(item['start']),float(item['end']);text=str(item['text'])
        if not math.isfinite(start) or not math.isfinite(end) or start<0 or end<=start:
            raise ValueError(f'Cue {index+1} has invalid times.')
        if not allow_overlap and start<previous-.001:raise ValueError(f'Cue {index+1} overlaps the previous cue.')
        if duration is not None and end>duration+.001:raise ValueError(f'Cue {index+1} exceeds the selected duration.')
        if not text.strip() or len(text)>10000:raise ValueError(f'Cue {index+1} has invalid text.')
        result.append({'start':start,'end':end,'text':text});previous=end
    return result

def parse_track(text, allow_overlap=False):
    """Strict SRT/WebVTT track import; preserve explicit cue line breaks and Unicode."""
    text=str(text).lstrip('\ufeff').replace('\r\n','\n').replace('\r','\n')
    items=[]
    for block in re.split(r'\n\s*\n',text.strip()):
        lines=block.splitlines()
        if lines and lines[0].startswith(('NOTE','STYLE','REGION')):continue
        for index,line in enumerate(lines):
            if '-->' not in line:continue
            left,right=line.split('-->',1)
            try:start,end=_seconds(left),_seconds(right.strip().split()[0])
            except (ValueError,IndexError):raise ValueError('Invalid subtitle timestamp.')
            clean='\n'.join(html.unescape(re.sub(r'<[^>]+>','',line)).strip() for line in lines[index+1:])
            items.append({'start':start,'end':end,'text':clean});break
    return validate_track(items,allow_overlap=allow_overlap)

def write_track(items, format='srt', shift=0, duration=None, allow_overlap=False):
    if format not in ('srt','vtt'):raise ValueError('Choose SRT or WebVTT.')
    if not math.isfinite(float(shift)):raise ValueError('Invalid subtitle shift.')
    items=validate_track([dict(item,start=float(item['start'])+float(shift),end=float(item['end'])+float(shift)) for item in items],duration,allow_overlap)
    def stamp(value):
        ms=round(value*1000);hours,ms=divmod(ms,3600000);minutes,ms=divmod(ms,60000);seconds,ms=divmod(ms,1000)
        return f'{hours:02}:{minutes:02}:{seconds:02}'+(',' if format=='srt' else '.')+f'{ms:03}'
    blocks=[]
    for index,item in enumerate(items,1):
        prefix=str(index)+'\n' if format=='srt' else ''
        blocks.append(prefix+stamp(item['start'])+' --> '+stamp(item['end'])+'\n'+item['text'])
    return ('WEBVTT\n\n' if format=='vtt' else '')+'\n\n'.join(blocks)+'\n'

def clean_words(words,duration):
    """Automatic captions can carry a word that starts before the clip, ends after it or has a bad time. Keep what is usable."""
    out=[]
    for word in words or []:
        try:
            start=float(word['start']);end=float(word['end']);text=str(word['text']).strip()
        except (KeyError,TypeError,ValueError):
            continue
        if not (math.isfinite(start) and math.isfinite(end)) or not text:
            continue
        start=max(0.0,start);end=min(float(duration),end)
        if end-start<0.02:
            continue
        out.append({'start':round(start,3),'end':round(end,3),'text':text[:500]})
    return out


def validate_words(words,duration,max_words=20000):
    if not isinstance(words,list) or len(words)>max_words:raise ValueError(f'Provide at most {max_words} subtitle words.')
    out=[]
    for index,word in enumerate(words):
        if not isinstance(word,dict):raise ValueError(f'Subtitle word {index+1} must be an object.')
        start,end=float(word['start']),float(word['end']);text=word['text']
        if not all(map(math.isfinite,(start,end))) or not 0<=start<end<=duration+.1:
            raise ValueError(f'Subtitle word {index+1} is outside the clip or has invalid times.')
        if not isinstance(text,str) or not text.strip() or len(text)>500:raise ValueError(f'Subtitle word {index+1} has invalid text.')
        out.append({'start':start,'end':end,'text':text})
    return out


def _seconds(value):
    value = value.strip().replace(',', '.')
    parts = value.split(':')
    if len(parts) == 3:
        h, m, s = parts
    elif len(parts) == 2:
        h, m, s = '0', parts[0], parts[1]
    else:
        raise ValueError('Bad time: ' + value)
    h,m,s=int(h),int(m),float(s)
    if h<0 or not 0<=m<60 or not math.isfinite(s) or not 0<=s<60:raise ValueError('Invalid subtitle timestamp.')
    return h*3600+m*60+s


def _clean(text):
    text = re.sub(r'\{[^}]*\}', '', text)                 # ASS override tags
    text = re.sub(r'<[^>]+>', '', text)                   # <i> <b> <font ...>
    text = text.replace('\\N', ' ').replace('\\n', ' ').replace('\\h', ' ')
    return ' '.join(text.split())


def cues(text):
    """-> [(start, end, text)] from SRT or ASS content."""
    text = text.lstrip('﻿').replace('\r\n', '\n').replace('\r', '\n')
    out = []
    if re.search(r'^\s*\[Events\]', text, re.M) or re.search(r'^\s*Dialogue:', text, re.M):
        fmt = None
        for line in text.split('\n'):
            if line.lower().startswith('format:') and 'start' in line.lower() and 'text' in line.lower():
                fmt = [x.strip().lower() for x in line.split(':', 1)[1].split(',')]
            elif line.startswith('Dialogue:'):
                cols = fmt or ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
                parts = line.split(':', 1)[1].lstrip().split(',', len(cols) - 1)
                if len(parts) < len(cols):
                    continue
                row = dict(zip(cols, parts))
                try:
                    out.append((_seconds(row['start']), _seconds(row['end']), _clean(row['text'])))
                except (ValueError, KeyError):
                    continue
    else:
        # Reject malformed timestamps rather than silently losing individual cues.
        out=[(item['start'],item['end'],_clean(item['text'])) for item in parse_track(text,allow_overlap=True)]
    out = [(a, b, t) for a, b, t in out if t and b > a and math.isfinite(a) and math.isfinite(b)]
    if not out:
        raise ValueError('No captions found. Use an .srt, .ass or .vtt file.')
    return sorted(out)


def words_from(text, clip_start=0.0, clip_end=None):
    """Words with start/end relative to the clip (clip_start..clip_end in source time). Cues outside the clip are dropped."""
    result = []
    for a, b, t in cues(text):
        if b <= clip_start or (clip_end is not None and a >= clip_end):
            continue
        tokens = t.split()
        total = sum(len(x) + 1 for x in tokens)
        pos = a
        for tok in tokens:
            span = (b - a) * (len(tok) + 1) / total
            ws, we = pos, pos + span
            pos = we
            ws, we = ws - clip_start, we - clip_start
            if clip_end is not None:
                we = min(we, clip_end - clip_start)
            if we <= 0 or ws >= (clip_end - clip_start if clip_end is not None else 1e9):
                continue
            ws = max(0.0, ws)
            if we - ws < 0.03:
                continue
            result.append({'start': round(ws, 3), 'end': round(we, 3), 'text': tok[:100]})
    return result


def attach(app):
    from fastapi import HTTPException

    @app.post('/captions/convert')
    def convert(b:dict):
        try:
            if len(str(b.get('text','')))>4_000_000:raise ValueError('Subtitle file is too large.')
            track=b.get('cues') or parse_track(b.get('text',''))
            format=str(b.get('format','vtt'))
            return {'text':write_track(track,format,float(b.get('shift',0)),b.get('duration')),'format':format,'cues':len(track)}
        except (ValueError,KeyError,TypeError,OverflowError) as error:raise HTTPException(400,str(error))

    @app.post('/captions/parse')
    def parse_captions(b: dict):
        try:
            text = str(b.get('text', ''))
            if len(text) > 4_000_000:
                raise ValueError('That caption file is too large.')
            start = float(b.get('start', 0) or 0)
            end = b.get('end')
            end = float(end) if end not in (None, '') else None
            if not math.isfinite(start) or (end is not None and (not math.isfinite(end) or end <= start)):
                raise ValueError('Check the clip start and end.')
            words = words_from(text, start, end)
            if not words:
                raise ValueError('No caption lines fall inside this clip. Check the clip start and end.')
            return {'words': words, 'cues': len(cues(text))}
        except (ValueError, TypeError) as e:
            raise HTTPException(400, str(e))
