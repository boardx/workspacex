"""Execute workflow Bash with isolated command sentinels; no cloud/host calls."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/prepare-cn-release.yml'
SHA = 'a' * 40
BASELINE = 'b' * 40


def privileged_steps(source):
    steps = []
    for block in source.split('      - name: ')[1:]:
        if '        run: |\n' not in block:
            continue
        body = block.split('        run: |\n', 1)[1]
        script = '\n'.join(line[10:] for line in body.splitlines() if line.startswith('          ')) + '\n'
        if 'sudo -n ' in script:
            steps.append(script)
    return steps


class ManualPrepareGate(unittest.TestCase):
    def setUp(self):
        self.source = WORKFLOW.read_text()
        self.steps = privileged_steps(self.source)
        self.assertEqual(len(self.steps), 2)

    def invoke(self, script, event, ref, sha=SHA):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trace = root / 'trace'
            for command in ('sudo', 'gh', 'git', 'find', 'node'):
                stub = root / command
                stub.write_text('#!/bin/bash\nprintf "%s\\n" "' + command + ' $*" >> "$TRACE"\n' +
                                (f'printf "%s\\n" "{BASELINE}"\n' if command in ('gh', 'git') else 'exit 77\n'))
                stub.chmod(0o755)
            # Minimal fresh environment: no inherited cloud/GitHub credentials.
            env = dict(PATH=str(root) + ':/usr/bin:/bin', TRACE=str(trace),
                       INPUT_SHA=sha, INPUT_RELEASE='2026.10.8-cn.1',
                       GITHUB_REPOSITORY='boardx/workspacex', GITHUB_WORKSPACE=directory,
                       GITHUB_RUN_ID='1', GITHUB_RUN_ATTEMPT='1')
            if event is not None:
                env['EVENT_NAME'] = event
            if ref is not None:
                env['GITHUB_REF'] = ref
            result = subprocess.run(['/bin/bash', '-c', script], env=env, cwd=directory,
                                    text=True, capture_output=True, timeout=5)
            return result, trace.read_text() if trace.exists() else ''

    def test_only_dispatch_trigger_and_main_job_admission(self):
        triggers = self.source.split('\non:\n', 1)[1].split('\npermissions:', 1)[0]
        self.assertEqual(re.findall(r'^  ([a-z_]+):', triggers, re.M), ['workflow_dispatch'])
        job = self.source.split('  build-candidate:\n', 1)[1]
        gate = job.split('    if: >-\n', 1)[1].split('\n    environment:', 1)[0].strip()
        self.assertEqual(gate, "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'")
        self.assertNotIn('workflow_run', self.source)
        self.assertNotIn('GITHUB_RUN_NUMBER', self.source)
        self.assertEqual(self.source.count('EVENT_NAME: ${{ github.event_name }}'), 2)
        self.assertEqual(self.source.count('INPUT_SHA: ${{ inputs.release_sha }}'), 2)

    def test_automatic_events_never_reach_commands_even_with_main_ref(self):
        for script in self.steps:
            for event in ('workflow_run', 'push', 'pull_request', 'merge_group', 'schedule', '', None):
                with self.subTest(event=event, step=self.steps.index(script)):
                    result, trace = self.invoke(script, event, 'refs/heads/main')
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(trace, '')

    def test_manual_non_main_or_missing_ref_never_reaches_commands(self):
        for script in self.steps:
            for ref in ('refs/heads/codex/cloud-release-oidc', 'refs/tags/main', 'refs/pull/5512/merge',
                        'refs/heads/main-cn', 'refs/heads/main/evil', '', None):
                with self.subTest(ref=ref, step=self.steps.index(script)):
                    result, trace = self.invoke(script, 'workflow_dispatch', ref)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(trace, '')

    def test_exact_sha_validation_still_precedes_commands(self):
        for script in self.steps:
            for sha in ('main', 'A' * 40, 'a' * 39, '', '../main'):
                with self.subTest(sha=sha, step=self.steps.index(script)):
                    result, trace = self.invoke(script, 'workflow_dispatch', 'refs/heads/main', sha)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(trace, '')

    def test_manual_main_uses_explicit_sha_until_first_privileged_sentinel(self):
        for script, operation in zip(self.steps, ('workspacex-cn-export-source', 'workspacex-cn-deploy --check-prepare-inputs')):
            result, trace = self.invoke(script, 'workflow_dispatch', 'refs/heads/main')
            self.assertEqual(result.returncode, 77, result.stdout + result.stderr)
            self.assertIn(operation, trace)
            self.assertIn(SHA, trace)
            self.assertNotIn('--prepare ', trace)
            self.assertNotIn('workspacex-cn-build-candidate', trace)

    def test_shared_lock_and_existing_host_gates_are_retained(self):
        self.assertIn('group: workspacex-cn-production-deploy', self.source)
        self.assertIn('cancel-in-progress: false', self.source)
        for gate in ('git merge-base --is-ancestor', 'cmp --silent', '--check-prepare-inputs',
                     'workspacex-cn-build-candidate', '--prepare', 'workspacex-cn-verify-promotion', 'freeze-tag'):
            self.assertIn(gate, self.source)


if __name__ == '__main__':
    unittest.main()
