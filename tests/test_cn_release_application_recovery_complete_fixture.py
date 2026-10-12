"""Offline preload contract checks; no Docker or database is started."""
import ast
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'tests/cn_release_application_recovery_complete_linux.py'
spec = importlib.util.spec_from_file_location('complete_fixture', PATH)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class PreloadContract(unittest.TestCase):
    def test_override_retains_original_image_preload(self):
        image = (ROOT / 'apps/api/docker/postgres-age/Dockerfile').read_text()
        self.assertIn('CMD ["postgres", "-c", "shared_preload_libraries=age"]', image)
        self.assertEqual(fixture.postgres_command(), [
            'postgres', '-c', 'shared_preload_libraries=age', '-c',
            'listen_addresses=', '-c', 'statement_timeout=85000'])
        main = next(x for x in ast.parse(PATH.read_text()).body
                    if isinstance(x, ast.FunctionDef) and x.name == 'main')
        calls = [n for n in ast.walk(main) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Name)]
        self.assertEqual(len([n for n in calls if n.func.id == 'postgres_command']), 1)
        preload = next(n for n in calls if n.func.id == 'check_preload')
        bridge = next(n for n in calls if n.func.id == 'bridge_command')
        self.assertLess(preload.lineno, bridge.lineno)

    def test_live_setting_readback_before_acceptance(self):
        with patch.object(fixture, 'run', return_value=SimpleNamespace(stdout=b'age\n')) as run:
            fixture.check_preload('/fixed/docker', 'owned-container')
        self.assertEqual(run.call_args.args[0], [
            '/fixed/docker', 'exec', 'owned-container', 'psql', '-XAt', '-U',
            'fixture_owner', '-d', 'postgres', '-c',
            "SELECT current_setting('shared_preload_libraries')"])

    def test_available_extension_does_not_prove_preload(self):
        for observed in (b'', b'\n', b'vector\n', b'age,other\n', b'age\nvector\n'):
            with self.subTest(observed=observed), patch.object(
                    fixture, 'run', return_value=SimpleNamespace(stdout=observed)):
                with self.assertRaisesRegex(RuntimeError, '^AGE_PRELOAD_REQUIRED$'):
                    fixture.check_preload('/fixed/docker', 'owned-container')


if __name__ == '__main__':
    unittest.main()
