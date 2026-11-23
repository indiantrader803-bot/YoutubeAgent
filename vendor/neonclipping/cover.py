"""Cover image for a finished clip: a sharp frame from the clip with its title on a dark box, as a JPEG you can use as thumbnail."""
from pathlib import Path
import subprocess

import hooks


def _probe(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
                        '-of', 'csv=p=0:s=,', str(path)], capture_output=True, text=True, timeout=30)
    values = [x for x in r.stdout.replace('\n', ',').split(',') if x.strip()]
    width, height = int(float(values[0])), int(float(values[1]))
    duration = float(values[2]) if len(values) > 2 else 0.0
    return width, height, duration


def frame_time(duration):
    """A moment a little before the middle of the clip, never past the end."""
    if duration <= 0.5:
        return 0.0
    return max(0.0, min(duration * 0.4, duration - 0.3))


def ass_text(lines, width, height):
    scale = min(width / 1080.0, height / 1920.0)
    head = ['[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {width}', f'PlayResY: {height}', 'WrapStyle: 2', '[V4+ Styles]',
            'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
            'Style: Main,Arial,72,&H00FFFFFF,&H0000FFFF,&H00100B18,&H99000000,-1,0,0,0,100,100,0,0,1,5,2,5,50,50,0,1',
            '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text']
    events = hooks.events(lines, width, height, int(height * 0.62), scale, {'hook_duration': 60})
    events = [e.replace('0:01:00.00', '9:59:59.00') for e in events]      # stay on screen at whatever time the frame is taken
    return '\n'.join(head + events) + '\n'


def hook_until(settings):
    """Seconds during which the clip itself already shows its opening heading (0 when it has none)."""
    try:
        if str(settings.get('hook') or '').strip() and settings.get('hook_enabled') is not False and settings.get('template') in (None, '', 'none'):
            return float(settings.get('hook_duration') or 8)
    except (TypeError, ValueError):
        pass
    return 0.0


def make(data, job, title='', hook='', hook_visible=0.0):
    """Create (or reuse) DATA/<job>.cover.jpg and return its path."""
    data = Path(data)
    clip = data / (job + '.mp4')
    out = data / (job + '.cover.jpg')
    if out.exists():
        return out
    if not clip.exists():
        raise FileNotFoundError('clip is missing')
    width, height, duration = _probe(clip)
    t = frame_time(duration)
    text = ' '.join(str(title or hook or '').split())[:80]
    # -ss after -i on purpose: with the seek before the input the title overlay (timed from 0) did not appear on the frame
    if hook_visible and t < hook_visible:
        if duration > hook_visible + 1:
            t = min(hook_visible + 0.5, duration - 0.3)       # pick a frame after the opening heading is gone
        else:
            text = ''                                          # short clip: its own heading already is the title
    command = ['ffmpeg', '-y', '-v', 'error', '-i', str(clip), '-ss', f'{t:.2f}', '-frames:v', '1', '-update', '1', '-q:v', '2']
    ass_file = data / (job + '.cover.ass')
    try:
        if text:
            from captions import hook_lines
            lines = hook_lines(text, width=max(12, int(width / (82 * min(width / 1080.0, height / 1920.0) * .6))))
            ass_file.write_text(ass_text(lines, width, height), encoding='utf-8')
            command += ['-vf', f'ass=filename={ass_file.name}']
        r = subprocess.run(command + [str(out)], capture_output=True, text=True, timeout=60, cwd=str(data))
        if r.returncode or not out.exists():
            out.unlink(missing_ok=True)
            raise RuntimeError('cover could not be made: ' + r.stderr[-200:])
    finally:
        ass_file.unlink(missing_ok=True)
    return out
