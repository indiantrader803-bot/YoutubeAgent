"""Live clipping: record a live stream while it is on, watch chat speed, and cut a clip around every chat spike.

Pattern used by the live clippers (heistclips, Claude Clipper, stream-clipper): chat velocity in 10 s buckets against a
5-minute baseline, clip window BACKDATED from the spike because chat reacts after the moment, ready about a minute later.
Chat is read anonymously (Twitch IRC, no login; YouTube Live via pytchat). Recording uses Streamlink.
"""
import collections
import os
import re
import shutil
import socket
import statistics
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

BUCKET = 10        # seconds per chat bucket
HISTORY = 30       # buckets in the baseline (5 minutes)
SIGMA = 2.5        # spike = mean + SIGMA * stdev ...
RATIO = 2.5        # ... and at least RATIO x the baseline mean
MIN_MSGS = 8       # ... and at least this many messages in the bucket
COOLDOWN = 60      # seconds between two automatic clips
try:MIN_FREE_GB = float(os.environ.get('NEONCLIPPING_MIN_FREE_GB', '8'))   # an unattended (auto) session stops below this much free disk space
except ValueError:MIN_FREE_GB = 8.0


def parse_target(text):
    """-> ('twitch', channel, url) or ('youtube', video_id, url)."""
    t = text.strip()
    if 'youtu' in t:
        m = re.search(r'(?:v=|/live/|youtu\.be/)([A-Za-z0-9_-]{11})', t)
        if not m:
            raise ValueError('Paste a YouTube Live link that contains the video id.')
        return 'youtube', m.group(1), t if t.startswith('http') else 'https://' + t
    m = re.search(r'twitch\.tv/([A-Za-z0-9_]{3,25})', t)
    channel = (m.group(1) if m else t.lstrip('#@')).lower()
    if not re.fullmatch(r'[a-z0-9_]{3,25}', channel):
        raise ValueError('Paste a Twitch channel link (twitch.tv/name) or a YouTube Live link.')
    return 'twitch', channel, f'https://twitch.tv/{channel}'


def is_spike(count, history):
    """Chat spike rule: needs 6+ non-empty buckets of history, then count >= MIN_MSGS, > mean + SIGMA*stdev and >= RATIO x mean."""
    if len([h for h in history if h]) < 6:
        return False
    mu, sd = statistics.mean(history), statistics.pstdev(history) or 1.0
    return count >= MIN_MSGS and count > mu + SIGMA * sd and count >= RATIO * max(mu, 1.0)


def clean_title(title):
    """Stream title as a hook: emoji and symbol pictures are dropped (the caption font cannot draw them), spaces tidied."""
    keep = []
    for ch in str(title or ''):
        o = ord(ch)
        if o >= 0x1F000 or 0x2600 <= o <= 0x27BF or 0x2B00 <= o <= 0x2BFF or o in (0xFE0F, 0x200D, 0x20E3) or 0xE000 <= o <= 0xF8FF:
            continue
        keep.append(ch if ch.isprintable() else ' ')
    return ' '.join(''.join(keep).split())[:120]


def hype_percent(msgs30, baseline_bucket, history_buckets=30):
    """0-100 chat 'hype' from the messages of the last ~30 s.
    With enough history it is relative to the usual rate (baseline_bucket = mean messages per 10 s): 100 at four times the usual speed.
    In the first half minute there is no usual yet, so an absolute scale is used (150 messages in 30 s = 100)."""
    if history_buckets < 3:
        return int(max(0, min(100, round(100.0 * msgs30 / 150.0))))
    usual30 = max(baseline_bucket * 3.0, 6.0)
    return int(max(0, min(100, round(100.0 * msgs30 / (4.0 * usual30)))))


def hype_label(h):
    return 'quiet' if h < 25 else 'building momentum' if h < 50 else 'hot' if h < 80 else 'peak viral hype'


class LiveSession:
    def __init__(self, target, data, render, before=24, after=14):
        self.kind, self.ref, self.url = target
        self.id = uuid.uuid4().hex
        self.dir = Path(data) / ('live_' + self.id)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.rec = self.dir / 'recording.ts'
        self.render, self.before, self.after = render, before, after
        self.creator = None          # set when the creator watcher started this session
        self.auto = False            # unattended: capped length, disk guard, recording deleted at the end
        self.max_seconds = None
        self.counts = collections.Counter()
        self.stop_ev = threading.Event()
        self.t0 = None
        self.proc = None
        self.lock = threading.Lock()
        self.state = {'id': self.id, 'status': 'starting', 'stage': 'Starting the recorder', 'platform': self.kind, 'target': self.ref,
                      'clips': [], 'chat_now': 0, 'hist_n': 0, 'msgs30': 0, 'hype': 0, 'hype_label': 'quiet', 'title': '', 'baseline': 0.0, 'spikes': 0, 'elapsed': 0, 'chat': 'connecting', 'pending': 0, 'error': None}

    # ---- helpers
    def _set(self, **kw):
        with self.lock:
            self.state.update(kw)

    def now(self):
        return (time.time() - self.t0) if self.t0 else 0.0

    # ---- chat readers
    def _twitch_chat(self):
        while not self.stop_ev.is_set():
            try:
                s = socket.create_connection(('irc.chat.twitch.tv', 6667), timeout=30)
                s.sendall(f'PASS SCHMOOPIIE\r\nNICK justinfan{int(time.time()) % 100000}\r\nJOIN #{self.ref}\r\n'.encode())
                self._set(chat='connected (read-only)')
                buf = ''
                while not self.stop_ev.is_set():
                    data = s.recv(4096).decode('utf-8', 'ignore')
                    if not data:
                        break
                    buf += data
                    *lines, buf = buf.split('\r\n')
                    for ln in lines:
                        if ln.startswith('PING'):
                            s.sendall(b'PONG :tmi.twitch.tv\r\n')
                        elif ' PRIVMSG ' in ln:
                            self.counts[int(time.time() // BUCKET)] += 1
            except Exception as e:
                self._set(chat='reconnecting (' + type(e).__name__ + ')')
                time.sleep(3)

    def _youtube_chat(self):
        try:
            import pytchat
        except ImportError:
            self._set(chat='pytchat is not installed (pip install pytchat)')
            return
        while not self.stop_ev.is_set():
            try:
                chat = pytchat.create(video_id=self.ref, interruptable=False)   # True needs the main thread (signal handler)
                self._set(chat='connected (read-only)')
                while chat.is_alive() and not self.stop_ev.is_set():
                    for _ in chat.get().sync_items():
                        self.counts[int(time.time() // BUCKET)] += 1
                    time.sleep(0.5)
            except Exception as e:
                self._set(chat='reconnecting (' + type(e).__name__ + ': ' + str(e)[:80] + ')')
                time.sleep(3)

    # ---- clips
    def _cut(self, start, dur, why, chat_feature):
        self._set(pending=self.state['pending'] + 1)
        try:
            clip = self.render(self, max(0.0, start), dur, why, chat_feature)
            if clip:
                with self.lock:
                    self.state['clips'].append(clip)
        except Exception as e:                     # one failed clip must not stop the session
            with self.lock:
                self.state['clips'].append({'error': str(e)[-200:], 'title': 'Clip failed', 'why': why})
        finally:
            self._set(pending=max(0, self.state['pending'] - 1))

    def clip_now(self, seconds=30):
        if not self.t0:
            raise RuntimeError('Recording has not started yet.')
        threading.Thread(target=self._cut, args=(self.now() - seconds, seconds, 'You pressed Clip now', None), daemon=True).start()

    def _fetch_title(self):
        """Stream title (Twitch via Streamlink metadata, YouTube via yt-dlp) for the optional 'hook from the stream title'."""
        try:
            if self.kind == 'twitch':
                r = subprocess.run([sys.executable, '-m', 'streamlink', '--json', self.url], capture_output=True, timeout=40)
                import json as _json
                title = (_json.loads(r.stdout.decode('utf-8', 'replace') or '{}').get('metadata') or {}).get('title') or ''   # utf-8, not the Windows code page
            else:
                import ytdl
                with ytdl.YDL({'quiet': True, 'no_warnings': True, 'skip_download': True, 'noplaylist': True, 'socket_timeout': 20}) as y:
                    title = y.extract_info(self.url, download=False).get('title') or ''
            self._set(title=clean_title(title))
        except Exception:
            pass

    def stop(self):
        self.stop_ev.set()
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self._set(status='stopped', stage='Stopped. Clips already made stay in My clips.')

    # ---- main loop
    def start(self):
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            log = open(self.dir / 'streamlink.log', 'wb')
            self.proc = subprocess.Popen([sys.executable, '-m', 'streamlink', '--loglevel', 'warning', '--stdout', self.url, 'best'],
                                         stdout=open(self.rec, 'wb'), stderr=log)
            deadline = time.time() + 90
            while self.t0 is None:
                if self.proc.poll() is not None:
                    tail = (self.dir / 'streamlink.log').read_text(errors='ignore')[-300:] if (self.dir / 'streamlink.log').exists() else ''
                    raise RuntimeError('The stream is offline or could not be opened. ' + tail.strip().replace('\n', ' '))
                if self.rec.exists() and self.rec.stat().st_size > 0:
                    self.t0 = time.time()
                elif time.time() > deadline:
                    raise RuntimeError('Timed out waiting for the stream. Is it live?')
                time.sleep(0.5)
            threading.Thread(target=self._twitch_chat if self.kind == 'twitch' else self._youtube_chat, daemon=True).start()
            threading.Thread(target=self._fetch_title, daemon=True).start()
            self._set(status='recording', stage='Recording and watching chat')
            last_clip, seen = -1e9, None
            while not self.stop_ev.is_set() and self.proc.poll() is None:
                time.sleep(1)
                done_bucket = int(time.time() // BUCKET) - 1
                if self.auto and self.max_seconds and self.now() > self.max_seconds:
                    self._set(stage='Reached the length limit; a new session starts if the stream is still live')
                    self.proc.terminate()
                    break
                if self.auto and shutil.disk_usage(self.dir).free < MIN_FREE_GB * 1024 ** 3:
                    self._set(status='error', error='Stopped: less than %d GB free on the disk.' % MIN_FREE_GB, stage='Disk almost full')
                    self.proc.terminate()
                    break
                cur = int(time.time() // BUCKET)
                m30 = sum(self.counts.get(b, 0) for b in (cur - 2, cur - 1, cur))
                hype = hype_percent(m30, self.state['baseline'], self.state['hist_n'])
                self._set(elapsed=int(self.now()), chat_now=self.counts.get(done_bucket + 1, 0), msgs30=m30, hype=hype, hype_label=hype_label(hype))
                if done_bucket == seen:
                    continue
                seen = done_bucket
                first = int(self.t0 // BUCKET)            # buckets before the session started are not 'usual chat', they are just empty
                hist = [self.counts.get(b, 0) for b in range(max(first, done_bucket - HISTORY), done_bucket)]
                self._set(hist_n=len(hist))
                c = self.counts.get(done_bucket, 0)
                self._set(baseline=round(statistics.mean(hist), 1) if hist else 0.0)
                if len([h for h in hist if h]) < 6:
                    continue                                   # not enough chat history yet
                mu = statistics.mean(hist)
                at = done_bucket * BUCKET + BUCKET / 2 - self.t0
                if is_spike(c, hist) and at - last_clip > COOLDOWN:
                    last_clip = at
                    feature = min(1.0, c / (max(mu, 1.0) * 6.0))
                    self._set(spikes=self.state['spikes'] + 1)
                    why = f'Chat spike: {c} msgs/10s vs {mu:.0f} normal'
                    threading.Timer(self.after + 4, lambda a=at, w=why, f=feature: self._cut(a - self.before, self.before + self.after, w, f)).start()
            if not self.stop_ev.is_set() and self.state['status'] != 'error':
                self._set(status='ended', stage=self.state['stage'] if self.auto and self.max_seconds and self.now() > self.max_seconds else 'The stream ended.')
        except Exception as e:
            self._set(status='error', error=str(e)[-300:], stage='Could not start')
        finally:
            self.stop_ev.set()
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
            if self.auto:
                threading.Thread(target=self._cleanup_recording, daemon=True).start()

    def _cleanup_recording(self):
        """Unattended sessions delete their big recording once the last clip is cut (the clips stay in My clips)."""
        end = time.time() + 600
        while self.state['pending'] and time.time() < end:
            time.sleep(2)
        time.sleep(5)
        try:
            shutil.rmtree(self.dir, ignore_errors=True)
        except OSError:
            pass
