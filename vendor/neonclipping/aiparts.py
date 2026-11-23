"""Long streams with a free chatbot: split a video's transcript into small parts, give one copy-ready prompt per part,
read the chatbot's answers back as moments, and hand them to Make clips (which then downloads only those sections).

Why: a chatbot that is given a 9-hour transcript in one go only really reads the beginning. Twenty parts of ~25 minutes
are small enough to be read properly. Works with any chatbot (Gemini, ChatGPT, Claude, ...): the text is copied by hand,
nothing is sent anywhere by NeonClipping. The transcript comes from the video's own YouTube captions.
"""
import json
import math
import re

PART_MINUTES = 25
MAX_PARTS = 40


def hms(seconds):
    s = int(max(0, seconds))
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def parse_time(value):
    """'1:02:03', '12:30', '754', 754, '12m30s' -> seconds (float) or None."""
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) and value >= 0 else None
    t = str(value).strip().lower().replace(',', '.')
    m = re.fullmatch(r'(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)', t)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    m = re.fullmatch(r'(\d+):(\d{1,2}(?:\.\d+)?)', t)
    if m:
        return int(m.group(1)) * 60 + float(m.group(2))
    m = re.fullmatch(r'(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s?)?', t)
    if m and any(m.groups()):
        return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + float(m.group(3) or 0)
    if re.fullmatch(r'\d+(?:\.\d+)?', t):
        return float(t)
    return None


def transcript_lines(words, step=9.0):
    """[(start_seconds, 'text of about `step` seconds')] from word-timed captions."""
    lines, cur, t0 = [], [], None
    for w in words:
        if t0 is None:
            t0 = w['start']
        cur.append(w['text'])
        if w['start'] - t0 >= step and w['text'][-1:] in '.?!,' or w['start'] - t0 >= step * 1.8:
            lines.append((t0, ' '.join(cur)))
            cur, t0 = [], None
    if cur:
        lines.append((t0 if t0 is not None else 0.0, ' '.join(cur)))
    return lines


def plan_parts(duration, parts=None):
    n = int(parts) if parts else max(1, math.ceil(duration / (PART_MINUTES * 60.0)))
    n = max(1, min(MAX_PARTS, n))
    size = duration / n
    return [(i, i * size, min(duration, (i + 1) * size)) for i in range(n)]


def build_prompt(title, i, n, a, b, body, per_part=3, min_len=30, max_len=60, game_hint=''):
    return (
        f'You are an expert short-form video editor (YouTube Shorts, Instagram Reels, TikTok).\n'
        f'Below is part {i + 1} of {n} of the transcript of the video "{title}". This part covers {hms(a)} to {hms(b)}. '
        f'Every line starts with its time in [HH:MM:SS].\n\n'
        f'Task: find the {per_part} best moments in THIS part only. A good moment is complete and understandable on its own, '
        f'{min_len} to {max_len} seconds long, and starts on a strong line. Prefer big reactions (shouting, "oh my god"), funny fails, '
        f'crashes, chases, explosions, police, surprises and clear jokes or reveals{(". " + game_hint) if game_hint else "."} '
        f'Use only times that appear in the transcript. Never invent times.\n\n'
        f'Reply with ONLY a JSON array and nothing else:\n'
        f'[{{"start":"HH:MM:SS","end":"HH:MM:SS","title":"short title","hook":"the first 8 words viewers will see"}}]\n'
        f'If this part has nothing good, reply [].\n\n'
        f'TRANSCRIPT:\n{body}\n')


def split(title, words, duration, parts=None, per_part=3, min_len=30, max_len=60, game_hint=''):
    lines = transcript_lines(words)
    plan = plan_parts(duration, parts)
    out = []
    for i, a, b in plan:
        body_lines = [f'[{hms(t)}] {txt}' for t, txt in lines if a <= t < b]
        body = '\n'.join(body_lines)
        out.append({'index': i + 1, 'start': round(a), 'end': round(b), 'label': f'{hms(a)} - {hms(b)}', 'lines': len(body_lines),
                    'chars': len(body), 'prompt': build_prompt(title, i, len(plan), a, b, body, per_part, min_len, max_len, game_hint)})
    return out


def _json_blobs(text):
    """Outermost JSON values found in the text (chatbots wrap answers in prose and code fences)."""
    blobs, pos, dec = [], 0, json.JSONDecoder()
    while True:
        m = re.search(r'[\[{]', text[pos:])
        if not m:
            return blobs
        j = pos + m.start()
        try:
            obj, end = dec.raw_decode(text[j:])
            blobs.append(obj)
            pos = j + end
        except ValueError:
            pos = j + 1


LINE = re.compile(r'(?P<a>\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—|to|->)\s*(?P<b>\d{1,2}:\d{2}(?::\d{2})?)\s*[-:–—|]?\s*(?P<rest>.*)')


def parse_answers(text, duration=None, min_len=8, max_len=180):
    """-> (moments, rejected). Understands JSON (several answers pasted together are fine) and lines like '12:30-13:10 - title'."""
    cand = []

    def add(start, end, title='', hook=''):
        cand.append({'start': parse_time(start), 'end': parse_time(end), 'title': str(title or '')[:90], 'hook': str(hook or '')[:90]})

    def walk(obj):
        if isinstance(obj, list):
            for x in obj:
                walk(x)
        elif isinstance(obj, dict):
            keys = {k.lower(): v for k, v in obj.items()}
            s = next((keys[k] for k in ('start', 'start_time', 'from', 'begin') if k in keys), None)
            e = next((keys[k] for k in ('end', 'end_time', 'to', 'stop') if k in keys), None)
            if s is not None and e is not None:
                add(s, e, keys.get('title') or keys.get('name') or keys.get('label'), keys.get('hook') or keys.get('caption') or keys.get('text'))
            else:
                for v in obj.values():
                    if isinstance(v, (list, dict)):
                        walk(v)
    for blob in _json_blobs(text):
        walk(blob)
    if not cand:
        for line in text.splitlines():
            m = LINE.search(line)
            if m:
                rest = m.group('rest').strip(' *_`')
                add(m.group('a'), m.group('b'), rest, '')
    moments, rejected = [], []
    for c in cand:
        a, b = c['start'], c['end']
        if a is None or b is None:
            rejected.append({**c, 'why': 'time not understood'})
        elif b <= a:
            rejected.append({**c, 'why': 'end is before start'})
        elif b - a < min_len:
            rejected.append({**c, 'why': f'shorter than {min_len} s'})
        elif b - a > max_len:
            c['end'] = a + max_len                              # a chatbot that rambles: keep the strong opening
            moments.append(c)
        elif duration and a >= duration:
            rejected.append({**c, 'why': 'starts after the video ends'})
        else:
            if duration and b > duration:
                c['end'] = duration
            moments.append(c)
    moments.sort(key=lambda m: m['start'])
    clean = []
    for m in moments:                                           # overlapping answers (the same moment twice): keep the first
        if clean and m['start'] < clean[-1]['end'] - 2:
            rejected.append({**m, 'why': 'overlaps the previous moment'})
            continue
        clean.append(m)
    return clean[:40], rejected


def attach(app):
    from fastapi import HTTPException

    @app.post('/ai/parts')
    def ai_parts(b: dict):
        url = str(b.get('url', '')).strip()
        if not re.match(r'https?://', url):
            raise HTTPException(400, 'Paste a YouTube video link.')
        try:
            per_part = max(1, min(10, int(b.get('per_part', 3))))
            min_len = max(8, min(120, int(b.get('min_len', 30))))
            max_len = max(min_len + 5, min(180, int(b.get('max_len', 60))))
            parts = int(b['parts']) if b.get('parts') else None
        except (TypeError, ValueError):
            raise HTTPException(400, 'Check the numbers for parts, moments per part and clip length.')
        try:
            import ytdl
            from captions_yt import from_info
            with ytdl.YDL({'quiet': True, 'no_warnings': True, 'skip_download': True, 'noplaylist': True, 'socket_timeout': 20}) as y:
                info = y.extract_info(url, download=False)
        except Exception as e:
            raise HTTPException(400, 'Could not read that video: ' + str(e)[:160])
        if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
            raise HTTPException(400, 'This stream is live now. Use Live clipping, or wait until it has ended.')
        words = None
        try:
            words = from_info(info)
        except Exception:
            words = None
        if not words:
            raise HTTPException(400, 'This video has no YouTube captions, so there is no transcript to split. Use Make clips: it transcribes locally.')
        duration = float(info.get('duration') or (words[-1]['end'] + 5))
        title = str(info.get('title') or 'the video')[:120]
        data = split(title, words, duration, parts, per_part, min_len, max_len, str(b.get('hint', ''))[:200])
        return {'title': title, 'duration': round(duration), 'words': len(words), 'parts': data, 'url': url}

    @app.post('/ai/answers')
    def ai_answers(b: dict):
        text = str(b.get('text', ''))
        if len(text) > 400_000:
            raise HTTPException(400, 'That is too much text to read at once.')
        duration = b.get('duration')
        try:
            duration = float(duration) if duration else None
        except (TypeError, ValueError):
            duration = None
        moments, rejected = parse_answers(text, duration)
        if not moments:
            raise HTTPException(400, 'No moments found in that text. Paste the chatbot answers (JSON or lines like 12:30-13:10 title).')
        return {'moments': [{**m, 'start_label': hms(m['start']), 'end_label': hms(m['end'])} for m in moments], 'rejected': rejected}
