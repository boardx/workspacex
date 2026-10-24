import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def module():
    spec=importlib.util.spec_from_file_location('deploy_registry',ROOT/'scripts/deploy-registry-images.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class Policy(unittest.TestCase):
    def test_missing_policy_never_pulls_or_deploys(self):
        m=module()
        with patch.object(m.registry,'resolve') as pull:
            with self.assertRaises(FileNotFoundError): m.deploy('devapp','a'*40+'-123-1',Path('/nonexistent/release-config'))
            pull.assert_not_called()
    def test_environment_and_tag_reject_injection(self):
        m=module()
        for environment,tag in [('other','a'*40+'-123-1'),('cn','latest'),('../cn','a'*40+'-123-1')]:
            with self.assertRaises(ValueError): m.deploy(environment,tag)
    def test_cn_cannot_skip_existing_host_admission(self):
        m=module()
        with self.assertRaisesRegex(ValueError,'CN_ADMISSION_REQUIRED'):m.admission_command({},'cn')
        self.assertIsNone(m.admission_command({},'devapp'))

    def test_atomic_pointer_is_complete(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'current.json';m.atomic(p,{'tag':'old'});m.atomic(p,{'tag':'new'})
            self.assertEqual(json.loads(p.read_text()),{'tag':'new'});self.assertEqual(p.stat().st_mode & 0o777,0o600)
    def test_untrusted_policy_is_rejected(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'config';p.write_text('{}');p.chmod(0o666)
            with self.assertRaises(ValueError): m.trusted(p)
    def test_symlink_ancestor_is_rejected(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'real').mkdir();(root/'link').symlink_to(root/'real',target_is_directory=True)
            p=root/'real'/'config';p.write_text('{}')
            with self.assertRaises(ValueError): m.trusted(root/'link'/'config')

if __name__=='__main__':unittest.main()
