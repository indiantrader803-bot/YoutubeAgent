"""Visual styling extras for exports, independent of the layout code.

A style plan is built from the export request. It can add, in this order:
  1. a social-card TEMPLATE (X light / X dark / TikTok hook / Breaking news) that replaces the layout, or a BACKGROUND card
     (padding + rounded corners on a blur / colour / gradient / image canvas) around the finished layout,
  2. a WATERMARK image,
  3. text layers through the ASS file: credit line, outro ribbon, template texts,
  4. a MUSIC bed under the clip that rises to a peak volume in the last seconds.
The layout code only has to produce a [base] stream; everything here works on that stream or on the source video.
"""
import json
import math
import re
import subprocess
import textwrap
from pathlib import Path

KEYS = ('template', 'tpl_name', 'tpl_handle', 'bg_mode', 'bg_color', 'bg_color2', 'bg_image', 'bg_dim', 'bg_blur', 'padding', 'radius',
        'watermark_image', 'watermark_pos', 'watermark_size', 'watermark_opacity', 'credit', 'outro_text', 'outro_seconds',
        'music', 'music_volume', 'music_peak', 'music_riser', 'caption_anim')
TEMPLATES = ('none', 'x_light', 'x_dark', 'tiktok_hook', 'breaking_news')
BG_MODES = ('blur', 'color', 'gradient', 'image')
WM_POS = ('tl', 'tr', 'bl', 'br')
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')
ASSET_KINDS = {'image': ('.png', '.jpg', '.jpeg', '.webp'), 'audio': ('.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac')}


def asset_dir(data):
    d = Path(data) / 'assets'
    d.mkdir(parents=True, exist_ok=True)
    return d


def asset_path(data, asset_id, kind):
    """Path of an uploaded image/audio asset, or None. Ids are alphanumeric so they cannot point outside the folder."""
    if not isinstance(asset_id, str) or not asset_id.isalnum():
        return None
    for ext in ASSET_KINDS[kind]:
        p = asset_dir(data) / (asset_id + ext)
        if p.exists():
            return p
    return None


def hexcolor(value, default):
    value = default if value in (None, '') else str(value)
    if not HEX.match(value):
        raise ValueError('Colours must look like #RRGGBB.')
    return value


def ass_color(hex_, alpha=0):
    r, g, b = int(hex_[1:3], 16), int(hex_[3:5], 16), int(hex_[5:7], 16)
    return '&H%02X%02X%02X%02X&' % (alpha, b, g, r)


def number(value, default, lo, hi, name):
    try:
        v = float(default if value in (None, '') else value)
    except (TypeError, ValueError):
        raise ValueError(f'{name} must be a number.')
    if not math.isfinite(v) or not lo <= v <= hi:
        raise ValueError(f'{name} must be between {lo:g} and {hi:g}.')
    return v


def text_field(value, limit, name):
    s = ' '.join(str(value or '').replace('{', '(').replace('}', ')').replace('\\', '/').split())
    return s[:limit]


def rrect(x, y, w, h, r):
    """ASS drawing path of a rounded rectangle (cubic corners)."""
    r = max(0, min(r, w / 2, h / 2))
    x, y, w, h, r = (round(v, 1) for v in (x, y, w, h, r))
    k = r * .5523
    return (f'm {x + r} {y} l {x + w - r} {y} b {x + w - r + k} {y} {x + w} {y + r - k} {x + w} {y + r} '
            f'l {x + w} {y + h - r} b {x + w} {y + h - r + k} {x + w - r + k} {y + h} {x + w - r} {y + h} '
            f'l {x + r} {y + h} b {x + r - k} {y + h} {x} {y + h - r + k} {x} {y + h - r} '
            f'l {x} {y + r} b {x} {y + r - k} {x + r - k} {y} {x + r} {y}')


def circle_path(cx, cy, r):
    return rrect(cx - r, cy - r, 2 * r, 2 * r, r)


def shape(path, color, alpha=0, layer=0):
    return f'Dialogue: {layer},0:00:00.00,9:59:59.00,Main,,0,0,0,,{{\\an7\\pos(0,0)\\bord0\\shad0\\c{color}\\1a&H{alpha:02X}&\\p1}}{path}{{\\p0}}'


def label(text, x, y, size, color, bold=True, align=7, layer=1, extra=''):
    b = '\\b1' if bold else '\\b0'
    return f'Dialogue: {layer},0:00:00.00,9:59:59.00,Main,,0,0,0,,{{\\an{align}\\pos({round(x)},{round(y)})\\fs{round(size)}{b}\\bord0\\shad0\\c{color}{extra}}}{text}'


def stamp(t):
    t = max(0.0, t)
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def source_info(path):
    """(fps, has_audio) of the source, from ffprobe."""
    try:
        r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,r_frame_rate', '-of', 'json', str(path)],
                           capture_output=True, text=True, timeout=30)
        streams = json.loads(r.stdout or '{}').get('streams', [])
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return 30.0, True
    fps, audio = 30.0, False
    for s in streams:
        if s.get('codec_type') == 'video':
            try:
                a, b = s.get('r_frame_rate', '30/1').split('/')
                fps = float(a) / float(b) if float(b) else 30.0
            except (ValueError, ZeroDivisionError):
                pass
        elif s.get('codec_type') == 'audio':
            audio = True
    return min(max(fps, 10.0), 120.0), audio


class Plan:
    def __init__(self, spec):
        self.__dict__.update(spec)
        self.inputs = []          # extra ffmpeg input arguments, appended after the source input
        self.next_input = 1
        self.data = getattr(self, 'data', None)
        self.job = getattr(self, 'job', 'style')

    # ---- ffmpeg inputs
    def add_input(self, args):
        self.inputs += args
        i = self.next_input
        self.next_input += 1
        return i

    @property
    def active(self):
        return any((self.template != 'none', self.bg_mode, self.padding > 0, self.watermark, self.music, self.credit, self.outro_text))

    # ---- video graph
    def graph(self, base_graph, src, width, height, duration):
        """Return a graph that ends in [base] (width x height)."""
        self.width, self.height = width, height
        self.s = width / 1080.0
        fps, self.has_audio = source_info(src)
        self.fps = fps
        g = base_graph
        if self.template != 'none':
            g = self._template_graph(width, height)
        elif self.bg_mode or self.padding > 0:
            g = base_graph.replace('[base]', '[lay]') + ';' + self._card_graph(width, height, fps, duration)
        if self.watermark:
            idx = self.add_input(['-loop', '1', '-framerate', f'{fps:.3f}', '-i', str(self.watermark)])
            w = max(16, int(width * self.watermark_size / 100) // 2 * 2)
            m = int(width * .055)
            top = int(height * .14)            # stays under the platform's top bar
            xs = {'l': m, 'r': f'W-w-{m}'}
            side = 'l' if self.watermark_pos in ('tl', 'bl') else 'r'
            y = top if self.watermark_pos in ('tl', 'tr') else f'H-h-{int(height * .22)}'
            g += (f';[{idx}:v]scale={w}:-2,format=rgba,colorchannelmixer=aa={self.watermark_opacity:.2f}[wm]'
                  f';[base][wm]overlay={xs[side]}:{y}:shortest=1[base2];[base2]null[base]')
        return g

    def _round(self, src, w, h, r, dst):
        """Graph piece that rounds the corners of [src] (w x h) into [dst]. Uses a cached mask PNG, so it is cheap per frame."""
        r = int(r)
        w, h = int(w) // 2 * 2, int(h) // 2 * 2
        if r <= 0:
            return f'{src}scale={w}:{h}{dst}'
        mask = self._mask_png(w, h, r)
        idx = self.add_input(['-loop', '1', '-framerate', f'{self.fps:.3f}', '-i', str(mask)])
        n = self.next_input
        return (f'{src}scale={w}:{h},format=yuv420p[ra{n}];[{idx}:v]scale={w}:{h},format=gray[rm{n}];[ra{n}][rm{n}]alphamerge{dst}')

    def _mask_png(self, w, h, r):
        d = asset_dir(self.data) / 'masks'
        d.mkdir(exist_ok=True)
        p = d / f'round_{w}x{h}_{r}.png'
        if not p.exists():
            a, b = 'min(X,W-1-X)', 'min(Y,H-1-Y)'
            expr = f'if(gt({a},{r})+gt({b},{r}),255,if(lte(hypot({r}-{a},{r}-{b}),{r}),255,0))'
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', f'color=c=white:s={w}x{h}', '-vf',
                            f"format=gray,geq=lum='{expr}'", '-frames:v', '1', str(p)], check=True)
        return p

    def _card_graph(self, W, H, fps, duration):
        pad = int(W * self.padding / 100) // 2 * 2
        iw = max(64, W - 2 * pad) // 2 * 2
        ih = max(64, int(round(H * iw / W))) // 2 * 2
        radius = int(self.radius * self.s)
        mode = self.bg_mode or 'blur'
        if mode == 'blur':
            parts = [f'[lay]split=2[l1][l2];[l1]scale={W // 16 * 2}:{H // 16 * 2},scale={W}:{H}:flags=bicubic,'
                     f'boxblur={max(2, int(self.bg_blur / 4))}:2,eq=brightness={-self.bg_dim:.2f}[bgc]',
                     f'[l2]scale={iw}:{ih}:force_original_aspect_ratio=decrease,setsar=1[cd0]', self._round('[cd0]', iw, ih, radius, '[card]')]
        else:
            parts = [f'[lay]scale={iw}:{ih}:force_original_aspect_ratio=decrease,setsar=1[cd0]', self._round('[cd0]', iw, ih, radius, '[card]')]
            if mode == 'color':
                parts.append(f'color=c={self.bg_color}:s={W}x{H}:r={fps:.3f}[bgc]')
            elif mode == 'gradient':
                parts.append(f'gradients=s={W}x{H}:r={fps:.3f}:c0={self.bg_color}:c1={self.bg_color2}:x0=0:y0=0:x1={W // 2}:y1={H}:speed=0.0001:n=2[bgc]')
            else:
                idx = self.add_input(['-loop', '1', '-framerate', f'{fps:.3f}', '-i', str(self.bg_image)])
                parts.append(f'[{idx}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur={max(0, int(self.bg_blur / 3))}:2,'
                             f'eq=brightness={-self.bg_dim:.2f},setsar=1[bgc]')
        parts.append('[bgc][card]overlay=(W-w)/2:(H-h)/2:shortest=1[base]')
        return ';'.join(parts)

    # ---- templates
    def _template_geometry(self, W, H):
        s = self.s
        t = self.template
        hook = text_field(self.hook, 140, 'hook') or 'Your hook text goes here'
        g = {'s': s}
        if t in ('x_light', 'x_dark'):
            lines = textwrap.wrap(hook, 30)[:4] or ['']
            cw = int(W * .84)
            clip_w = (cw - int(56 * s)) // 2 * 2
            clip_h = int(clip_w * 9 / 16) // 2 * 2
            head = int(150 * s)
            text_h = int(len(lines) * 66 * s)
            meta = int(92 * s)
            card_h = head + text_h + int(18 * s) + clip_h + meta + int(14 * s)
            card_x = (W - cw) // 2
            card_y = max(int(H * .12), int((H - card_h) / 2) - int(20 * s))
            g.update(lines=lines, card=(card_x, card_y, cw, card_h), clip=(card_x + int(28 * s), card_y + head + text_h + int(18 * s), clip_w, clip_h),
                     head=head, text_y=card_y + head, caption_y=card_y + card_h + int(150 * s))
        elif t == 'tiktok_hook':
            clip_w = int(W * .94) // 2 * 2
            clip_h = int(clip_w * 9 / 16) // 2 * 2
            lines = textwrap.wrap(hook.upper(), 18)[:3] or ['']
            box_h = int(len(lines) * 104 * s + 40 * s)
            top = int(H * .14)
            clip_y = top + box_h + int(70 * s)
            g.update(lines=lines, box=(int(W * .06), top, int(W * .88), box_h), clip=((W - clip_w) // 2, clip_y, clip_w, clip_h),
                     caption_y=clip_y + clip_h + int(170 * s))
        else:   # breaking_news
            clip_w = W
            clip_h = int(W * 9 / 16) // 2 * 2
            lines = textwrap.wrap(hook.upper(), 26)[:3] or ['']
            clip_y = int(H * .17)
            bar_y = clip_y + clip_h
            head_h = int(len(lines) * 74 * s + 40 * s)
            g.update(lines=lines, clip=(0, clip_y, clip_w, clip_h), label_y=bar_y, head_y=bar_y + int(70 * s), head_h=head_h,
                     ticker_y=bar_y + int(70 * s) + head_h, caption_y=bar_y + int(70 * s) + head_h + int(190 * s))
        return g

    def _template_graph(self, W, H):
        self.tg = tg = self._template_geometry(W, H)
        cx, cy, cw, ch = tg['clip']
        bg = {'x_light': '#EFF3F4', 'x_dark': '#000000', 'tiktok_hook': '#000000', 'breaking_news': '#0B0B0F'}[self.template]
        radius = int(26 * self.s) if self.template in ('x_light', 'x_dark') else (int(18 * self.s) if self.template == 'tiktok_hook' else 0)
        self.template_caption_y = tg['caption_y']
        under, self.template_over = self._template_events()
        under_name = f'{self.job}_card.ass'
        head = ['[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {W}', f'PlayResY: {H}', 'WrapStyle: 2', '[V4+ Styles]',
                'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
                'Style: Main,Arial,72,&H00FFFFFF,&H0000FFFF,&H00100B18,&H99000000,-1,0,0,0,100,100,0,0,1,5,2,5,50,50,0,1',
                '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text']
        (Path(self.data) / under_name).write_text(chr(10).join(head + under) + chr(10), encoding='utf-8')
        return (f'[0:v]split=2[s0][s1];[s0]scale={W}:{H},drawbox=x=0:y=0:w={W}:h={H}:color={bg}:t=fill[bg0];[bg0]ass=filename={under_name}[bgc];'
                f'[s1]scale={cw}:{ch}:force_original_aspect_ratio=increase,crop={cw}:{ch},setsar=1[cl0];'
                + self._round('[cl0]', cw, ch, radius, '[clipv]') +
                f';[bgc][clipv]overlay={cx}:{cy}:shortest=1[base]')

    # ---- ASS additions
    def ass(self, duration):
        """-> (extra_style_lines, extra_event_lines). Called after the captions file has been written."""
        styles, ev = [], []
        W, H, s = self.width, self.height, self.s
        if self.template != 'none':
            ev += self.template_over
        if self.credit:
            ev.append(f'Dialogue: 3,0:00:00.00,9:59:59.00,Main,,0,0,0,,{{\\an7\\pos({int(W * .055)},{int(H * .135)})\\fs{round(36 * s)}\\b1\\bord3\\shad1\\c&H00FFFFFF&\\3c&H00000000&\\1a&H30&}}{self.credit}')
        if self.outro_text and duration > self.outro_seconds + 1:
            t0 = duration - self.outro_seconds
            y = round(H * .66)
            h = round(120 * s)
            x0, x1 = round(W * .08), round(W * .92)
            ev.append(f'Dialogue: 4,{stamp(t0)},{stamp(duration + 1)},Main,,0,0,0,,{{\\an7\\bord0\\shad0\\c&H0020D0&\\move({W},{y},{x0},{y},0,350)\\p1}}'
                      f'{rrect(0, 0, x1 - x0, h, h / 2)}{{\\p0}}')
            ev.append(f'Dialogue: 5,{stamp(t0)},{stamp(duration + 1)},Main,,0,0,0,,{{\\an5\\fs{round(54 * s)}\\b1\\bord0\\shad0\\c&H00FFFFFF&'
                      f'\\move({W + (x1 - x0) // 2},{y + h // 2},{(x0 + x1) // 2},{y + h // 2},0,350)}}{self.outro_text}')
        return styles, ev

    def _template_events(self):
        tg, s, W, H = self.tg, self.s, self.width, self.height
        under, ev = [], []
        name = text_field(self.tpl_name, 28, 'name') or 'Your Name'
        handle = text_field(self.tpl_handle, 28, 'handle').lstrip('@') or 'yourhandle'
        t = self.template
        if t in ('x_light', 'x_dark'):
            dark = t == 'x_dark'
            card_c, txt_c, sub_c, line_c = (('&H00000000&', '&H00FFFFFF&', '&H00847B71&', '&H00383533&') if dark
                                            else ('&H00FFFFFF&', '&H00000000&', '&H00666059&', '&H00EBE7E3&'))
            x, y, w, h = tg['card']
            if dark:
                under.append(shape(rrect(x - 2, y - 2, w + 4, h + 4, 36 * s), line_c, 0, 0))
            under.append(shape(rrect(x, y, w, h, 34 * s), card_c, 0, 0))
            ax, ay, ar = x + 28 * s + 40 * s, y + 28 * s + 40 * s, 40 * s
            under.append(shape(circle_path(ax, ay, ar), '&H00F9A31D&', 0, 0))
            ev.append(label(name[:1].upper(), ax, ay, 46 * s, '&H00FFFFFF&', True, 5, 1))
            nx = ax + ar + 22 * s
            ev.append(label(name, nx, y + 26 * s, 44 * s, txt_c, True, 7, 1))
            check_x = nx + len(name) * 24.5 * s + 18 * s
            under.append(shape(circle_path(check_x, y + 26 * s + 24 * s, 17 * s), '&H00F0991D&', 0, 0))
            ev.append(label('v', check_x, y + 26 * s + 22 * s, 24 * s, '&H00FFFFFF&', True, 5, 1))
            ev.append(label('@' + handle, nx, y + 78 * s, 34 * s, sub_c, False, 7, 1))
            for i, ln in enumerate(tg['lines']):
                ev.append(label(ln, x + 28 * s, tg['text_y'] + i * 66 * s, 50 * s, txt_c, False, 7, 1))
            cx, cy, cw, ch = tg['clip']
            ev.append(label('Views  ·  Reposts  ·  Likes', x + 28 * s, cy + ch + 28 * s, 30 * s, sub_c, False, 7, 1))
        elif t == 'tiktok_hook':
            x, y, w, h = tg['box']
            under.append(shape(rrect(x, y, w, h, 28 * s), '&H00FFFFFF&', 0, 0))
            for i, ln in enumerate(tg['lines']):
                ev.append(label(ln, x + w / 2, y + 24 * s + i * 104 * s, 88 * s, '&H00000000&', True, 8, 1))
        else:
            cx, cy, cw, ch = tg['clip']
            under.append(shape(rrect(0, tg['label_y'], 560 * s, 70 * s, 0), '&H00181BD0&', 0, 0))
            ev.append(label('BREAKING NEWS', 28 * s, tg['label_y'] + 35 * s, 46 * s, '&H00FFFFFF&', True, 4, 1))
            under.append(shape(rrect(0, tg['head_y'], W, tg['head_h'], 0), '&H00FFFFFF&', 0, 0))
            for i, ln in enumerate(tg['lines']):
                ev.append(label(ln, 28 * s, tg['head_y'] + 20 * s + i * 74 * s, 62 * s, '&H00000000&', True, 7, 1))
            under.append(shape(rrect(0, tg['ticker_y'], W, 62 * s, 0), '&H0010108A&', 0, 0))
            tick = f'LIVE  •  @{handle}  •  {name}  •  LIVE  •  @{handle}  •  {name}  '
            ev.append(f'Dialogue: 1,0:00:00.00,9:59:59.00,Main,,0,0,0,,{{\\an4\\fs{round(36 * s)}\\b1\\bord0\\shad0\\c&H00FFFFFF&\\move({W},{round(tg["ticker_y"] + 31 * s)},{-len(tick) * 21 * s:.0f},{round(tg["ticker_y"] + 31 * s)},0,20000)\\clip(0,{tg["ticker_y"]},{W},{round(tg["ticker_y"] + 62 * s)})}}{tick}')
        return under, ev

    # ---- audio
    def audio(self, duration):
        """-> (filter_complex_part or None, map label or None). Source audio is label [0:a]."""
        if not self.music:
            return None, None
        idx = self.add_input(['-stream_loop', '-1', '-i', str(self.music)])
        d, v, p, r = duration, self.music_volume, self.music_peak, min(self.music_riser, duration)
        rise = f"if(lt(t,{d - r:.3f}),{v:.3f},{v:.3f}+({p:.3f}-{v:.3f})*(t-{d - r:.3f})/{r:.3f})"
        bed = f"[{idx}:a]atrim=0:{d:.3f},asetpts=PTS-STARTPTS,volume='{rise}':eval=frame[bed]"
        if self.has_audio:
            return bed + ';[0:a]aresample=48000[voice];[voice][bed]amix=inputs=2:duration=first:normalize=0:dropout_transition=0[aout]', '[aout]'
        return bed + ';[bed]anull[aout]', '[aout]'


def plan(body, data):
    """Validate the style fields of an export request. Returns a Plan, or None when the request uses none of them."""
    template = str(body.get('template') or 'none')
    if template not in TEMPLATES:
        raise ValueError('Choose a supported template.')
    bg_mode = body.get('bg_mode') or None
    if bg_mode is not None and bg_mode not in BG_MODES:
        raise ValueError('Choose blur, colour, gradient or image for the background.')
    spec = dict(
        template=template, bg_mode=bg_mode,
        padding=number(body.get('padding'), 0, 0, 25, 'Padding'), radius=number(body.get('radius'), 0, 0, 80, 'Corner radius'),
        bg_color=hexcolor(body.get('bg_color'), '#0b0912'), bg_color2=hexcolor(body.get('bg_color2'), '#ff4ba5'),
        bg_dim=number(body.get('bg_dim'), 0.25, 0, 0.9, 'Background dim'), bg_blur=number(body.get('bg_blur'), 24, 0, 60, 'Background blur'),
        bg_image=None, watermark=None, music=None,
        watermark_pos=str(body.get('watermark_pos') or 'tr'), watermark_size=number(body.get('watermark_size'), 16, 5, 40, 'Watermark size'),
        watermark_opacity=number(body.get('watermark_opacity'), 0.85, 0.1, 1, 'Watermark opacity'),
        credit=text_field(body.get('credit'), 60, 'credit'),
        outro_text=text_field(body.get('outro_text'), 40, 'outro'), outro_seconds=number(body.get('outro_seconds'), 3, 1.5, 8, 'Outro length'),
        music_volume=number(body.get('music_volume'), 0.15, 0, 1, 'Music volume'), music_peak=number(body.get('music_peak'), 0.85, 0, 1, 'Peak volume'),
        music_riser=number(body.get('music_riser'), 4, 1, 15, 'Riser length'),
        tpl_name=body.get('tpl_name'), tpl_handle=body.get('tpl_handle'), hook=body.get('hook', ''),
    )
    if spec['watermark_pos'] not in WM_POS:
        raise ValueError('Watermark position must be tl, tr, bl or br.')
    for key, field, kind in (('bg_image', 'bg_image', 'image'), ('watermark', 'watermark_image', 'image'), ('music', 'music', 'audio')):
        if body.get(field):
            p = asset_path(data, body.get(field), kind)
            if p is None:
                raise ValueError(f'The uploaded {kind} for "{field}" was not found. Upload it again.')
            spec[key] = p
    if spec['bg_mode'] == 'image' and not spec['bg_image']:
        raise ValueError('Upload a background image first.')
    if spec['bg_mode'] and spec['padding'] == 0 and spec['bg_mode'] != 'blur' and template == 'none':
        spec['padding'] = 6      # a background is only visible around a padded card
    p = Plan(spec)
    return p if p.active else None


def append_ass(ass_path, plan, duration):
    """Add the plan's extra styles/events to an ASS file written by captions.write()."""
    nl = chr(10)
    styles, events = plan.ass(duration)
    if not styles and not events:
        return
    text = Path(ass_path).read_text(encoding='utf-8')
    if styles:
        text = text.replace(nl + '[Events]', nl + nl.join(styles) + nl + '[Events]', 1)
    Path(ass_path).write_text(text.rstrip(nl) + nl + nl.join(events) + nl, encoding='utf-8')


def attach(app, data):
    """POST /upload-asset?kind=image|audio  (multipart "file"): stores a logo / wallpaper / music file for the style options."""
    import uuid
    from fastapi import File, HTTPException, UploadFile

    @app.post('/upload-asset')
    async def upload_asset(kind: str, file: UploadFile = File(...)):
        if kind not in ASSET_KINDS:
            raise HTTPException(400, 'kind must be image or audio.')
        ext = Path(file.filename or '').suffix.lower()
        if ext not in ASSET_KINDS[kind]:
            raise HTTPException(400, 'Allowed ' + kind + ' files: ' + ', '.join(ASSET_KINDS[kind]))
        limit = (25 if kind == 'image' else 300) * 1024 * 1024
        aid = uuid.uuid4().hex
        p = asset_dir(data) / (aid + ext)
        size = 0
        with p.open('wb') as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    out.close()
                    p.unlink(missing_ok=True)
                    raise HTTPException(400, 'That file is too large.')
                out.write(chunk)
        r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', str(p)], capture_output=True, text=True)
        want = 'video' if kind == 'image' else 'audio'      # ffprobe reports a still image as a video stream
        if r.returncode or want not in r.stdout:
            p.unlink(missing_ok=True)
            raise HTTPException(400, 'That is not a valid ' + kind + ' file.')
        return {'id': aid, 'kind': kind, 'name': (file.filename or '')[:80]}
