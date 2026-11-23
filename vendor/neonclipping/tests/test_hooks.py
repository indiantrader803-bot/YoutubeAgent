from pathlib import Path
import tempfile
import unittest
import captions,hooks
class HookHeadings(unittest.TestCase):
    def test_heading_lasts_eight_seconds_and_has_separate_black_backing(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);captions.write([],'gta',p,'hook','THE PLAN WENT WRONG',width=1080,height=1920,appearance={'hook_style':'box'})
            text=(p/'hook.ass').read_text(encoding='utf-8')
            self.assertIn('Dialogue: 2,0:00:00.00,0:00:08.00',text)
            self.assertIn('Dialogue: 3,0:00:00.00,0:00:08.00',text)
            self.assertIn('\\1c&H000000&',text)
    def test_duration_and_background_are_explicit(self):
        self.assertEqual(hooks.settings({'hook_duration':12,'hook_background':False}),(12,False))
        events=hooks.events(['HELLO'],720,1280,200,.667,{'hook_background':False,'hook_duration':12,'hook_style':'box'})
        self.assertEqual(len(events),1);self.assertIn('0:00:12.00',events[0])
        for duration in (0,1,61,float('nan')):
            with self.assertRaises(ValueError):hooks.settings({'hook_duration':duration})
class HookStyles(unittest.TestCase):
    def test_every_style_draws_the_text_once_and_ends_with_the_duration(self):
        for look in hooks.STYLES:
            events=hooks.events(['THE PLAN','WENT WRONG'],1080,1920,300,1,{'hook_style':look,'hook_duration':6})
            self.assertTrue(events,look)
            self.assertTrue(all('0:00:06.00' in e for e in events),look)
            self.assertEqual(sum('THE PLAN' in e for e in events),1 if look!='neon' else 2,look)       # neon draws a glow copy behind
    def test_default_is_impact_with_accent_word_and_pop(self):
        self.assertEqual(hooks.style({}),'impact')
        text=chr(10).join(hooks.events(['I LOST 3 KEYS'],1080,1920,300,1,{}))
        self.assertIn(chr(92)+'t(0,150',text)             # pop-in
        self.assertIn('&H0000E5FF&',text)           # accent colour on the keyword
    def test_keyword_prefers_numbers_then_long_words(self):
        self.assertEqual(hooks.keyword(['I LOST 3 KEYS']),(0,2))
        self.assertEqual(hooks.keyword(['THE PLAN','WENT WRONG']),(1,1))
        self.assertIsNone(hooks.keyword(['A B']))
    def test_unknown_style_is_refused(self):
        with self.assertRaises(ValueError):hooks.settings({'hook_style':'rainbow'})
if __name__=='__main__':unittest.main()


class RoundedBoxes(unittest.TestCase):
    def test_rounded_shape_has_curves_and_is_closed_at_top(self):
        d = hooks.rounded(400, 120, 24)
        self.assertIn(' b ', d)
        self.assertTrue(d.startswith('m 24 0'))
        self.assertEqual(hooks.rounded(10, 10, 1), 'm 0 0 l 10 0 l 10 10 l 0 10')      # too small to round

    def test_box_banner_and_underline_use_rounded_shapes(self):
        for look in ('box', 'banner', 'impact'):
            text = chr(10).join(hooks.events(['TWO WORDS'], 1080, 1920, 300, 1, {'hook_style': look}))
            self.assertIn(' b ', text, look)
