"""Heavy group of the NeonClipping test matrix: real downloads, transcription and rendering through /make.

    python tests/e2e_make.py            # everything
    python tests/e2e_make.py errors     # only the quick error-handling cases
Results go to tests/report.json (group "make") through the same Report as e2e.py.
"""
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e
from e2e import BOX, DATA, R, api, probe, test_source

YT_SHORT = 'https://www.youtube.com/watch?v=uh8i_T6mWQo'        # 132 s English, normal (download whole) path
YT_MID = 'https://www.youtube.com/watch?v=6E2cBXFCDyQ'          # 797 s English, audio-first fast path
YT_HINDI = 'https://www.youtube.com/watch?v=169ZzvPxvvM'        # 2 h Hindi, audio-first fast path
YT_TRAILER = 'https://www.youtube.com/watch?v=QdBZY2fkU-0'      # 90 s music, no speech
YT_LIVE = 'https://www.youtube.com/watch?v=hwSg39yIBGU'         # a stream that was live when this was written
TWITCH_VOD = 'https://www.twitch.tv/videos/2931745878'


def make(url=None, sid=None, count=2, mode='fast', accurate='fast', language='', style='gta', layout='blur',
         minlen=20, maxlen=45, limit=1500, **extra):
    body = {'count': count, 'mode': mode, 'accurate': accurate, 'min_len': minlen, 'max_len': maxlen, 'layout': layout,
            'caption_style': style, 'language': language, 'top': .32, **BOX, **extra}
    body.update({'url': url} if url else {'id': sid})
    st, r = api('/make', body)
    if st != 200:
        return None, f'HTTP {st} {r}'
    t0 = time.time()
    while time.time() - t0 < limit:
        s = api('/make/' + r['job'])[1]
        if s.get('status') in ('done', 'error'):
            s['_secs'] = round(time.time() - t0)
            return s, ''
        time.sleep(4)
    return None, 'timeout'


def verify_clips(s, count, minlen, maxlen, language='', style='gta'):
    """Every produced clip: size/codec/duration, captions, title, scores."""
    if s is None:
        return False, 'no result'
    if s.get('status') != 'done':
        return False, 'job error: ' + str(s.get('error'))[:250]
    clips = [c for c in s.get('clips', []) if not c.get('error')]
    bad = [c for c in s.get('clips', []) if c.get('error')]
    notes = []
    ok = len(clips) >= 1 and not bad
    if bad:
        notes.append('failed clips: ' + '; '.join(str(c['error'])[:80] for c in bad))
    if len(clips) < count:
        notes.append(f'only {len(clips)}/{count} clips')
        ok = ok and len(clips) >= max(1, count - 1)
    for c in clips:
        f = DATA / (c['file'] + '.mp4')
        if not f.exists():
            return False, 'missing file ' + c['file']
        p = probe(f)
        if not (p['w'] == 1080 and p['h'] == 1920 and p['vcodec'] == 'h264' and p['acodec'] == 'aac'):
            ok = False
            notes.append('bad media ' + str(p))
        if not (minlen - 3 <= p['dur'] <= maxlen + 6):
            ok = False
            notes.append(f'duration {p["dur"]:.0f}s outside {minlen}-{maxlen}')
        rec = json.loads((DATA / (c['file'] + '.json')).read_text(encoding='utf-8'))
        words = rec['settings'].get('words') or []
        if len(words) < 3:
            notes.append(f'{c["file"][:6]} only {len(words)} caption words')
        txt = ' '.join(w['text'] for w in words)
        if language == 'hinglish' and re.search('[ऀ-ॿ]', txt):
            ok = False
            notes.append('Devanagari left in a Hinglish caption: ' + txt[:50])
        if not c.get('title') or c.get('viral') is None or not c.get('axes'):
            ok = False
            notes.append('missing title/viral/axes')
        if rec['settings'].get('caption_style') != style:
            ok = False
            notes.append('caption style not applied')
    head = f'{len(clips)} clips in {s.get("_secs")}s'
    return ok, head + ('; ' + '; '.join(notes) if notes else ', all 1080x1920 h264/aac, titles+scores+captions OK')


def errors():
    g = 'make'
    for name, url, expect in [('nonexistent YouTube id', 'https://www.youtube.com/watch?v=zzzzzzzzzzz', 'error'),
                              ('not a video URL', 'https://example.com/', 'error'),
                              ('live stream link is refused with a clear message', YT_LIVE, 'live')]:
        def f(url=url, expect=expect):
            s, why = make(url=url, limit=240)
            if s is None:                    # refused at once with a clear 400 is just as good as a failed job
                return ('HTTP 400' in why and len(why) > 30), why[:200]
            e = str(s.get('error', ''))
            return (s['status'] == 'error' and len(e) > 10 and (expect != 'live' or 'live' in e.lower())), e[:200]
        R.check(g, 'error: ' + name, f)
    R.check(g, 'error: min_len > max_len', lambda: (lambda r: (r[0] == 400, r[1]))(
        api('/make', {'url': YT_SHORT, 'min_len': 60, 'max_len': 20, 'count': 2, **BOX})))


def matrix():
    g = 'make'
    layouts = [x['id'] for x in api('/layouts')[1]]
    cfgs = [
        dict(mode='fast', accurate='fast', language='', style='gta', layout='blur'),
        dict(mode='deep', accurate='accurate', language='en', style='bold', layout='stack'),
        dict(mode='fast', accurate='accurate', language='hinglish', style='clean', layout=layouts[3]),
        dict(mode='deep', accurate='fast', language='hi', style='hormozi', layout='circle' if 'circle' in layouts else layouts[0]),
        dict(mode='fast', accurate='fast', language='en', style='mrbeast', layout=layouts[-1]),
    ]
    for cfg in cfgs:
        def f(cfg=cfg):
            s, why = make(url=YT_SHORT, count=2, minlen=20, maxlen=45, **cfg)
            return verify_clips(s, 2, 20, 45, cfg['language'], cfg['style']) if s else (False, why)
        R.check(g, 'Make 132s English video: ' + ', '.join(f'{k}={v}' for k, v in cfg.items()), f)


def best():
    g = 'make'

    def f():
        s, why = make(url=YT_HINDI, count=1, minlen=30, maxlen=50, accurate='best', language='hinglish', limit=3000)
        return verify_clips(s, 1, 30, 50, 'hinglish') if s else (False, why)
    R.check(g, 'Make 2-hour Hindi video, Best Hindi (large-v3), Hinglish captions', f)


def sources():
    g = 'make'

    def case(name, minlen, maxlen, count, language='', url=None, sid=None, accurate='fast', limit=1500, **kw):
        def f():
            s, why = make(url=url, sid=sid, count=count, minlen=minlen, maxlen=maxlen, accurate=accurate, language=language, limit=limit, **kw)
            return verify_clips(s, count, minlen, maxlen, language) if s else (False, why)
        R.check(g, name, f)

    case('Make 13-min English (audio-first path), default Fast', 30, 60, 3, url=YT_MID)
    case('Make 2-hour Hindi video, Fast, Hinglish captions', 30, 60, 3, 'hinglish', url=YT_HINDI)
    case('Make 2-hour Hindi video with the old "accurate" value: still YouTube captions, no local model', 30, 60, 2, 'hinglish', url=YT_HINDI, accurate='accurate')

    def trailer():
        s, why = make(url=YT_TRAILER, count=2, minlen=15, maxlen=40)
        if s is None:
            return False, why
        n = len([c for c in s.get('clips', []) if not c.get('error')])
        return s['status'] == 'done' and n >= 1, f'{s["status"]} {str(s.get("error", ""))[:150]} clips={n}'
    R.check(g, 'Make 90-s music trailer (no speech) still returns clips', trailer)
    sid, _ = test_source()
    case('Make from an uploaded/local file', 15, 40, 2, sid=sid)
    case('Make from a Twitch VOD', 30, 60, 2, url=TWITCH_VOD, limit=900)
    case('Make count=1 short range 10-20 s', 10, 20, 1, url=YT_SHORT)

    def many():
        s, why = make(url=YT_SHORT, count=6, minlen=10, maxlen=25)
        if s is None:
            return False, why
        n = len(s.get('clips', []))
        return s['status'] == 'done' and n >= 3, f'{n} of 6 requested from a 132-s video'
    R.check(g, 'Make count=6 on a short video returns what exists', many)


if __name__ == '__main__':
    which = sys.argv[1:] or ['errors', 'matrix', 'sources', 'best']
    for w in which:
        {'errors': errors, 'matrix': matrix, 'sources': sources, 'best': best}[w]()
        R.save()
    bad = [r for r in R.rows if not r['ok']]
    print(f'\n{len(R.rows) - len(bad)}/{len(R.rows)} passed')
