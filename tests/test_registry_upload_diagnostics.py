"""Safe command-boundary diagnostics; no Docker, credentials or network required."""
import contextlib
from hashlib import sha256
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TAG = '44000938132-90000000000000000001'
SYNTHETIC = 'DUMMY_private_diagnostic_payload_https://invalid.invalid/?token=synthetic'
IMAGE = 'sha256:' + 'a' * 64
ENV = {'REGISTRY_PREFIX': 'registry.example/team', 'DOCKER_CONFIG': '/tmp/managed-dummy-docker',
       'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_ACTIONS': 'true',
       'RUNNER_ENVIRONMENT': 'github-hosted', 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_SHA': 'f' * 40}


def module():
    spec = importlib.util.spec_from_file_location('upload_diagnostic', ROOT / 'scripts/registry-upload-diagnostics.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def manifest():
    def descriptor(kind, char, size):
        return {'mediaType': kind, 'digest': 'sha256:' + char * 64, 'size': size,
                'urls': [SYNTHETIC], 'annotations': {'private': SYNTHETIC}}
    return {'Ref': SYNTHETIC,
            'Descriptor': descriptor('application/vnd.docker.distribution.manifest.v2+json', 'b', 500),
            'SchemaV2Manifest': {'schemaVersion': 2,
                'config': descriptor('application/vnd.docker.container.image.v1+json', 'c', 100),
                'layers': [descriptor('application/vnd.docker.image.rootfs.diff.tar.gzip', 'd', 33555000)]}}


class DockerFixture:
    def __init__(self, m, *, failure=None):
        self.m, self.failure, self.calls = m, failure, []
        self.removed, self.pulled = False, False
        self.temp_path = None

    def __call__(self, args, timeout, progress=None):
        self.calls.append((args, timeout))
        if args[0] == 'version':
            return 0, SYNTHETIC if self.failure == 'version' else '28.5.1\n'
        if args[:3] == ['manifest', 'inspect', '--verbose']:
            if ':acr-probe-' in args[-1]:
                return (0, json.dumps(manifest())) if self.failure == 'existing-probe' else (1, 'no such manifest: ' + SYNTHETIC)
            if self.failure == 'metadata-timeout':
                raise self.m.DiagnosticError('COMMAND_TIMEOUT')
            if self.failure == 'metadata-denied':
                return 1, 'denied: ' + SYNTHETIC
            if self.failure == 'metadata-missing':
                return 1, 'manifest unknown: ' + SYNTHETIC
            return 0, json.dumps(manifest())
        if args[0] == 'build':
            self.temp_path = Path(args[-1])
            assert sorted(p.name for p in self.temp_path.iterdir()) == ['Dockerfile', 'payload']
            assert (self.temp_path / 'Dockerfile').read_text() == 'FROM scratch\nCOPY payload /payload\n'
            assert (self.temp_path / 'payload').stat().st_size == 32 * 1024 * 1024
            assert args[1] == '--network=none' and args[2] == '--tag'
            return 0, SYNTHETIC
        if args[:3] == ['image', 'rm', '--force']:
            self.removed = True
            return 0, SYNTHETIC
        if args[:2] == ['image', 'inspect']:
            if self.removed and not self.pulled:
                return (1, 'permission denied: ' + SYNTHETIC) if self.failure == 'remove-check' else (1, 'No such image: ' + SYNTHETIC)
            return 0, ('sha256:' + 'e' * 64 if self.failure == 'mismatch' and self.pulled else IMAGE)
        if args[0] in ('push', 'pull'):
            if args[0] == 'pull':
                assert self.removed
                self.pulled = True
            progress(SYNTHETIC, 0.1)
            progress('d' * 12 + ': ' + ('Pushed' if args[0] == 'push' else 'Pull complete') + ' ' + SYNTHETIC, 0.2)
            if self.failure == args[0] + '-timeout':
                raise self.m.DiagnosticError('COMMAND_TIMEOUT')
            return (1 if self.failure == 'push-error' else 0), SYNTHETIC
        raise AssertionError('unexpected command')


class BuildkitFixture(DockerFixture):
    def __init__(self, m, *, failure=None):
        super().__init__(m, failure=failure)
        config = json.dumps({'architecture': 'amd64', 'os': 'linux', 'rootfs': {'type': 'layers', 'diff_ids': ['sha256:' + 'd' * 64]}}, sort_keys=True).encode()
        self.config_id = 'sha256:' + sha256(config).hexdigest()
        value = manifest()
        value['SchemaV2Manifest']['config'].update(digest=self.config_id, size=len(config))
        body = json.dumps(value['SchemaV2Manifest'], sort_keys=True, separators=(',', ':')).encode()
        self.manifest_id = 'sha256:' + sha256(body).hexdigest()
        value['Descriptor'].update(digest=self.manifest_id, size=len(body))
        self.remote_manifest = value
        self.uploaded = False
        self.local = False
        self.metadata_path = None

    def __call__(self, args, timeout, progress=None):
        if args[:3] == ['manifest', 'inspect', '--verbose'] and ':acr-probe-' in args[-1] and self.uploaded:
            self.calls.append((args, timeout))
            value = json.loads(json.dumps(self.remote_manifest))
            if self.failure == 'manifest-mismatch':
                value['Descriptor']['digest'] = 'sha256:' + 'e' * 64
            if self.failure == 'config-mismatch':
                value['SchemaV2Manifest']['config']['digest'] = 'sha256:' + 'e' * 64
            return 0, json.dumps(value)
        if args[:2] == ['buildx', 'build']:
            self.calls.append((args, timeout))
            self.temp_path = Path(args[-1])
            assert sorted(p.name for p in self.temp_path.iterdir()) == ['Dockerfile', 'payload']
            assert (self.temp_path / 'payload').stat().st_size == 32 * 1024 * 1024
            assert '--platform' in args and args[args.index('--platform') + 1] == 'linux/amd64'
            assert '--network=none' in args and '--provenance=false' in args and '--progress=plain' in args
            assert '--output=type=registry,oci-mediatypes=false' in args
            assert '--load' not in args and '--push' not in args
            self.metadata_path = Path(args[args.index('--metadata-file') + 1])
            assert self.metadata_path.parent.stat().st_mode & 0o777 == 0o700
            assert self.metadata_path.stat().st_mode & 0o777 == 0o600
            if self.failure == 'buildkit-timeout':
                raise self.m.DiagnosticError('COMMAND_TIMEOUT')
            self.uploaded = True
            self.local = self.failure == 'driver-loaded'
            value = {'containerimage.config.digest': self.config_id, 'containerimage.digest': self.manifest_id,
                     'buildx.build.provenance': {'private': SYNTHETIC}, 'buildx.build.ref': SYNTHETIC}
            if self.failure == 'metadata-digest':
                value['containerimage.digest'] = SYNTHETIC
            if self.failure != 'metadata-missing':
                self.metadata_path.write_text(SYNTHETIC if self.failure == 'metadata-json' else json.dumps(value))
            return 0, SYNTHETIC
        if args[:2] == ['image', 'inspect']:
            self.calls.append((args, timeout))
            if self.failure == 'preexisting-local' or self.local or self.pulled:
                return 0, 'sha256:' + 'e' * 64 if self.failure == 'mismatch' and self.pulled else self.config_id
            return 1, 'No such image: ' + SYNTHETIC
        if args[:3] == ['image', 'rm', '--force']:
            self.calls.append((args, timeout))
            self.local = False
            return 0, SYNTHETIC
        if args[0] == 'pull':
            self.calls.append((args, timeout))
            assert not self.local
            assert args[-1] == ENV['REGISTRY_PREFIX'] + '/api@' + self.manifest_id
            self.pulled = True
            progress('d' * 12 + ': Pull complete', 0.2)
            return 0, SYNTHETIC
        return super().__call__(args, timeout, progress)


class DiagnosticTests(unittest.TestCase):
    def execute(self, *, failure=None, extra=None, tag=TAG, size=32, transport='docker'):
        m = module()
        fixture = (BuildkitFixture if transport == 'buildkit' else DockerFixture)(m, failure=failure)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'result.json'
            log = io.StringIO()
            with patch.dict(os.environ, {**ENV, **(extra or {})}, clear=True), patch.object(m, 'command', side_effect=fixture), contextlib.redirect_stdout(log):
                result = m.diagnose(tag, size, str(output), transport)
            report = json.loads(output.read_text())
            self.assertNotIn(SYNTHETIC, output.read_text() + log.getvalue())
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            return result, report, fixture, log.getvalue()

    def test_invalid_inputs_refuse_before_any_cli_and_preserve_safe_failure_receipt(self):
        for options in ({'tag': 'latest'}, {'tag': TAG + '\n'}, {'size': 31}, {'size': True},
                        {'extra': {'REGISTRY_PREFIX': 'https://invalid.invalid/team'}},
                        {'extra': {'REGISTRY_PREFIX': 'registry-vpc.invalid/team'}},
                        {'extra': {'DOCKER_CONFIG': ''}}, {'extra': {'GITHUB_RUN_ID': '$(id)'}},
                        {'transport': SYNTHETIC}):
            with self.subTest(options=list(options)):
                result, report, fixture, _ = self.execute(**options)
                self.assertEqual(result, 1)
                self.assertEqual(report['status'], 'failed')
                self.assertEqual(fixture.calls, [])

    def test_buildkit_registry_export_reads_actual_metadata_and_pulls_exact_manifest_without_daemon_push(self):
        result, report, fixture, _ = self.execute(transport='buildkit')
        self.assertEqual(result, 0)
        self.assertEqual(report['transport'], 'buildkit')
        self.assertEqual(report['probeTag'], 'acr-probe-123-1-sized-buildkit')
        self.assertEqual(report['imageIdBefore'], fixture.config_id)
        self.assertEqual(report['imageIdAfter'], fixture.config_id)
        self.assertEqual(report['expectedManifestDigest'], fixture.manifest_id)
        self.assertTrue(report['localTagAndIdAbsentBeforePull'])
        self.assertEqual(report['buildkitPush']['status'], 'completed')
        self.assertEqual([timeout for args, timeout in fixture.calls if args[:2] == ['buildx', 'build']], [180])
        self.assertFalse(any(args[0] in ('push', 'build') or args[:2] == ['image', 'rm'] for args, _ in fixture.calls))
        self.assertFalse(fixture.metadata_path.exists())
        before_build = next(i for i, (args, _) in enumerate(fixture.calls) if args[:2] == ['buildx', 'build'])
        self.assertEqual(fixture.calls[before_build - 1][0][:2], ['image', 'inspect'])

    def test_buildkit_matching_local_driver_output_removed_only_when_present(self):
        result, report, fixture, _ = self.execute(transport='buildkit', failure='driver-loaded')
        self.assertEqual(result, 0)
        removals = [args for args, _ in fixture.calls if args[:2] == ['image', 'rm']]
        self.assertEqual(len(removals), 1)
        self.assertEqual(removals[0][-1], ENV['REGISTRY_PREFIX'] + '/api:acr-probe-123-1-sized-buildkit')
        self.assertTrue(report['localTagAndIdAbsentBeforePull'])

    def test_buildkit_failures_never_fall_back_or_accept_missing_or_mismatched_evidence(self):
        for failure, code in (('buildkit-timeout', 'BUILDKIT_PUSH_TIMEOUT'),
                              ('metadata-missing', 'BUILDKIT_METADATA_FILE_INVALID'),
                              ('metadata-json', 'BUILDKIT_METADATA_INVALID'), ('metadata-digest', 'BUILDKIT_METADATA_INVALID'),
                              ('manifest-mismatch', 'PROBE_MANIFEST_DIGEST_MISMATCH'),
                              ('config-mismatch', 'PROBE_CONFIG_DIGEST_MISMATCH'),
                              ('mismatch', 'PULLED_IMAGE_ID_MISMATCH'), ('preexisting-local', 'LOCAL_IMAGE_NOT_REMOVED')):
            with self.subTest(failure=failure):
                result, report, fixture, _ = self.execute(transport='buildkit', failure=failure)
                self.assertEqual(result, 1)
                self.assertEqual(report['errorCode'], code)
                self.assertFalse(any(args[0] in ('push', 'build') for args, _ in fixture.calls))
                self.assertLessEqual(sum(args[:2] == ['buildx', 'build'] for args, _ in fixture.calls), 1)

    def test_buildkit_keeps_source_and_host_guards_before_cli(self):
        for name, value in (('GITHUB_SHA', 'main'), ('GITHUB_ACTIONS', ''), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                            ('GITHUB_EVENT_NAME', 'push'), ('DOCKER_HOST', SYNTHETIC), ('DOCKER_TLS_VERIFY', '1')):
            result, report, fixture, _ = self.execute(transport='buildkit', extra={name: value})
            self.assertEqual(result, 1)
            self.assertEqual(fixture.calls, [])
            self.assertEqual(report['status'], 'failed')

    def test_unmanaged_job_and_docker_endpoint_overrides_refuse_before_cli(self):
        for name, value in (('GITHUB_ACTIONS', ''), ('RUNNER_ENVIRONMENT', 'self-hosted'),
                            ('GITHUB_EVENT_NAME', 'push'), ('GITHUB_SHA', 'main'),
                            ('DOCKER_HOST', SYNTHETIC), ('DOCKER_CONTEXT', SYNTHETIC),
                            ('DOCKER_TLS', '1'), ('DOCKER_TLS_VERIFY', '1'), ('DOCKER_CERT_PATH', SYNTHETIC)):
            with self.subTest(name=name):
                result, report, fixture, _ = self.execute(extra={name: value})
                self.assertEqual(result, 1)
                self.assertEqual(report['status'], 'failed')
                self.assertEqual(fixture.calls, [])

    def test_invalid_cli_never_echoes_argument_text_or_executes_docker(self):
        m = module()
        with patch.object(m, 'command') as command, contextlib.redirect_stdout(io.StringIO()) as log, contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(m.main(['--payload-mib', SYNTHETIC, '--output', SYNTHETIC]), 2)
        command.assert_not_called()
        self.assertNotIn(SYNTHETIC, log.getvalue() + errors.getvalue())
        self.assertEqual(json.loads(log.getvalue()), {'errorCode': 'ARGUMENTS_INVALID'})

    def test_existing_output_is_not_overwritten_and_no_cli(self):
        m = module()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'receipt.json'
            output.write_text('original')
            with patch.object(m, 'command') as command, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.diagnose(TAG, 32, str(output)), 1)
            command.assert_not_called()
            self.assertEqual(output.read_text(), 'original')

    def test_random_sized_scratch_push_remove_both_local_references_then_pull_and_exact_id(self):
        result, report, fixture, logged = self.execute()
        self.assertEqual(result, 0)
        self.assertEqual(report['status'], 'succeeded')
        self.assertEqual(report['payloadBytes'], 32 * 1024 * 1024)
        self.assertEqual(report['imageIdBefore'], report['imageIdAfter'])
        self.assertTrue(report['localTagAndIdAbsentBeforePull'])
        self.assertTrue(report['pullMayReuseLayerCache'])
        self.assertEqual(report['dockerServerVersion'], '28.5.1')
        self.assertEqual(report['diagnosticCodeRevision'], ENV['GITHUB_SHA'])
        self.assertEqual(set(report['metadata']), set(module().registry.SERVICES))
        self.assertFalse(fixture.temp_path.exists())
        commands = [args for args, _ in fixture.calls]
        push = next(i for i, args in enumerate(commands) if args[0] == 'push')
        pull = next(i for i, args in enumerate(commands) if args[0] == 'pull')
        self.assertEqual(commands[push + 1][:3], ['image', 'rm', '--force'])
        self.assertEqual(commands[pull - 1][-1], IMAGE)
        self.assertIn(':acr-probe-123-1-sized', commands[push][-1])
        self.assertEqual([timeout for args, timeout in fixture.calls if args[0] in ('push', 'pull')], [180, 180])
        self.assertEqual([timeout for args, timeout in fixture.calls if args[0] == 'manifest'], [30] * 6)
        for row in map(json.loads, logged.splitlines()):
            self.assertTrue(set(row) <= {'stage', 'layerId', 'status', 'elapsed'})

    def test_present_descriptors_and_missing_original_manifests_are_distinct(self):
        result, report, _, _ = self.execute(failure='metadata-missing')
        self.assertEqual(result, 0)
        self.assertTrue(all(row == {'status': 'missing', 'descriptors': []} for row in report['metadata'].values()))
        descriptors = module().manifest_metadata(json.dumps(manifest()))
        self.assertEqual([d['kind'] for d in descriptors], ['manifest', 'config', 'layer'])
        self.assertTrue(all(set(d) == {'kind', 'digest', 'size'} for d in descriptors))

    def test_unknown_manifest_shapes_sizes_and_media_fail_closed(self):
        m = module()
        for raw in ('not JSON ' + SYNTHETIC, '{}', '[]'):
            with self.assertRaises(m.DiagnosticError):
                m.manifest_metadata(raw)
        for key, value in (('size', True), ('size', -1), ('digest', SYNTHETIC), ('mediaType', SYNTHETIC)):
            data = manifest()
            data['Descriptor'][key] = value
            with self.assertRaises(m.DiagnosticError):
                m.manifest_metadata(json.dumps(data))

    def test_mixed_missing_with_auth_or_transport_failure_is_never_absence(self):
        m = module()
        for marker in ('unauthorized', 'denied', 'forbidden', 'TLS handshake', 'x509',
                       'certificate', 'timeout', 'connection reset', 'unexpected EOF',
                       'proxy failure', 'no such host', 'network unreachable', 'dial tcp'):
            with self.subTest(marker=marker), patch.object(m, 'command', return_value=(1, 'no such manifest\n' + marker + ' ' + SYNTHETIC)), contextlib.redirect_stdout(io.StringIO()) as log:
                self.assertEqual(m.inspect_manifest('unused'), {'status': 'error', 'errorCode': 'MANIFEST_INSPECT_FAILED'})
                self.assertEqual(log.getvalue(), '')

    def test_all_five_metadata_attempted_but_timeout_or_denial_never_reaches_build(self):
        for failure in ('metadata-timeout', 'metadata-denied'):
            result, report, fixture, _ = self.execute(failure=failure)
            self.assertEqual(result, 1)
            self.assertEqual(report['errorCode'], 'METADATA_INCOMPLETE')
            self.assertEqual(len(report['metadata']), 5)
            self.assertFalse(any(args[0] in ('build', 'push', 'pull') for args, _ in fixture.calls))

    def test_push_timeout_retains_partial_safe_progress_without_retry_or_pull(self):
        result, report, fixture, _ = self.execute(failure='push-timeout')
        self.assertEqual(result, 1)
        self.assertEqual(report['errorCode'], 'PUSH_TIMEOUT')
        self.assertEqual(report['push']['completedCount'], 1)
        self.assertEqual(sum(args[0] == 'push' for args, _ in fixture.calls), 1)
        self.assertFalse(any(args[0] == 'pull' for args, _ in fixture.calls))

    def test_existing_probe_bad_server_version_remove_failure_and_mismatched_pull_fail(self):
        for failure, code in (('existing-probe', 'PROBE_TAG_NOT_CONFIRMED_ABSENT'),
                              ('version', 'SERVER_VERSION_INVALID'), ('remove-check', 'LOCAL_IMAGE_NOT_REMOVED'),
                              ('mismatch', 'PULLED_IMAGE_ID_MISMATCH'), ('pull-timeout', 'PULL_TIMEOUT'),
                              ('push-error', 'PUSH_FAILED')):
            with self.subTest(failure=failure):
                result, report, _, _ = self.execute(failure=failure)
                self.assertEqual(result, 1)
                self.assertEqual(report['errorCode'], code)

    def test_real_pipe_reader_bounds_unknown_output_and_kills_on_deadline(self):
        m = module()
        real_popen = subprocess.Popen
        for child, limit, timeout, code in (("print('x'*100)", 16, 2, 'COMMAND_OUTPUT_LIMIT'),
                                           ('import time; time.sleep(5)', m.MAX_OUTPUT, 0.03, 'COMMAND_TIMEOUT')):
            def child_process(_args, **kwargs):
                return real_popen([sys.executable, '-c', child], **kwargs)
            with patch.object(m.subprocess, 'Popen', side_effect=child_process), patch.object(m, 'MAX_OUTPUT', limit), contextlib.redirect_stdout(io.StringIO()) as log:
                with self.assertRaisesRegex(m.DiagnosticError, code):
                    m.command(['push', 'dummy'], timeout)
                self.assertEqual(log.getvalue(), '')

    def test_overall_deadline_clamps_stage_budget_and_saves_safe_partial_receipt(self):
        m = module()
        fixture = DockerFixture(m)
        clock = [1000.0]
        actual_push_budget = []

        def timed(args, timeout, progress=None):
            result = fixture(args, timeout, progress)
            duration = 29 if args[0] == 'manifest' or args[:2] == ['image', 'inspect'] else 59 if args[0] == 'build' else 179 if args[0] == 'push' else 0
            if args[0] == 'push':
                actual_push_budget.append(timeout)
            clock[0] += min(duration, timeout)
            if duration >= timeout:
                raise m.DiagnosticError('COMMAND_TIMEOUT')
            return result

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'result.json'
            with patch.dict(os.environ, ENV, clear=True), patch.object(m, 'command', side_effect=timed), patch.object(m.time, 'monotonic', side_effect=lambda: clock[0]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(m.diagnose(TAG, 32, str(output)), 1)
            report = json.loads(output.read_text())
        self.assertEqual(actual_push_budget, [158.0])
        self.assertEqual(report['errorCode'], 'DIAGNOSTIC_DEADLINE')
        self.assertEqual(report['push']['completedCount'], 1)
        self.assertFalse(any(args[0] == 'pull' for args, _ in fixture.calls))
        self.assertEqual(clock[0], 1420.0)
        self.assertIsNone(m._DEADLINE.get())


if __name__ == '__main__':
    unittest.main()
