"""Producer registry export identity, through actual metadata files and CLI seams."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'a' * 40
CONFIG = 'sha256:' + 'c' * 64
MANIFEST = 'sha256:' + 'd' * 64
SYNTHETIC = 'DUMMY_export_private_fixture_value'
ENV = {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'ACR_PASSWORD': SYNTHETIC,
       'NODE_IMAGE': 'example/node@sha256:' + 'b' * 64,
       'PYTHON_IMAGE': 'example/python@sha256:' + 'b' * 64,
       'PGVECTOR_IMAGE': 'example/postgres@sha256:' + 'b' * 64}


def module():
    spec = importlib.util.spec_from_file_location('buildkit_export_registry', ROOT / 'scripts/registry-images.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class ProducerFixture:
    def __init__(self, m, failure=None):
        self.m, self.failure, self.calls = m, failure, []
        self.metadata = None

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        status, out, error = 0, '', ''
        if args == ['git', 'rev-parse', 'HEAD']:
            out = SOURCE
        elif args[:3] == ['docker', 'manifest', 'inspect']:
            status, error = 1, 'manifest unknown'
        elif args[:3] == ['docker', 'buildx', 'build']:
            if '--load' in args:
                return subprocess.CompletedProcess(args, 0, '', '')
            self.metadata = Path(args[args.index('--metadata-file') + 1])
            assert self.metadata.parent.stat().st_mode & 0o777 == 0o700
            assert self.metadata.stat().st_mode & 0o777 == 0o600
            if self.failure == 'timeout':
                raise subprocess.TimeoutExpired(args, kwargs['timeout'], output=SYNTHETIC.encode(), stderr=b'https://upload.invalid/blob?_state=DUMMY_signed_state&Signature=DUMMY_signed_signature&AccessKeyId=DUMMY_signed_id')
            if self.failure == 'export-denied':
                return subprocess.CompletedProcess(args, 1, '', 'denied: ' + SYNTHETIC)
            value = {'containerimage.config.digest': CONFIG, 'containerimage.digest': MANIFEST,
                     'buildx.build.provenance': {'private': SYNTHETIC}, 'buildx.build.ref': SYNTHETIC}
            if self.failure == 'missing-metadata':
                self.metadata.unlink()
            elif self.failure == 'empty-metadata':
                pass
            elif self.failure == 'oversize-metadata':
                self.metadata.write_bytes(b'x' * (self.m.MAX_BUILD_METADATA_BYTES + 1))
            elif self.failure == 'symlink-metadata':
                target = self.metadata.parent / 'other.json'
                target.write_text(json.dumps(value))
                self.metadata.unlink()
                self.metadata.symlink_to(target)
            elif self.failure == 'invalid-json':
                self.metadata.write_text(SYNTHETIC)
            else:
                if self.failure == 'invalid-config':
                    value['containerimage.config.digest'] = SYNTHETIC
                if self.failure == 'invalid-manifest':
                    value['containerimage.digest'] = MANIFEST + '\n'
                if self.failure == 'missing-field':
                    value.pop('containerimage.config.digest')
                self.metadata.write_text(json.dumps(value))
        elif args[:2] == ['docker', 'push']:
            if self.failure == 'push-timeout':
                raise subprocess.TimeoutExpired(args, kwargs['timeout'])
            if self.failure != 'missing-push-digest':
                out = f'123-1: digest: {MANIFEST} size: 1234\n'
        elif args[:4] == ['docker', 'image', 'inspect', '--format']:
            out = CONFIG
        elif args[:2] == ['docker', 'pull']:
            if self.failure in ('pull-missing', 'pull-denied'):
                status, error = 1, ('manifest unknown' if self.failure == 'pull-missing' else 'denied') + ': ' + SYNTHETIC
        elif args[:3] == ['docker', 'image', 'inspect']:
            labels = {'org.opencontainers.image.revision': SOURCE, 'io.boardx.workspacex.release-tag': '123-1'}
            if self.failure == 'source':
                labels['org.opencontainers.image.revision'] = 'e' * 40
            if self.failure == 'missing-label':
                labels.pop('io.boardx.workspacex.release-tag')
            if self.failure == 'wrong-label':
                labels['io.boardx.workspacex.release-tag'] = '123-2'
            out = json.dumps([{'Os': 'windows' if self.failure == 'os' else 'linux',
                              'Architecture': 'arm64' if self.failure == 'architecture' else 'amd64',
                              'Id': 'sha256:' + 'e' * 64 if self.failure == 'config' else CONFIG,
                              'RepoDigests': ['registry.example/team/api@' + ('sha256:' + 'e' * 64 if self.failure == 'manifest' else MANIFEST)],
                              'Config': {'Labels': labels}}])
        else:
            raise AssertionError('unexpected process')
        return subprocess.CompletedProcess(args, status, out, error)


class ExportTests(unittest.TestCase):
    def execute(self, failure=None, target="devapp"):
        m = module()
        fixture = ProducerFixture(m, failure)
        stdout, stderr = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'result.json'
            error = None
            with patch.dict(os.environ, {**ENV, "TARGET_ENVIRONMENT": target}, clear=True), patch.object(m.subprocess, 'run', side_effect=fixture), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                try:
                    m.build('api', 'registry.example/team', '123-1', str(output), SOURCE)
                except Exception as caught:
                    error = caught
            row = json.loads(output.read_text()) if output.exists() else None
            self.assertNotIn(SYNTHETIC, stdout.getvalue() + stderr.getvalue() + json.dumps(row))
            if fixture.metadata:
                self.assertFalse(fixture.metadata.exists())
            return m, fixture, row, error, stdout.getvalue() + stderr.getvalue()

    def test_single_registry_export_keeps_identity_args_and_3120_cap_then_pulls_before_receipt(self):
        _, fixture, row, error, _ = self.execute()
        self.assertIsNone(error)
        self.assertEqual(row['sourceRevision'], SOURCE)
        self.assertEqual(row['imageId'], CONFIG)
        self.assertEqual(row['image'], 'registry.example/team/api@' + MANIFEST)
        commands = [args for args, _ in fixture.calls]
        builds = [(args, options) for args, options in fixture.calls if args[:3] == ['docker', 'buildx', 'build']]
        self.assertEqual(len(builds), 1)
        args, options = builds[0]
        self.assertEqual(options['timeout'], 3120)
        for expected in ('--output=type=registry,oci-mediatypes=false', '--provenance=false', '--progress=plain',
                         'SOURCE_REVISION=' + SOURCE, 'org.opencontainers.image.revision=' + SOURCE,
                         'io.boardx.workspacex.release-tag=123-1', 'NODE_IMAGE=' + ENV['NODE_IMAGE']):
            self.assertIn(expected, args)
        self.assertEqual(args[args.index('--platform') + 1], 'linux/amd64')
        self.assertNotIn('--load', args)
        self.assertNotIn('--push', args)
        self.assertFalse(any(args[:2] == ['docker', 'push'] for args in commands))
        self.assertEqual(sum(args[:2] == ['docker', 'pull'] for args in commands), 1)
        self.assertLess(commands.index(args), next(i for i, command in enumerate(commands) if command[:2] == ['docker', 'pull']))

    def test_cn_loads_then_pushes_and_verifies_registry_identity(self):
        _, fixture, row, error, _ = self.execute(target='cn')
        self.assertIsNone(error)
        commands = [args for args, _ in fixture.calls]
        self.assertEqual([args[1] for args in commands[2:]], ['buildx', 'image', 'push', 'pull', 'image'])
        self.assertIn('--load', commands[2])
        self.assertEqual(row['imageId'], CONFIG)
        self.assertEqual(row['image'], 'registry.example/team/api@' + MANIFEST)

    def test_cn_push_timeout_or_unverified_digest_has_no_receipt(self):
        for failure, code in (('push-timeout', 'PUSH_TIMEOUT_API'),
                              ('missing-push-digest', 'IMAGE_PUSH_DIGEST'),
                              ('manifest', 'IMAGE_MANIFEST_MISMATCH'),
                              ('config', 'IMAGE_CONFIG_MISMATCH')):
            with self.subTest(failure=failure):
                _, _, row, error, _ = self.execute(failure, target='cn')
                self.assertIsNone(row)
                self.assertEqual(str(error), code)

    def test_missing_empty_oversize_symlink_or_invalid_metadata_never_reads_back_or_writes_result(self):
        for failure in ('missing-metadata', 'empty-metadata', 'oversize-metadata', 'symlink-metadata',
                        'invalid-json', 'invalid-config', 'invalid-manifest', 'missing-field'):
            with self.subTest(failure=failure):
                _, fixture, row, error, _ = self.execute(failure)
                self.assertIsNone(row)
                self.assertEqual(str(error), 'BUILD_METADATA_INVALID')
                self.assertFalse(any(args[:2] == ['docker', 'pull'] for args, _ in fixture.calls))

    def test_remote_source_config_manifest_platform_and_exact_labels_must_match_before_receipt(self):
        for failure, code in (('source', 'IMAGE_SOURCE_MISMATCH'), ('config', 'IMAGE_CONFIG_MISMATCH'),
                              ('manifest', 'IMAGE_MANIFEST_MISMATCH'), ('os', 'IMAGE_PLATFORM'),
                              ('architecture', 'IMAGE_PLATFORM'), ('missing-label', 'IMAGE_BUILD_IDENTITY'),
                              ('wrong-label', 'IMAGE_BUILD_IDENTITY')):
            with self.subTest(failure=failure):
                _, _, row, error, _ = self.execute(failure)
                self.assertIsNone(row)
                self.assertEqual(str(error), code)

    def test_export_timeout_denial_or_failed_readback_has_no_retry_fallback_or_result(self):
        for failure, code in (('timeout', 'BUILD_TIMEOUT_API'), ('export-denied', 'COMMAND_FAILED_DOCKER'),
                              ('pull-missing', 'COMMAND_FAILED_DOCKER'), ('pull-denied', 'COMMAND_FAILED_DOCKER')):
            with self.subTest(failure=failure):
                _, fixture, row, error, logs = self.execute(failure)
                self.assertIsNone(row)
                self.assertEqual(str(error), code)
                self.assertEqual(sum(args[:3] == ['docker', 'buildx', 'build'] for args, _ in fixture.calls), 1)
                self.assertFalse(any(args[:2] == ['docker', 'push'] for args, _ in fixture.calls))
                exports = [options for args, options in fixture.calls if args[:3] == ['docker', 'buildx', 'build']]
                self.assertEqual(exports[0]['timeout'], 3120)
                if failure == 'timeout':
                    self.assertFalse(any(args[:2] == ['docker', 'pull'] for args, _ in fixture.calls))
                for private in ('DUMMY_signed_state', 'DUMMY_signed_signature', 'DUMMY_signed_id'):
                    self.assertNotIn(private, logs)

    def test_all_signed_url_query_keys_are_removed_before_truncation_and_headers_stay_redacted(self):
        m = module()
        raw = ('https://user:pass@upload.invalid/blob?_state=DUMMY_state&Signature=DUMMY_signature&AccessKeyId=DUMMY_id&novel=DUMMY_unknown\n'
               'HTTPS://user:pass@upload.invalid/blob?Signature=DUMMY_uppercase\n'
               '/v2/api/blobs/uploads/?token=DUMMY_relative\n?password=DUMMY_fragment\n'
               '/v2/upload?Signature=DUMMY_relative_signature&_state=DUMMY_relative_state&AccessKeyId=DUMMY_relative_id\n'
               'Authorization: Bearer DUMMY_header\n' + ('\n' * 110))
        safe = m.safe_diagnostics(raw)
        visible = m.safe_diagnostics(raw.rstrip())
        for private in ('user:pass', 'DUMMY_state', 'DUMMY_signature', 'DUMMY_id', 'DUMMY_unknown', 'DUMMY_header',
                        'DUMMY_uppercase', 'DUMMY_relative', 'DUMMY_fragment', 'DUMMY_relative_signature',
                        'DUMMY_relative_state', 'DUMMY_relative_id'):
            self.assertNotIn(private, safe + visible)
        self.assertIn('upload.invalid/blob?[redacted]', visible)


if __name__ == '__main__':
    unittest.main()
