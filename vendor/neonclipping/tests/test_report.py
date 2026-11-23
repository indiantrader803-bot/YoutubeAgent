import http.server
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

os.environ['NEONCLIPPING_NO_AUTOUPDATE'] = '1'
import report

_tmp = tempfile.TemporaryDirectory()
_patch = None


def setUpModule():
    global _patch
    _patch = mock.patch.object(report, 'DATA', Path(_tmp.name))
    _patch.start()


def tearDownModule():
    _patch.stop()


class Redact(unittest.TestCase):
    def test_links_keep_only_the_site(self):
        out = report.redact('failed https://www.youtube.com/watch?v=JiVLpGU4FQ4&si=abc123 now')
        self.assertIn('<link:www.youtube.com>', out)
        self.assertNotIn('JiVLpGU4FQ4', out)

    def test_user_names_in_paths(self):
        self.assertNotIn('WeDream', report.redact(r'C:\Users\WeDream\Desktop\video\x.mp4 missing'))
        self.assertNotIn('priya', report.redact('/home/priya/clips/a.mp4'))

    def test_email_ip_secrets_and_long_ids(self):
        out = report.redact('mail a.b@gmail.com ip 192.168.1.20 token=abcd1234 cookie: SID=zzz id ' + 'A' * 40)
        for bad in ('a.b@gmail.com', '192.168.1.20', 'abcd1234', 'zzz', 'A' * 40):
            self.assertNotIn(bad, out)

    def test_error_wording_survives(self):
        out = report.redact("Sign in to confirm you're not a bot")
        self.assertIn('not a bot', out)


class Classify(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(report.classify("Sign in to confirm you're not a bot"), 'youtube-bot-check')
        self.assertEqual(report.classify('HTTP Error 429: Too Many Requests'), 'rate-limited')
        self.assertEqual(report.classify('ffmpeg exited with code 1'), 'ffmpeg')
        self.assertEqual(report.classify('weird'), 'other')


class Log(unittest.TestCase):
    def setUp(self):
        p = Path(_tmp.name) / 'errors.log'
        if p.exists():
            p.unlink()

    def test_log_is_redacted_and_readable(self):
        report.log_error('Downloading', r'boom https://youtu.be/AbC in C:\Users\Asha\x')
        rows = report.recent_errors()
        self.assertEqual(len(rows), 1)
        raw = (Path(_tmp.name) / 'errors.log').read_text(encoding='utf-8')
        self.assertNotIn('Asha', raw)
        self.assertNotIn('AbC', raw)

    def test_log_is_trimmed_when_large(self):
        for i in range(400):
            report.log_error('s', 'x' * 600)
        p = Path(_tmp.name) / 'errors.log'
        self.assertLess(p.stat().st_size, report.LOG_MAX + 2000)

    def test_job_error_logged_once(self):
        row = {'status': 'error', 'stage': 'Rendering', 'error': 'ffmpeg failed'}
        report.note_job_error(row)
        report.note_job_error(row)
        self.assertEqual(len(report.recent_errors()), 1)


class Diagnostics(unittest.TestCase):
    def test_contains_versions_not_identity(self):
        report.log_error('x', r'C:\Users\Meena\a.mp4 failed')
        text = report.diagnostics('my note with https://youtu.be/QWERTY12345 link')
        self.assertIn('python:', text)
        self.assertIn('yt_dlp:', text)
        self.assertNotIn('Meena', text)
        self.assertNotIn('QWERTY12345', text)
        self.assertTrue(text.startswith('NeonClipping diagnostics'))

    def test_issue_url_fits_in_a_link(self):
        for _ in range(20):
            report.log_error('s', 'y' * 600)
        url = report.issue_url('note ' * 200)
        self.assertTrue(url.startswith('https://github.com/iamajmeena/neonclipping/issues/new?'))
        self.assertLess(len(url), 8000)


class Collector(http.server.BaseHTTPRequestHandler):
    got = []
    code = 200

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        Collector.got.append(json.loads(self.rfile.read(n)))
        self.send_response(Collector.code)
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *a):
        pass


class Send(unittest.TestCase):
    def setUp(self):
        Collector.got = []
        Collector.code = 200
        self.srv = http.server.HTTPServer(('127.0.0.1', 0), Collector)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)
        self.url = f'http://127.0.0.1:{self.srv.server_port}/'

    def test_not_configured_sends_nothing(self):
        with mock.patch.dict(os.environ, {'NEONCLIPPING_REPORT_URL': ''}), mock.patch.object(report, 'DEFAULT_REPORT_URL', ''):
            ok, msg = report.send('hi')
        self.assertFalse(ok)
        self.assertIn('not set up', msg)
        self.assertEqual(Collector.got, [])

    def test_sends_only_the_shown_text(self):
        report.log_error('Downloading', "Sign in to confirm you're not a bot")
        with mock.patch.dict(os.environ, {'NEONCLIPPING_REPORT_URL': self.url}):
            ok, msg = report.send('please help https://youtu.be/ZZZZZZZZZZZ')
        self.assertTrue(ok, msg)
        body = Collector.got[0]
        self.assertTrue(body['text'].startswith('NeonClipping diagnostics'))
        self.assertNotIn('ZZZZZZZZZZZ', json.dumps(body))
        self.assertEqual(set(body), {'text', 'sent', 'kinds'})
        self.assertIn('youtube-bot-check', body['kinds'])

    def test_collector_error_is_reported(self):
        Collector.code = 500
        with mock.patch.dict(os.environ, {'NEONCLIPPING_REPORT_URL': self.url}):
            ok, _ = report.send('')
        self.assertFalse(ok)

    def test_only_https_or_localhost_urls_are_used(self):
        with mock.patch.dict(os.environ, {'NEONCLIPPING_REPORT_URL': 'http://example.com/x'}), mock.patch.object(report, 'DEFAULT_REPORT_URL', ''):
            self.assertEqual(report.report_url(), '')


class Endpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from fastapi.testclient import TestClient
            import app as neon_app
        except Exception as e:                      # noqa: BLE001
            raise unittest.SkipTest('TestClient unavailable: ' + str(e))
        cls.c = TestClient(neon_app.app, client=('127.0.0.1', 50000))

    def test_info_and_download(self):
        j = self.c.get('/report/info').json()
        self.assertIn('diagnostics', j)
        self.assertTrue(j['issue_url'].startswith('https://github.com/'))
        self.assertFalse(j['can_send'] and not report.report_url())
        r = self.c.get('/report/download')
        self.assertIn('attachment', r.headers['content-disposition'])
        self.assertTrue(r.text.startswith('NeonClipping diagnostics'))

    def test_send_requires_explicit_consent(self):
        self.assertEqual(self.c.post('/report/send', json={}).status_code, 400)
        self.assertEqual(self.c.post('/report/send', json={'consent': 'yes'}).status_code, 400)

    def test_script_is_served_and_linked(self):
        self.assertEqual(self.c.get('/assets/report.js').status_code, 200)
        self.assertIn('/assets/report.js', self.c.get('/').text)


if __name__ == '__main__':
    unittest.main()
