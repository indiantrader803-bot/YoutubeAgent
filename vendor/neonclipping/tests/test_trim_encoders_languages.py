"""Trim in the saved-clip editor, encoder choice (NVIDIA / Mac / CPU) and the caption language list. No network, models or GPU needed."""
import copy
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI, HTTPException

os.environ['NEONCLIPPING_NO_AUTOUPDATE'] = '1'
import encoders
import languages
from reedit import attach, trim_words


class TrimWords(unittest.TestCase):
    W = [{'start': 0, 'end': 1, 'text': 'a'}, {'start': 5, 'end': 6, 'text': 'b'}, {'start': 25, 'end': 26, 'text': 'c'}, {'start': 29, 'end': 30, 'text': 'd'}]

    def test_start_later_shifts_and_drops(self):
        out = trim_words(self.W, 5, 20)             # new clip = old 5s..25s
        self.assertEqual([w['text'] for w in out], ['b'])
        self.assertEqual((out[0]['start'], out[0]['end']), (0, 1))

    def test_end_earlier_drops_late_words(self):
        out = trim_words(self.W, 0, 10)
        self.assertEqual([w['text'] for w in out], ['a', 'b'])

    def test_word_cut_by_an_edge_is_shortened(self):
        out = trim_words([{'start': 4, 'end': 8, 'text': 'x'}], 5, 2)      # clip covers old 5..7
        self.assertEqual((out[0]['start'], out[0]['end']), (0, 2))

    def test_start_earlier_moves_words_right(self):
        out = trim_words(self.W[:1], -3, 10)
        self.assertEqual((out[0]['start'], out[0]['end']), (3, 4))

    def test_empty(self):
        self.assertEqual(trim_words(None, 1, 5), [])


class SavedClipTrim(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        self.state, self.submitted = {}, []
        self.app = FastAPI()
        for name in ('a', 'b'):
            (self.data / (name + 'source.mp4')).write_bytes(b'src')
            settings = {'id': name + 'source', 'start': 10, 'end': 40, 'layout': 'stack', 'top': .32,
                        'cam': {'x': .8, 'y': 0, 'w': .2, 'h': .3}, 'game': {'x': 0, 'y': 0, 'w': .8, 'h': 1},
                        'captions': True, 'caption_style': 'gta', 'caption_y': 1450, 'title': name,
                        'source_url': 'https://example.com/v', 'words': copy.deepcopy(TrimWords.W)}
            (self.data / (name + '.json')).write_text(json.dumps({'source': name + 'source', 'settings': settings, 'result': {'status': 'done', 'caption_words': 4}}))
            (self.data / (name + '.mp4')).write_bytes(b'prev')

        def save(job, fields):
            self.state[job] = {**self.state.get(job, {}), **copy.deepcopy(fields)}

        def export(settings):
            self.submitted.append(copy.deepcopy(settings))
            job = 'new' + str(len(self.submitted))
            result = {'status': 'done', 'file': job, 'srt': '/text/' + job + '/srt'}
            (self.data / (job + '.json')).write_text(json.dumps({'source': settings['id'], 'settings': settings, 'result': result}))
            self.state[job] = result
            return {'job': job}
        attach(self.app, self.data, self.state, lambda p: {'w': 1280, 'h': 720, 'duration': 100}, export, save)
        self.reedit = {r.path: r.endpoint for r in self.app.routes}['/clips/reedit']

    def wait(self, job):
        end = time.monotonic() + 3
        while self.state[job]['status'] == 'running' and time.monotonic() < end:
            time.sleep(.01)
        self.assertEqual(self.state[job]['status'], 'done', self.state[job])

    def test_trim_changes_range_and_moves_subtitles(self):
        r = self.reedit({'file': 'a', 'scope': 'one', 'changes': {}, 'trim': {'start': 15, 'end': 35}})
        self.wait(r['job'])
        s = self.submitted[0]
        self.assertEqual((s['start'], s['end']), (15, 35))
        self.assertEqual([w['text'] for w in s['words']], ['b'])          # only the word spoken between 15s and 35s of the source
        self.assertEqual(s['words'][0]['start'], 0)

    def test_no_trim_keeps_range(self):
        self.wait(self.reedit({'file': 'a', 'scope': 'one', 'changes': {'layout': 'circle'}})['job'])
        self.assertEqual((self.submitted[0]['start'], self.submitted[0]['end']), (10, 40))

    def test_trim_needs_a_single_clip(self):
        with self.assertRaises(HTTPException) as c:
            self.reedit({'file': 'a', 'files': ['a', 'b'], 'changes': {}, 'trim': {'start': 12, 'end': 30}})
        self.assertEqual(c.exception.status_code, 400)

    def test_trim_limits(self):
        for bad in ({'start': 10, 'end': 11}, {'start': -1, 'end': 20}, {'start': 0, 'end': 200}, {'start': 'x', 'end': 5}, {'end': 9}):
            with self.assertRaises(HTTPException, msg=str(bad)):
                self.reedit({'file': 'a', 'scope': 'one', 'changes': {}, 'trim': bad})

    def test_cannot_end_after_the_saved_video(self):
        with self.assertRaises(HTTPException) as c:
            self.reedit({'file': 'a', 'scope': 'one', 'changes': {}, 'trim': {'start': 90, 'end': 110}})
        self.assertIn('only', c.exception.detail)


class Encoders(unittest.TestCase):
    def setUp(self):
        encoders.works.cache_clear()
        for k in ('NEONCLIPPING_ENCODER',):
            os.environ.pop(k, None)

    def names(self):
        return [e[1] for e in encoders.h264()]

    def test_cpu_only_goes_straight_to_x264(self):
        with mock.patch.object(encoders, 'works', lambda n: n == 'libx264'):
            self.assertEqual(self.names(), ['libx264'])

    def test_mac_uses_videotoolbox_then_x264(self):
        with mock.patch.object(encoders, 'works', lambda n: n in ('h264_videotoolbox', 'libx264')):
            self.assertEqual(self.names(), ['h264_videotoolbox', 'libx264'])

    def test_nvidia_uses_nvenc_first(self):
        with mock.patch.object(encoders, 'works', lambda n: True):
            self.assertEqual(self.names(), ['h264_nvenc', 'h264_amf', 'h264_qsv', 'h264_videotoolbox', 'libx264'])

    def test_amd_and_intel_gpus(self):
        with mock.patch.object(encoders, 'works', lambda n: n in ('h264_amf', 'libx264')):
            self.assertEqual(self.names(), ['h264_amf', 'libx264'])
        with mock.patch.object(encoders, 'works', lambda n: n in ('h264_qsv', 'libx264')):
            self.assertEqual(self.names(), ['h264_qsv', 'libx264'])

    def test_override_to_x264(self):
        with mock.patch.dict(os.environ, {'NEONCLIPPING_ENCODER': 'x264'}), mock.patch.object(encoders, 'works', lambda n: True):
            self.assertEqual(self.names(), ['libx264'])

    def test_x264_is_always_last_and_has_quality_args(self):
        with mock.patch.object(encoders, 'works', lambda n: True):
            last = encoders.h264(cq=21, x264_preset='veryfast')[-1]
        self.assertEqual(last, ['-c:v', 'libx264', '-crf', '21', '-preset', 'veryfast'])

    def test_unknown_encoder_name_in_env_falls_back_to_auto(self):
        with mock.patch.dict(os.environ, {'NEONCLIPPING_ENCODER': 'banana'}), mock.patch.object(encoders, 'works', lambda n: n == 'libx264'):
            self.assertEqual(self.names(), ['libx264'])


class Languages(unittest.TestCase):
    def test_fifty_plus_languages(self):
        self.assertGreaterEqual(len(languages.ALL), 50)
        self.assertEqual(len(languages.MORE), 50)

    def test_valid_codes(self):
        for ok in (None, '', 'en', 'hi', 'hinglish', 'es', 'ja', 'ar', 'ta'):
            self.assertTrue(languages.valid(ok), ok)
        for bad in ('xx', 'english', 'EN', 'hindi'):
            self.assertFalse(languages.valid(bad), bad)

    def test_menu_matches_the_list(self):
        html = (Path(__file__).resolve().parent.parent / 'index.html').read_text(encoding='utf-8')
        start = html.index('id="language"')
        menu = html[start:html.index('</select>', start)]
        for code, _, _ in languages.MORE:
            self.assertIn(f'<option value="{code}">', menu, code)


if __name__ == '__main__':
    unittest.main()
