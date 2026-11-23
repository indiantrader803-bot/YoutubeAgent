"""Style features end to end: templates, background card, watermark, credit, outro, music, caption animations, SRT/ASS import.
Renders real clips through /export and measures them; frames are saved in tests/out/ for a visual check."""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e import BOX, DATA, OUT, R, WORDS, api, frame, probe, test_source, wait_job
import urllib.request

G = 'style'


def upload_asset(path, kind):
    boundary = '----ncasset'
    blob = Path(path).read_bytes()
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{Path(path).name}"\r\nContent-Type: application/octet-stream\r\n\r\n').encode() \
        + blob + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(f'http://127.0.0.1:8770/upload-asset?kind={kind}', data=body, headers={'Content-Type': 'multipart/form-data; boundary=' + boundary})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode()[:200], 'status': e.code}


def make_assets():
    img = OUT / 'logo.png'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xff4ba5:s=240x240', '-vf', 'drawbox=x=40:y=40:w=160:h=160:color=white:t=fill', '-frames:v', '1', str(img)], check=True)
    bg = OUT / 'wall.jpg'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', str(bg)], check=True)
    mus = OUT / 'bed.mp3'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-q:a', '5', str(mus)], check=True)
    return img, bg, mus


def render(extra, start, dur=8, layout='stack', check_audio=False, name='x'):
    body = {'id': SID, 'start': start, 'end': start + dur, 'layout': layout, 'captions': True, 'caption_style': 'gta', 'hook': 'WAIT FOR IT',
            'title': 't', 'words': WORDS, 'top': .32, **BOX, **extra}
    st, r = api('/export', body)
    if st != 200:
        return False, f'HTTP {st} {r}', None
    res = wait_job(r['job'], limit=240)
    if res['status'] != 'done':
        return False, res.get('error', '')[:400], None
    f = DATA / (res['file'] + '.mp4')
    p = probe(f)
    ok = p['w'] == 1080 and p['h'] == 1920 and p['vcodec'] == 'h264' and abs(p['dur'] - dur) < 0.7 and (not check_audio or p['acodec'] == 'aac')
    frame(f, min(3.0, dur - 1), OUT / f'style_{name}.jpg')
    if dur > 5:
        frame(f, dur - 1.0, OUT / f'style_{name}_end.jpg')
    return ok, f'{p["w"]}x{p["h"]} {p["vcodec"]}/{p["acodec"]} {p["dur"]:.1f}s', res['file']


def run():
    global SID
    SID, m = test_source()
    start = min(5, m['dur'] - 14)
    img, bg, mus = make_assets()
    a_img = upload_asset(img, 'image')
    a_bg = upload_asset(bg, 'image')
    a_mus = upload_asset(mus, 'audio')
    R.check(G, 'upload image asset', lambda: ('id' in a_img, a_img))
    R.check(G, 'upload audio asset', lambda: ('id' in a_mus, a_mus))
    R.check(G, 'upload rejects a non-media file', lambda: (lambda x: (x.get('status') == 400, x))(upload_asset(OUT / 'edit_sample.mp4' if False else Path(__file__), 'image')))
    R.check(G, 'upload rejects unknown kind', lambda: (upload_asset(img, 'zip').get('status') in (400, 422), ''))
    for t in ('x_light', 'x_dark', 'tiktok_hook', 'breaking_news'):
        R.check(G, f'template {t}', lambda t=t: render({'template': t, 'hook': 'The strength of being misunderstood is that people never see it coming', 'tpl_name': 'Ajay K Meena', 'tpl_handle': 'iamajmeena'}, start, name='tpl_' + t)[:2])
    R.check(G, 'template rejects unknown name', lambda: (api('/export', {'id': SID, 'start': start, 'end': start + 5, 'layout': 'stack', **BOX, 'template': 'zzz'})[0] == 400, ''))
    for mode in ('blur', 'color', 'gradient'):
        R.check(G, f'background card {mode} + padding + rounded corners', lambda mode=mode: render({'bg_mode': mode, 'padding': 8, 'radius': 40, 'bg_color': '#112244', 'bg_color2': '#ff4ba5'}, start, name='bg_' + mode)[:2])
    R.check(G, 'background image + dim + blur', lambda: render({'bg_mode': 'image', 'bg_image': a_bg['id'], 'padding': 8, 'radius': 30, 'bg_dim': .3}, start, name='bg_image')[:2])
    R.check(G, 'background image without upload is refused', lambda: (api('/export', {'id': SID, 'start': start, 'end': start + 5, 'layout': 'stack', **BOX, 'bg_mode': 'image'})[0] == 400, ''))
    R.check(G, 'bad colour refused', lambda: (api('/export', {'id': SID, 'start': start, 'end': start + 5, 'layout': 'stack', **BOX, 'bg_mode': 'color', 'bg_color': 'red'})[0] == 400, ''))
    for pos in ('tl', 'tr', 'bl', 'br'):
        R.check(G, f'watermark {pos}', lambda pos=pos: render({'watermark_image': a_img['id'], 'watermark_pos': pos, 'watermark_size': 14, 'watermark_opacity': .8}, start, name='wm_' + pos)[:2])
    R.check(G, 'credit line', lambda: render({'credit': 'Clip: Kai Cenat'}, start, name='credit')[:2])
    R.check(G, 'outro ribbon in the last 3 s', lambda: render({'outro_text': 'FOLLOW @iamajmeena', 'outro_seconds': 3}, start, dur=8, name='outro')[:2])

    def level(file, ss):
        r = subprocess.run(['ffmpeg', '-v', 'info', '-ss', str(ss), '-t', '1.5', '-i', str(DATA / (file + '.mp4')), '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
                           capture_output=True, text=True)
        for line in r.stderr.splitlines():
            if 'mean_volume' in line:
                return float(line.split('mean_volume:')[1].split('dB')[0])
        return -99.0

    # music-only path: a source without audio, so the level IS the bed
    silent = OUT / 'silent_sample.mp4'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', '0', '-t', '14', '-i', str(DATA / (SID + '.mp4')), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', str(silent)], check=True)
    from e2e import upload
    sid2 = upload(silent)['id']

    def music_only():
        body = {'id': sid2, 'start': 1, 'end': 9, 'layout': 'stack', 'captions': False, **BOX, 'music': a_mus['id'], 'music_volume': .1, 'music_peak': .9, 'music_riser': 3}
        st, r = api('/export', body)
        res = wait_job(r['job'], limit=120)
        if res['status'] != 'done':
            return False, res.get('error', '')[:300]
        a, b = level(res['file'], 0.3), level(res['file'], 6.3)
        p = probe(DATA / (res['file'] + '.mp4'))
        return (b > a + 8 and p['acodec'] == 'aac' and abs(p['dur'] - 8) < .7), f'bed {a:.1f} dB at start -> {b:.1f} dB at the end (peak 9x louder), audio={p["acodec"]}, {p["dur"]:.1f}s'
    R.check(G, 'music bed (source without audio) starts quiet and rises to its peak', music_only)
    R.check(G, 'music mixed under a voice (source with audio): aac, right length', lambda: render({'music': a_mus['id'], 'music_volume': .1, 'music_peak': .9, 'music_riser': 3}, start, dur=8, check_audio=True, name='music')[:2])
    R.check(G, 'music without upload is refused', lambda: (api('/export', {'id': SID, 'start': start, 'end': start + 5, 'layout': 'stack', **BOX, 'music': 'nope'})[0] == 400, ''))
    R.check(G, 'everything together (template off): card + watermark + credit + outro + music', lambda: render({
        'bg_mode': 'gradient', 'padding': 7, 'radius': 36, 'bg_color': '#1b1030', 'bg_color2': '#ff4ba5', 'watermark_image': a_img['id'], 'watermark_pos': 'tl',
        'credit': 'Clip: Test', 'outro_text': 'FOLLOW', 'music': a_mus['id']}, start, dur=9, check_audio=True, name='all')[:2])
    R.check(G, 'template + watermark + music together', lambda: render({'template': 'x_light', 'hook': 'Together', 'watermark_image': a_img['id'], 'music': a_mus['id']}, start, dur=9, check_audio=True, name='tpl_all')[:2])


if __name__ == '__main__':
    run()
    R.save()
    bad = [r for r in R.rows if not r['ok']]
    print(f'\n{len(R.rows) - len(bad)}/{len(R.rows)} passed')
