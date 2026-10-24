"""Producer identity tests; registry calls use a command-boundary fixture."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

def module():
    spec = importlib.util.spec_from_file_location('registry_images', ROOT/'scripts/registry-images.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

class Producer(unittest.TestCase):
    def test_unique_tag_includes_source_run_and_attempt(self):
        m=module()
        self.assertEqual(m.release_tag('a'*40,'123','2'),'a'*40+'-123-2')
        with self.assertRaises(ValueError): m.release_tag('main','123','2')
        with self.assertRaises(ValueError): m.release_tag('a'*40,'$(id)','2')

    def test_complete_set_required_for_manifest(self):
        m=module()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError): m.aggregate(Path(tmp),'a'*40,'a'*40+'-123-2','registry.example/team')

    def test_rejects_mixed_tag_or_source(self):
        m=module()
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            for role,(repo,*_) in m.SERVICES.items():
                row={'service':role,'tag':'a'*40+'-123-2','sourceRevision':'a'*40,'image':'registry.example/team/'+repo+'@sha256:'+'b'*64,'imageId':'sha256:'+'c'*64}
                if role=='web': row['sourceRevision']='d'*40
                (directory/(role+'.json')).write_text(json.dumps(row))
            with self.assertRaises(ValueError): m.aggregate(directory,'a'*40,'a'*40+'-123-2','registry.example/team')

    def test_manual_tag_deploy_skips_build_and_selects_cn(self):
        import os, subprocess, sys
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'output'
            env={**os.environ,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF_NAME':'main','TARGET_ENVIRONMENT':'cn',
                 'EXISTING_TAG':'a'*40+'-123-2','GITHUB_OUTPUT':str(output)}
            p=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','b'*40],env=env,capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            values=dict(line.split('=',1) for line in output.read_text().splitlines())
            self.assertEqual(values['tag'],'a'*40+'-123-2');self.assertEqual(values['build'],'false')
            self.assertEqual(values['environment'],'production-cn')
    def test_login_rejects_vpc_before_using_credentials(self):
        import os, subprocess, sys
        env={**os.environ,'REGISTRY':'registry-vpc.cn-shanghai.cr.aliyuncs.com','REGISTRY_PREFIX':'registry-vpc.cn-shanghai.cr.aliyuncs.com/team',
             'ACR_USERNAME':'fixture','ACR_PASSWORD':'never-print-this'}
        p=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'login'],env=env,capture_output=True,text=True)
        self.assertNotEqual(p.returncode,0);self.assertIn('PUBLIC_REGISTRY_REQUIRED',p.stderr)
        self.assertNotIn('never-print-this',p.stdout+p.stderr)

    def test_failed_build_diagnostics_redact_before_truncation(self):
        m=module()
        with patch.dict('os.environ',{'ACR_PASSWORD':'private-fixture-value'}):
            report=m.safe_diagnostics('build failure private-fixture-value https://user:password@example.com/path?token=other-secret')
        self.assertNotIn('private-fixture-value',report);self.assertNotIn('user:password',report);self.assertNotIn('other-secret',report)
        self.assertIn('build failure',report)

    def test_registry_prefix_and_tag_are_validated(self):
        m=module()
        for prefix in ('https://registry.example/team','registry.example/team/../../bad','registry.example/team\n'):
            with self.assertRaises(ValueError): m.coordinates(prefix,'a'*40+'-123-2')

if __name__=='__main__': unittest.main()
