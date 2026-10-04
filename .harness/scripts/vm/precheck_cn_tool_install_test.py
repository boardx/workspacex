import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

HERE = pathlib.Path(__file__).parent
spec = importlib.util.spec_from_file_location('precheck', HERE / 'precheck-cn-tool-install.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
fixture_spec = importlib.util.spec_from_file_location('existing_producer_tests', HERE / 'prepare_cn_tool_install_test.py')
fixture = importlib.util.module_from_spec(fixture_spec)
fixture_spec.loader.exec_module(fixture)


class PackagePrecheck(unittest.TestCase):
    def package(self, root):
        repo, revision, inventory, _ = fixture.Producer().fixture(root)
        out = root / 'package'
        m.producer.produce(repo, revision, revision, revision, inventory, out)
        pin = m.producer.sha((out / 'manifest.json').read_bytes())
        return repo, revision, out, pin

    def test_readonly_replay_keeps_authority_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            repo, revision, out, pin = self.package(pathlib.Path(directory))
            before = {str(p): p.read_bytes() for p in out.rglob('*') if p.is_file()}
            first = m.precheck(repo, out, pin, revision, revision, revision)
            self.assertEqual(first, m.precheck(repo, out, pin, revision, revision, revision))
            self.assertTrue(first['packageIntegrityVerified'])
            self.assertFalse(first['ready'])
            self.assertFalse(first['installationAuthorized'])
            self.assertEqual(before, {str(p): p.read_bytes() for p in out.rglob('*') if p.is_file()})

    def test_mutations_failclosed(self):
        for kind in ('pin', 'complete', 'application', 'payload', 'extra', 'symlink', 'metadata', 'authority', 'target', 'tree'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                repo, revision, out, pin = self.package(root)
                app = revision
                source = '.harness/scripts/vm/cn-build-tool-identity.py'
                payload = out / 'payload' / source
                if kind == 'pin': pin = '0' * 64
                if kind == 'complete': (out / 'COMPLETE').write_text('0' * 64 + '\n')
                if kind == 'application': app = '1' * 40
                if kind == 'payload': payload.write_bytes(b'foreign')
                if kind == 'extra': (out / 'payload' / 'foreign').write_text('foreign')
                if kind == 'symlink':
                    payload.unlink()
                    payload.symlink_to(repo / source)
                if kind in ('metadata', 'authority', 'target', 'tree'):
                    manifest = json.loads((out / 'manifest.json').read_bytes())
                    if kind == 'metadata': manifest['files'][source]['newSha256'] = '0' * 64
                    if kind == 'authority': manifest['ready'] = True
                    if kind == 'target': manifest['files'][source]['target'] = '/etc/passwd'
                    if kind == 'tree': manifest['trustedGitClosure']['inventorySha256'] = '0' * 64
                    (out / 'manifest.json').write_text(json.dumps(manifest))
                    pin = m.producer.sha((out / 'manifest.json').read_bytes())
                    (out / 'COMPLETE').write_text(pin + '\n')
                before = (out / 'manifest.json').read_bytes()
                with self.assertRaises((ValueError, OSError)):
                    m.precheck(repo, out, pin, revision, app, revision)
                self.assertEqual(before, (out / 'manifest.json').read_bytes())

    def test_cli_redacts_bad_input(self):
        result = subprocess.run(['python3', str(HERE / 'precheck-cn-tool-install.py'), 'private-input-marker'], capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b'')
        self.assertEqual(result.stderr, b'CN_TOOL_PACKAGE_PRECHECK_REJECTED\n')


if __name__ == '__main__':
    unittest.main()
