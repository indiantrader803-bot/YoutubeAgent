"""Live clipping against a real stream: start, chat connects, guard rails, Clip now, edit the live clip, stop. Needs a Twitch channel that is live."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import creators
from e2e import BOX, DATA, R, api, probe, wait_job

CANDIDATES = ['kaicenat', 'jynxzi', 'xqc', 'pokimane', 'shroud', 'ninja', 'summit1g', 'ishowspeed', 'asmongold', 'tfue']


def run():
    g = 'live'
    chan = None
    for c in CANDIDATES:
        if creators.live_target(creators.parse_creator(c)):
            chan = c
            break
    if not chan:
        R.check(g, 'a Twitch channel is live for the test', lambda: (False, 'none of %s is live right now' % CANDIDATES))
        return
    print('using live channel', chan)
    R.check(g, 'clip-now on unknown session -> 404', lambda: (api('/live/nope/clip-now', {})[0] == 404, ''))
    st, r = api('/live/start', {'url': 'twitch.tv/' + chan, 'layout': 'blur', 'caption_style': 'gta', 'language': '', 'top': .32, **BOX})
    R.check(g, 'start live clipping', lambda: (st == 200, r))
    if st != 200:
        return
    sid = r['live']
    R.check(g, 'second start while running is refused with a clear message', lambda: (lambda x: (x[0] == 400 and 'already running' in str(x[1]), x[1]))(
        api('/live/start', {'url': 'twitch.tv/' + chan})))
    R.check(g, '/live-active returns the running session', lambda: (api('/live-active')[1].get('live') == sid, ''))
    t0 = time.time()
    s = {}
    while time.time() - t0 < 120:
        s = api('/live/' + sid)[1]
        if s['status'] == 'recording' and s['elapsed'] >= 20:
            break
        time.sleep(3)
    R.check(g, 'recording starts and elapsed time counts up', lambda: (s['status'] == 'recording' and s['elapsed'] >= 20, {k: s.get(k) for k in ('status', 'elapsed', 'stage')}))
    R.check(g, 'state carries hype, comments in 30 s, label, stream title (clean)', lambda: (all(k in s for k in ('hype', 'msgs30', 'hype_label', 'title')) and 0 <= s['hype'] <= 100 and 'ð' not in s['title'], {k: s.get(k) for k in ('hype', 'msgs30', 'hype_label', 'title')}))
    R.check(g, 'chat reader connected (read-only)', lambda: ('connected' in str(s.get('chat')), s.get('chat')))
    t1 = time.time()
    while time.time() - t1 < 60 and not (s.get('chat_now') or s.get('baseline')):
        time.sleep(3)
        s = api('/live/' + sid)[1]
    R.check(g, 'chat messages are being counted (chat_now or baseline > 0)', lambda: (bool(s.get('chat_now') or s.get('baseline')), f'chat_now={s.get("chat_now")} baseline={s.get("baseline")}'))
    st, _ = api('/live/' + sid + '/clip-now', {})
    R.check(g, 'Clip now accepted', lambda: (st == 200, st))
    t0 = time.time()
    while time.time() - t0 < 300:
        s = api('/live/' + sid)[1]
        if s['clips'] and not s['pending']:
            break
        time.sleep(4)
    clip = (s.get('clips') or [{}])[0]
    R.check(g, 'live clip is produced without error', lambda: ('file' in clip and not clip.get('error'), clip.get('error') or clip.get('secs')))
    if 'file' in clip:
        f = DATA / (clip['file'] + '.mp4')
        p = probe(f)
        R.check(g, 'live clip is 1080x1920 h264/aac, about 30 s', lambda: (p['w'] == 1080 and p['h'] == 1920 and p['vcodec'] == 'h264' and p['acodec'] == 'aac' and 25 <= p['dur'] <= 36, p))
        R.check(g, 'live clip has title, viral score and axes', lambda: (bool(clip.get('title')) and clip.get('viral') is not None and bool(clip.get('axes')), {k: clip.get(k) for k in ('title', 'viral', 'axes')}))
        R.check(g, 'live clip is editable (edit panel data)', lambda: (lambda e: (e[0] == 200 and e[1].get('file') == clip['file'], e[0]))(api('/clips/' + clip['file'] + '/edit')))
        st, j = api('/clips/reedit', {'file': clip['file'], 'scope': 'one', 'changes': {'caption_style': 'bold'}})
        res = wait_job(j['job'], limit=180) if st == 200 else {'status': 'error', 'error': str(j)}
        R.check(g, 'live clip can be re-edited (style -> bold)', lambda: (res['status'] == 'done', res.get('error', '')))
        lib = api('/library')[1]
        R.check(g, 'live clip appears in My clips exactly once', lambda: (lambda n: (n == 1, n))(sum(1 for c in lib if c['settings'].get('title') == clip['title'] and c['settings'].get('caption_style') == 'bold')))
    api('/live/' + sid + '/stop', {})
    time.sleep(3)
    s = api('/live/' + sid)[1]
    R.check(g, 'stop ends the session', lambda: (s['status'] == 'stopped', s['status']))
    R.check(g, '/live-active is empty after stop', lambda: (api('/live-active')[1].get('live') is None, ''))
    R.check(g, 'start works again after stop', lambda: (lambda x: (x[0] == 200, x[1]))(api('/live/start', {'url': 'twitch.tv/' + chan, **BOX})))
    time.sleep(5)
    a = api('/live-active')[1].get('live')
    if a:
        api('/live/' + a + '/stop', {})


if __name__ == '__main__':
    run()
    R.save()
    bad = [r for r in R.rows if not r['ok']]
    print(f'\n{len(R.rows) - len(bad)}/{len(R.rows)} passed')
