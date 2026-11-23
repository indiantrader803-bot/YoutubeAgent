"""In-app updater: safe paths, version file, git checkouts are never touched, data is kept."""
import io, sys, tempfile, unittest, zipfile
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import updater

SHA_OLD = 'a' * 40
SHA_NEW = 'b' * 40


def fake_zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for name, text in files.items():
            z.writestr('neonclipping-main/' + name, text)
    return buf.getvalue()


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'app.py').write_text('old', encoding='utf-8')
        (self.root / 'requirements.txt').write_text('a\n', encoding='utf-8')
        (self.root / 'data').mkdir()
        (self.root / 'data' / 'keep.txt').write_text('mine', encoding='utf-8')
        (self.root / '.neon_version').write_text(SHA_OLD, encoding='utf-8')
        updater._latest.update(sha='', at=0.0)
        updater._state.update(stage='', error='', running=False, done=False)

    def tearDown(self):
        self.tmp.cleanup()

    def test_status_shows_update_when_versions_differ(self):
        with mock.patch.object(updater, 'latest', return_value=SHA_NEW):
            s = updater.status(self.root)
        self.assertTrue(s['available'])
        self.assertEqual((s['current'], s['latest']), ('aaaaaaa', 'bbbbbbb'))

    def test_no_update_when_same_or_offline(self):
        with mock.patch.object(updater, 'latest', return_value=SHA_OLD):
            self.assertFalse(updater.status(self.root)['available'])
        with mock.patch.object(updater, 'latest', return_value=''):
            self.assertFalse(updater.status(self.root)['available'])

    def test_git_checkout_is_never_updated(self):
        (self.root / '.git').mkdir()
        with mock.patch.object(updater, 'latest', return_value=SHA_NEW):
            self.assertFalse(updater.status(self.root)['available'])
            ok, msg = updater.apply(self.root, lambda: False)
        self.assertFalse(ok)
        self.assertIn('git', msg)

    def test_busy_blocks_update(self):
        with mock.patch.object(updater, 'latest', return_value=SHA_NEW):
            ok, msg = updater.apply(self.root, lambda: True)
        self.assertFalse(ok)
        self.assertIn('running', msg)

    def test_install_replaces_files_keeps_data_and_backs_up(self):
        data = fake_zip({'app.py': 'new', 'requirements.txt': 'a\n', 'extra/new.txt': 'hello', 'data/overwrite.txt': 'NO', 'index.html': 'page'})
        with mock.patch.object(updater, '_request', return_value=FakeResponse(data)):
            updater._install(self.root, SHA_NEW)
        self.assertEqual((self.root / 'app.py').read_text(encoding='utf-8'), 'new')
        self.assertEqual((self.root / 'extra' / 'new.txt').read_text(encoding='utf-8'), 'hello')
        self.assertEqual((self.root / 'data' / 'keep.txt').read_text(encoding='utf-8'), 'mine')
        self.assertFalse((self.root / 'data' / 'overwrite.txt').exists())
        self.assertEqual((self.root / '.update-backup' / 'app.py').read_text(encoding='utf-8'), 'old')
        self.assertEqual(updater.current(self.root), SHA_NEW)

    def test_install_installs_packages_only_when_requirements_change(self):
        data = fake_zip({'app.py': 'new', 'requirements.txt': 'a\nav<19\n'})
        with mock.patch.object(updater, '_request', return_value=FakeResponse(data)), \
                mock.patch.object(updater.subprocess, 'run', return_value=mock.Mock(returncode=0, stdout='', stderr='')) as run:
            updater._install(self.root, SHA_NEW)
        self.assertEqual(run.call_count, 1)
        data = fake_zip({'app.py': 'newer', 'requirements.txt': 'a\nav<19\n'})
        with mock.patch.object(updater, '_request', return_value=FakeResponse(data)), \
                mock.patch.object(updater.subprocess, 'run') as run:
            updater._install(self.root, SHA_NEW)
        run.assert_not_called()

    def test_rejects_zip_without_app_and_path_escape(self):
        with mock.patch.object(updater, '_request', return_value=FakeResponse(fake_zip({'readme.md': 'x'}))):
            with self.assertRaises(RuntimeError):
                updater._install(self.root, SHA_NEW)
        with self.assertRaises(ValueError):
            updater._safe_target(self.root, '../evil.txt')


if __name__ == '__main__':
    unittest.main()
