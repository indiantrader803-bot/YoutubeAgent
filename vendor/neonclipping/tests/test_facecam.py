import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import facecam_detect as F


def make(path, box):
    """1280x720 moving test pattern; optionally a static framed 'webcam' box ('tr' / 'bl' / None)."""
    base = ['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12']
    if box is None:
        cmd = base + ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path)]
    else:
        pos = 'W-w-4:4' if box == 'tr' else '6:H-h-6'
        cmd = base + ['-f', 'lavfi', '-i', 'color=c=0x303a44:s=300x170:r=30:d=12', '-filter_complex',
                      f"[1:v]drawbox=x='30*sin(t)+100':y=60:w=70:h=70:color=0xd0a080:t=fill,pad=306:176:3:3:white[cam];[0:v][cam]overlay={pos}",
                      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path)]
    subprocess.run(cmd, check=True)


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix, iy = max(0, min(ax + aw, bx + bw) - max(ax, bx)), max(0, min(ay + ah, by + bh) - max(ay, by))
    return ix * iy / (aw * ah + bw * bh - ix * iy)


@unittest.skipIf(F.cv2 is None or not F.MODEL.exists(), 'OpenCV or the face model is missing')
class Facecam(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        for name in ('tr', 'bl', None):
            make(cls.dir / f'{name}.mp4', name)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def cands(self, name):
        gray = F._gray_small(F.sample_frames(self.dir / f'{name}.mp4'))
        return F.candidates(gray)[0]

    def test_border_search_finds_a_framed_box_in_a_corner(self):
        # expected box in 320x180 coordinates: 306x176 at (W-306-4, 4) of 1280x720 -> /4
        want = (int((1280 - 306 - 4) / 4), 1, int(306 / 4), int(176 / 4))
        got = [(c['x0'], c['y0'], c['w'], c['h']) for c in self.cands('tr')]
        self.assertTrue(any(iou(g, want) > .75 for g in got), got[:5])

    def test_bottom_left_box(self):
        want = (int(6 / 4), int((720 - 176 - 6) / 4), int(306 / 4), int(176 / 4))
        got = [(c['x0'], c['y0'], c['w'], c['h']) for c in self.cands('bl')]
        self.assertTrue(any(iou(g, want) > .75 for g in got), got[:5])

    def test_plain_footage_has_no_corner_candidates(self):
        # the test pattern has a static box in the middle of the picture, but nothing anchored at a frame edge
        self.assertEqual([c for c in self.cands('None') if c['corner'] == 'edge'], [])

    def test_no_face_means_no_facecam(self):
        # a static framed box WITHOUT a face is a HUD panel, not a webcam: the answer must be "no facecam"
        for name in ('tr', 'bl', 'None'):
            r = F.detect(self.dir / f'{name}.mp4')
            self.assertFalse(r['found'], (name, r))
            self.assertIn('reason', r)

    def test_result_shape_when_found(self):
        r = {'found': True}
        fake = F.detect_from_frames
        try:
            F.detect_from_frames = lambda frames: {'found': True, 'cam': {'x': .8, 'y': .0, 'w': .2, 'h': .3}, 'confidence': .9}
            F.sample_frames = lambda p, n=14: None
            out = F.detect('whatever.mp4')
        finally:
            F.detect_from_frames = fake
            import importlib
            importlib.reload(F)
        self.assertEqual(out['game'], {'x': 0, 'y': 0, 'w': 1, 'h': 1})
        self.assertGreater(out['cam']['x'], .8)               # inset so no border line leaks into the clip


if __name__ == '__main__':
    unittest.main()
