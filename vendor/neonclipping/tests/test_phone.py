"""Phone remote: the gate must keep strangers out, let the right phone in, and never expose PC-only routes."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ROOT = Path(__file__).resolve().parent.parent
PHONE_ROUTES = ('/live-active', '/library', '/creators')


class PhoneGate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        os.environ['NEONCLIPPING_DATA_DIR'] = cls.tmp.name
        os.environ['NEONCLIPPING_LAN'] = '1'
        import importlib
        import app as A
        importlib.reload(A)
        cls.A = A
        from fastapi.testclient import TestClient
        cls.phone = TestClient(A.app, client=('192.168.1.50', 40000))      # a phone on the Wi-Fi
        cls.pc = TestClient(A.app, client=('127.0.0.1', 40001))            # the PC itself

    @classmethod
    def tearDownClass(cls):
        os.environ.pop('NEONCLIPPING_LAN', None)
        os.environ.pop('NEONCLIPPING_DATA_DIR', None)
        cls.tmp.cleanup()

    def pin(self):
        return self.pc.get('/phone/status').json()['pin']

    def test_pc_needs_no_pin(self):
        for p in PHONE_ROUTES + ('/layouts', '/queue'):
            self.assertEqual(self.pc.get(p).status_code, 200, p)

    def test_phone_without_pin_is_refused_but_can_load_the_page(self):
        self.assertEqual(self.phone.get('/m').status_code, 200)
        self.assertIn('NeonClipping', self.phone.get('/m').text)
        for p in PHONE_ROUTES + ('/media/abc', '/make/abc'):
            self.assertEqual(self.phone.get(p).status_code, 401, p)

    def test_wrong_pin_then_lockout_then_right_pin_works_for_another_phone(self):
        from fastapi.testclient import TestClient
        other = TestClient(self.A.app, client=('192.168.1.99', 40010))
        for _ in range(5):
            self.assertEqual(other.post('/m/login', json={'pin': '000000'}).status_code in (401,), True)
        r = other.post('/m/login', json={'pin': self.pin()})
        self.assertEqual(r.status_code, 429)                                  # locked even with the right PIN for 10 minutes
        fresh = TestClient(self.A.app, client=('192.168.1.77', 40011))
        ok = fresh.post('/m/login', json={'pin': self.pin()})
        self.assertEqual(ok.status_code, 200)
        self.assertIn('nc_phone', ok.headers.get('set-cookie', ''))
        self.assertIn('httponly', ok.headers.get('set-cookie', '').lower())
        self.assertEqual(fresh.get('/library').status_code, 200)
        self.assertEqual(fresh.get('/live-active').status_code, 200)

    def test_pc_only_routes_stay_closed_even_with_the_pin(self):
        from fastapi.testclient import TestClient
        c = TestClient(self.A.app, client=('192.168.1.60', 40020))
        self.assertEqual(c.post('/m/login', json={'pin': self.pin()}).status_code, 200)
        for method, path in (('get', '/phone/status'), ('post', '/phone/newpin'), ('get', '/queue'), ('post', '/upload'), ('post', '/upload-asset'),
                             ('post', '/facecam/detect'), ('post', '/ai/parts'), ('post', '/export'), ('post', '/captions/parse'), ('get', '/layouts')):
            r = getattr(c, method)(path) if method == 'get' else c.post(path, json={})
            self.assertEqual(r.status_code, 403, (method, path, r.status_code))

    def test_new_pin_logs_everyone_out(self):
        from fastapi.testclient import TestClient
        c = TestClient(self.A.app, client=('192.168.1.61', 40030))
        self.assertEqual(c.post('/m/login', json={'pin': self.pin()}).status_code, 200)
        self.assertEqual(c.get('/library').status_code, 200)
        old = self.pin()
        new = self.pc.post('/phone/newpin').json()['pin']
        self.assertNotEqual(old, new)
        self.assertEqual(c.get('/library').status_code, 401)

    def test_pin_is_six_digits_and_phone_cannot_read_it(self):
        self.assertRegex(self.pin(), r'^\d{6}$')
        self.assertEqual(self.phone.get('/phone/status').status_code, 401 if False else self.phone.get('/phone/status').status_code)
        self.assertIn(self.phone.get('/phone/status').status_code, (401, 403))

    def test_manifest_and_icon_are_public(self):
        self.assertEqual(self.phone.get('/manifest.webmanifest').json()['start_url'], '/m')
        self.assertEqual(self.phone.get('/phone-icon.svg').status_code, 200)

    def test_status_lists_wifi_addresses_for_the_pc(self):
        s = self.pc.get('/phone/status').json()
        self.assertTrue(s['enabled'])
        for u in s['urls']:
            self.assertRegex(u, r'^http://(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)[\d.]+:\d+/m$')


class PhoneOff(unittest.TestCase):
    def test_everything_is_closed_for_other_machines_when_lan_mode_is_off(self):
        os.environ.pop('NEONCLIPPING_LAN', None)
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            os.environ['NEONCLIPPING_DATA_DIR'] = d
            import importlib
            import app as A
            importlib.reload(A)
            from fastapi.testclient import TestClient
            phone = TestClient(A.app, client=('192.168.1.50', 40000))
            for p in ('/m', '/library', '/live-active'):
                self.assertEqual(phone.get(p).status_code, 403, p)
            self.assertFalse(TestClient(A.app, client=('127.0.0.1', 1)).get('/phone/status').json()['enabled'])
            os.environ.pop('NEONCLIPPING_DATA_DIR', None)


class Helpers(unittest.TestCase):
    def test_allow_list_matches_whole_path_segments(self):
        import phone as P
        self.assertTrue(P.allowed('/live/abc/clip-now'))
        self.assertTrue(P.allowed('/media/xyz'))
        self.assertFalse(P.allowed('/livestock'))
        self.assertFalse(P.allowed('/mediaX'))
        self.assertFalse(P.allowed('/upload'))
        self.assertFalse(P.allowed('/phone/status'))

    def test_loopback_detection(self):
        import phone as P
        self.assertTrue(P.is_local('127.0.0.1') and P.is_local('::1') and P.is_local('127.5.5.5'))
        self.assertFalse(P.is_local('192.168.1.5') or P.is_local('10.0.0.2'))

    def test_lan_ips_are_private_only(self):
        import phone as P
        for ip in P.lan_ips():
            self.assertTrue(ip.startswith(('10.', '192.168.', '172.')), ip)


if __name__ == '__main__':
    unittest.main()
