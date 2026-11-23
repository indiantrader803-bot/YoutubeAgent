from pathlib import Path
import tempfile
import unittest
from subtitles import parse_track, write_track, validate_words

class SubtitleTracks(unittest.TestCase):
    def test_srt_vtt_roundtrip_preserves_hours_unicode_linebreaks(self):
        source='1\n01:02:03,125 --> 01:02:05,875\nHello & welcome\nनमस्ते दुनिया\n'
        track=parse_track(source)
        self.assertEqual(track[0]['text'],'Hello & welcome\nनमस्ते दुनिया')
        vtt=write_track(track,'vtt');self.assertTrue(vtt.startswith('WEBVTT\n'))
        self.assertEqual(parse_track(vtt),track)
        self.assertEqual(parse_track(write_track(track,'srt')),track)

    def test_vtt_identifiers_settings_and_notes(self):
        vtt='WEBVTT\n\nNOTE ignore this\nnot a cue\n\nintro\n00:00.500 --> 00:01.750 align:start\n<b>Hello</b> &amp; bye\n'
        self.assertEqual(parse_track(vtt),[{'start':.5,'end':1.75,'text':'Hello & bye'}])

    def test_overlaps_bad_minutes_and_negative_shifts_rejected(self):
        bad=['1\n00:90:00,000 --> 00:91:00,000\nBad','1\n00:00:00,000 --> 00:00:02,000\nOne\n\n2\n00:00:01,000 --> 00:00:03,000\nTwo']
        for source in bad:
            with self.assertRaises(ValueError):parse_track(source)
        with self.assertRaises(ValueError):write_track([{'start':0,'end':1,'text':'Hello'}],'vtt',-.5)

    def test_shift_and_word_validation_are_explicit(self):
        cue=[{'start':0,'end':1,'text':'Hello'}]
        self.assertEqual(parse_track(write_track(cue,'srt',.5))[0]['start'],.5)
        with self.assertRaises(ValueError):validate_words([{'start':0,'end':5,'text':'Outside'}],3)
        self.assertEqual(validate_words([],3),[])

    def test_import_does_not_silently_drop_bad_cue(self):
        from subtitles import cues
        with self.assertRaises(ValueError):
            cues('1\n00:00:00,000 --> 00:00:01,000\nGood\n\n2\n00:90:00,000 --> 00:91:00,000\nBad')
        with self.assertRaises(ValueError):validate_words([None],3)

if __name__=='__main__':unittest.main()
