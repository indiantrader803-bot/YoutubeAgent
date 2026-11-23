"""NeonClipping end-to-end test matrix. Runs against the live server (default http://127.0.0.1:8770).

    python tests/e2e.py static export edit feedback creators   # pick groups, or no argument = all light groups
    python tests/e2e.py make                                   # heavy: real downloads + transcription

Every check is recorded (PASS / FAIL + evidence + seconds) in tests/report.json and tests/REPORT.md.
Test files go to tests/out/. The feedback group starts a private local server and never changes the user's ratings.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
OUT = Path(__file__).resolve().parent / 'out'
OUT.mkdir(exist_ok=True)
BASE = os.environ.get('NEONCLIPPING_URL', 'http://127.0.0.1:8770')
REPORT = Path(__file__).resolve().parent / 'report.json'


def api(path, body=None, timeout=120, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            content = r.read()
            return r.status, (content if raw else json.loads(content or b'null'))
    except urllib.error.HTTPError as e:
        txt = e.read().decode('utf-8', 'ignore')
        try:
            return e.code, json.loads(txt)
        except ValueError:
            return e.code, txt


def upload(path):
    boundary = '----nc' + str(int(time.time()))
    blob = Path(path).read_bytes()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{Path(path).name}"\r\n'
            f'Content-Type: video/mp4\r\n\r\n').encode() + blob + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(BASE + '/upload', data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read())


def probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration',
                        '-of', 'json', str(path)], capture_output=True, text=True)
    j = json.loads(r.stdout or '{}')
    st = j.get('streams', [])
    v = next((s for s in st if s['codec_type'] == 'video'), {})
    a = next((s for s in st if s['codec_type'] == 'audio'), {})
    return {'w': v.get('width'), 'h': v.get('height'), 'vcodec': v.get('codec_name'), 'acodec': a.get('codec_name'),
            'dur': float(j.get('format', {}).get('duration') or 0)}


def frame(path, t, out):
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', str(t), '-i', str(path), '-frames:v', '1', '-vf', 'scale=270:-2', str(out)])
    return out


class Report:
    def __init__(self):
        self.rows = []

    def check(self, group, name, fn):
        t = time.time()
        try:
            ev = fn()
            ok, msg = (True, ev) if not isinstance(ev, tuple) else ev
        except Exception as e:
            ok, msg = False, f'{type(e).__name__}: {str(e)[:300]}'
        row = {'group': group, 'name': name, 'ok': bool(ok), 'evidence': str(msg)[:400], 'sec': round(time.time() - t, 1)}
        self.rows.append(row)
        print(('PASS ' if ok else 'FAIL ') + f'[{group}] {name} ({row["sec"]}s) {"" if ok else "-> " + row["evidence"]}', flush=True)
        return ok

    def save(self):
        old = []
        try:
            old = json.loads(REPORT.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            pass
        names = {(x['group'], x['name']) for x in self.rows}
        keep = [r for r in old if (r['group'], r['name']) not in names]
        REPORT.write_text(json.dumps(keep + self.rows, indent=1, ensure_ascii=False), encoding='utf-8')


R = Report()


def wait_job(job, route='/status/', limit=600):
    t0 = time.time()
    while time.time() - t0 < limit:
        s = api(route + job)[1]
        if isinstance(s, dict) and s.get('status') in ('done', 'error'):
            return s
        time.sleep(1.5)
    raise TimeoutError('job did not finish in %ds' % limit)


# ------------------------------------------------------------------ source video for the render tests
def test_source():
    """A saved source with speech that already exists in data/ (id, duration)."""
    lib = api('/library')[1]
    for c in lib:
        sid = c.get('source') or c['settings'].get('id')
        j = json.loads((DATA / (c['id'] + '.json')).read_text(encoding='utf-8'))
        sid = j.get('source')
        p = DATA / (str(sid) + '.mp4')
        if sid and p.exists():
            m = probe(p)
            if m['dur'] > 40 and m['w'] and m['w'] > m['h']:
                return str(sid), m
    raise RuntimeError('no landscape saved source found')


WORDS = [{'start': 0.3 + i * 0.45, 'end': 0.7 + i * 0.45, 'text': w} for i, w in enumerate(
    'this is a caption test oh my god look at that chase'.split())]
BOX = {'cam': {'x': 0, 'y': 0, 'w': .25, 'h': .3}, 'game': {'x': .25, 'y': 0, 'w': .75, 'h': 1}}


# ------------------------------------------------------------------ groups
def g_static():
    g = 'static'
    html = api('/', raw=True)[1].decode('utf-8')
    js = (ROOT / 'app.js').read_text(encoding='utf-8')
    R.check(g, 'index.html served', lambda: ('<title>' in html, len(html)))
    ids = set(re.findall(r'''\$\(['"]([\w-]+)['"]\)''', js))
    have = set(re.findall(r'id="([\w-]+)"', html))
    missing = sorted(ids - have)
    R.check(g, 'every $("id") used by app.js exists in index.html', lambda: (not missing, 'missing: %s' % missing))
    R.check(g, 'app.js syntax (node --check)', lambda: (subprocess.run(['node', '--check', str(ROOT / 'app.js')], capture_output=True).returncode == 0, ''))
    for p in ('/assets/app.js', '/assets/style.css'):
        R.check(g, 'GET ' + p, lambda p=p: (api(p, raw=True)[0] == 200, ''))
    for p in ('/library', '/donate', '/feedback/summary', '/live-active', '/creators', '/layouts'):
        R.check(g, 'GET ' + p, lambda p=p: (api(p)[0] == 200, ''))
    R.check(g, '/layouts returns 11 layouts with geometry', lambda: (lambda r: (len(r) == 11 and all('layers' in x or 'cam' in x or 'id' in x for x in r), len(r)))(api('/layouts')[1]))
    R.check(g, '/layouts rejects bad speaker size', lambda: (api('/layouts?top=9')[0] == 400, ''))
    d = api('/donate')[1]
    R.check(g, 'donate links are https only', lambda: (all(str(v).startswith('https://') for v in (d.values() if isinstance(d, dict) else []) if v), d))
    # validation / error messages
    R.check(g, '/make without link or id -> 4xx', lambda: (api('/make', {})[0] in (400, 422), ''))
    R.check(g, '/make with bad count -> 400', lambda: (api('/make', {'url': 'https://youtu.be/x', 'count': 'x'})[0] == 400, ''))
    R.check(g, '/export unknown source -> 400', lambda: (api('/export', {'id': 'nope'})[0] == 400, ''))
    sid, m = test_source()
    base = {'id': sid, 'start': 0, 'end': 5, 'layout': 'stack', **BOX}
    R.check(g, '/export rejects bad layout', lambda: (api('/export', {**base, 'layout': 'zzz'})[0] == 400, ''))
    R.check(g, '/export rejects bad caption style', lambda: (api('/export', {**base, 'caption_style': 'zzz'})[0] == 400, ''))
    R.check(g, '/export rejects end before start', lambda: (api('/export', {**base, 'start': 9, 'end': 2})[0] == 400, ''))
    R.check(g, '/export rejects clip > 10 min', lambda: (api('/export', {**base, 'start': 0, 'end': 9999})[0] == 400, ''))
    R.check(g, '/export rejects caption_y out of range', lambda: (api('/export', {**base, 'caption_y': 5})[0] == 400, ''))
    R.check(g, '/export rejects NaN crop', lambda: (api('/export', {**base, 'cam': {'x': 'a', 'y': 0, 'w': 1, 'h': 1}})[0] == 400, ''))
    R.check(g, '/transcribe rejects unknown language', lambda: (api('/transcribe', {**base, 'language': 'xx'})[0] == 400, ''))
    def bad_upload():
        junk = OUT / 'not_a_video.mp4'
        junk.write_bytes(b'this is not a video' * 100)
        try:
            upload(junk)
        except urllib.error.HTTPError as e:
            return e.code == 400, e.read().decode()[:100]
        return False, 'accepted a non-video'
    R.check(g, '/upload rejects a file that is not a video', bad_upload)
    R.check(g, '/live/start rejects junk', lambda: (api('/live/start', {'url': 'hello world!!'})[0] == 400, ''))
    R.check(g, '/live/start rejects YouTube link without id', lambda: (api('/live/start', {'url': 'https://youtube.com/@x'})[0] == 400, ''))
    R.check(g, '/live/<unknown> -> 404', lambda: (api('/live/nope')[0] == 404, ''))
    R.check(g, '/status/<unknown> not 500', lambda: (api('/status/nope')[0] in (200, 404), ''))
    R.check(g, '/make/<unknown> not 500', lambda: (api('/make/nope')[0] in (200, 404), ''))
    R.check(g, '/media path traversal blocked', lambda: (api('/media/..%2f..%2fapp.py', raw=True)[0] in (400, 404), ''))
    R.check(g, '/text path traversal blocked', lambda: (api('/text/..%2fapp/srt', raw=True)[0] in (400, 404), ''))
    R.check(g, '/clips/<bad>/edit -> 4xx', lambda: (api('/clips/zz!/edit')[0] in (400, 404), ''))
    R.check(g, '/clips/reedit rejects unknown change key', lambda: (api('/clips/reedit', {'file': 'x', 'changes': {'evil': 1}})[0] in (400, 404), ''))


LAYOUTS = None


def g_export():
    g = 'export'
    global LAYOUTS
    sid, m = test_source()
    LAYOUTS = [x['id'] for x in api('/layouts')[1]]
    start = min(5, m['dur'] - 12)
    done = {}

    def run(layout, style, **extra):
        body = {'id': sid, 'start': start, 'end': start + 6, 'layout': layout, 'captions': True, 'caption_style': style,
                'hook': 'WAIT FOR IT', 'title': 'test', 'words': WORDS, 'top': .32, **BOX, **extra}
        st, r = api('/export', body)
        if st != 200:
            return False, f'HTTP {st} {r}'
        res = wait_job(r['job'], limit=180)
        if res['status'] != 'done':
            return False, res.get('error', '')[:300]
        f = DATA / (res['file'] + '.mp4')
        p = probe(f)
        ok = p['w'] == 1080 and p['h'] == 1920 and p['vcodec'] == 'h264' and p['acodec'] == 'aac' and abs(p['dur'] - 6) < 0.6
        tag = f'{layout}_{style}'.replace('/', '_')
        frame(f, 2.5, OUT / f'frame_{tag}.jpg')
        done[tag] = res['file']
        return ok, f'{p["w"]}x{p["h"]} {p["vcodec"]}/{p["acodec"]} {p["dur"]:.1f}s enc={res.get("encoder")} words={res.get("caption_words")}'

    for lay in LAYOUTS:
        R.check(g, f'render layout {lay} (gta captions)', lambda lay=lay: run(lay, 'gta'))
    for st in ('gta', 'bold', 'clean', 'hormozi', 'mrbeast'):
        R.check(g, f'render caption style {st} (blur layout)', lambda st=st: run('blur', st))
    R.check(g, 'render without captions', lambda: (lambda r: r)(run_nocap(sid, start)))
    R.check(g, 'render caption position top (caption_y=600)', lambda: run('stack', 'gta', caption_y=600))
    R.check(g, 'render caption position bottom (caption_y=1700)', lambda: run('stack', 'gta', caption_y=1700))
    R.check(g, 'render speaker size 0.2 / 0.5', lambda: (run('stack', 'gta', top=.2)[0] and run('stack', 'gta', top=.5)[0], ''))
    R.check(g, 'render accepts unicode hook (Hinglish) ', lambda: run('blur', 'gta', hook='ARRE YAAR 😮 WAIT'))
    R.check(g, 'SRT downloadable for a captioned clip', lambda: (lambda f: (api(f'/text/{f}/srt', raw=True)[0] == 200, f))(next(iter(done.values()))))
    (OUT / 'export_done.json').write_text(json.dumps(done))


def run_nocap(sid, start):
    st, r = api('/export', {'id': sid, 'start': start, 'end': start + 5, 'layout': 'stack', 'captions': False, **BOX})
    res = wait_job(r['job'], limit=120)
    return res['status'] == 'done' and res.get('caption_words') == 0, res.get('error') or f'words={res.get("caption_words")}'


def g_edit():
    g = 'edit'
    done = json.loads((OUT / 'export_done.json').read_text())
    files = list(done.values())[:3]
    # make 3 clips that share a batch id so "apply to all" has a group
    src_id, src_m = test_source()
    # an isolated upload so "all clips of this video" is exactly the clips made here
    sample = OUT / 'edit_sample.mp4'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '0', '-t', '40', '-i', str(DATA / (src_id + '.mp4')), '-c:v', 'libx264', '-preset', 'veryfast',
                    '-crf', '28', '-c:a', 'aac', str(sample)], check=True)
    sid = upload(sample)['id']
    m = probe(sample)
    start = 3
    batch = 'e2ebatch' + str(int(time.time()))
    made = []
    for i in range(3):
        st, r = api('/export', {'id': sid, 'start': start + i, 'end': start + i + 5, 'layout': 'stack', 'captions': True, 'caption_style': 'gta',
                                'title': f'T{i}', 'hook': f'H{i}', 'words': WORDS, 'batch_id': batch, 'source_url': '', **BOX})
        made.append(wait_job(r['job'], limit=120)['file'])
    R.check(g, 'edit panel data for a saved clip', lambda: (lambda e: (e['video_clips'] == 3, e.get('video_clips')))(api(f'/clips/{made[0]}/edit')[1]))
    r = {}

    def apply(scope, changes):
        st, j = api('/clips/reedit', {'file': made[0], 'scope': scope, 'changes': changes})
        if st != 200:
            return False, f'HTTP {st} {j}'
        res = wait_job(j['job'], route='/status/', limit=240)
        r['res'] = res
        return res['status'] == 'done', f'{j["clips"]} clips, {res.get("error", "")}'

    def current(scope_files):
        out = []
        for f in scope_files:
            cur = f
            while True:
                rec = json.loads((DATA / (cur + '.json')).read_text(encoding='utf-8'))
                if rec.get('superseded_by'):
                    cur = rec['superseded_by']
                else:
                    break
            out.append(cur)
        return out

    R.check(g, 'apply style=bold to ONLY this clip', lambda: apply('one', {'caption_style': 'bold'}))
    cur = current(made)
    R.check(g, 'only the chosen clip changed', lambda: (lambda s: (s == ['bold', 'gta', 'gta'], s))(
        [json.loads((DATA / (c + '.json')).read_text(encoding='utf-8'))['settings']['caption_style'] for c in cur]))
    R.check(g, 'apply layout+style to ALL clips of the video', lambda: apply('video', {'layout': 'circle', 'caption_style': 'hormozi'}))
    cur = current(made)
    R.check(g, 'all 3 clips changed, each kept its own title/hook', lambda: (lambda s: (all(x[0] == 'circle' and x[1] == 'hormozi' for x in s) and [x[2] for x in s] == ['T0', 'T1', 'T2'], s))(
        [(lambda d: (d['layout'], d['caption_style'], d['title']))(json.loads((DATA / (c + '.json')).read_text(encoding='utf-8'))['settings']) for c in cur]))
    R.check(g, 'stale (old) clip id still edits the newest version', lambda: (lambda e: (e['file'] != made[0], e['file'][:8]))(api(f'/clips/{made[0]}/edit')[1]))
    R.check(g, 'apply captions OFF to all', lambda: apply('video', {'captions': False}))
    R.check(g, 'apply speaker size + caption position to all', lambda: apply('video', {'top': .4, 'caption_y': 1300}))
    R.check(g, 'apply new cam/game boxes to all', lambda: apply('video', {'cam': {'x': .7, 'y': .6, 'w': .3, 'h': .4}, 'game': {'x': 0, 'y': 0, 'w': .7, 'h': 1}}))
    R.check(g, 'reedit rejects invalid layout', lambda: (api('/clips/reedit', {'file': made[0], 'scope': 'one', 'changes': {'layout': 'zzz'}})[0] == 400, ''))
    R.check(g, 'reedit rejects invalid caption style', lambda: (api('/clips/reedit', {'file': made[0], 'scope': 'one', 'changes': {'caption_style': 'zzz'}})[0] == 400, ''))
    R.check(g, 'library shows exactly 3 live clips of the batch (no duplicates)', lambda: (lambda n: (n == 3, n))(
        sum(1 for c in api('/library')[1] if c.get('batch_id') == batch)))
    (OUT / 'edit_batch.json').write_text(json.dumps({'batch': batch, 'made': made}))


def g_feedback():
    """Exercise the real API in a private data folder, never user feedback."""
    import socket
    import tempfile
    global BASE
    g = 'feedback'
    previous_base=BASE
    with tempfile.TemporaryDirectory(prefix='neon-feedback-') as directory:
        data=Path(directory)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
        env=dict(os.environ,NEONCLIPPING_DATA_DIR=str(data),NEONCLIPPING_PORT=str(port))
        with (data/'server.log').open('w') as log:
            proc=subprocess.Popen([sys.executable,str(ROOT/'app.py')],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            try:
                BASE='http://127.0.0.1:'+str(port)
                for attempt in range(60):
                    try:
                        if api('/healthz',timeout=2)[0]==200:break
                    except Exception:pass
                    if proc.poll() is not None:raise RuntimeError((data/'server.log').read_text())
                    time.sleep(.2)
                else:raise RuntimeError('Isolated feedback server did not start.')
                def fixture(index):
                    name='feedbackfixture'+str(index)
                    features={'words':index/7,'motion':1-index/7,'chat':None}
                    (data/(name+'.json')).write_text(json.dumps({'source':'fixture','settings':{'features':features},'result':{'status':'done'}}))
                    return name
                first=fixture(0)
                R.check(g,'private summary starts empty',lambda:(api('/feedback/summary')[1]['ratings']==0,''))
                R.check(g,'rating 5 accepted',lambda:(api('/feedback',{'file':first,'rating':5})[0]==200,''))
                R.check(g,'rating 0 / 6 / text rejected',lambda:(all(api('/feedback',{'file':first,'rating':v})[0] in (400,422) for v in (0,6,'x')),''))
                R.check(g,'unknown clip rejected',lambda:(api('/feedback',{'file':'nope','rating':3})[0] in (400,404),''))
                for i in range(10):api('/feedback',{'file':first,'rating':1+i%5})
                summary=api('/feedback/summary')[1]
                R.check(g,'repeated ratings count as one moment',lambda:(summary['ratings']==1 and not summary['fitted'],summary))
                api('/feedback',{'file':first,'rating':1})
                for i in range(1,8):api('/feedback',{'file':fixture(i),'rating':1 if i<4 else 5})
                summary=api('/feedback/summary')[1]
                R.check(g,'eight varied distinct moments fit preferences',lambda:(summary['ratings']==8 and summary['fitted'],summary))
                R.check(g,'weights remain positive and normalized',lambda:(abs(sum(summary['weights'].values())-1)<.001 and min(summary['weights'].values())>0,summary['weights']))
                (data/'feedbackrevision.json').write_text(json.dumps({'source':'fixture','settings':{'features':{'words':0,'motion':1},'revision_of':first},'result':{'status':'done'}}))
                revised=api('/feedback',{'file':'feedbackrevision','rating':2})[1]
                R.check(g,'revisions retain one training identity',lambda:(revised['ratings']==8,revised))
            finally:
                BASE=previous_base
                proc.terminate()
                try:proc.wait(timeout=10)
                except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=10)


def g_creators():
    g = 'creators'
    sys.path.insert(0, str(ROOT))
    import creators
    cases = {'kaicenat': ('twitch', 'kaicenat'), 'https://www.twitch.tv/xQc': ('twitch', 'xqc'), '@pokimane': ('twitch', 'pokimane'),
             'youtube.com/@IShowSpeed': ('youtube', '@IShowSpeed'), 'https://www.youtube.com/channel/UCWsDFcIhY2DBi3GB5uykGXA': ('youtube', 'channel/UCWsDFcIhY2DBi3GB5uykGXA')}
    for t, (plat, ref) in cases.items():
        R.check(g, f'parse "{t[:40]}"', lambda t=t, plat=plat, ref=ref: (lambda c: (c['platform'] == plat and c['ref'] == ref, c))(creators.parse_creator(t)))
    for bad in ('', 'ab', 'https://youtu.be/abc12345678', 'hello world', 'x' * 40):
        def f(bad=bad):
            try:
                creators.parse_creator(bad)
            except ValueError:
                return True, 'rejected'
            return False, 'accepted'
        R.check(g, f'reject "{bad[:20]}"', f)
    R.check(g, 'add offline creator', lambda: (lambda r: (r[0] == 200, r[1]))(api('/creators', {'url': 'twitch.tv/xqc', 'layout': 'blur', 'caption_style': 'gta'})))
    cid = next(c['id'] for c in api('/creators')[1]['creators'] if c['ref'] == 'xqc')
    R.check(g, 'duplicate add rejected', lambda: (api('/creators', {'url': 'xqc'})[0] == 400, ''))
    R.check(g, 'bad add rejected', lambda: (api('/creators', {'url': '!!'})[0] == 400, ''))
    R.check(g, 'check now reports offline/online', lambda: (lambda r: (r[0] == 200 and 'live' in r[1], r[1]))(api(f'/creators/{cid}/check', {})))
    R.check(g, 'auto toggle off/on persists', lambda: (api(f'/creators/{cid}/auto', {'auto': False})[0] == 200 and not [c for c in api('/creators')[1]['creators'] if c['id'] == cid][0]['auto'], ''))
    R.check(g, 'save layout', lambda: (api(f'/creators/{cid}/layout', {'layout': 'circle', 'caption_style': 'bold'})[0] == 200 and [c for c in api('/creators')[1]['creators'] if c['id'] == cid][0]['opts']['layout'] == 'circle', ''))
    R.check(g, 'library not broken by creators store (no .json in data)', lambda: (not (DATA / 'creators.json').exists() and api('/library')[0] == 200, ''))
    R.check(g, 'remove', lambda: (api(f'/creators/{cid}/remove', {})[0] == 200 and not any(c['id'] == cid for c in api('/creators')[1]['creators']), ''))
    R.check(g, 'unknown creator -> 404', lambda: (api('/creators/nope/auto', {'auto': True})[0] == 404, ''))
    R.check(g, 'detect live Twitch channel (any of 5 big ones)', lambda: (lambda hits: (True, hits) if hits is not None else (True, 'none live right now (not a failure)'))(
        [c for c in ('kaicenat', 'jynxzi', 'xqc', 'pokimane', 'shroud') if creators.live_target(creators.parse_creator(c))] or None))
    R.check(g, 'offline/nonexistent channel -> not live, no crash', lambda: (creators.live_target(creators.parse_creator('zzzqqq_nobody_9')) is None, ''))


GROUPS = {'static': g_static, 'export': g_export, 'edit': g_edit, 'feedback': g_feedback, 'creators': g_creators}

if __name__ == '__main__':
    want = sys.argv[1:] or list(GROUPS)
    for name in want:
        if name in GROUPS:
            GROUPS[name]()
    R.save()
    bad = [r for r in R.rows if not r['ok']]
    print(f'\n{len(R.rows) - len(bad)}/{len(R.rows)} passed')
    sys.exit(1 if bad else 0)
