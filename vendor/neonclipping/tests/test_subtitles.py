import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import subtitles as S

NL = chr(10)
BS = chr(92)

SRT = NL.join([
    '1', '00:00:01,000 --> 00:00:03,000', '<i>Hello</i> there my friend', '',
    '2', '00:00:03,500 --> 00:00:05,000', 'second line', 'with two rows', '',
    '3', '00:01:00,000 --> 00:01:02,000', 'far away', ''])

ASS = NL.join([
    '[Script Info]', 'ScriptType: v4.00+', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.00,Main,,0,0,0,,{' + BS + 'an8' + BS + 'b1}Hello, there{' + BS + 'i0} my friend',
    'Dialogue: 0,0:00:03.50,0:00:05.00,Main,,0,0,0,,second' + BS + 'Nline', ''])


class Parse(unittest.TestCase):
    def test_srt_cues_and_tags(self):
        c = S.cues(SRT)
        self.assertEqual(len(c), 3)
        self.assertEqual(c[0][2], 'Hello there my friend')
        self.assertEqual(c[1][2], 'second line with two rows')

    def test_ass_cues_and_tags(self):
        c = S.cues(ASS)
        self.assertEqual([x[2] for x in c], ['Hello, there my friend', 'second line'])
        self.assertAlmostEqual(c[0][0], 1.0)

    def test_words_are_relative_to_clip_and_ordered(self):
        w = S.words_from(SRT, 0.5, 6.0)
        self.assertEqual(w[0]['text'], 'Hello')
        self.assertAlmostEqual(w[0]['start'], 0.5, places=2)           # cue starts at 1.0, clip at 0.5
        for a, b in zip(w, w[1:]):
            self.assertLessEqual(a['end'], b['start'] + 1e-6)
        self.assertTrue(all(0 <= x['start'] < x['end'] <= 5.5 + 1e-6 for x in w))
        self.assertNotIn('far', [x['text'] for x in w])                # the cue at 1:00 is outside this clip

    def test_cue_cut_in_the_middle(self):
        w = S.words_from(SRT, 2.0, 4.0)
        self.assertTrue(w)
        self.assertTrue(all(x['end'] <= 2.0 + 1e-6 for x in w))

    def test_garbage_is_rejected(self):
        for bad in ('', 'hello world', '1' + NL + 'not a time' + NL + 'text'):
            with self.assertRaises(ValueError):
                S.cues(bad)

    def test_bom_and_crlf(self):
        self.assertEqual(len(S.cues(chr(0xfeff) + SRT.replace(NL, chr(13) + NL))), 3)

    def test_word_timing_follows_letter_count(self):
        w = S.words_from(NL.join(['1', '00:00:00,000 --> 00:00:04,000', 'a bbbbbbb', '']), 0, 4)
        self.assertLess(w[0]['end'] - w[0]['start'], w[1]['end'] - w[1]['start'])


if __name__ == '__main__':
    unittest.main()
