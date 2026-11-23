"""GTA 6 live clipper: Streamlink records, anonymous Twitch chat finds spikes,
FFmpeg cuts a 9:16 clip around each spike, Whisper burns captions.

Usage:
  python live_clip.py <twitch_channel> [--minutes 120] [--before 20] [--after 10]
  python live_clip.py --test <video_file> --at 45,120     # offline pipeline test

Output: ./out/<channel>_<date>/  (recording.ts, clip_###.mp4, spikes.csv)
"""
import argparse, collections, csv, datetime as dt, os, re, socket, statistics, subprocess, sys, threading, time
from pathlib import Path

BUCKET = 10          # seconds per chat bucket
HISTORY = 30         # buckets used as the baseline (5 minutes)
SIGMA = 2.5          # spike = mean + SIGMA * stdev
MIN_MSGS = 8         # and at least this many messages in the bucket
COOLDOWN = 60        # seconds between two clips


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------- Whisper (GPU if available) ----------
_model = None

def whisper():
    global _model
    if _model is None:
        sp = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
        for sub in ("cublas", "cudnn"):
            b = sp / sub / "bin"
            if b.exists():
                os.add_dll_directory(str(b)); os.environ["PATH"] = str(b) + ";" + os.environ["PATH"]
        from faster_whisper import WhisperModel
        try:
            _model = WhisperModel("large-v3-turbo", device="cuda", compute_type="int8_float16")
        except Exception as e:
            log("GPU whisper failed, using CPU:", e)
            _model = WhisperModel("small", device="cpu", compute_type="int8")
    return _model


def srt_time(t):
    h, r = divmod(t, 3600); m, s = divmod(r, 60)
    return f"{int(h):02}:{int(m):02}:{int(s):02},{int((s % 1) * 1000):03}"


def make_srt(wav, srt):
    segs, _ = whisper().transcribe(str(wav), word_timestamps=True, vad_filter=True)
    words = [w for s in segs for w in (s.words or [])]
    lines, i = [], 0
    while i < len(words):                       # 3 words per caption, punchy reel style
        chunk = words[i:i + 3]; i += 3
        lines.append((chunk[0].start, chunk[-1].end, " ".join(w.word.strip() for w in chunk).upper()))
    with open(srt, "w", encoding="utf-8") as f:
        for n, (a, b, t) in enumerate(lines, 1):
            f.write(f"{n}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n\n")
    return len(lines)


# ---------- FFmpeg cut + 9:16 + captions ----------
def has_nvenc():
    r = subprocess.run(["ffmpeg", "-hide_banner", "-f", "lavfi", "-i", "nullsrc=s=256x256:d=0.1",
                        "-c:v", "h264_nvenc", "-f", "null", "-"], capture_output=True)
    return r.returncode == 0

VENC = None

CREDIT = ''

def cut_clip(src, start, dur, out):
    global VENC
    if VENC is None:
        VENC = ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", "21"] if has_nvenc() else ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast"]
    raw = out.with_suffix(".raw.mp4"); wav = out.with_suffix(".wav"); srt = out.with_suffix(".srt")
    # 1) cut the moment (re-encode so the cut is frame-accurate)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.2f}", "-i", str(src), "-t", f"{dur:.2f}",
                    *VENC, "-c:a", "aac", "-b:a", "160k", str(raw)], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-ac", "1", "-ar", "16000", str(wav)], check=True)
    n = make_srt(wav, srt)
    # 2) 9:16: blurred full frame behind, gameplay centred, captions in the safe zone
    sub = srt.name.replace("\\", "/")
    style = "Fontname=Arial Black,Fontsize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=110"
    vf = ("[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bg];"
          "[0:v]scale=1080:-2[fg];[bg][fg]overlay=0:(H-h)/2" + (f",subtitles={sub}:force_style='{style}'" if n else "")
          + (f",drawtext=text='Credit\: {CREDIT}':fontfile='C\:/Windows/Fonts/arialbd.ttf':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.6:boxborderw=14:x=60:y=270" if CREDIT else ""))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", raw.name, "-filter_complex", vf,
                    *VENC, "-c:a", "copy", "-movflags", "+faststart", out.name], check=True, cwd=out.parent)
    for p in (raw, wav):
        p.unlink(missing_ok=True)
    log(f"CLIP READY {out}  ({n} caption lines)")


# ---------- Anonymous Twitch chat ----------
def chat_counter(channel, counts, stop):
    while not stop.is_set():
        try:
            s = socket.create_connection(("irc.chat.twitch.tv", 6667), timeout=30)
            s.sendall(f"PASS SCHMOOPIIE\r\nNICK justinfan{int(time.time()) % 100000}\r\nJOIN #{channel}\r\n".encode())
            log("chat connected (anonymous, read-only)")
            buf = ""
            while not stop.is_set():
                data = s.recv(4096).decode("utf-8", "ignore")
                if not data:
                    break
                buf += data
                *lines, buf = buf.split("\r\n")
                for ln in lines:
                    if ln.startswith("PING"):
                        s.sendall(b"PONG :tmi.twitch.tv\r\n")
                    elif " PRIVMSG " in ln:
                        counts[int(time.time() // BUCKET)] += 1
        except Exception as e:
            log("chat reconnect:", e); time.sleep(3)


def yt_chat_counter(video_id, counts, stop):
    import pytchat
    while not stop.is_set():
        try:
            chat = pytchat.create(video_id=video_id)
            log("YouTube chat connected (read-only)")
            while chat.is_alive() and not stop.is_set():
                for _ in chat.get().sync_items():
                    counts[int(time.time() // BUCKET)] += 1
                time.sleep(0.5)
        except Exception as e:
            log("yt chat reconnect:", e); time.sleep(3)


def run_live(a):
    global CREDIT
    CREDIT = a.credit
    is_yt = "youtu" in a.channel
    if is_yt:
        m = re.search(r"(?:v=|live/|youtu\.be/)([A-Za-z0-9_-]{11})", a.channel)
        ch, url = (m.group(1) if m else "ytlive"), a.channel
    else:
        ch = a.channel.lower().lstrip("#"); url = f"https://twitch.tv/{ch}"
    outdir = Path(a.out) / f"{ch}_{dt.datetime.now():%Y%m%d_%H%M}"
    outdir.mkdir(parents=True, exist_ok=True)
    rec = outdir / "recording.ts"
    log("recording", url, "->", rec)
    sl = subprocess.Popen(["py", "-3.11", "-m", "streamlink", "--twitch-disable-ads", "--stdout",
                           url, "best"], stdout=open(rec, "wb"), stderr=subprocess.PIPE)
    t0 = None
    while t0 is None:                       # wait for the first bytes so times line up
        if sl.poll() is not None:
            sys.exit("streamlink stopped: " + sl.stderr.read().decode(errors="ignore")[-400:])
        if rec.exists() and rec.stat().st_size > 0:
            t0 = time.time()
        time.sleep(0.5)
    counts, stop = collections.Counter(), threading.Event()
    threading.Thread(target=yt_chat_counter if is_yt else chat_counter, args=(ch, counts, stop), daemon=True).start()
    spikes = open(outdir / "spikes.csv", "a", newline=""); w = csv.writer(spikes)
    w.writerow(["clock", "stream_sec", "msgs", "baseline", "clip"])
    pending, last_clip, n = [], -1e9, 0
    end = time.time() + a.minutes * 60
    try:
        while time.time() < end and sl.poll() is None:
            time.sleep(1)
            done_bucket = int(time.time() // BUCKET) - 1
            if not hasattr(run_live, "seen") or run_live.seen != done_bucket:
                run_live.seen = done_bucket
                hist = [counts.get(b, 0) for b in range(done_bucket - HISTORY, done_bucket)]
                c = counts.get(done_bucket, 0)
                if len([h for h in hist if h]) >= 6:
                    mu, sd = statistics.mean(hist), statistics.pstdev(hist) or 1
                    t_spike = done_bucket * BUCKET + BUCKET / 2 - t0
                    if c >= MIN_MSGS and c > mu + SIGMA * sd and t_spike - last_clip > COOLDOWN:
                        n += 1; last_clip = t_spike
                        name = outdir / f"clip_{n:03}.mp4"
                        log(f"SPIKE {c} msgs (baseline {mu:.1f}) at {t_spike:.0f}s -> {name.name}")
                        w.writerow([time.strftime("%H:%M:%S"), round(t_spike), c, round(mu, 1), name.name]); spikes.flush()
                        pending.append((time.time() + a.after + 5, t_spike, name))
            for job in [j for j in pending if j[0] <= time.time()]:
                pending.remove(job)
                start = max(0, job[1] - a.before)
                threading.Thread(target=cut_clip, args=(rec, start, a.before + a.after, job[2]), daemon=True).start()
    finally:
        stop.set(); sl.terminate()
        log("stopped. clips in", outdir)


def run_test(a):
    global CREDIT
    CREDIT = a.credit
    src = Path(a.test).resolve()
    outdir = Path(a.out) / f"test_{dt.datetime.now():%Y%m%d_%H%M}"; outdir.mkdir(parents=True, exist_ok=True)
    for i, t in enumerate([float(x) for x in a.at.split(",")], 1):
        cut_clip(src, max(0, t - a.before), a.before + a.after, (outdir / f"clip_{i:03}.mp4").resolve())


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("channel", nargs="?")
    p.add_argument("--minutes", type=float, default=120)
    p.add_argument("--before", type=float, default=20)
    p.add_argument("--after", type=float, default=10)
    p.add_argument("--out", default=str(Path(__file__).parent / "out"))
    p.add_argument("--credit", default="", help="streamer handle burned as Credit badge")
    p.add_argument("--test"); p.add_argument("--at", default="30")
    a = p.parse_args()
    run_test(a) if a.test else run_live(a) if a.channel else p.error("channel or --test needed")
