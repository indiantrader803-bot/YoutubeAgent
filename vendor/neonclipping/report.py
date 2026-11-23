"""Report a problem: a local error log, a redacted diagnostics block, and three ways to share it (all user-triggered).

1. GitHub issue  - opens a pre-filled issue; the user presses Submit. (safe default)
2. Download      - a text file with the same diagnostics plus the recent error log; the user sends it however they like.
3. Send directly - OPT-IN, one explicit click after reading the exact text. Posts that same text to REPORT_URL, a small collector
                   run by the maintainer (see tools/report-worker). Disabled while no collector is configured.

Nothing is sent automatically. Video links, file paths with user names, e-mails, IP addresses and token-like values are removed
before anything is shown, saved to the log or shared. Never read here: video files, transcripts, cookies, browser data.
"""
from pathlib import Path
import json, os, platform, re, subprocess, sys, time, urllib.parse, urllib.request

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('NEONCLIPPING_DATA_DIR', str(ROOT / 'data')))
REPO = 'iamajmeena/neonclipping'
DEFAULT_REPORT_URL = ''            # set after deploying tools/report-worker (or use NEONCLIPPING_REPORT_URL / data/report.json)
LOG_MAX = 200_000                  # bytes; the log is trimmed to its newest half when it grows past this
SEND_MAX = 24_000                  # characters sent in a direct report
ISSUE_BODY_MAX = 5_500             # characters in the pre-filled issue (URLs over ~8k fail)

_URL = re.compile(r'https?://[^\s\'"<>)\]]+', re.I)
_WIN_USER = re.compile(r'([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s\'"]+', re.I)
_POSIX_USER = re.compile(r'(/(?:Users|home)/)[^/\s\'"]+')
_EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
_IPV4 = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
_SECRET = re.compile(r'(?i)\b(token|secret|password|passwd|authorization|api[_-]?key|cookie|sid|sapisid|psid)\b\s*[=:]\s*[^\s,;&\'"]+')
_LONG = re.compile(r'\b[A-Za-z0-9_\-]{32,}\b')


def redact(text):
    """Remove what identifies a person or a video. Keeps the error wording and site names (youtube.com) so the cause stays readable."""
    s = str(text or '')

    def url(m):
        host = urllib.parse.urlparse(m.group(0)).netloc.split('@')[-1].split(':')[0]
        return f'<link:{host}>' if host else '<link>'
    s = _URL.sub(url, s)
    s = _EMAIL.sub('<email>', s)
    s = _SECRET.sub(lambda m: m.group(1) + '=<hidden>', s)
    s = _WIN_USER.sub(lambda m: m.group(1) + '<user>', s)
    s = _POSIX_USER.sub(lambda m: m.group(1) + '<user>', s)
    s = _IPV4.sub('<ip>', s)
    s = _LONG.sub('<id>', s)
    return s


def _log_path():
    return DATA / 'errors.log'


def log_error(stage, message, kind=''):
    """Append one redacted line to data/errors.log. Never raises."""
    try:
        DATA.mkdir(parents=True, exist_ok=True)
        row = {'time': time.strftime('%Y-%m-%d %H:%M:%S'), 'stage': redact(stage)[:80], 'kind': kind or classify(message),
               'error': redact(message)[:700]}
        p = _log_path()
        if p.exists() and p.stat().st_size > LOG_MAX:
            keep = p.read_text(encoding='utf-8', errors='replace').splitlines()[-200:]
            p.write_text('\n'.join(keep) + '\n', encoding='utf-8')
        with p.open('a', encoding='utf-8') as f:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    except OSError:
        pass


def classify(message):
    """Short label so many reports of the same cause are easy to count."""
    t = str(message or '').lower()
    for kind, marks in (('youtube-bot-check', ('not a bot', 'sign in to confirm', 'bot check')),
                        ('rate-limited', ('429', 'too many requests', 'http error 403')),
                        ('video-unavailable', ('video unavailable', 'private video', 'not available', 'removed')),
                        ('ffmpeg', ('ffmpeg', 'ffprobe', 'filter', 'encoder')),
                        ('speech-model', ('whisper', 'transcrib')),
                        ('llm', ('ollama', 'llm', 'connection refused')),
                        ('disk-or-permission', ('no space', 'permission denied', 'winerror 5', 'winerror 32')),
                        ('restart', ('server restarted', 'restarted during'))):
        if any(m in t for m in marks):
            return kind
    return 'other'


def recent_errors(n=8):
    try:
        lines = _log_path().read_text(encoding='utf-8', errors='replace').splitlines()[-n:]
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def _run(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return (r.stdout or r.stderr or '').strip().splitlines()[0][:120] if (r.stdout or r.stderr) else ''
    except (OSError, subprocess.SubprocessError, IndexError):
        return ''


def environment():
    """Facts about the machine and tool versions. No paths, no user names, no network details."""
    info = {'app': _run(['git', '-C', str(ROOT), 'rev-parse', '--short', 'HEAD']) or 'unknown',
            'python': platform.python_version(), 'os': f'{platform.system()} {platform.release()}',
            'ffmpeg': _run(['ffmpeg', '-version']), 'cpu_threads': os.cpu_count()}
    try:
        import yt_dlp
        info['yt_dlp'] = yt_dlp.version.__version__
    except Exception:                      # noqa: BLE001
        info['yt_dlp'] = 'missing'
    try:
        info['yt_dlp_checked'] = (DATA / '.ytdlp_checked').read_text(encoding='utf-8').strip()
    except OSError:
        info['yt_dlp_checked'] = 'never'
    try:
        import ytdl as _y
        info['js_runtime'] = ','.join(_y.js_runtimes()) or 'none (YouTube may hide some qualities)'
    except Exception:
        info['js_runtime'] = 'unknown'
    info['browser_login_set'] = bool(os.environ.get('NEONCLIPPING_COOKIES_BROWSER') or (DATA / 'youtube_cookies.txt').exists()
                                     or (DATA / 'ytdl.json').exists())      # yes/no only, never the cookies
    return info


def diagnostics(note='', errors=8):
    """The exact text the user sees and shares. Redacted again here so nothing slips through."""
    env = environment()
    lines = ['NeonClipping diagnostics (links, user names, e-mails and IPs removed)', '']
    lines += [f'{k}: {redact(v)}' for k, v in env.items()]
    errs = recent_errors(errors)
    lines += ['', f'recent errors ({len(errs)}):']
    for e in errs:
        lines.append(f"- {e.get('time')} | {e.get('kind')} | {e.get('stage')} | {e.get('error')}")
    if not errs:
        lines.append('- none logged yet')
    if note:
        lines += ['', 'note from user:', redact(note)[:600]]
    return '\n'.join(lines)


def issue_url(note='', title=''):
    last = (recent_errors(1) or [{}])[0]
    head = title or ('Problem: ' + (last.get('kind') or 'something went wrong'))
    body = ('**What happened / क्या हुआ**\n' + (redact(note)[:600] or '(write here)') + '\n\n'
            '**What you were doing / आप क्या कर रहे थे**\n(paste link type only, e.g. YouTube, Twitch, MP4)\n\n'
            '**Diagnostics (checked, nothing private)**\n```\n' + diagnostics(errors=4)[:ISSUE_BODY_MAX - 700] + '\n```\n')
    return f'https://github.com/{REPO}/issues/new?' + urllib.parse.urlencode({'title': head[:120], 'body': body[:ISSUE_BODY_MAX]}, quote_via=urllib.parse.quote)


def report_url():
    url = os.environ.get('NEONCLIPPING_REPORT_URL', '')
    if not url:
        try:
            url = json.loads((DATA / 'report.json').read_text(encoding='utf-8')).get('url', '')
        except (OSError, ValueError):
            url = ''
    url = (url or DEFAULT_REPORT_URL).strip()
    return url if url.startswith(('https://', 'http://127.0.0.1', 'http://localhost')) else ''


def send(note=''):
    """Opt-in direct report. The caller must have checked the user's consent. Returns (ok, message)."""
    url = report_url()
    if not url:
        return False, 'Direct sending is not set up in this build. Use the GitHub issue or the download option.'
    payload = json.dumps({'text': diagnostics(note)[:SEND_MAX], 'sent': time.strftime('%Y-%m-%d'),
                          'kinds': sorted({e.get('kind') for e in recent_errors(20) if e.get('kind')})}).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json', 'User-Agent': 'NeonClipping-report'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return (200 <= r.status < 300), ('Sent. Thank you!' if 200 <= r.status < 300 else f'The collector answered {r.status}.')
    except Exception as e:                  # noqa: BLE001
        return False, 'Could not send: ' + redact(str(e))[:160]


def note_job_error(row):
    """Log a failed job once (call from the status endpoints). Returns the same row."""
    if isinstance(row, dict) and row.get('status') == 'error' and not row.get('_reported'):
        row['_reported'] = True
        log_error(row.get('stage') or row.get('message') or 'job', row.get('error') or '')
    return row
