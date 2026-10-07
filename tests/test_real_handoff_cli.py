"""Real Node22 canonical producer and consumer; only Docker is synthetic.

This validates offline handoff identity and bytes, never registry or production
authority. Runtime dependencies and original TypeScript sources are hashed.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = ROOT / 'toolchain/node-v22.20.0-linux-x64/bin/node'
VERIFIER = ROOT / 'scripts/verify-hosted-handoff.py'


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


canonical = module('real_handoff_canonical_fixture', ROOT / 'tests/test_canonical_cli.py')
verifier = module('real_handoff_verifier', VERIFIER)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


class RealHandoffIntegration(unittest.TestCase):
    def setUp(self):
        self.assertTrue(NODE.is_file(), 'Prepare isolated official Node22 first')
        version = subprocess.run([str(NODE), '--version'], check=True,
                                 text=True, capture_output=True).stdout.strip()
        self.assertEqual(version, 'v22.20.0')
        canonical.CanonicalIntegration.setUp(self)
        # Keep the Docker fixture first, then the exact Node22 runtime.
        self.env['PATH'] = str(self.root / 'bin') + os.pathsep + str(NODE.parent) + os.pathsep + os.environ['PATH']
        self.plan_path = self.root / 'plan.json'
        public_plan = {key: value for key, value in self.plan.items() if not key.startswith('_')}
        public_plan['services'] = list(canonical.h.SERVICES)
        write(self.plan_path, public_plan)
        self.plan['_planSha256'] = digest(self.plan_path)
        for path in self.results.glob('*.json'):
            result = json.loads(path.read_text())
            result['planSha256'] = self.plan['_planSha256']
            write(path, result)
        canonical.CanonicalIntegration.aggregate(self)
        self.sealed = self.root / 'sealed'
        self.output = self.root / 'handoff-evidence.json'

    def invoke(self, extra_env=None):
        env = dict(os.environ, **(extra_env or {}))
        return subprocess.run([
            sys.executable, '-B', str(VERIFIER), '--plan', str(self.plan_path),
            '--sealed-dir', str(self.sealed), '--expected', str(self.expected_path),
            '--output', str(self.output), '--control', str(self.control_path),
            '--control-sha256', self.control_sha256], env=env, text=True, capture_output=True,
            timeout=90)

    def rejects(self):
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.output.exists())

    def test_real_producer_and_canonical_consumer_validate_exact_bytes(self):
        result = self.invoke({'NODE_OPTIONS': '--invalid-untrusted-node-option'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = json.loads(self.output.read_text())
        for key, name in [('planSha256', None), ('manifestSha256', 'release.json'),
                          ('sealSha256', 'release.sealed.json'), ('receiptSha256', 'artifact-build.json')]:
            self.assertEqual(evidence[key], digest(self.plan_path if name is None else self.sealed / name))
        self.assertTrue(evidence['handoffValidated'])
        self.assertIs(evidence['prepared'], False)
        self.assertIs(evidence['productionActivated'], False)
        self.assertIs(evidence['cloudVerified'], False)
        self.assertEqual(evidence['stage'], 'offline-hosted-handoff-validation')
        self.assertEqual(evidence['canonicalControlSha256'], self.control_sha256)
        self.assertEqual(evidence['canonicalVerifierSha256'], digest(ROOT / 'scripts/canonical_control.py'))
        self.assertEqual(evidence['canonicalNodeSha256'], digest(NODE))

    def test_real_canonical_rejects_offset_timestamp_even_after_hash_rebinding(self):
        seal_path = self.sealed / 'release.sealed.json'
        seal = json.loads(seal_path.read_text())
        # Python accepts timezone offsets; unchanged Zod canonical schema requires Z.
        seal['sealedAt'] = '2026-10-07T12:00:00+01:00'
        write(seal_path, seal)
        receipt_path = self.sealed / 'artifact-build.json'
        receipt = json.loads(receipt_path.read_text())
        receipt['sealSha256'] = digest(seal_path)
        write(receipt_path, receipt)
        with self.assertRaisesRegex(ValueError, 'CANONICAL_VALIDATION_FAILED'):
            verifier.verify(self.plan_path, self.sealed, self.expected_path,
                            control_path=self.control_path, control_sha256=self.control_sha256)
        self.rejects()

    def test_real_control_source_drift_is_rejected(self):
        source = self.control_root / 'packages/cloud-deploy/src/release-candidate.ts'
        source.write_bytes(source.read_bytes() + b'\n// unreviewed local drift\n')
        with self.assertRaisesRegex(ValueError, 'CONTROL_FILE_HASH_MISMATCH'):
            verifier.verify(self.plan_path, self.sealed, self.expected_path,
                            control_path=self.control_path, control_sha256=self.control_sha256)
        self.rejects()

    def test_real_dependency_tree_hash_mismatch_is_rejected(self):
        dependency = self.control_root / 'node_modules/zod/package.json'
        dependency.write_bytes(dependency.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'CONTROL_FILE_HASH_MISMATCH'):
            verifier.verify(self.plan_path, self.sealed, self.expected_path,
                            control_path=self.control_path, control_sha256=self.control_sha256)
        self.rejects()


if __name__ == '__main__':
    unittest.main()
