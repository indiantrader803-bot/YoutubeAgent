"""Find the facecam box in a gameplay video, locally, without any online AI.

A streamer's webcam is a rectangle whose border stays in exactly the same place in every frame (usually in a corner) and
that contains a face. Game panels (minimap, HUD, chat) also have static straight borders, so the border alone is not enough:

  1. look at ~14 frames spread through the video,
  2. mark the pixels that carry an edge in (almost) every frame: static borders,
  3. list the best rectangles anchored at a corner whose two inner borders are static,
  4. run the small YuNet face detector (MIT licence, 230 KB, models/face_detection_yunet_2023mar.onnx) inside each candidate:
     the webcam is the candidate that holds a face in most frames; a minimap never does,
  5. if no bordered rectangle holds a face, look for a face that sits in the same spot in most frames (a borderless overlay).

Only a sure answer is returned. With no convincing webcam the answer is "no facecam" and a plain game crop is the right layout.
Needs numpy + OpenCV (both already required by the app). Typically 2-5 seconds per video.
"""
import subprocess
import tempfile
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:      # the app lists opencv-python-headless; without it detection is simply unavailable
    cv2 = None

BW, BH = 640, 360          # frames kept for face detection
W, H = 320, 180            # frames used for the border search
FRAMES = 14
MODEL = Path(__file__).resolve().parent / 'models' / 'face_detection_yunet_2023mar.onnx'


def _duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True, timeout=30)
    return float(r.stdout.strip() or 0)


def sample_frames(path, n=FRAMES):
    """n BGR frames (n, BH, BW, 3) from evenly spread moments of the video."""
    dur = _duration(path)
    if dur <= 0:
        raise ValueError('Could not read the video.')
    lo, hi = dur * .06, dur * .94
    times = [lo + (hi - lo) * i / max(1, n - 1) for i in range(n)] if dur > 8 else [dur * (i + .5) / n for i in range(n)]
    frames = []
    with tempfile.TemporaryDirectory() as d:
        for i, t in enumerate(times):
            out = Path(d) / f'f{i}.png'
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{t:.2f}', '-i', str(path), '-frames:v', '1', '-vf', f'scale={BW}:{BH}', str(out)],
                           capture_output=True, timeout=60)
            if out.exists():
                img = cv2.imread(str(out), cv2.IMREAD_COLOR)
                if img is not None and img.shape[:2] == (BH, BW):
                    frames.append(img)
    if len(frames) < 6:
        raise ValueError('Not enough frames could be read from this video.')
    return np.stack(frames)


def _gray_small(frames):
    return np.stack([cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) for f in frames])


def static_edges(gray):
    """(thin, thick): pixels on an edge in at least 75% of the frames; thick is dilated by one pixel so a border that
    shifts by a pixel still counts."""
    freq = np.zeros(gray.shape[1:], np.float32)
    for f in gray:
        g = cv2.GaussianBlur(f, (3, 3), 0)
        gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
        freq += (np.hypot(gx, gy) > 60).astype(np.float32)
    freq /= len(gray)
    thin = (freq >= .75).astype(np.uint8)
    return thin, cv2.dilate(thin, np.ones((3, 3), np.uint8)).astype(np.float32)


def _vseg(cs, x, y0, y1):
    """Mean of the static-edge mask along column x between rows y0 and y1 (cs = cumulative sums down the rows)."""
    if x < 0 or x >= W or y1 <= y0:
        return 0.0
    top = cs[y0 - 1, x] if y0 > 0 else 0.0
    return float((cs[min(y1, H) - 1, x] - top) / (min(y1, H) - y0))


def _hseg(cs, y, x0, x1):
    """Mean of the static-edge mask along row y between columns x0 and x1 (cs = cumulative sums along the columns)."""
    if y < 0 or y >= H or x1 <= x0:
        return 0.0
    left = cs[y, x0 - 1] if x0 > 0 else 0.0
    return float((cs[y, min(x1, W) - 1] - left) / (min(x1, W) - x0))


def _runs(line, min_len, gap=3):
    """(start, end) of runs of non-zero values in a 1-D array, bridging gaps of up to `gap` pixels."""
    idx = np.flatnonzero(line)
    if idx.size == 0:
        return []
    cuts = np.flatnonzero(np.diff(idx) > gap)
    starts = np.r_[idx[0], idx[cuts + 1]]
    ends = np.r_[idx[cuts], idx[-1]]
    return [(int(a), int(b)) for a, b in zip(starts, ends) if b - a + 1 >= min_len]


def _segments(mask, vertical, min_len):
    """Static straight segments as (pos, start, end), one per cluster of neighbouring lines, plus the frame edge itself."""
    raw = []
    n = W if vertical else H
    span = H if vertical else W
    for p in range(n):
        line = mask[:, p] if vertical else mask[p, :]
        for a, b in _runs(line, min_len):
            raw.append((p, a, b))
    clusters = []
    for p, a, b in raw:
        for c in clusters:
            if abs(p - c['last']) <= 1 and min(b, c['b']) - max(a, c['a']) > .6 * min(b - a, c['b'] - c['a']):
                c['pos'].append(p)
                c['last'] = p
                c['a'], c['b'] = min(a, c['a']), max(b, c['b'])
                break
        else:
            clusters.append({'pos': [p], 'last': p, 'a': a, 'b': b})
    out = [(int(np.median(c['pos'])), c['a'], c['b']) for c in clusters]
    out += [(0, 0, span - 1), (n - 1, 0, span - 1)]                      # the frame's own edges
    return out


def candidates(gray, limit=24, min_border=.55):
    """Best distinct rectangles (small-frame pixels) whose four sides are static straight lines or the frame edge."""
    thin, thick = static_edges(gray)
    cs_r, cs_c = np.cumsum(thick, axis=0), np.cumsum(thick, axis=1)
    std = gray.std(axis=0)
    mean = gray.mean(axis=0)
    min_w, max_w = int(W * .09), int(W * .46)
    min_h, max_h = int(H * .12), int(H * .66)
    seen, vs = set(), []
    for seg in _segments(thin, True, int(H * .10)) + _segments(thick, True, int(H * .10)):     # thin lines and bridged lines both count
        key = (seg[0], seg[1] // 3, seg[2] // 3)
        if key not in seen:
            seen.add(key)
            vs.append(seg)
    found = []
    for xl, yl0, yl1 in vs:
        for xr, yr0, yr1 in vs:
            w = xr - xl
            if not min_w <= w <= max_w:
                continue
            y0, y1 = max(yl0, yr0), min(yl1, yr1)
            h = y1 - y0
            if not min_h <= h <= max_h or not .45 <= w / float(h) <= 2.3:
                continue
            # top / bottom sides: static line or frame edge
            top = 1.0 if y0 <= 2 else max(_hseg(cs_c, yy, xl, xr) for yy in (y0 - 1, y0, y0 + 1) if 0 <= yy < H)
            bot = 1.0 if y1 >= H - 3 else max(_hseg(cs_c, yy, xl, xr) for yy in (y1 - 1, y1, y1 + 1) if 0 <= yy < H)
            left = 1.0 if xl <= 1 else max(_vseg(cs_r, xx, y0, y1) for xx in (xl - 1, xl, xl + 1) if 0 <= xx < W)
            right = 1.0 if xr >= W - 2 else max(_vseg(cs_r, xx, y0, y1) for xx in (xr - 1, xr, xr + 1) if 0 <= xx < W)
            border = min(top, bot, left, right)
            if border >= min_border:
                touches = [xl <= 1, xr >= W - 2, y0 <= 2, y1 >= H - 3]
                if sum(touches) >= 3:       # most of the frame, not a webcam
                    continue
                found.append((border, xl, y0, w, h, 'edge' if any(touches) else 'float'))
    found.sort(key=lambda c: (-round(c[0], 2), -c[3] * c[4]))
    picked = []
    for b, x0, y0, w, h, kind in found:
        if any(_iou((x0, y0, w, h), (p['x0'], p['y0'], p['w'], p['h'])) > .7 for p in picked):      # nested boxes are kept on purpose
            continue
        inside = std[y0 + 2:y0 + h - 2, x0 + 2:x0 + w - 2]
        ya, yb, xa, xb = max(0, y0 - 6), min(H, y0 + h + 6), max(0, x0 - 6), min(W, x0 + w + 6)
        outer = mean[ya:yb, xa:xb]
        mask = np.ones_like(outer, bool)
        mask[y0 - ya:y0 - ya + h, x0 - xa:x0 - xa + w] = False
        contrast = abs(float(mean[y0 + 3:y0 + h - 3, x0 + 3:x0 + w - 3].mean()) - float(outer[mask].mean())) if mask.any() else 0.0
        picked.append({'border': float(b), 'x0': x0, 'y0': y0, 'w': w, 'h': h, 'corner': kind,
                       'calm': float(inside.mean()) if inside.size else 99.0, 'contrast': contrast})
        if len(picked) >= limit:
            break
    return picked, float(np.median(std))


def _iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix, iy = max(0, min(ax + aw, bx + bw) - max(ax, bx)), max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / float(aw * ah + bw * bh - inter + 1e-9)


class Faces:
    """YuNet wrapper: faces(image) -> [(x, y, w, h, score)]."""
    def __init__(self):
        if not MODEL.exists():
            raise FileNotFoundError(f'Face model missing: {MODEL}')
        self.det = cv2.FaceDetectorYN.create(str(MODEL), '', (320, 320), 0.6, 0.3, 500)

    def find(self, img):
        h, w = img.shape[:2]
        self.det.setInputSize((w, h))
        _, out = self.det.detect(img)
        return [] if out is None else [(float(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[14])) for r in out]


MIN_LIVE = 0.35      # a channel logo, drawn avatar or still picture does not change between frames; a real webcam always does a little


def is_live(calm):
    """False for a picture that never changes (typical logo or avatar box), True for moving video."""
    return calm >= MIN_LIVE


def face_rate(frames, cand, faces):
    """Share of frames in which a face is found inside the candidate rectangle (candidate in small-frame pixels)."""
    sx, sy = BW / W, BH / H
    x0, y0, w, h = int(cand['x0'] * sx), int(cand['y0'] * sy), int(cand['w'] * sx), int(cand['h'] * sy)
    hits = 0
    for f in frames:
        crop = f[y0:y0 + h, x0:x0 + w]
        if crop.size == 0:
            continue
        scale = max(1.0, 192.0 / min(crop.shape[:2]))
        if scale > 1:
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        ok = [r for r in faces.find(crop) if r[2] >= .16 * crop.shape[1] and r[3] >= .16 * crop.shape[0]]
        hits += 1 if ok else 0
    return hits / float(len(frames))


def borderless_face(frames, faces):
    """A face that sits in the same corner spot in most frames (webcam overlay without a clear border)."""
    boxes = []
    for f in frames:
        fs = [r for r in faces.find(f) if r[2] >= 36 and r[4] >= .75]
        boxes.append(fs)
    best = None
    for i, fs in enumerate(boxes):
        for r in fs:
            cx, cy = r[0] + r[2] / 2, r[1] + r[3] / 2
            if not (cx < BW * .42 or cx > BW * .58) or not (cy < BH * .45 or cy > BH * .55):
                continue                                   # only faces in a corner area
            same = sum(1 for g in boxes if any(abs((q[0] + q[2] / 2) - cx) < r[2] * .45 and abs((q[1] + q[3] / 2) - cy) < r[3] * .45 for q in g))
            rate = same / float(len(frames))
            if best is None or rate > best[0]:
                best = (rate, r)
    if not best or best[0] < .6:
        return None
    rate, (fx, fy, fw, fh, _) = best
    bw_, bh_ = fw * 2.6, fh * 2.9
    x0 = min(max(0, fx + fw / 2 - bw_ / 2), BW - bw_)
    y0 = min(max(0, fy + fh / 2 - bh_ * .45), BH - bh_)
    return rate, (x0 / BW, y0 / BH, bw_ / BW, bh_ / BH)


def detect_from_frames(frames):
    gray = _gray_small(frames)
    cands, game_motion = candidates(gray)
    faces = Faces()
    scored = []
    for c in cands:
        if not is_live(c['calm']):
            continue                    # static logo / avatar: not the streamer's camera
        rate = face_rate(frames, c, faces)
        c['faces'] = rate
        area = c['w'] * c['h'] / float(W * H)
        score = rate * .6 + c['border'] * .3 + min(c['contrast'] / 40.0, 1) * .1 + min(area / .12, 1) * .12   # prefer the whole webcam over a frame inside it
        if rate >= .35 and 0.015 <= area <= 0.32:
            scored.append((score, c))
    if scored:
        score, c = max(scored, key=lambda t: t[0])
        # the best box may be only the picture inside a larger framed webcam: upgrade to the enclosing framed box when one exists
        for _, o in sorted(scored, key=lambda t: -t[1]['w'] * t[1]['h']):
            area_o = o['w'] * o['h'] / float(W * H)
            inside = (o['x0'] <= c['x0'] + 2 and o['y0'] <= c['y0'] + 2 and o['x0'] + o['w'] >= c['x0'] + c['w'] - 2 and o['y0'] + o['h'] >= c['y0'] + c['h'] - 2)
            if o is not c and inside and area_o <= .28 and o['border'] >= max(.6, c['border'] - .35) and o['faces'] >= .85 * c['faces'] and o['w'] * o['h'] <= 6 * c['w'] * c['h']:
                c = o
                break
        return {'found': True, 'method': 'border+face', 'confidence': round(min(1.0, score), 2), 'corner': c['corner'],
                'cam': {'x': round(c['x0'] / W, 4), 'y': round(c['y0'] / H, 4), 'w': round(c['w'] / W, 4), 'h': round(c['h'] / H, 4)},
                'face_rate': round(c['faces'], 2), 'border': round(c['border'], 2), 'calm': round(c['calm'], 1), 'game_motion': round(game_motion, 1)}
    bf = borderless_face(frames, faces)
    if bf:
        rate, (x, y, w, h) = bf
        return {'found': True, 'method': 'face-only', 'confidence': round(min(.85, rate * .8), 2), 'cam': {'x': round(x, 4), 'y': round(y, 4), 'w': round(w, 4), 'h': round(h, 4)},
                'face_rate': round(rate, 2), 'game_motion': round(game_motion, 1)}
    return {'found': False, 'confidence': 0.0, 'game_motion': round(game_motion, 1),
            'reason': 'no rectangle with a steady border holds a face, and no face sits in the same corner spot in most frames'}


def detect(path):
    """Detect the facecam in a video file. When found the dict also carries a 'game' box (the whole frame)."""
    if cv2 is None:
        return {'found': False, 'reason': 'OpenCV is not installed (pip install opencv-python-headless)', 'confidence': 0.0}
    res = detect_from_frames(sample_frames(path))
    if res['found']:
        c = res['cam']
        inset = .006                                      # stay just inside the border so no frame line leaks into the clip
        res['cam'] = {'x': round(c['x'] + inset, 4), 'y': round(c['y'] + inset, 4), 'w': round(max(.02, c['w'] - 2 * inset), 4), 'h': round(max(.02, c['h'] - 2 * inset), 4)}
        res['game'] = {'x': 0, 'y': 0, 'w': 1, 'h': 1}
    return res


def attach(app, data):
    from fastapi import HTTPException

    @app.post('/facecam/detect')
    def facecam_detect(b: dict):
        sid = str(b.get('id', ''))
        p = Path(data) / (sid + '.mp4')
        if not sid.isalnum() or not p.exists():
            raise HTTPException(400, 'Add a video first (wait for the download to finish).')
        try:
            return detect(p)
        except (ValueError, FileNotFoundError, subprocess.TimeoutExpired, OSError) as e:
            raise HTTPException(400, 'Could not look for a facecam: ' + str(e)[:150])
