"""Local contract checks only: no kernel FUSE or Linux cgroup claim."""
import ast
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('fixture', ROOT/'tests/cn_release_fsync_entry_linux.py')
f = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(f)


class FsyncEntryFixtureTests(unittest.TestCase):
    def test_generated_shell_and_verifier_are_real_valid_bytes(self):
        self.assertEqual(subprocess.check_output(['/bin/sh','-c',f.OK.decode()]), b'{"verified":true}\n')
        space = {}
        exec(compile(f.VERIFIER, '<fixture-verifier>', 'exec'), space)
        self.assertEqual(space['verify'](b'{"verified":true}', {}, None, 'terminal'), {'externalWritesTerminal':True})
        self.assertIs(space['verify'](b'{"verified":false}', {}, None, 'reconcile'), False)

    def test_package_loads_original_schema_and_byte_bindings(self):
        entry = f.load('test_original_entry', ROOT/'.harness/scripts/vm/cn-release-advance.py')
        with tempfile.TemporaryDirectory(prefix='.fsync-package-',dir=ROOT) as directory:
            path = Path(directory)
            with patch.object(entry,'REQUESTS',path), patch.object(entry,'OWNER',path.stat().st_uid):
                request = f.package(entry, f.OK, f.OK)
                manifest, files = entry.load_package(request,'fsync-one')
                self.assertEqual(manifest['stage'],'consume')
                self.assertEqual(files['action.sh'],f.OK)
                self.assertEqual(files['verify.py'],f.VERIFIER)

    def test_mac_capability_gate_never_reports_success(self):
        with patch.object(f.sys,'platform','darwin'):
            self.assertEqual(f.main(),2)

    def test_entry_fixture_preserves_original_production_call_surface(self):
        tree = ast.parse((ROOT/'tests/cn_release_fsync_entry_linux.py').read_text())
        attributes = [n.attr for n in ast.walk(tree) if isinstance(n,ast.Attribute) and isinstance(n.ctx,ast.Store)]
        self.assertEqual(sorted(attributes),sorted(['dont_write_bytecode','REQUESTS','STATE','OWNER','CGROUP_BASE']))
        # No patch of create/entry/run_command/verify: Linux path calls original code.


if __name__ == '__main__':
    unittest.main()
