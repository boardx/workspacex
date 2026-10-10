import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile
from datetime import datetime, timedelta, timezone

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from cn_candidate_download_supervisor import supervise, SupervisionError
from cn_candidate_sdk_runtime import extract_wheels
spec = importlib.util.spec_from_file_location('download_entry', SCRIPTS / 'execute-cn-candidate-download.py')
entry = importlib.util.module_from_spec(spec); spec.loader.exec_module(entry)


class SupervisorTests(unittest.TestCase):
    def test_real_library_alarm_remains_available(self):
        def execute():
            if signal.getitimer(signal.ITIMER_REAL)[0]:
                raise RuntimeError('outer alarm')
            signal.setitimer(signal.ITIMER_REAL, 1)
            signal.setitimer(signal.ITIMER_REAL, 0)
            print('MUST_NOT_ESCAPE')
            return {'ok': True}
        self.assertEqual(supervise(execute, 2), {'ok': True})

    def test_timeout_and_reap(self):
        start = time.monotonic()
        with self.assertRaisesRegex(SupervisionError, 'TIMEOUT'):
            supervise(lambda: time.sleep(20), 1)
        self.assertLess(time.monotonic() - start, 3)

    def test_exception_is_redacted(self):
        def execute():
            raise RuntimeError('fake-secret-must-not-escape')
        with self.assertRaisesRegex(SupervisionError, '^AUTHENTICATED_TRANSFER_REJECTED$'):
            supervise(execute, 1)

    def test_result_bound(self):
        with self.assertRaises(SupervisionError):
            supervise(lambda: {'value': 'x' * 65536}, 1)


class ApprovalTests(unittest.TestCase):
    def fixture(self):
        now = datetime.now(timezone.utc)
        return dict(kind='cn-candidate-download-root-v1', sourceRevision='a'*40,
            controlRevision='f'*40, attemptId='original-build', operation='check', issuedAt=now.isoformat(),
            expiresAt=(now + timedelta(minutes=5)).isoformat(), maxSeconds=120,
            inputs={n: 'b'*64 for n in ('request.json', 'candidate-plan.json', 'candidate-set.json')},
            code={n: 'c'*64 for n in entry.BASE_CODE}, sdkManifestSha256='d'*64)

    def admit(self, value, **overrides):
        raw = json.dumps(value).encode()
        return entry.admit_approval(raw, overrides.get('sha', hashlib.sha256(raw).hexdigest()),
            overrides.get('source', 'a'*40), overrides.get('attempt', 'original-build'), overrides.get('operation', 'check'))

    def test_independent_hash_source_attempt_and_operation(self):
        value = self.fixture()
        self.assertEqual(self.admit(value)['operation'], 'check')
        for change in ({'sha': '0'*64}, {'source': 'f'*40}, {'attempt': 'new-verification'}, {'operation': 'download'}):
            with self.assertRaises(ValueError):
                self.admit(value, **change)

    def test_expired_and_partial_proof_reject(self):
        value = self.fixture(); value['expiresAt'] = value['issuedAt']
        with self.assertRaises(ValueError): self.admit(value)
        value = self.fixture(); value['inputs']['candidate-revalidation.json'] = 'e'*64
        with self.assertRaises(ValueError): self.admit(value)


class WheelTests(unittest.TestCase):
    def fixture(self, bad=None):
        versions = {'oss2': '2.19.1', 'alibabacloud_credentials': '0.3.6',
                    'aliyun_python_sdk_core': '2.16.0', 'aliyun_python_sdk_sts': '3.1.2'}
        wheels, blobs = [], {}
        for index, (package, version) in enumerate(versions.items()):
            name = f'{package}-{version}-py3-none-any.whl'
            out = io.BytesIO()
            with zipfile.ZipFile(out, 'w') as archive:
                archive.writestr(bad if index == 0 and bad else f'{package}/__init__.py', b'pass\n')
            blob = out.getvalue(); blobs[name] = blob
            wheels.append(dict(filename=name, package=package, version=version, size=len(blob),
                sha256=hashlib.sha256(blob).hexdigest(), originSha256='a'*64))
        return json.dumps(dict(kind='cn-oss-sdk-wheels-v1', python='cp312-linux-x86_64', wheels=wheels)).encode(), blobs

    def test_hash_mismatch_and_unsafe_member_never_write(self):
        for bad in ('../../escape.py', 'evil.pth', '/absolute.py', 'oss2/lib.so'):
            raw, blobs = self.fixture(bad)
            with tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError): extract_wheels(raw, lambda n,s: blobs[n], folder)
                self.assertFalse(list(Path(folder).iterdir()))
        raw, blobs = self.fixture()
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): extract_wheels(raw, lambda n,s: blobs[n] + b'x', folder)
            self.assertFalse(list(Path(folder).iterdir()))

    def test_valid_closed_runtime(self):
        raw, blobs = self.fixture()
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(extract_wheels(raw, lambda n,s: blobs[n], folder), 4)

    def test_foreign_native_wheel_rejects(self):
        raw, blobs = self.fixture()
        v = json.loads(raw)
        v['wheels'][0]['filename'] = 'oss2-2.19.1-cp312-cp312-macosx_11_0_arm64.whl'
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): extract_wheels(json.dumps(v).encode(), lambda n,s: blobs[n], folder)


class RootFileTests(unittest.TestCase):
    def setUp(self):
        # Test filesystem invariants on a non-root developer host. Production's
        # root guard and the hash-bound OWNER constant are never overridden.
        self.owner = patch.object(entry, 'OWNER', (os.getuid(), os.getgid()))
        self.owner.start()
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.fd = os.open(self.folder, os.O_RDONLY | os.O_DIRECTORY)
        (self.folder / 'data').write_bytes(b'original')
        (self.folder / 'data').chmod(0o600)

    def tearDown(self):
        os.close(self.fd); self.temp.cleanup(); self.owner.stop()

    def test_symlink_hardlink_and_permissions(self):
        self.assertEqual(entry.read(self.fd, 'data'), b'original')
        (self.folder / 'link').symlink_to('data')
        with self.assertRaises(OSError): entry.read(self.fd, 'link')
        os.link(self.folder / 'data', self.folder / 'hard')
        with self.assertRaises(ValueError): entry.read(self.fd, 'data')
        (self.folder / 'hard').unlink()
        (self.folder / 'data').chmod(0o644)
        with self.assertRaises(ValueError): entry.read(self.fd, 'data')

    def test_named_target_change_rejected(self):
        original_stat = os.stat
        def replace_then_stat(*args, **kwargs):
            (self.folder / 'replacement').write_bytes(b'original')
            (self.folder / 'replacement').chmod(0o600)
            os.replace(self.folder / 'replacement', self.folder / 'data')
            return original_stat(*args, **kwargs)
        with patch.object(entry.os, 'stat', side_effect=replace_then_stat):
            with self.assertRaisesRegex(ValueError, 'FILE_CHANGED'):
                entry.read(self.fd, 'data')


if __name__ == '__main__':
    unittest.main()
