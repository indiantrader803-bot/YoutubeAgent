"""Creator list: remember streamers, notice when they go live, and start live clipping for them automatically.

The list is stored in data/creators.store. A background thread checks every CHECK_EVERY seconds whether a creator
with "auto" switched on is live (Twitch through Streamlink, YouTube through yt-dlp). When one is, it starts the same
live-clipping session the Live panel uses, with the layout / facecam boxes / caption style saved for that creator.
Only one live session runs at a time (recording + rendering is heavy), so other creators wait for their turn.
Nothing is uploaded; chat is read anonymously, exactly like the Live panel.
"""
import json
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from fastapi import HTTPException

CHECK_EVERY = 60            # seconds between live checks
MANUAL_STOP_COOLDOWN = 1800  # after you press Stop, do not restart this creator for 30 minutes
ERROR_COOLDOWN = 300         # after a failed start, wait 5 minutes
from styling import KEYS as STYLE_KEYS
from brands import KEYS as BRAND_KEYS
from hooks import KEYS as HOOK_KEYS
OPT_KEYS = ('aspect','resolution','fps','layout', 'cam', 'game', 'top', 'caption_style', 'language')+STYLE_KEYS+BRAND_KEYS+HOOK_KEYS


def parse_creator(text):
    """-> dict(platform, ref, url, name). Twitch: name or link. YouTube: @handle, channel link or a link with /@handle."""
    t = (text or '').strip()
    if not t:
        raise ValueError('Type a Twitch name or paste a Twitch / YouTube channel link.')
    if 'youtu' in t:
        m = re.search(r'youtube\.com/(@[A-Za-z0-9_.\-]{2,60}|channel/UC[A-Za-z0-9_-]{20,24}|c/[A-Za-z0-9_.\-]{2,60}|user/[A-Za-z0-9_.\-]{2,60})', t)
        if not m:
            raise ValueError('Paste the YouTube channel link (youtube.com/@name or youtube.com/channel/...), not a video link.')
        path = m.group(1)
        return {'platform': 'youtube', 'ref': path, 'url': 'https://www.youtube.com/' + path,
                'name': path.split('/')[-1].lstrip('@')}
    m = re.search(r'twitch\.tv/([A-Za-z0-9_]{3,25})', t)
    channel = (m.group(1) if m else t.lstrip('#@')).lower()
    if not re.fullmatch(r'[a-z0-9_]{3,25}', channel):
        raise ValueError('Type a Twitch name (like kaicenat), a twitch.tv link, or a YouTube channel link.')
    return {'platform': 'twitch', 'ref': channel, 'url': 'https://twitch.tv/' + channel, 'name': channel}


def live_target(creator):
    """-> ('twitch', channel, url) / ('youtube', video_id, url) when the creator is live right now, else None."""
    if creator['platform'] == 'twitch':
        try:
            r = subprocess.run([sys.executable, '-m', 'streamlink', '--json', creator['url']],
                               capture_output=True, text=True, timeout=40)
            streams = json.loads(r.stdout or '{}').get('streams') or {}
        except (subprocess.TimeoutExpired, ValueError, OSError):
            return None
        return ('twitch', creator['ref'], creator['url']) if streams else None
    try:
        import ytdl
        with ytdl.YDL({'quiet': True, 'no_warnings': True, 'skip_download': True, 'noplaylist': True,
                               'socket_timeout': 20}) as y:
            info = y.extract_info(creator['url'] + '/live', download=False)
    except Exception:
        return None
    if info and info.get('is_live') and re.fullmatch(r'[A-Za-z0-9_-]{11}', str(info.get('id', ''))):
        return ('youtube', info['id'], 'https://www.youtube.com/watch?v=' + info['id'])
    return None


def attach(app, data, live, start_live):
    """Register the /creators routes and start the watcher thread.
    live = dict of LiveSession objects, start_live(target, opts, creator_id) starts one (raises RuntimeError if busy)."""
    path = Path(data) / 'creators.store'   # not *.json: the library and the editor read every data/*.json as a clip record
    lock = threading.RLock()
    runtime = {}   # creator id -> {'live': bool, 'checked': ts, 'session': id, 'wait_until': ts, 'last_live': ts}

    def load():
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return []

    def save(rows):
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
        tmp.replace(path)

    def clip_counts():
        counts = {}
        for f in Path(data).glob('*.json'):
            if f.name.endswith(('.state.json', '.words.json', '.request.json')):
                continue
            try:
                j = json.loads(f.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if not isinstance(j, dict):
                continue
            c = (j.get('settings') or {}).get('creator')
            if c and not j.get('superseded_by') and j.get('result', {}).get('status') == 'done':
                counts[c] = counts.get(c, 0) + 1
        return counts

    def session_of(cid):
        for s in live.values():
            if getattr(s, 'creator', None) == cid and s.state['status'] in ('starting', 'recording'):
                return s
        return None

    def anything_running():
        return any(s.state['status'] in ('starting', 'recording') for s in live.values())

    def view(rows):
        counts = clip_counts()
        out = []
        for c in rows:
            rt = runtime.get(c['id'], {})
            s = session_of(c['id'])
            status = 'recording' if s else ('live' if rt.get('live') else ('unknown' if not rt.get('checked') else 'offline'))
            out.append({**c, 'status': status, 'session': s.id if s else None, 'checked': rt.get('checked'),
                        'last_live': rt.get('last_live') or c.get('last_live'), 'clips': counts.get(c['id'], 0),
                        'waiting': bool(rt.get('live') and not s and anything_running()),
                        'paused_until': rt.get('wait_until') if rt.get('wait_until', 0) > time.time() else None})
        return out

    def opts_from(body, old=None):
        o = dict(old or {})
        for k in OPT_KEYS:
            if body.get(k) is not None:
                o[k] = body[k]
        return o

    def remember_stop_reasons():
        """If a creator's session was stopped by hand, give it a cooldown so the watcher does not restart it at once."""
        for cid, rt in runtime.items():
            sid = rt.get('session')
            s = live.get(sid) if sid else None
            if s and s.state['status'] not in ('starting', 'recording'):
                rt['session'] = None
                if s.state['status'] == 'stopped':
                    rt['wait_until'] = time.time() + MANUAL_STOP_COOLDOWN
                elif s.state['status'] == 'error':
                    rt['wait_until'] = time.time() + ERROR_COOLDOWN

    def check(creator, start=True):
        """Check one creator; start live clipping if they are live and auto is on. Returns True if live."""
        remember_stop_reasons()
        rt = runtime.setdefault(creator['id'], {})
        target = live_target(creator)
        rt['checked'] = time.time()
        rt['live'] = bool(target)
        if target:
            rt['last_live'] = time.time()
        if target and start and creator.get('auto') and not session_of(creator['id']) \
                and time.time() >= rt.get('wait_until', 0) and not anything_running():
            try:
                rt['session'] = start_live(target, creator.get('opts') or {}, creator['id'])
            except Exception as e:      # e.g. another session started a moment ago
                rt['error'] = str(e)[:160]
                rt['wait_until'] = time.time() + 60
        return bool(target)

    def watcher():
        time.sleep(20)       # let the app finish starting
        while True:
            try:
                with lock:
                    rows = load()
                remember_stop_reasons()
                for c in rows:
                    if c.get('auto'):
                        check(c)
                    time.sleep(1)
            except Exception:
                pass
            time.sleep(CHECK_EVERY)

    threading.Thread(target=watcher, daemon=True, name='creator-watcher').start()

    @app.get('/creators')
    def creators_list():
        with lock:
            remember_stop_reasons()
            return {'creators': view(load()), 'busy': anything_running(), 'every': CHECK_EVERY}

    @app.post('/creators')
    def creators_add(b: dict):
        try:
            c = parse_creator(str(b.get('url', '')))
        except ValueError as e:
            raise HTTPException(400, str(e))
        with lock:
            rows = load()
            if any(r['platform'] == c['platform'] and r['ref'].lower() == c['ref'].lower() for r in rows):
                raise HTTPException(400, c['name'] + ' is already in your list.')
            if len(rows) >= 30:
                raise HTTPException(400, 'The list holds up to 30 creators. Remove one first.')
            c.update(id=uuid.uuid4().hex[:12], auto=True, added=time.time(), opts=opts_from(b))
            rows.append(c)
            save(rows)
        threading.Thread(target=lambda: check(c), daemon=True).start()
        return {'id': c['id']}

    def find(rows, cid):
        for r in rows:
            if r['id'] == cid:
                return r
        raise HTTPException(404, 'Creator not found.')

    @app.post('/creators/{cid}/auto')
    def creators_auto(cid: str, b: dict):
        with lock:
            rows = load()
            c = find(rows, cid)
            c['auto'] = bool(b.get('auto'))
            save(rows)
            runtime.setdefault(cid, {}).pop('wait_until', None)
        if c['auto']:
            threading.Thread(target=lambda: check(c), daemon=True).start()
        return {'ok': True}

    @app.post('/creators/{cid}/layout')
    def creators_layout(cid: str, b: dict):
        with lock:
            rows = load()
            c = find(rows, cid)
            c['opts'] = opts_from(b, c.get('opts'))
            save(rows)
        return {'ok': True}

    @app.post('/creators/{cid}/check')
    def creators_check(cid: str):
        with lock:
            c = find(load(), cid)
        is_live = check(c)
        return {'live': is_live}

    @app.post('/creators/{cid}/remove')
    def creators_remove(cid: str):
        with lock:
            rows = load()
            find(rows, cid)
            save([r for r in rows if r['id'] != cid])
            runtime.pop(cid, None)
        return {'ok': True}
