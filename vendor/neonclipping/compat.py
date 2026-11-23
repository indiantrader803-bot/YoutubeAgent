"""Small compatibility fixes that run before anything else, so a fresh install keeps working.

1. PyAV 19 removed the `metadata_errors` argument that faster-whisper 1.2.x still passes to av.open(). Without this shim every
   captioned clip fails with "open() got an unexpected keyword argument 'metadata_errors'".
2. FFmpeg and FFprobe are required. If they are not installed, a portable copy is fetched once (static-ffmpeg) instead of every
   import and render failing.
"""
import shutil

def stub_av():
    """Windows Smart App Control can block PyAV's DLLs. Audio is decoded by ffmpeg here, so a placeholder lets faster-whisper import."""
    import sys, types
    stub = types.ModuleType('av')
    def _unavailable(*a, **k):
        raise RuntimeError('PyAV is blocked or missing on this computer; NeonClipping decodes audio with FFmpeg instead.')
    stub.open = _unavailable
    stub.__neon_stub__ = True
    sys.modules['av'] = stub
    return stub


def patch_pyav():
    try:
        import av
    except Exception:       # noqa: BLE001 - ImportError, DLL blocked by Application Control, broken wheel
        stub_av()
        return False
    original = getattr(av, 'open', None)
    if original is None or getattr(original, '_neon_patched', False):
        return False
    def open_(*args, **kwargs):
        try:
            return original(*args, **kwargs)
        except TypeError as error:
            if 'metadata_errors' in kwargs and 'metadata_errors' in str(error):
                kwargs.pop('metadata_errors', None)
                return original(*args, **kwargs)
            raise
    open_._neon_patched = True
    av.open = open_
    return True

def ffmpeg_ready():
    return bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))

def ensure_ffmpeg():
    """True when ffmpeg and ffprobe can be run. Tries a portable copy when they are missing."""
    if ffmpeg_ready():
        return True
    try:
        import static_ffmpeg
        static_ffmpeg.add_paths()
    except Exception:       # noqa: BLE001 - offline or package missing: the app shows a clear message instead
        pass
    return ffmpeg_ready()

def patch_subprocess():
    """ffmpeg/ffprobe must never wait for keyboard input: when the app runs from a hidden or minimised console, a child that
    inherits that console's stdin can stall forever (the classic 'stuck at 12%'). Give them an empty stdin unless one is set."""
    import os, subprocess
    original = subprocess.Popen.__init__
    if getattr(original, '_neon_patched', False):
        return False
    def init(self, args, *a, **kw):
        try:
            first = args[0] if isinstance(args, (list, tuple)) and args else args
            name = os.path.basename(str(first)).lower()
            if (name.startswith('ffmpeg') or name.startswith('ffprobe')) and kw.get('stdin') is None and len(a) < 3:
                kw['stdin'] = subprocess.DEVNULL
        except Exception:       # noqa: BLE001 - never break process creation
            pass
        original(self, args, *a, **kw)
    init._neon_patched = True
    subprocess.Popen.__init__ = init
    return True

patch_pyav()
patch_subprocess()
ensure_ffmpeg()
