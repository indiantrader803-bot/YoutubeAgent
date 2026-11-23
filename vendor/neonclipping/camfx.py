"""Facecam look: contrast, brightness, saturation and clarity (sharpening) for the facecam part of a clip only."""
import math

KEYS = ('cam_contrast', 'cam_brightness', 'cam_saturation', 'cam_clarity')
DEFAULTS = {'cam_contrast': 1.0, 'cam_brightness': 0.0, 'cam_saturation': 1.0, 'cam_clarity': 0.0}
RANGES = {'cam_contrast': (0.5, 2.0), 'cam_brightness': (-0.3, 0.3), 'cam_saturation': (0.0, 2.0), 'cam_clarity': (0.0, 1.5)}


def settings(body):
    """Validated values (defaults when missing). Raises ValueError with a readable message."""
    out = {}
    for key in KEYS:
        value = body.get(key)
        if value in (None, ''):
            out[key] = DEFAULTS[key]
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError('Facecam look values must be numbers.')
        low, high = RANGES[key]
        if not math.isfinite(number) or not low <= number <= high:
            raise ValueError(f'{key.replace("_", " ")} must be between {low} and {high}.')
        out[key] = number
    return out


def is_default(values):
    return all(abs(values[k] - DEFAULTS[k]) < 1e-6 for k in KEYS)


def filter(body):
    """ffmpeg filter text (starting with a comma) for the facecam layer, or '' when nothing is changed."""
    values = settings(body)
    if is_default(values):
        return ''
    parts = []
    if any(abs(values[k] - DEFAULTS[k]) > 1e-6 for k in ('cam_contrast', 'cam_brightness', 'cam_saturation')):
        parts.append(f"eq=contrast={values['cam_contrast']:.3f}:brightness={values['cam_brightness']:.3f}:saturation={values['cam_saturation']:.3f}")
    if values['cam_clarity'] > 0.01:
        parts.append(f"unsharp=5:5:{values['cam_clarity']:.2f}:5:5:0")
    return ',' + ','.join(parts) if parts else ''
