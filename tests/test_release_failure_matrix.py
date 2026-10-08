"""Independent failure injection; fake process boundary, no cloud operations."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from test_hosted_release import HostBoundary, fixture, h


class UploadBoundary(HostBoundary):
    def __init__(self, plan, failures, committed=False, fatal=False, conflict=False):
        super().__init__(plan)
        self.failures = failures
        self.committed = committed
        self.fatal = fatal
        self.conflict = conflict
        self.pushes = 0

    def __call__(self, argv, **kwargs):
        result = super().__call__(argv, **kwargs)
        if argv[:2] == ['docker', 'push']:
            self.pushes += 1
            if self.pushes <= self.failures:
                return subprocess.CompletedProcess(argv, 1, '', 'denied' if self.fatal else 'connection reset synthetic-secret')
        if argv[:2] == ['docker', 'pull'] and self.pushes and self.pushes <= self.failures:
            if not self.committed and not self.conflict:
                return subprocess.CompletedProcess(argv, 1, '', 'manifest unknown')
        if argv[:3] == ['docker', 'image', 'inspect'] and self.conflict:
            value = json.loads(result.stdout)
            value[0]['Config']['Labels']['org.opencontainers.image.revision'] = 'f' * 40
            return subprocess.CompletedProcess(argv, 0, json.dumps(value), '')
        return result


class ReleaseFailureMatrix(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.output = Path(self.tmp.name) / 'result.json'
        self.plan = h.validate_input(fixture())
        self.plan['_planSha256'] = 'd' * 64

    def run_build(self, boundary):
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), patch.object(h.subprocess, 'run', side_effect=boundary), patch.object(h.time, 'sleep') as sleeper:
            h.build(self.plan, 'api', self.output)
            return sleeper.call_args_list

    def test_lost_push_response_after_commit_reads_back_without_second_push(self):
        boundary = UploadBoundary(self.plan, 1, committed=True)
        sleeps = self.run_build(boundary)
        self.assertEqual(boundary.pushes, 1)
        self.assertEqual(sleeps, [])
        self.assertTrue(self.output.exists())
        self.assertNotIn('synthetic-secret', self.output.read_text())

    def test_transient_upload_interruption_retries_then_verifies(self):
        boundary = UploadBoundary(self.plan, 2)
        sleeps = self.run_build(boundary)
        self.assertEqual(boundary.pushes, 3)
        self.assertEqual([v.args[0] for v in sleeps], [2, 4])
        self.assertTrue(self.output.exists())

    def test_upload_retry_exhaustion_publishes_no_result(self):
        boundary = UploadBoundary(self.plan, 10)
        with self.assertRaisesRegex(ValueError, 'REGISTRY_PUSH_FAILED'):
            self.run_build(boundary)
        self.assertEqual(boundary.pushes, 4)
        self.assertFalse(self.output.exists())

    def test_auth_denial_is_not_retried_or_recorded_as_success(self):
        boundary = UploadBoundary(self.plan, 10, fatal=True)
        with self.assertRaisesRegex(ValueError, 'REGISTRY_PUSH_FAILED'):
            self.run_build(boundary)
        self.assertEqual(boundary.pushes, 1)
        self.assertFalse(self.output.exists())

    def test_concurrent_foreign_image_on_lost_response_stops_before_retry(self):
        boundary = UploadBoundary(self.plan, 1, conflict=True)
        with self.assertRaisesRegex(ValueError, 'IMAGE_REVISION_MISMATCH'):
            self.run_build(boundary)
        self.assertEqual(boundary.pushes, 1)
        self.assertFalse(self.output.exists())

    def test_duplicate_result_path_never_overwrites_prior_evidence(self):
        self.output.write_text('prior-evidence')
        with self.assertRaises(FileExistsError):
            self.run_build(UploadBoundary(self.plan, 0))
        self.assertEqual(self.output.read_text(), 'prior-evidence')

    def test_cloud_identity_never_inherited_by_build_children_or_receipt(self):
        identity = {
            'ALIBABA_CLOUD_ACCESS_KEY_ID': 'synthetic-id',
            'ALIBABA_CLOUD_ACCESS_KEY_SECRET': 'synthetic-sts-secret',
            'ALIBABA_CLOUD_SECURITY_TOKEN': 'synthetic-sts-token',
            'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'synthetic-oidc-token',
            'GH_TOKEN': 'synthetic-github-token',
        }
        boundary = UploadBoundary(self.plan, 0)
        with patch.dict(h.os.environ, identity):
            self.run_build(boundary)
        for argv, kwargs in boundary.calls:
            for name in identity:
                self.assertNotIn(name, kwargs.get('env', {}), (argv, name))
        self.assertNotIn('synthetic-', self.output.read_text())

    def test_workflow_pushes_cannot_activate_production(self):
        root = Path(__file__).resolve().parents[1]
        for name in ('release-cn.yml', 'build-cn-release-artifacts.yml'):
            value = (root / '.github/workflows' / name).read_text()
            triggers = value.split('\non:', 1)[1].split('\npermissions:', 1)[0]
            self.assertNotRegex(triggers, r'(?m)^  (push|pull_request|schedule|workflow_run):')
        release = (root / '.github/workflows/release-cn.yml').read_text()
        self.assertIn('default: artifact-only', release)
        self.assertIn("if: inputs.mode == 'full-release'", release)
        self.assertIn('[[ "$GITHUB_REF" == refs/heads/main ]]', release)
        self.assertIn('workspacex-cn-import-hosted-artifacts', release)

    def test_build_attempts_keep_serialization_without_canceling_active_upload(self):
        root = Path(__file__).resolve().parents[1]
        value = (root / '.github/workflows/build-cn-release-artifacts.yml').read_text()
        self.assertIn('group: hosted-cn-artifacts-${{ inputs.release_sha }}', value)
        self.assertIn('cancel-in-progress: false', value)


if __name__ == '__main__':
    unittest.main()
