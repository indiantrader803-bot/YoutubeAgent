"""In-app updates from GitHub, so people who already installed NeonClipping get new versions without running the installer again.

How it works
  * The installed version is the commit id in `.neon_version` (written by the installer and by this updater). A git checkout is
    never touched: developers update with git.
  * The newest version is the head commit of the `main` branch on GitHub (one small request, cached, offline-safe).
  * Updating downloads the repository zip, replaces the program files and keeps your data (data/, models/, .venv, cache/,
    logs). If requirements.txt changed the packages are installed too, the old files are kept once in `.update-backup/`,
    then the app restarts itself.
Everything here is user-triggered from the page; nothing is sent to GitHub except the public download.
"""
from pathlib import Path
import io, os, shutil, subprocess, sys, threading, time, urllib.request, zipfile

REPO = 'iamajmeena/neonclipping'
API = f'https://api.github.com/repos/{REPO}/commits/main'
ZIP = f'https://codeload.github.com/{REPO}/zip/refs/heads/main'
KEEP = {'data', 'models', '.venv', 'venv', 'cache', '__pycache__', '.git', '.update-backup', '.neon_version', 'server.log',
        'server.stdout.log', 'server.stderr.log', 'server-error.log'}
CACHE_SECONDS = 1800
_lock = threading.Lock()
_state = {'stage': '', 'error': '', 'running': False, 'done': False}
_latest = {'sha': '', 'at': 0.0}


def _request(url, timeout=10, accept=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'NeonClipping-updater', **({'Accept': accept} if accept else {})})
    return urllib.request.urlopen(req, timeout=timeout)


def current(root):
    try:
        return (Path(root) / '.neon_version').read_text(encoding='utf-8').strip()[:40]
    except OSError:
        return ''


def is_checkout(root):
    return (Path(root) / '.git').exists()


def latest(force=False):
    """Head commit id of main on GitHub, or '' when offline."""
    if not force and _latest['sha'] and time.time() - _latest['at'] < CACHE_SECONDS:
        return _latest['sha']
    try:
        with _request(API, 6, 'application/vnd.github.sha') as r:
            sha = r.read(200).decode('ascii', 'ignore').strip()
        if len(sha) == 40 and all(c in '0123456789abcdef' for c in sha):
            _latest.update(sha=sha, at=time.time())
            return sha
    except Exception:       # noqa: BLE001 - offline, rate limited, blocked: the page just shows no update
        pass
    return _latest['sha']


def status(root, busy=False):
    cur = current(root)
    new = latest()
    checkout = is_checkout(root)
    return {'current': cur[:7], 'latest': new[:7], 'available': bool(new) and new != cur and not checkout,
            'can_update': not checkout, 'checkout': checkout, 'busy': bool(busy),
            **{k: _state[k] for k in ('stage', 'error', 'running', 'done')}}


def _set(**kw):
    _state.update(kw)


def _safe_target(root, rel):
    base = Path(root).resolve()
    target = (base / rel).resolve()
    if base != target and base not in target.parents:
        raise ValueError('unsafe path in update')
    return target


def _install(root, sha):
    root = Path(root)
    _set(stage='Downloading the new version...', error='', running=True, done=False)
    with _request(ZIP, 60) as r:
        raw = r.read(300 * 1024 * 1024)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = z.namelist()
        prefix = names[0].split('/')[0] + '/'
        if prefix + 'app.py' not in names:
            raise RuntimeError('The download does not look like NeonClipping (app.py missing).')
        _set(stage='Installing files...')
        backup = root / '.update-backup'
        if backup.exists():
            shutil.rmtree(backup, ignore_errors=True)
        req_file = root / 'requirements.txt'
        old_req = req_file.read_text(encoding='utf-8') if req_file.exists() else ''
        for name in names:
            rel = name[len(prefix):]
            if not rel or name.endswith('/') or rel.split('/')[0] in KEEP:
                continue
            target = _safe_target(root, rel)
            if target.exists():
                dest = backup / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, dest)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(name))
    new_req = req_file.read_text(encoding='utf-8') if req_file.exists() else ''
    if new_req != old_req:
        _set(stage='Updating Python packages (a few minutes)...')
        r = subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', str(req_file), '--quiet', '--disable-pip-version-check'],
                           capture_output=True, text=True, timeout=1800, cwd=str(root))
        if r.returncode:
            raise RuntimeError('Packages could not be installed: ' + (r.stderr or r.stdout)[-300:])
    (root / '.neon_version').write_text(sha, encoding='utf-8')
    _set(stage='Restarting NeonClipping...', done=True)


def restart(root):
    """Start a fresh copy a moment after this one exits (same port), then exit."""
    code = ('import subprocess,sys,time\n'
            'time.sleep(3)\n'
            'f=(0x00000008|0x00000200|0x08000000) if sys.platform=="win32" else 0\n'
            'subprocess.Popen([sys.executable,"app.py"],cwd=sys.argv[1],creationflags=f,start_new_session=(sys.platform!="win32"),'
            'stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n')
    flags = (0x00000008 | 0x00000200 | 0x08000000) if sys.platform == 'win32' else 0
    subprocess.Popen([sys.executable, '-c', code, str(root)], cwd=str(root), creationflags=flags,
                     start_new_session=(sys.platform != 'win32'), stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.6)
    os._exit(0)


def apply(root, busy_fn):
    """Start the update in the background. Returns (ok, message)."""
    root = Path(root)
    if is_checkout(root):
        return False, 'This is a git checkout. Update it with git pull.'
    with _lock:
        if _state['running']:
            return False, 'An update is already running.'
        if busy_fn():
            return False, 'Finish or stop the running clip jobs first, then update.'
        sha = latest(True)
        if not sha:
            return False, 'Could not reach GitHub. Check your internet and try again.'
        if sha == current(root):
            return False, 'You already have the newest version.'
        _set(running=True, done=False, error='', stage='Starting...')

    def work():
        try:
            _install(root, sha)
            restart(root)
        except Exception as error:      # noqa: BLE001
            _set(running=False, done=False, error=str(error)[-300:], stage='')
    threading.Thread(target=work, daemon=True).start()
    return True, 'Updating...'
