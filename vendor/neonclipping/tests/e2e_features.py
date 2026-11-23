"""New features end to end: caption animations, SRT/ASS import, facecam auto-detect, AI parts + pasted answers, Make with
moments / auto facecam / credit / templates, and editing style keys across a whole video."""
import glob
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import e2e
from e2e import BOX, DATA, OUT, R, WORDS, api, frame, probe, test_source, wait_job
from e2e_make import YT_HINDI, YT_MID, YT_SHORT, make

G = 'features'
NL = chr(10)


def render(extra, start, dur=8, layout='stack', sid=None):
    body = {'id': sid or SID, 'start': start, 'end': start + dur, 'layout': layout, 'captions': True, 'caption_style': 'gta', 'hook': 'WAIT FOR IT',
            'words': WORDS, 'top': .32, **BOX, **extra}
    st, r = api('/export', body)
    if st != 200:
        return False, f'HTTP {st} {r}', None
    res = wait_job(r['job'], limit=240)
    if res['status'] != 'done':
        return False, res.get('error', '')[:300], None
    f = DATA / (res['file'] + '.mp4')
    p = probe(f)
    return (p['w'] == 1080 and p['h'] == 1920 and abs(p['dur'] - dur) < .7), f'{p["w"]}x{p["h"]} {p["dur"]:.1f}s words={res.get("caption_words")}', res['file']


def known_facecam_sources():
    """Saved sources of kept clips, split into (with webcam, without) by looking at their own boxes."""
    found = []
    for p in glob.glob(str(DATA / '*.json')):
        n = Path(p).name
        if n.endswith(('.state.json', '.words.json', '.request.json')):
            continue
        try:
            j = json.loads(Path(p).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if isinstance(j, dict) and j.get('source') and isinstance(j.get('settings'), dict) and (DATA / (str(j['source']) + '.mp4')).exists():
            found.append((str(j['source']), j['settings'].get('source_url') or ''))
    return found


def run():
    global SID
    SID, m = test_source()
    start = min(5, m['dur'] - 14)

    # ---- caption animations
    for anim in ('highlight', 'pop_in', 'pop_in_line', 'one_by_one', 'build_up', 'full_line'):
        R.check(G, f'caption animation {anim}', lambda anim=anim: render({'caption_anim': anim}, start)[:2])
    R.check(G, 'caption animation with clean style', lambda: render({'caption_anim': 'one_by_one', 'caption_style': 'clean'}, start)[:2])
    R.check(G, 'unknown caption animation is refused', lambda: (api('/export', {'id': SID, 'start': start, 'end': start + 5, 'layout': 'stack', **BOX, 'caption_anim': 'zzz'})[0] == 400, ''))

    # ---- SRT / ASS import
    srt = NL.join(['1', '00:00:06,000 --> 00:00:08,500', 'imported caption one', '', '2', '00:00:09,000 --> 00:00:11,000', 'and line two here', ''])
    st, r = api('/captions/parse', {'text': srt, 'start': 5, 'end': 15})
    R.check(G, 'SRT import gives words relative to the clip', lambda: (st == 200 and r['words'][0]['text'] == 'imported' and abs(r['words'][0]['start'] - 1.0) < .05, r if st != 200 else r['words'][:2]))
    R.check(G, 'imported words render as captions', lambda: (lambda x: (x[0] and 'words=7' in x[1], x[1]))(render({'words': r['words']}, 5, dur=10)[:2]) if st == 200 else (False, 'parse failed'))
    R.check(G, 'SRT outside the clip is refused with a clear message', lambda: (lambda x: (x[0] == 400 and 'inside' in str(x[1]), x[1]))(api('/captions/parse', {'text': srt, 'start': 100, 'end': 110})))
    R.check(G, 'garbage caption file is refused', lambda: (api('/captions/parse', {'text': 'hello', 'start': 0, 'end': 5})[0] == 400, ''))

    # ---- facecam detection on real footage
    sources = known_facecam_sources()
    hits = []
    for sid, url in sources[:8]:
        st, d = api('/facecam/detect', {'id': sid}, timeout=120)
        if st == 200:
            hits.append((sid, url, d))
    R.check(G, 'facecam endpoint answers for saved sources', lambda: (len(hits) >= 1, f'{len(hits)} sources checked'))
    with_cam = [h for h in hits if h[2]['found']]
    R.check(G, 'a webcam is found on at least one real stream, inside the frame, with a sensible size', lambda: (
        bool(with_cam) and all(0 <= h[2]['cam']['x'] <= 1 and 0 <= h[2]['cam']['y'] <= 1 and .04 < h[2]['cam']['w'] < .5 and .04 < h[2]['cam']['h'] < .7 for h in with_cam),
        [(h[0][:6], h[2]['cam'], h[2]['confidence']) for h in with_cam[:3]]))
    R.check(G, 'facecam on the GTA stream with a top-right webcam is in the top-right area', lambda: (lambda c: (bool(c) and all(h[2]['cam']['x'] > .6 and h[2]['cam']['y'] < .45 for h in c), [h[2]['cam'] for h in c[:3]]))(
        [h for h in with_cam if 'cabe601e' in h[0] or '6E2c' in h[1] or '169Zz' in h[1]]))
    R.check(G, 'facecam unknown id is refused', lambda: (api('/facecam/detect', {'id': 'nope'})[0] == 400, ''))
    syn = OUT / 'syn_nocam.mp4'
    if syn.exists():
        sid = e2e.upload(syn)['id']
        R.check(G, 'footage without a webcam answers "no facecam" with a reason', lambda: (lambda d: (d[0] == 200 and d[1]['found'] is False and d[1].get('reason'), d[1]))(api('/facecam/detect', {'id': sid}, timeout=120)))

    # ---- AI parts
    st, parts = api('/ai/parts', {'url': YT_HINDI, 'parts': 5, 'per_part': 3}, timeout=120)
    R.check(G, 'AI parts: 2-hour video split into the requested 5 parts', lambda: (st == 200 and len(parts['parts']) == 5, parts if st != 200 else len(parts['parts'])))
    if st == 200:
        R.check(G, 'AI parts: every part has lines and a complete prompt', lambda: (all(p['lines'] > 20 and 'TRANSCRIPT:' in p['prompt'] and 'ONLY a JSON array' in p['prompt'] for p in parts['parts']),
                                                                                  [(p['label'], p['lines'], p['chars']) for p in parts['parts']]))
        R.check(G, 'AI parts: part prompts stay small enough to paste (< 60k characters)', lambda: (max(p['chars'] for p in parts['parts']) < 60000, max(p['chars'] for p in parts['parts'])))
        R.check(G, 'AI parts: the first prompt contains real transcript text with timestamps', lambda: ('[00:' in parts['parts'][0]['prompt'], parts['parts'][0]['prompt'][-200:]))
    R.check(G, 'AI parts: not a link is refused', lambda: (api('/ai/parts', {'url': 'hello'})[0] == 400, ''))
    R.check(G, 'AI parts: unreadable video is refused with a message', lambda: (lambda x: (x[0] == 400 and len(str(x[1])) > 20, x[1]))(api('/ai/parts', {'url': 'https://www.youtube.com/watch?v=zzzzzzzzzzz'}, timeout=120)))
    answer = 'Here are my picks:' + NL + '[{"start":"00:05:10","end":"00:05:55","title":"Plane crash","hook":"bhai plane gir gaya"},{"start":"00:40:00","end":"00:40:50","title":"Police chase"}]'
    st2, a = api('/ai/answers', {'text': answer, 'duration': 7650})
    R.check(G, 'AI answers: JSON from a chatbot becomes moments', lambda: (st2 == 200 and [x['start'] for x in a['moments']] == [310.0, 2400.0], a))
    R.check(G, 'AI answers: nothing usable is refused', lambda: (api('/ai/answers', {'text': 'no moments here'})[0] == 400, ''))
    R.check(G, 'Make refuses an empty moments list', lambda: (api('/make', {'url': YT_SHORT, 'moments': [], **BOX})[0] == 400, ''))

    # ---- Make with moments, auto facecam, credit, template
    moments = [{'start': 8, 'end': 48, 'title': 'First pick', 'hook': 'first pick'}, {'start': 70, 'end': 112, 'title': 'Second pick', 'hook': 'second pick'}]
    s, why = make(url=YT_SHORT + '&x=e2efeat', moments=moments, count=2, minlen=20, maxlen=60, credit_auto=True, template='x_dark', tpl_name='NeonClipping', tpl_handle='iamajmeena', cam_auto=True)

    def mk_check():
        if s is None or s['status'] != 'done':
            return False, why or str(s and s.get('error'))
        clips = [c for c in s['clips'] if not c.get('error')]
        recs = [json.loads((DATA / (c['file'] + '.json')).read_text(encoding='utf-8')) for c in clips]
        durs = [probe(DATA / (c['file'] + '.mp4'))['dur'] for c in clips]
        ok = (len(clips) == 2 and all(34 <= d <= 48 for d in durs) and all(r['settings'].get('template') == 'x_dark' for r in recs)
              and all((r['settings'].get('credit') or '').startswith('Clip:') for r in recs) and s.get('engine') == 'AI answer')
        if clips:
            frame(DATA / (clips[0]['file'] + '.mp4'), 6, OUT / 'feat_make_moments.jpg')
        return ok, f'{len(clips)} clips {[round(d) for d in durs]} s, engine={s.get("engine")}, facecam={s.get("facecam")}, credit={recs[0]["settings"].get("credit") if recs else None}'
    R.check(G, 'Make from pasted moments (+ template, credit, auto facecam on a video without webcam)', mk_check)
    R.check(G, 'moments clips keep their own titles', lambda: (lambda t: (sorted(t) == ['First pick', 'Second pick'], t))([c.get('title') for c in (s or {}).get('clips', [])]))
    R.check(G, 'auto facecam reported "not found" cleanly when there is no webcam', lambda: ((s or {}).get('facecam', {}).get('found') is False, (s or {}).get('facecam')))

    # whole-video edit of a style key
    if s and s['status'] == 'done' and s['clips']:
        first = s['clips'][0]['file']

        def edit_all():
            st, j = api('/clips/reedit', {'file': first, 'scope': 'video', 'changes': {'template': 'tiktok_hook', 'caption_anim': 'build_up', 'watermark_pos': 'tl'}})
            if st != 200:
                return False, f'HTTP {st} {j}'
            res = wait_job(j['job'], limit=300)
            if res['status'] != 'done':
                return False, res.get('error', '')[:300]
            recs = [json.loads((DATA / (c['file'] + '.json')).read_text(encoding='utf-8')) for c in res['clips']]
            return (len(recs) == 2 and all(r['settings'].get('template') == 'tiktok_hook' and r['settings'].get('caption_anim') == 'build_up' for r in recs),
                    f'{len(recs)} clips updated to tiktok_hook + build_up')
        R.check(G, 'edit ALL clips of a video: template + caption animation', edit_all)

    # ---- Make on a 13-minute video with an auto-found webcam: the webcam must end up on top in the stack layout
    s2, why2 = make(url=YT_MID, count=2, minlen=25, maxlen=45, layout='stack', cam_auto=True, accurate='fast')

    def mid_check():
        if s2 is None or s2['status'] != 'done':
            return False, why2 or str(s2 and s2.get('error'))
        fc = s2.get('facecam') or {}
        clips = [c for c in s2['clips'] if not c.get('error')]
        if clips:
            frame(DATA / (clips[0]['file'] + '.mp4'), 8, OUT / 'feat_make_autocam.jpg')
        rec = json.loads((DATA / (clips[0]['file'] + '.json')).read_text(encoding='utf-8')) if clips else {'settings': {}}
        cam = rec['settings'].get('cam', {})
        return (bool(fc.get('found')) and cam.get('x', 0) > .6 and cam.get('y', 1) < .45 and len(clips) >= 1), f'facecam={fc}, clip cam box={cam}'
    R.check(G, 'Make with "find my facecam": the detected webcam box is used for every clip', mid_check)


if __name__ == '__main__':
    run()
    R.save()
    bad = [r for r in R.rows if not r['ok']]
    print(f'\n{len(R.rows) - len(bad)}/{len(R.rows)} passed')
