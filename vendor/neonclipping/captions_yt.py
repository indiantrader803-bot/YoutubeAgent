"""YouTube's own word-timed transcript (json3 auto-captions): no speech model, ~1 s for a 3-hour video.
Same idea PeakCut uses for YouTube links. Returns [{'start','end','text'}] in absolute seconds, or None."""
import json, re, urllib.request

def from_info(info):
    auto = info.get('automatic_captions') or {}; manual = info.get('subtitles') or {}
    lang = info.get('language') or ''
    origs = [k for k in auto if k.endswith('-orig')]
    key = None
    if lang and f'{lang}-orig' in auto: key = f'{lang}-orig'
    elif lang and lang in auto: key = lang
    elif len(origs) == 1: key = origs[0]
    elif 'en-orig' in auto: key = 'en-orig'          # several tracks and no declared language: English is the safest guess
    elif origs: key = origs[0]
    group = auto
    if not key:                                           # a human-written track in the spoken language
        key = lang if lang in manual else None; group = manual
    track = next((f for f in group.get(key) or [] if f.get('ext') == 'json3' and f.get('url')), None) if key else None
    if not track: return None
    req = urllib.request.Request(track['url'], headers={'User-Agent': 'Mozilla/5.0'})
    data = json.loads(urllib.request.urlopen(req, timeout=30).read(40_000_000))
    out = []; skipping = False
    for ev in data.get('events') or []:
        segs = [x for x in ev.get('segs') or [] if (x.get('utf8') or '').strip()]
        if not segs: continue
        t0, dur = float(ev.get('tStartMs') or 0), float(ev.get('dDurationMs') or 0)
        timed = len(segs) > 1 or 'tOffsetMs' in segs[0]
        for x in segs:
            parts = x['utf8'].split()
            for n, w in enumerate(parts):
                if skipping:                                   # inside a multi-word [Music ...] span
                    if w.endswith((']', ')')): skipping = False
                    continue
                if w[:1] in '[(' and not re.fullmatch(r'[\[(].*[\])]', w): skipping = True; continue
                if re.fullmatch(r'[\[(].*[\])]', w) or w in ('[', ']', '__', '>>', '-'): continue   # [Music], [Applause]
                at = t0 + float(x.get('tOffsetMs') or 0) if timed else t0 + dur * n / max(1, len(parts))
                out.append({'start': round(at / 1000, 2), 'text': w})
    out.sort(key=lambda w: w['start'])
    for n, w in enumerate(out):
        nxt = out[n + 1]['start'] if n + 1 < len(out) else w['start'] + .4
        w['end'] = round(max(w['start'] + .08, min(nxt, w['start'] + .6)), 2)
    return out or None

def window(words, a, b):
    """Words inside [a,b) with times relative to a."""
    return [{'start': round(w['start'] - a, 3), 'end': round(min(w['end'], b) - a, 3), 'text': w['text']} for w in words if a <= w['start'] < b]
