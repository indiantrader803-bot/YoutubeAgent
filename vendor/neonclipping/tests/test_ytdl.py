import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

_tmp = tempfile.TemporaryDirectory()
os.environ['NEONCLIPPING_NO_AUTOUPDATE'] = '1'          # tests must never pip-install anything
os.environ['NEONCLIPPING_DATA_DIR'] = _tmp.name
for _k in ('NEONCLIPPING_COOKIES_BROWSER', 'NEONCLIPPING_COOKIES_FILE'):
    os.environ.pop(_k, None)
import ytdl

_patch = None


def setUpModule():
    """ytdl may already be imported by another test module with the real data folder: point it at a temp folder for these tests."""
    global _patch
    _patch = mock.patch.object(ytdl, 'DATA', Path(_tmp.name))
    _patch.start()


def tearDownModule():
    _patch.stop()


BOT = ("ERROR: [youtube] JiVLpGU4FQ4: Sign in to confirm you're not a bot. This helps protect our community. "
       "Use --cookies-from-browser or --cookies for the authentication.")


class FakeYT:
    """Stands in for yt_dlp.YoutubeDL. `rule(options)` returns a result or raises."""
    rule = None
    calls = []

    def __init__(self, options):
        self.options = options

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=True, **kw):
        FakeYT.calls.append(self.options)
        return FakeYT.rule(self.options)

    def download(self, urls):
        FakeYT.calls.append(self.options)
        return FakeYT.rule(self.options)


def clients(options):
    return options.get('extractor_args', {}).get('youtube', {}).get('player_client')


class Detect(unittest.TestCase):
    def test_screenshot_error_is_a_block(self):
        self.assertTrue(ytdl.is_blocked(Exception(BOT)))

    def test_rate_limits_are_blocks(self):
        self.assertTrue(ytdl.is_blocked(Exception('HTTP Error 429: Too Many Requests')))
        self.assertTrue(ytdl.is_blocked(Exception('HTTP Error 403: Forbidden')))

    def test_normal_errors_are_not_blocks(self):
        self.assertFalse(ytdl.is_blocked(Exception('Video unavailable')))
        self.assertFalse(ytdl.is_blocked(Exception('Private video')))


class Variants(unittest.TestCase):
    def test_default_first_without_cookie_setup(self):
        v = ytdl.variants({'quiet': True})
        self.assertTrue(v[0][1])                               # default options come first
        self.assertNotIn('cookiesfrombrowser', v[0][0])
        self.assertGreaterEqual(len(v), 4)                     # plus alternative player clients

    def test_browser_cookies_only_when_asked(self):
        with mock.patch.dict(os.environ, {'NEONCLIPPING_COOKIES_BROWSER': 'Chrome'}):
            v = ytdl.variants({})
        self.assertEqual(v[0][0]['cookiesfrombrowser'], ('chrome',))
        self.assertFalse(v[0][1])

    def test_cookie_file_is_used_when_present(self):
        f = Path(_tmp.name) / 'cookies.txt'
        f.write_text('# Netscape HTTP Cookie File\n', encoding='utf-8')
        with mock.patch.dict(os.environ, {'NEONCLIPPING_COOKIES_FILE': str(f)}):
            v = ytdl.variants({})
        self.assertEqual(v[0][0]['cookiefile'], str(f))


class Ladder(unittest.TestCase):
    def setUp(self):
        FakeYT.calls = []
        p = mock.patch.object(ytdl.yt_dlp, 'YoutubeDL', FakeYT)
        p.start()
        self.addCleanup(p.stop)

    def test_recovers_with_another_player_client(self):
        def rule(o):
            if clients(o) == ['tv', 'web_safari']:
                return {'title': 'ok'}
            raise Exception(BOT)
        FakeYT.rule = staticmethod(rule)
        self.assertEqual(ytdl.YDL({}).extract_info('u', download=False), {'title': 'ok'})
        self.assertEqual(len(FakeYT.calls), 2)                 # default failed, tv client worked

    def test_all_blocked_gives_one_readable_message(self):
        FakeYT.rule = staticmethod(lambda o: (_ for _ in ()).throw(Exception(BOT)))
        with self.assertRaises(RuntimeError) as c:
            ytdl.YDL({}).download(['u'])
        self.assertIn('Upload video', str(c.exception))
        self.assertIn('NEONCLIPPING_COOKIES_BROWSER', str(c.exception))
        self.assertNotIn('--cookies-from-browser', str(c.exception))

    def test_normal_error_is_not_retried(self):
        FakeYT.rule = staticmethod(lambda o: (_ for _ in ()).throw(Exception('Video unavailable')))
        with self.assertRaisesRegex(Exception, 'Video unavailable'):
            ytdl.YDL({}).extract_info('u', download=False)
        self.assertEqual(len(FakeYT.calls), 1)

    def test_unreadable_browser_cookies_fall_through_to_next_way(self):
        def rule(o):
            if 'cookiesfrombrowser' in o:
                raise Exception('could not copy Chrome cookie database')
            return {'title': 'ok'}
        FakeYT.rule = staticmethod(rule)
        with mock.patch.dict(os.environ, {'NEONCLIPPING_COOKIES_BROWSER': 'chrome'}):
            self.assertEqual(ytdl.YDL({}).extract_info('u', download=False), {'title': 'ok'})

    def test_works_as_context_manager(self):
        FakeYT.rule = staticmethod(lambda o: 1)
        with ytdl.YDL({'quiet': True}) as y:
            self.assertEqual(y.download(['u']), 1)


class Update(unittest.TestCase):
    def test_not_checked_again_within_a_day(self):
        stamp = Path(_tmp.name) / '.ytdlp_checked'
        stamp.write_text('x', encoding='utf-8')
        with mock.patch.dict(os.environ, {'NEONCLIPPING_NO_AUTOUPDATE': ''}), \
             mock.patch.object(ytdl.subprocess, 'run') as run:
            self.assertFalse(ytdl.update_ytdlp())
            run.assert_not_called()

    def test_runs_when_stale_and_records_result(self):
        stamp = Path(_tmp.name) / '.ytdlp_checked'
        stamp.write_text('x', encoding='utf-8')
        old = time.time() - 3 * 24 * 3600
        os.utime(stamp, (old, old))
        with mock.patch.dict(os.environ, {'NEONCLIPPING_NO_AUTOUPDATE': ''}), \
             mock.patch.object(ytdl.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run:
            self.assertTrue(ytdl.update_ytdlp())
            self.assertIn('yt-dlp[default]', run.call_args[0][0])
        self.assertTrue(stamp.read_text(encoding='utf-8').endswith('ok'))

    def test_opt_out(self):
        with mock.patch.object(ytdl.subprocess, 'run') as run:
            self.assertFalse(ytdl.update_ytdlp())              # NO_AUTOUPDATE=1 is set at the top of this file
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
