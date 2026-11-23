import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import camfx, hooks, layouts


class CamFxTests(unittest.TestCase):
    def test_defaults_change_nothing(self):
        self.assertEqual(camfx.filter({}), '')
        self.assertEqual(camfx.filter({'cam_contrast': 1, 'cam_brightness': 0, 'cam_saturation': 1, 'cam_clarity': 0}), '')

    def test_filter_text(self):
        f = camfx.filter({'cam_contrast': 1.3, 'cam_clarity': 0.8})
        self.assertTrue(f.startswith(','))
        self.assertIn('eq=contrast=1.300', f)
        self.assertIn('unsharp=5:5:0.80', f)

    def test_validation(self):
        for body in ({'cam_contrast': 5}, {'cam_brightness': -1}, {'cam_clarity': 'x'}, {'cam_saturation': float('nan')}):
            with self.assertRaises(ValueError):
                camfx.settings(body)
        with self.assertRaises(ValueError):
            hooks.settings({'cam_contrast': 9})
        self.assertIn('cam_contrast', hooks.KEYS)

    def test_only_the_facecam_layer_is_touched(self):
        rects = [(0, 0, 400, 300), (400, 0, 880, 720)]
        plain = layouts.render_graph('stack', rects, .32, 1080, 1920)
        fx = layouts.render_graph('stack', rects, .32, 1080, 1920, camfx.filter({'cam_contrast': 1.3}))
        self.assertNotIn('eq=', plain)
        self.assertEqual(fx.count('eq=contrast'), 1)


if __name__ == '__main__':
    unittest.main()


class LivenessTests(unittest.TestCase):
    def test_static_picture_is_not_a_webcam(self):
        import facecam_detect as fd
        self.assertFalse(fd.is_live(0.0))
        self.assertFalse(fd.is_live(0.2))
        self.assertTrue(fd.is_live(1.5))


class JsRuntimeTests(unittest.TestCase):
    def test_node_and_deno_are_allowed_when_installed(self):
        import ytdl
        from unittest import mock
        with mock.patch('shutil.which', lambda n: '/x/' + n if n == 'node' else None):
            self.assertEqual(ytdl.js_runtimes(), {'node': {}})
            opts = [o for o, d in ytdl.variants({'quiet': True})]
            self.assertTrue(all(o.get('js_runtimes') == {'node': {}} for o in opts))
        with mock.patch('shutil.which', lambda n: None):
            self.assertEqual(ytdl.js_runtimes(), {})
            self.assertTrue(all('js_runtimes' not in o for o, d in ytdl.variants({'quiet': True})))


class Round3Tests(unittest.TestCase):
    def test_clean_words_keeps_usable_words(self):
        import subtitles
        words = [{'start': -0.5, 'end': 0.4, 'text': 'a'}, {'start': 1, 'end': 99, 'text': 'b'}, {'start': 2, 'end': 2.0, 'text': 'c'},
                 {'start': 3, 'end': 3.5, 'text': '  '}, {'start': float('nan'), 'end': 4, 'text': 'd'}, {'start': 5, 'end': 6}]
        out = subtitles.clean_words(words, 10)
        self.assertEqual([w['text'] for w in out], ['a', 'b'])
        self.assertEqual((out[0]['start'], out[1]['end']), (0.0, 10.0))
        subtitles.validate_words(out, 10)            # whatever clean_words returns passes the strict check

    def test_audio_loads_without_pyav(self):
        import wave, tempfile, numpy as np, captions
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'a.wav'
            data = (np.sin(np.linspace(0, 100, 16000)) * 16000).astype(np.int16)
            with wave.open(str(path), 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(data.tobytes())
            arr = captions._load_audio(path)
        self.assertEqual(arr.dtype, np.float32)
        self.assertEqual(len(arr), 16000)
        self.assertLessEqual(float(abs(arr).max()), 1.0)

    def test_blocked_pyav_gets_a_stub(self):
        import sys, subprocess
        code = "import sys; sys.modules['av']=None; import compat; m=sys.modules['av']; print(getattr(m,'__neon_stub__',False))"
        r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, cwd=str(Path(__file__).resolve().parents[1]))
        self.assertEqual(r.stdout.strip().splitlines()[-1], 'True')

    def test_ass_filter_uses_explicit_option_name(self):
        text = (Path(__file__).resolve().parents[1] / 'app.py').read_text(encoding='utf-8')
        self.assertIn('ass=filename={ass}', text)
        self.assertNotIn('ass={ass}', text)


class CoverTests(unittest.TestCase):
    def test_frame_time_stays_inside_the_clip(self):
        import cover
        self.assertEqual(cover.frame_time(0.2), 0.0)
        self.assertAlmostEqual(cover.frame_time(10), 4.0)
        self.assertLess(cover.frame_time(1.0), 1.0)

    def test_ass_text_has_box_and_title(self):
        import cover
        text = cover.ass_text(['HELLO WORLD'], 1080, 1920)
        self.assertIn('PlayResX: 1080', text)
        self.assertIn('HELLO', text)
        self.assertIn('WORLD', text)          # the accent word is wrapped in its own colour tag
        self.assertGreaterEqual(text.count('Dialogue:'), 2)       # text + accent bar


class CoverHookTests(unittest.TestCase):
    def test_hook_until(self):
        import cover
        self.assertEqual(cover.hook_until({}), 0.0)
        self.assertEqual(cover.hook_until({'hook': 'X'}), 8.0)
        self.assertEqual(cover.hook_until({'hook': 'X', 'hook_duration': 5}), 5.0)
        self.assertEqual(cover.hook_until({'hook': 'X', 'hook_enabled': False}), 0.0)
        self.assertEqual(cover.hook_until({'hook': 'X', 'template': 'x_dark'}), 0.0)


class CoverTimingTests(unittest.TestCase):
    def test_title_overlay_lasts_the_whole_clip(self):
        import cover
        text = cover.ass_text(['TITLE'], 1080, 1920)
        self.assertIn('9:59:59.00', text)
        self.assertNotIn('0:01:00.00', text)
