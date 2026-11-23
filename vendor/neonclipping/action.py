"""On-screen action cues from a low-resolution look at a candidate window.

motion  - optical flow (Farneback), 90th percentile magnitude: cars, people, camera moving fast
flash   - sudden brightness / fire-orange jumps: explosions, muzzle flashes, impacts
strobe  - red <-> blue alternation: police lights
cuts    - hard scene cuts per second (editing / camera swaps)
Everything is a heuristic, scaled 0..1, meant to RANK candidates, not to label them. Never claims 'police chase' on its own.
"""
import subprocess
import numpy as np
import cv2

W, H, FPS = 160, 90, 6


def analyze(path, start, dur):
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{max(0, start):.2f}', '-t', f'{dur:.2f}', '-i', str(path), '-an',
           '-vf', f'fps={FPS},scale={W}:{H}', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
    raw = subprocess.run(cmd, capture_output=True).stdout
    size = W * H * 3
    n = len(raw) // size
    if n < 4:
        return {'motion': 0.0, 'flash': 0.0, 'strobe': 0.0, 'cuts': 0.0}
    frames = np.frombuffer(raw[:n * size], np.uint8).reshape(n, H, W, 3)
    gray = frames.mean(axis=3).astype(np.uint8)
    lum = gray.reshape(n, -1).mean(axis=1)
    flows, cuts = [], 0
    for i in range(1, n):
        if float(np.mean(cv2.absdiff(gray[i], gray[i - 1]))) > 38:
            cuts += 1
            continue
        f = cv2.calcOpticalFlowFarneback(gray[i - 1], gray[i], None, .5, 2, 9, 2, 5, 1.1, 0)
        flows.append(float(np.percentile(np.hypot(f[..., 0], f[..., 1]), 90)))
    motion = float(np.mean(flows)) if flows else 0.0
    # flash: luminance jump up (>= 18 levels in one step) followed by a drop = a short bright burst, not a cut
    d = np.diff(lum)
    flash_events = int(np.sum((d[:-1] > 28) & (d[1:] < -10)))
    r = frames[..., 0].astype(np.int16); g = frames[..., 1].astype(np.int16); b = frames[..., 2].astype(np.int16)
    orange = ((r > 200) & (g > 90) & (g < 190) & (b < 90)).reshape(n, -1).mean(axis=1)
    flash_events += int(np.sum(np.diff(orange) > 0.08))
    red = ((r > 170) & (g < 90) & (b < 90)).reshape(n, -1).mean(axis=1)
    blue = ((b > 170) & (r < 90) & (g < 140)).reshape(n, -1).mean(axis=1)
    diff = red - blue
    sign = np.where(diff > 0.004, 1, np.where(diff < -0.004, -1, 0))
    nz = sign[sign != 0]
    alternations = int(np.sum(nz[1:] != nz[:-1])) if len(nz) > 1 else 0
    secs = n / FPS
    return {
        'motion': float(min(1.0, motion / 8.0)),                 # ~8 px/frame at 160x90 = very fast action
        'flash': float(min(1.0, flash_events / max(secs / 6.0, 1.0) / 3.0)),
        'strobe': float(min(1.0, alternations / max(secs, 1.0) / 1.5)),
        'cuts': float(min(1.0, cuts / max(secs / 4.0, 1.0))),
    }
