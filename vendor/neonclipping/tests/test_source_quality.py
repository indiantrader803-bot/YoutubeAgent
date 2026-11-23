import os
import unittest

os.environ['NEONCLIPPING_NO_AUTOUPDATE'] = '1'
from standalone import source_height, source_format, quality_label, DEFAULT_SOURCE_HEIGHT


class SourceQuality(unittest.TestCase):
    def test_default_is_1080p_not_720p(self):
        self.assertEqual(DEFAULT_SOURCE_HEIGHT, 1080)
        self.assertEqual(source_height(None), 1080)
        self.assertEqual(source_height(''), 1080)

    def test_only_known_heights_are_accepted(self):
        for ok in (720, 1080, 1440, 2160, '2160'):
            self.assertEqual(source_height(ok), int(ok))
        for bad in (999, 'x', -1, 4320, [], {}):
            self.assertEqual(source_height(bad), 1080)

    def test_1080_prefers_h264_and_never_caps_at_720(self):
        f = source_format(1080)
        self.assertIn('height<=1080', f)
        self.assertIn('vcodec^=avc1', f)
        self.assertNotIn('height<=720', f)

    def test_4k_allows_vp9_or_av1(self):
        f = source_format(2160)
        self.assertIn('height<=2160', f)
        self.assertNotIn('avc1', f)

    def test_720_still_available_as_fast_option(self):
        self.assertIn('height<=720', source_format(720))

    def test_labels(self):
        self.assertEqual(quality_label(2160), '4K')
        self.assertEqual(quality_label(1080), '1080p')


if __name__ == '__main__':
    unittest.main()
