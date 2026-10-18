"""Real harmless durable-entry processes; all host/prod authority remains fixture-only."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
import test_cn_release_entry as native

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('closure', ROOT/'scripts/cn-release-evidence-closure.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class ClosureTests(unittest.TestCase):
    def setUp(self):
        self.case = native.EntryTests(methodName='test_verifier_cannot_complete_normal_release_after_original_deadline')
        self.case.setUp(); self.addCleanup(self.case.doCleanups)
        def fixture_directory(path):
            self.assertTrue(path == self.case.root or self.case.root in path.parents)
            self.assertTrue(path.is_dir())
            self.assertEqual(path.stat().st_uid, os.getuid())
            self.assertFalse(path.stat().st_mode & 0o022)
        p = patch.object(native.e, 'directory', fixture_directory); p.start(); self.addCleanup(p.stop)
        self.request = self.case.package()
        self.result = self.case.advance(self.request)
        self.root = self.case.state/'test-one'
        self.package = self.case.requests/self.request
        self.identity = json.loads((self.root/'identity.json').read_text())

    def inspect(self):
        return c.inspect(self.root, self.case.requests, github_accepted_at=self.identity['requestedAt'],
                         user_requested_at=self.identity['requestedAt'])

    def mutate(self, path, **values):
        obj = json.loads(path.read_text()); obj.update(values); path.write_bytes(native.e.encode(obj))

    def test_actual_original_closure_and_no_reexecution(self):
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('no child permitted')):
            value = self.inspect()
        self.assertEqual(len(value['files']), 13)
        self.assertTrue(value['originalBytesLinked'])
        self.assertFalse(value['completeTransportSnapshot'])
        self.assertFalse(value['sourceAuthorityVerified'])
        self.assertFalse(value['productionAccepted'])
        self.assertEqual(value['stages'][0]['originalCommandExitCode'], 0)
        self.assertEqual(len(value['missingProductionEvidence']), 7)

    def test_all_seventeen_original_stages_still_not_production_acceptance(self):
        previous = self.result['receiptSha256']
        for stage in native.e.STAGES[1:]:
            request = self.case.package(stage=stage, previous=previous)
            previous = self.case.advance(request)['receiptSha256']
        value = self.inspect()
        self.assertTrue(value['completeTransportSnapshot'])
        self.assertEqual(len(value['stages']), 17)
        self.assertEqual(len(value['files']), 205)
        self.assertFalse(value['thirtyMinuteProductionProven'])
        self.assertFalse(value['cloudTerminalityVerified'])
        self.assertFalse(value['productionAccepted'])

    def test_changed_package_code_is_rejected_never_run(self):
        for name in ['action.sh', 'observe.sh', 'verify.py', 'authorization.json']:
            path = self.package/name; raw = path.read_bytes(); path.write_bytes(raw+b'changed')
            with self.subTest(name=name), self.assertRaisesRegex(c.m.Rejected, 'PACKAGE_BYTES_CHANGED'):
                self.inspect()
            path.write_bytes(raw)

    def test_original_manifest_hash_is_required(self):
        self.mutate(self.package/'manifest.json', sourceRevision='f'*40)
        with self.assertRaisesRegex(c.m.Rejected, 'MANIFEST_HASH_CHANGED'): self.inspect()

    def test_missing_process_or_terminal_fails_closed(self):
        for suffix in ['process', 'terminal']:
            path = self.root/('00-consume.'+suffix+'.json'); raw = path.read_bytes(); path.unlink()
            with self.subTest(suffix=suffix), self.assertRaises(FileNotFoundError): self.inspect()
            path.write_bytes(raw)

    def test_wrong_process_request_rejected(self):
        self.mutate(self.root/'00-consume.process.json', requestSha256='f'*64)
        with self.assertRaisesRegex(c.m.Rejected, 'PROCESS_REQUEST_DRIFT'): self.inspect()

    def test_exit_code_unknown_skipped_and_remaining_group_rejected(self):
        path = self.root/'00-consume.terminal.json'; raw = path.read_bytes()
        for values in [dict(exitCode=None), dict(exitCode=1), dict(exitCode=False),
                       dict(reason='SKIPPED'), dict(reason='UNKNOWN'), dict(processGroupStillPresent=True)]:
            with self.subTest(values=values):
                path.write_bytes(raw); self.mutate(path, **values)
                with self.assertRaises(c.m.Rejected): self.inspect()

    def test_terminal_clock_and_stdout_binding(self):
        path = self.root/'00-consume.terminal.json'; raw = path.read_bytes()
        for values in [dict(finishedAt='2000-01-01T00:00:00Z'), dict(stdoutSha256='f'*64)]:
            path.write_bytes(raw); self.mutate(path, **values)
            with self.assertRaises(c.m.Rejected): self.inspect()

    def test_empty_proof_and_symlink_package_rejected(self):
        path = self.root/'00-consume.process.json'; raw = path.read_bytes(); path.write_bytes(b'{}')
        with self.assertRaisesRegex(c.m.Rejected, 'EMPTY_OR_NON_OBJECT_EVIDENCE'): self.inspect()
        path.write_bytes(raw)
        manifest = self.package/'manifest.json'; other = self.package/'other'; manifest.rename(other); manifest.symlink_to(other)
        with self.assertRaises(OSError): self.inspect()

    def test_second_read_detects_snapshot_change(self):
        original = c.m.read; count = 0
        def changing(root, name):
            nonlocal count
            if root == self.root and name == 'identity.json':
                count += 1
                if count == 3:
                    return original(root, name)+b' '
            return original(root, name)
        with patch.object(c.m, 'read', changing), self.assertRaisesRegex(c.m.Rejected, 'SNAPSHOT_CHANGED'):
            self.inspect()

    def test_empty_snapshot_is_not_a_closure(self):
        for path in self.root.iterdir():
            if path.name != 'identity.json': path.unlink()
        with self.assertRaisesRegex(c.m.Rejected, 'NO_ORIGINAL_STAGE_EVIDENCE'): self.inspect()

    def test_cli_error_is_bounded_and_cannot_admit(self):
        result = subprocess.run([sys.executable, '-B', str(ROOT/'scripts/cn-release-evidence-closure.py'),
                                 '--attempt-dir', str(self.root), '--packages-dir', '/missing',
                                 '--github-accepted-at', self.identity['requestedAt'],
                                 '--user-requested-at', self.identity['requestedAt']], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)['error'], 'CLOSURE_REJECTED')
        self.assertEqual(result.stderr, '')


if __name__ == '__main__':
    unittest.main()
