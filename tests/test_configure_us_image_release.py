import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module():
    spec = importlib.util.spec_from_file_location('configure_us', ROOT/'scripts/configure-us-image-release.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class Setup(unittest.TestCase):
    def test_requires_root_and_one_runner(self):
        m = module()
        with patch.object(m.os, 'geteuid', return_value=1001), patch('sys.argv', ['setup','runner']):
            with self.assertRaisesRegex(ValueError, 'Usage:'):
                m.main()

    def test_existing_us_policy_cannot_be_overwritten(self):
        m = module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'settings.json').write_text('{"domain":"appv1.boardx.us"}')
            (root/'us.json').write_text('existing-private-policy')
            # The bootstrap sentinel remains the real fixed path; mock is_file only.
            with patch.object(m, 'RUNTIME', root), patch.object(m, 'POLICY', root), patch.object(m, 'reference'), \
                    patch.object(m.os, 'geteuid', return_value=0), patch('sys.argv',['setup','runner']), \
                    patch.object(Path, 'is_file', return_value=True), patch.object(m.subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'US_POLICY_EXISTS'):
                    m.main()
                run.assert_not_called()
            self.assertEqual((root/'us.json').read_text(), 'existing-private-policy')

    def test_sudo_install_can_scope_us_without_expanding_existing_default(self):
        script = (ROOT/'scripts/install-image-release.sh').read_text()
        self.assertIn('^(cn|devapp|us|both)$', script)
        self.assertIn('environment=${2:-both}', script)
        self.assertNotIn('workspacex-image-release us *', script)
        workflow = (ROOT/'.github/workflows/image-release.yml').read_text()
        self.assertIn('branches: [develop]', workflow)
        self.assertIn('options: [auto, devapp, cn, us]', workflow)
        self.assertIn("steps.plan.outputs.target == 'us' && 'workspacex-us-production-deploy'", workflow)


if __name__ == '__main__':
    unittest.main()
