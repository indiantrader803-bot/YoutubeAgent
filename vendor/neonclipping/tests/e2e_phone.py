"""Phone remote end to end, over this PC's real Wi-Fi address (so the server sees a non-loopback client, like a phone).
Starts its own NeonClipping on port 8792 with NEONCLIPPING_LAN=1 and its own data folder, tests the gate, then runs live
clipping the way the phone page does (needs a Twitch channel that is live; that part is skipped, and says so, when none is)."""
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import phone as P
from e2e import R, probe

ROOT = Path(__file__).resolve().parent.parent
PORT = 8792
G = 'phone'


class Remote:
    """A phone: plain HTTP to the PC's Wi-Fi address, keeps its own cookie."""
    def __init__(self, host):
        self.host, self.cookie = host, ''

    def call(self, method, path, body=None, raw=False):
        c = http.client.HTTPConnection(self.host, PORT, timeout=60)
        headers = {'Content-Type': 'application/json'}
        if self.cookie:
            headers['Cookie'] = self.cookie
        c.request(method, path, json.dumps(body) if body is not None else None, headers)
        r = c.getresponse()
        data = r.read()
        sc = r.getheader('Set-Cookie')
        if sc and sc.startswith('nc_phone='):
            self.cookie = sc.split(';')[0]
        c.close()
        if raw:
            return r.status, data
        try:
            return r.status, json.loads(data or b'null')
        except ValueError:
            return r.status, data[:200]


def run():
    ips = P.lan_ips()
    if not ips:
        R.check(G, 'this PC has a Wi-Fi / LAN address to test with', lambda: (False, 'none found'))
        return
    host = ips[0]
    tmp = tempfile.TemporaryDirectory()
    env = dict(os.environ, NEONCLIPPING_PORT=str(PORT), NEONCLIPPING_LAN='1', NEONCLIPPING_DATA_DIR=tmp.name, PYTHONIOENCODING='utf-8')
    py = ROOT / '.venv' / 'Scripts' / 'python.exe'
    proc = subprocess.Popen([str(py if py.exists() else sys.executable), 'app.py'], cwd=str(ROOT), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                if http.client.HTTPConnection('127.0.0.1', PORT, timeout=2).request('GET', '/healthz') is None:
                    break
            except OSError:
                time.sleep(1)
        pc = Remote('127.0.0.1')
        phone = Remote(host)
        status = pc.call('GET', '/phone/status')[1]
        pin = status['pin']
        R.check(G, 'server is reachable on the Wi-Fi address (listens on 0.0.0.0 in phone mode)', lambda: (phone.call('GET', '/m', raw=True)[0] == 200, host))
        R.check(G, 'PC status shows the Wi-Fi URL and a 6-digit PIN', lambda: (status['enabled'] and len(pin) == 6 and any(host in u for u in status['urls']), status['urls']))
        R.check(G, 'phone page loads without the PIN', lambda: (b'NeonClipping' in phone.call('GET', '/m', raw=True)[1], ''))
        for path in ('/library', '/live-active', '/creators', '/media/x', '/make/x'):
            R.check(G, f'phone without PIN: GET {path} -> 401', lambda path=path: (phone.call('GET', path)[0] == 401, ''))
        R.check(G, 'phone cannot read /phone/status (PIN stays on the PC)', lambda: (phone.call('GET', '/phone/status')[0] in (401, 403), ''))
        R.check(G, 'wrong PIN -> 401', lambda: (phone.call('POST', '/m/login', {'pin': '000000'})[0] == 401, ''))
        R.check(G, 'right PIN -> 200 and a cookie', lambda: (phone.call('POST', '/m/login', {'pin': pin})[0] == 200 and phone.cookie.startswith('nc_phone='), ''))
        for path in ('/library', '/live-active', '/creators'):
            R.check(G, f'phone with PIN: GET {path} -> 200', lambda path=path: (phone.call('GET', path)[0] == 200, ''))
        for method, path in (('POST', '/upload'), ('POST', '/upload-asset'), ('GET', '/queue'), ('POST', '/facecam/detect'), ('POST', '/ai/parts'), ('POST', '/export'), ('GET', '/layouts'), ('POST', '/phone/newpin')):
            R.check(G, f'phone with PIN: {method} {path} stays PC-only (403)', lambda method=method, path=path: (phone.call(method, path, {} if method == 'POST' else None)[0] == 403, ''))
        R.check(G, 'the PC itself needs no PIN', lambda: (pc.call('GET', '/library')[0] == 200, ''))

        # ---- live clipping the way the phone page does it
        from creators import live_target, parse_creator
        chan = next((c for c in ('kaicenat', 'summit1g', 'tfue', 'jynxzi', 'xqc', 'pokimane', 'shroud') if live_target(parse_creator(c))), None)
        if not chan:
            R.check(G, 'live clipping from the phone (needs a live Twitch channel)', lambda: (True, 'skipped: no channel was live right now'))
            return
        st, r = phone.call('POST', '/live/start', {'url': 'twitch.tv/' + chan, 'layout': 'blur', 'caption_style': 'gta', 'captions': False, 'hook_mode': 'title', 'before': 7, 'after': 3})
        R.check(G, 'start live clipping from the phone (10 s preset, captions off, hook from the stream title)', lambda: (st == 200, r))
        if st != 200:
            return
        sid = r['live']
        s = {}
        t0 = time.time()
        while time.time() - t0 < 90:
            s = phone.call('GET', '/live/' + sid)[1]
            if s['status'] == 'recording' and s['elapsed'] >= 14 and s.get('title'):
                break
            time.sleep(2)
        R.check(G, 'state carries hype, comments in 30 s, label and the stream title', lambda: (all(k in s for k in ('hype', 'msgs30', 'hype_label', 'title')) and s['title'], {k: s.get(k) for k in ('hype', 'msgs30', 'hype_label', 'title')}))
        R.check(G, 'stream title has no emoji and no mojibake', lambda: (all(ord(c) < 0x2600 and 'ð' not in c for c in s['title']), s['title']))
        R.check(G, 'hype meter is a percentage between 0 and 100', lambda: (0 <= s['hype'] <= 100, s['hype']))
        st, _ = phone.call('POST', f'/live/{sid}/clip-now', {'seconds': 10})
        R.check(G, 'Clip now with 10 s accepted', lambda: (st == 200, st))
        t0 = time.time()
        while time.time() - t0 < 180:
            s = phone.call('GET', '/live/' + sid)[1]
            if s['clips'] and not s['pending']:
                break
            time.sleep(3)
        clip = (s.get('clips') or [{}])[0]
        R.check(G, 'phone clip is made without error', lambda: ('file' in clip and not clip.get('error'), clip.get('error') or clip.get('secs')))
        if 'file' in clip:
            code, data = phone.call('GET', '/media/' + clip['file'], raw=True)
            f = Path(tmp.name) / 'phone_clip.mp4'
            f.write_bytes(data)
            m = probe(f)
            R.check(G, 'phone can download the clip: 1080x1920 h264/aac and about 10 s', lambda: (code == 200 and m['w'] == 1080 and m['h'] == 1920 and m['acodec'] == 'aac' and 6 <= m['dur'] <= 11, m))
            rec = json.loads((Path(tmp.name) / (clip['file'] + '.json')).read_text(encoding='utf-8'))
            R.check(G, 'captions off: no caption words burned in', lambda: (rec['result'].get('caption_words') == 0, rec['result'].get('caption_words')))
            R.check(G, 'hook text is the stream title', lambda: (rec['settings'].get('hook') == s['title'][:70], rec['settings'].get('hook')))
        phone.call('POST', f'/live/{sid}/stop', {})
        time.sleep(2)
        R.check(G, 'stop from the phone ends the session', lambda: (phone.call('GET', '/live/' + sid)[1]['status'] == 'stopped', ''))
        # lockout last: it blocks this address for 10 minutes
        for _ in range(5):
            Remote(host).call('POST', '/m/login', {'pin': '111111'})
        R.check(G, 'after 5 wrong PINs the address is locked, even for the right PIN', lambda: (Remote(host).call('POST', '/m/login', {'pin': pin})[0] == 429, ''))
    finally:
        # kill the test server AND its recorder children only (never other NeonClipping sessions on this PC)
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)], capture_output=True)
        time.sleep(1)
        tmp.cleanup()


if __name__ == '__main__':
    run()
    R.save()
    bad = [r for r in R.rows if not r['ok']]
    print(f'\n{len(R.rows) - len(bad)}/{len(R.rows)} passed')
