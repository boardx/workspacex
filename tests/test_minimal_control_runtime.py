"""Exercise the actual hosted bootstrap and minimal pinned runtime offline."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('minimal_control_fixture', ROOT/'tests/test_canonical_cli.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class MinimalControlRuntime(unittest.TestCase):
    def test_portable_bootstrap_reproduces_and_real_seal_succeeds(self):
        fixture.CanonicalIntegration.setUp(self)
        configurations = []
        for name in ('first', 'second'):
            parent = self.root/name
            parent.mkdir()
            config = parent/'canonical-control.json'
            result = subprocess.run([
                sys.executable, str(ROOT/'scripts/prepare-canonical-control.py'),
                '--control', str(ROOT),
                '--runtime', str(ROOT/'control-runtime'),
                '--node', str(ROOT/'toolchain/node-v22.20.0-linux-x64/bin/node'),
                '--output', str(parent/'canonical-closure'),
                '--review-config', str(config)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            configurations.append(config)
        self.assertEqual(configurations[0].read_bytes(), configurations[1].read_bytes())
        self.control_path = configurations[0]
        self.control_sha256 = hashlib.sha256(self.control_path.read_bytes()).hexdigest()
        fixture.CanonicalIntegration.aggregate(self)
        receipt = json.loads((self.root/'sealed/artifact-build.json').read_bytes())
        self.assertEqual(receipt['canonicalControlSha256'], self.control_sha256)
        self.assertFalse(receipt['prepared'])
        self.assertFalse(receipt['productionActivated'])


if __name__ == '__main__':
    unittest.main()
