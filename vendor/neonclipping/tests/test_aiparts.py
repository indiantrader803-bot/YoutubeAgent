import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import aiparts as A


def fake_words(minutes, per_sec=2.5):
    out, t = [], 0.0
    n = 0
    while t < minutes * 60:
        out.append({'start': round(t, 2), 'end': round(t + .3, 2), 'text': f'word{n}' + ('.' if n % 9 == 8 else '')})
        t += 1 / per_sec
        n += 1
    return out


class Split(unittest.TestCase):
    def test_nine_hours_become_two_dozen_parts(self):
        plan = A.plan_parts(9 * 3600 + 40 * 60)
        self.assertEqual(len(plan), 24)                        # 25-minute parts
        self.assertAlmostEqual(plan[0][1], 0)
        self.assertAlmostEqual(plan[-1][2], 9 * 3600 + 40 * 60)

    def test_user_can_choose_the_number_of_parts(self):
        self.assertEqual(len(A.plan_parts(3600, 20)), 20)
        self.assertEqual(len(A.plan_parts(3600, 999)), A.MAX_PARTS)
        self.assertEqual(len(A.plan_parts(60)), 1)

    def test_every_line_lands_in_exactly_one_part(self):
        words = fake_words(100)
        parts = A.split('Test', words, 100 * 60, parts=4)
        self.assertEqual(len(parts), 4)
        total = sum(p['lines'] for p in parts)
        self.assertEqual(total, len(A.transcript_lines(words)))
        for p in parts:
            self.assertGreater(p['lines'], 0)
            self.assertIn('TRANSCRIPT:', p['prompt'])
            self.assertIn(f'part {p["index"]} of 4', p['prompt'])
            self.assertIn('[00:', p['prompt']) if p['index'] == 1 else None

    def test_prompt_has_the_instructions_a_chatbot_needs(self):
        p = A.split('My stream', fake_words(30), 30 * 60, parts=2, per_part=4, min_len=25, max_len=55)[0]['prompt']
        for needle in ('4 best moments', '25 to 55 seconds', 'ONLY a JSON array', '"start":"HH:MM:SS"', 'Never invent times'):
            self.assertIn(needle, p)


class Answers(unittest.TestCase):
    def test_json_array_with_prose_and_fences(self):
        text = 'Sure! Here you go:\n```json\n[{"start":"00:12:30","end":"00:13:10","title":"Crash","hook":"Oh no"},{"start":"1:05:00","end":"1:05:45","title":"Chase"}]\n```\nHope it helps.'
        m, r = A.parse_answers(text)
        self.assertEqual([x['start'] for x in m], [750.0, 3900.0])
        self.assertEqual(m[0]['title'], 'Crash')
        self.assertEqual(r, [])

    def test_several_answers_pasted_together(self):
        text = '[{"start":"00:01:00","end":"00:01:40"}]\n\nPart 2:\n[{"start":"00:30:00","end":"00:30:50"}]\n[]'
        m, _ = A.parse_answers(text)
        self.assertEqual(len(m), 2)

    def test_seconds_and_nested_objects(self):
        m, _ = A.parse_answers('{"clips":[{"start":120,"end":165,"name":"A"},{"start_time":"05:00","end_time":"05:40"}]}')
        self.assertEqual([x['start'] for x in m], [120.0, 300.0])

    def test_plain_lines(self):
        text = '1. 12:30-13:10 - Big crash\n2) 01:02:00 - 01:02:50: Police chase\nnot a line'
        m, _ = A.parse_answers(text)
        self.assertEqual([x['start'] for x in m], [750.0, 3720.0])
        self.assertEqual(m[1]['title'], 'Police chase')

    def test_bad_moments_are_rejected_with_a_reason(self):
        text = '[{"start":"10:00","end":"09:00"},{"start":"10:00","end":"10:03"},{"start":"abc","end":"10:50"},{"start":"20:00","end":"20:40"}]'
        m, r = A.parse_answers(text, duration=3600)
        self.assertEqual(len(m), 1)
        self.assertEqual(sorted(x['why'] for x in r), ['end is before start', 'shorter than 8 s', 'time not understood'])

    def test_overlaps_and_too_long_and_beyond_the_video(self):
        text = '[{"start":"10:00","end":"10:40"},{"start":"10:20","end":"11:00"},{"start":"20:00","end":"30:00"},{"start":"2:00:00","end":"2:00:40"}]'
        m, r = A.parse_answers(text, duration=3600)
        self.assertEqual(len(m), 2)
        self.assertEqual(m[1]['end'] - m[1]['start'], 180)     # the rambling 10-minute moment is cut to 3 minutes
        self.assertEqual(sorted(x['why'] for x in r), ['overlaps the previous moment', 'starts after the video ends'])

    def test_empty_answer(self):
        self.assertEqual(A.parse_answers('[]'), ([], []))

    def test_parse_time_formats(self):
        for v, want in (('1:02:03', 3723), ('12:30', 750), ('754', 754), (754, 754), ('1h2m3s', 3723), ('12m30s', 750), ('00:00:05,5', 5.5)):
            self.assertAlmostEqual(A.parse_time(v), want, msg=v)
        for bad in ('', 'x', '-5', None):
            self.assertIsNone(A.parse_time(bad), bad)


if __name__ == '__main__':
    unittest.main()
