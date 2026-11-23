import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import live_session as L


class Spike(unittest.TestCase):
    quiet = [3, 4, 2, 3, 5, 3, 4, 3, 2, 4] * 3

    def test_big_burst_is_a_spike(self):
        self.assertTrue(L.is_spike(30, self.quiet))

    def test_normal_chat_is_not(self):
        for c in (0, 3, 5, 7):
            self.assertFalse(L.is_spike(c, self.quiet), c)

    def test_needs_minimum_messages(self):
        self.assertFalse(L.is_spike(L.MIN_MSGS - 1, [0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0] * 2))

    def test_needs_history(self):
        self.assertFalse(L.is_spike(50, [1, 2, 3]))
        self.assertFalse(L.is_spike(50, [0] * 30))

    def test_busy_chat_needs_a_bigger_jump(self):
        busy = [60, 70, 65, 80, 75, 62, 68, 71, 66, 74] * 3
        self.assertFalse(L.is_spike(90, busy))       # busy chat getting a bit busier
        self.assertTrue(L.is_spike(400, busy))

    def test_ratio_rule(self):
        # high variance chat: above mean + 2.5 sd is not enough unless also 2.5x the mean
        wild = [2, 40, 3, 45, 2, 38, 4, 42, 3, 41] * 3
        self.assertFalse(L.is_spike(60, wild))


class Targets(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(L.parse_target('kaicenat')[:2], ('twitch', 'kaicenat'))
        self.assertEqual(L.parse_target('https://www.twitch.tv/XQC')[:2], ('twitch', 'xqc'))
        self.assertEqual(L.parse_target('https://www.youtube.com/watch?v=hwSg39yIBGU')[:2], ('youtube', 'hwSg39yIBGU'))
        self.assertEqual(L.parse_target('https://youtu.be/hwSg39yIBGU')[:2], ('youtube', 'hwSg39yIBGU'))
        self.assertEqual(L.parse_target('https://www.youtube.com/live/hwSg39yIBGU')[:2], ('youtube', 'hwSg39yIBGU'))
        for bad in ('', 'ab', 'a b c', 'https://youtube.com/@name'):
            with self.assertRaises(ValueError):
                L.parse_target(bad)

class Hype(unittest.TestCase):
    def test_hype_grows_with_chat_speed_and_is_capped(self):
        usual = 5.0           # messages per 10 s
        values = [L.hype_percent(m, usual) for m in (0, 15, 30, 60, 120, 600)]
        self.assertEqual(values, sorted(values))
        self.assertEqual(values[0], 0)
        self.assertEqual(values[-1], 100)
        self.assertTrue(all(0 <= v <= 100 for v in values))

    def test_quiet_chat_stays_low_even_with_no_baseline(self):
        self.assertLess(L.hype_percent(4, 0.0), 25)
        self.assertEqual(L.hype_percent(0, 0.0), 0)

    def test_four_times_the_usual_speed_is_peak(self):
        self.assertEqual(L.hype_percent(4 * 3 * 10, 10.0), 100)

    def test_busy_chat_at_its_normal_speed_is_not_peak(self):
        # a big streamer with ~80 messages per 10 s: normal speed is 25%, not 100%
        self.assertLessEqual(L.hype_percent(240, 80.0), 30)

    def test_first_seconds_use_the_absolute_scale(self):
        self.assertEqual(L.hype_percent(75, 0.0, history_buckets=1), 50)
        self.assertEqual(L.hype_percent(300, 0.0, history_buckets=2), 100)
        self.assertEqual(L.hype_percent(3, 0.0, history_buckets=0), 2)

    def test_labels(self):
        self.assertEqual([L.hype_label(x) for x in (0, 30, 60, 90)], ['quiet', 'building momentum', 'hot', 'peak viral hype'])

class Title(unittest.TestCase):
    def test_emoji_are_removed_and_text_kept(self):
        self.assertEqual(L.clean_title(chr(0x1F334) + 'PLAYING GTA 6 FOR THE FIRST TIME' + chr(0x1F334)), 'PLAYING GTA 6 FOR THE FIRST TIME')

    def test_hindi_and_punctuation_survive(self):
        self.assertEqual(L.clean_title('  Bhai  kya scene hai!! नमस्ते  '), 'Bhai kya scene hai!! नमस्ते')

    def test_length_cap_and_empty(self):
        self.assertEqual(len(L.clean_title('a' * 500)), 120)
        self.assertEqual(L.clean_title(None), '')


if __name__ == '__main__':
    unittest.main()
