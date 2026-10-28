import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module():
    spec = importlib.util.spec_from_file_location('probe_credentials', ROOT / 'scripts/image-release-probe-credentials.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class Credentials(unittest.TestCase):
    def test_rejected_login_never_saves_or_prints_credentials(self):
        m = module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cn-browser.env'
            with patch.object(m, 'verify_login', side_effect=ValueError('LOGIN_REJECTED')):
                with self.assertRaisesRegex(ValueError, '^LOGIN_REJECTED$'):
                    m.configure('cn', 'person@example.com', 'existing-password', path)
            self.assertFalse(path.exists())

    def test_success_writes_private_existing_credentials_without_session_token(self):
        m = module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cn-browser.env'
            with patch.object(m, 'verify_login') as verify:
                m.configure('cn', 'person@example.com', 'existing-password', path)
            verify.assert_called_once_with('https://app.boardx.com.cn', 'person@example.com', 'existing-password')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.stat().st_nlink, 1)
            self.assertEqual(path.read_text(), 'PROVISION_ADMIN_EMAIL=person@example.com\nPROVISION_ADMIN_PASSWORD=existing-password\n')

    def test_existing_or_symlink_destination_never_replaced_or_used_for_login(self):
        m = module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cn-browser.env'
            path.write_text('original')
            with patch.object(m, 'verify_login') as verify:
                with self.assertRaises(FileExistsError):
                    m.configure('cn', 'person@example.com', 'existing-password', path)
                verify.assert_not_called()
            path.unlink()
            path.symlink_to(Path(tmp) / 'missing')
            with patch.object(m, 'verify_login') as verify:
                with self.assertRaises(FileExistsError):
                    m.configure('cn', 'person@example.com', 'existing-password', path)
                verify.assert_not_called()

    def test_line_injection_and_unknown_environment_rejected_before_network(self):
        m = module()
        with tempfile.TemporaryDirectory() as tmp, patch.object(m, 'verify_login') as verify:
            for environment, email, password in [('cn', 'x\ny', 'p'), ('cn', 'e', 'p\r'), ('cn', 'e', 'p\x00'), ('other', 'e', 'p')]:
                with self.assertRaises(ValueError):
                    m.configure(environment, email, password, Path(tmp) / 'out')
            verify.assert_not_called()

    def test_special_characters_remain_literal_for_browser_reader(self):
        m = module()
        password = " # '$() `literal` = \"kept\" "
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cn-browser.env'
            with patch.object(m, 'verify_login'):
                m.configure('cn', 'person@example.com', password, path)
            parsed = dict(line.split('=', 1) for line in path.read_text().splitlines())
            self.assertEqual(parsed['PROVISION_ADMIN_PASSWORD'], password)

    def test_http_failure_identifies_phase_without_echoing_response(self):
        import io
        import urllib.error
        m = module()
        error = urllib.error.HTTPError('https://app.boardx.com.cn/api/auth/login', 401,
                                      'sensitive provider text', {}, io.BytesIO(b'private response'))
        with patch.object(m.urllib.request, 'build_opener') as make:
            make.return_value.open.side_effect = error
            with self.assertRaisesRegex(ValueError, '^LOGIN_HTTP_401$'):
                m.verify_login('https://app.boardx.com.cn', 'person@example.com', 'existing-password')

    def test_cli_prints_only_allowlisted_http_status(self):
        import contextlib
        import io
        import runpy
        import stat
        from types import SimpleNamespace
        import urllib.error
        error = urllib.error.HTTPError('https://app.boardx.com.cn/api/auth/login', 401,
                                      'sensitive provider text', {}, io.BytesIO(b'private response'))
        output = io.StringIO()
        with patch('sys.argv', ['setup', 'cn']), patch('os.geteuid', return_value=0), \
             patch('socket.gethostname', return_value='workspacex-cn-prod'), \
             patch('sys.stdin.isatty', return_value=True), \
             patch('pathlib.Path.mkdir'), \
             patch('pathlib.Path.lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)), \
             patch('os.path.lexists', return_value=False), \
             patch('builtins.input', return_value='person@example.com'), \
             patch('getpass.getpass', return_value='existing-password'), \
             patch('urllib.request.build_opener') as make, \
             contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(output):
            make.return_value.open.side_effect = error
            with self.assertRaises(SystemExit) as stopped:
                runpy.run_path(str(ROOT / 'scripts/image-release-probe-credentials.py'), run_name='__main__')
            self.assertEqual(stopped.exception.code, 1)
        self.assertEqual(output.getvalue(), 'CREDENTIAL_SETUP_FAILED LOGIN_HTTP_401\n')

    def test_redirect_handler_never_forwards_credentials(self):
        m = module()
        with self.assertRaisesRegex(ValueError, '^LOGIN_REDIRECT_REJECTED$'):
            m.NoRedirect().redirect_request(None, None, 307, None, None, 'https://other.example')


if __name__ == '__main__':
    unittest.main()
