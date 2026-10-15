"""Bounded diagnostics for synthetic PostgreSQL fixture processes only."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

SPEC=importlib.util.spec_from_file_location('pg_lifecycle',Path(__file__).with_name('cn_release_postgres_lifecycle_linux.py'))
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

class DiagnosticTests(unittest.TestCase):
    def test_actual_subprocess_error_retains_code_and_original_hash(self):
        stdout=b'x'*50000
        stderr=b'y'*50000
        error=subprocess.CalledProcessError(17,['DO_NOT_PRINT_ARGV'],output=stdout,stderr=stderr)
        value=m.fixture_diagnostic(error,'driver-bridge')
        self.assertEqual(value['stage'],'driver-bridge')
        self.assertEqual(value['returncode'],17)
        self.assertEqual(value['scope'],'fixture-only')
        for key,raw in [('stdout',stdout),('stderr',stderr)]:
            self.assertEqual(value[key]['sha256'],hashlib.sha256(raw).hexdigest())
            self.assertEqual(value[key]['bytes'],len(raw))
            self.assertTrue(value[key]['truncated'])
        self.assertLessEqual(len(json.dumps(value).encode()),8192)
        self.assertNotIn('DO_NOT_PRINT_ARGV',json.dumps(value))

    def test_sensitive_fields_urls_and_environment_are_not_exposed(self):
        raw=b'token=TOKEN_SENTINEL\npassword: PASSWORD_SENTINEL\nAuthorization: AUTH_SENTINEL\nhttps://host.example/URL_SENTINEL?signature=abc\nplain fixture failure\n'
        error=subprocess.CalledProcessError(3,['ARGV_SENTINEL'],output=b'',stderr=raw)
        error.env={'SECRET':'ENV_SENTINEL'}
        value=m.fixture_diagnostic(error,'migrator-import');encoded=json.dumps(value)
        for sentinel in ('TOKEN_SENTINEL','PASSWORD_SENTINEL','AUTH_SENTINEL','URL_SENTINEL','ARGV_SENTINEL','ENV_SENTINEL'):
            self.assertNotIn(sentinel,encoded)
        self.assertIn('plain fixture failure',encoded)
        self.assertEqual(value['stderr']['sha256'],hashlib.sha256(raw).hexdigest())

    def test_unicode_json_escaping_stays_bounded(self):
        error=subprocess.CalledProcessError(1,['hidden'],output=('漢'*9000).encode(),stderr=('字'*9000).encode())
        value=m.fixture_diagnostic(error,'driver-bridge')
        self.assertLessEqual(len(json.dumps(value).encode()),8192)
        self.assertTrue(value['stdout']['truncated'])

    def test_stage_is_a_fixed_enum(self):
        for stage in ('capability','driver-bridge','migrator-import','initdb','pg_ctl-start','pg_ctl-stop','pg_ctl-status','postgres','psql'):
            self.assertEqual(m.fixture_diagnostic(RuntimeError('FAIL'),stage)['stage'],stage)
        value=m.fixture_diagnostic(RuntimeError('FAIL'),'token=PRIVATE_STAGE')
        self.assertEqual(value['stage'],'unknown-fixture-stage')
        self.assertNotIn('PRIVATE_STAGE',json.dumps(value))

    def test_timeout_and_static_error_codes(self):
        error=subprocess.TimeoutExpired(['hidden'],1,output=b'partial',stderr=b'fixture timeout')
        value=m.fixture_diagnostic(error,'pg_ctl-start')
        self.assertIsNone(value['returncode'])
        self.assertEqual(value['stdout']['bytes'],7)
        self.assertEqual(m.fixture_diagnostic(RuntimeError('TCP_ENABLED'),'psql')['code'],'TCP_ENABLED')
        self.assertNotIn('code',m.fixture_diagnostic(RuntimeError('password=private'),'psql'))

if __name__=='__main__':unittest.main()
