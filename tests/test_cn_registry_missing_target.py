"""Exercise the real bounded command stderr classifier with local subprocesses."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import cn_image_archive as archive
spec = importlib.util.spec_from_file_location('archive_entry', ROOT / '.harness/scripts/vm/import-cn-image-archives.py')
entry = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entry)


class MissingTargetTests(unittest.TestCase):
    target = archive.PREFIX + '/api:' + '5' * 40

    def probe(self, stderr, stdout=b'', code=1, pull=False):
        adapter = object.__new__(entry.Commands)
        adapter.c = archive
        adapter.docker = '/usr/bin/docker'
        adapter.deadline = time.monotonic() + 10
        adapter.env = {'PATH': '/usr/bin:/bin', 'LANG': 'C'}
        real_popen = subprocess.Popen
        calls = []

        def local_process(argv, **kwargs):
            calls.append(argv)
            script = ('import os;os.write(1,' + repr(stdout) + ');'
                      'os.write(2,' + repr(stderr) + ');raise SystemExit(' + str(code) + ')')
            return real_popen([sys.executable, '-I', '-S', '-c', script], **kwargs)

        with patch.object(entry.subprocess, 'Popen', local_process):
            result = adapter.pull_optional(self.target) if pull else adapter.remote_config_id(self.target)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][-1], self.target)
        return result

    def test_exact_target_missing(self):
        for prefix in (b'', b'ERROR: '):
            for newline in (b'', b'\n', b'\r\n'):
                with self.subTest(prefix=prefix, newline=newline):
                    self.assertIsNone(self.probe(prefix + self.target.encode() + b': not found' + newline))

    def test_other_target_unbound_and_case_mismatch_rejected(self):
        for message in (b'not found', b'ERROR: other: not found',
                        b'ERROR: ' + self.target.upper().encode() + b': not found',
                        b'ERROR: ' + self.target.encode() + b'-other: not found'):
            with self.subTest(message=message):
                with self.assertRaisesRegex(entry.Rejected, '^COMMAND_FAILED$'):
                    self.probe(message)

    def test_auth_permissions_dns_and_extra_lines_rejected(self):
        exact = b'ERROR: ' + self.target.encode() + b': not found'
        for error in (b'unauthorized', b'denied: permission', b'lookup registry: no such host',
                      b'401 Unauthorized', b'403 Forbidden', b'i/o timeout'):
            for message in (error, error + b'\n' + exact, exact + b'\n' + error):
                with self.subTest(message=message):
                    with self.assertRaisesRegex(entry.Rejected, '^COMMAND_FAILED$'):
                        self.probe(message)

    def test_existing_missing_manifest_compatibility(self):
        self.assertIsNone(self.probe(b'ERROR: manifest unknown'))

    def test_valid_manifest_digest(self):
        digest = 'sha256:' + 'a' * 64
        raw = json.dumps({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                          'config': {'digest': digest}}).encode()
        self.assertEqual(self.probe(b'', raw, 0), digest)

    def test_pull_exact_resolver_missing(self):
        message = ('Error response from daemon: failed to resolve reference "'
                   + self.target + '": ' + self.target + ': not found').encode()
        for newline in (b'', b'\n', b'\r\n'):
            with self.subTest(newline=newline):
                self.assertIsNone(self.probe(message + newline, pull=True))

    def test_pull_resolver_other_target_and_failures_rejected(self):
        def message(first, second):
            return ('Error response from daemon: failed to resolve reference "'
                    + first + '": ' + second + ': not found').encode()
        exact = message(self.target, self.target)
        errors = [message('other', self.target), message(self.target, 'other'),
                  message(self.target.upper(), self.target),
                  message(self.target, self.target.upper())]
        for error in (b'unauthorized', b'denied', b'lookup registry: no such host',
                      b'401 Unauthorized', b'403 Forbidden', b'i/o timeout'):
            errors.extend((error, error + b'\n' + exact, exact + b'\n' + error))
        for error in errors:
            with self.subTest(error=error):
                with self.assertRaisesRegex(entry.Rejected, '^COMMAND_FAILED$'):
                    self.probe(error, pull=True)

    def test_pull_optional_not_broadened(self):
        with self.assertRaisesRegex(entry.Rejected, '^COMMAND_FAILED$'):
            self.probe(b'ERROR: ' + self.target.encode() + b': not found', pull=True)


if __name__ == '__main__':
    unittest.main()
