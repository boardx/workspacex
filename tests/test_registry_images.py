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
    def test_baseline_source_requires_exact_sha_and_build_only(self):
        m=module()
        self.assertEqual(m.build_source('a'*40,'',False),'a'*40)
        self.assertEqual(m.build_source('a'*40,'b'*40,True),'b'*40)
        for source in ('main','b'*39,'b'*40+'\n','$(id)'):
            with self.assertRaisesRegex(ValueError,'INVALID_BUILD_SOURCE'):
                m.build_source('a'*40,source,True)
        with self.assertRaisesRegex(ValueError,'SOURCE_OVERRIDE_REQUIRES_BUILD_ONLY'):
            m.build_source('a'*40,'b'*40,False)

    def test_baseline_source_cli_and_workflow_bind_checkout_to_tag(self):
        import os, subprocess, sys
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'output'
            env={**os.environ,'SOURCE_OVERRIDE':'b'*40,'BUILD_ONLY':'true','GITHUB_OUTPUT':str(output)}
            p=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'source','--default','a'*40],env=env,capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            self.assertEqual(output.read_text(),'source='+'b'*40+'\n')
        workflow=(ROOT/'.github/workflows/image-release.yml').read_text()
        self.assertIn('ref: ${{ needs.plan.outputs.source }}',workflow)
        self.assertIn('SOURCE_REVISION: ${{ steps.source.outputs.source }}',workflow)
        self.assertIn('SOURCE_REVISION: ${{ needs.plan.outputs.source }}',workflow)
        self.assertIn('../control/scripts/registry-images.py build --source "$SOURCE_REVISION"',workflow)
        self.assertIn('source_revision: ${{ inputs.release_sha }}',(ROOT/'.github/workflows/build-cn-release-artifacts.yml').read_text())

    def test_unique_tag_uses_run_and_attempt(self):
        m=module()
        self.assertEqual(m.release_tag('a'*40,'123','2'),'123-2')
        with self.assertRaises(ValueError): m.release_tag('main','123','2')
        with self.assertRaises(ValueError): m.release_tag('a'*40,'$(id)','2')

    def test_resolve_short_tag_keeps_full_source_and_checks_build_label(self):
        m=module()
        row={'Os':'linux','Architecture':'amd64','Id':'sha256:'+'c'*64,
             'RepoDigests':['registry.example/team/api@sha256:'+'b'*64],
             'Config':{'Labels':{'org.opencontainers.image.revision':'a'*40,
                                 'io.boardx.workspacex.release-tag':'123-2'}}}
        with patch.object(m,'run',side_effect=lambda *args,**kwargs: json.dumps([row])):
            self.assertEqual(m.resolve('docker','registry.example/team','123-2','api',False)['sourceRevision'],'a'*40)
            row['Config']['Labels']['io.boardx.workspacex.release-tag']='123-1'
            with self.assertRaisesRegex(ValueError,'IMAGE_BUILD_IDENTITY'): m.resolve('docker','registry.example/team','123-2','api',False)

    def test_short_alias_requires_matching_legacy_digest(self):
        m=module()
        row={'Os':'linux','Architecture':'amd64','Id':'sha256:'+'c'*64,
             'RepoDigests':['registry.example/team/api@sha256:'+'b'*64],
             'Config':{'Labels':{'org.opencontainers.image.revision':'a'*40}}}
        with patch.object(m,'run',side_effect=lambda *args,**kwargs: json.dumps([row])):
            self.assertEqual(m.resolve('docker','registry.example/team','123-2','api',False)['sourceRevision'],'a'*40)
        other={**row,'Id':'sha256:'+'d'*64}
        with patch.object(m,'run',side_effect=[json.dumps([row]),json.dumps([other])]):
            with self.assertRaisesRegex(ValueError,'ALIAS_IDENTITY'): m.resolve('docker','registry.example/team','123-2','api',False)

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
    def test_develop_promotes_existing_tag_to_explicit_production_without_build(self):
        import os, subprocess, sys
        for target in ['cn','us']:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp)/'output'
                env={**os.environ,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF_NAME':'develop','TARGET_ENVIRONMENT':target,
                     'EXISTING_TAG':'41239623420-1','BUILD_ONLY':'false','GITHUB_OUTPUT':str(output)}
                result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','b'*40,'--resolve-bases'],env=env,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                values=dict(line.split('=',1) for line in output.read_text().splitlines())
                self.assertEqual(values['tag'],'41239623420-1');self.assertEqual(values['build'],'false')
                self.assertEqual(values['target'],target);self.assertEqual(values['environment'],'production-'+target)
                self.assertEqual(json.loads(values['runner']),['self-hosted','linux','x64','workspacex-'+target+'-production'])

    def test_us_branch_routes_only_to_us(self):
        import os, subprocess, sys
        for branch, target, ok in [('main-us','auto',True),('main-us','us',True),('main-us','cn',False),('main','us',False),('develop','us',True)]:
            with self.subTest(branch=branch,target=target), tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp)/'output'
                env={**os.environ,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF_NAME':branch,
                     'TARGET_ENVIRONMENT':target,'EXISTING_TAG':'40216660127-1','BUILD_ONLY':'false','GITHUB_OUTPUT':str(output)}
                result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','b'*40],env=env,capture_output=True,text=True)
                self.assertEqual(result.returncode==0,ok,result.stderr)
                if ok:
                    values=dict(line.split('=',1) for line in output.read_text().splitlines())
                    self.assertEqual(values['target'],'us')
                    self.assertEqual(values['environment'],'production-us')
                    self.assertEqual(json.loads(values['runner']),['self-hosted','linux','x64','workspacex-us-production'])
                    self.assertEqual(values['group'],'workspacex-us-production-deploy')
                    self.assertEqual(values['build'],'false')

    def test_production_requires_existing_develop_tag_even_in_diagnostic_mode(self):
        import os, subprocess, sys
        for branch, target in [('main','cn'),('main-us','us'),('develop','cn'),('develop','us'),('diagnostic','cn'),('diagnostic','us')]:
            for build_only in ['false','true']:
                with self.subTest(branch=branch,build_only=build_only), tempfile.TemporaryDirectory() as tmp:
                    output=Path(tmp)/'output'
                    env={**os.environ,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF_NAME':branch,'TARGET_ENVIRONMENT':target,'BUILD_ONLY':build_only,'EXISTING_TAG':'','GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_OUTPUT':str(output)}
                    result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','b'*40],env=env,capture_output=True,text=True)
                    self.assertNotEqual(result.returncode,0)
                    if branch!='diagnostic' or build_only=='true': self.assertIn('PRODUCTION_REQUIRES_EXISTING_DEVELOP_TAG',result.stderr)
                    self.assertFalse(output.exists())

    def test_diagnostic_new_build_requires_develop_dispatch_branch(self):
        import os, subprocess, sys
        for branch in ['feature/diagnostic','main','main-us']:
            with self.subTest(branch=branch), tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp)/'output'
                env={**os.environ,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF_NAME':branch,'TARGET_ENVIRONMENT':'devapp','BUILD_ONLY':'true','EXISTING_TAG':'','GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_OUTPUT':str(output)}
                result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','b'*40],env=env,capture_output=True,text=True)
                self.assertNotEqual(result.returncode,0)
                if branch.startswith('feature/'): self.assertIn('IMAGE_BUILD_REQUIRES_DEVELOP',result.stderr)
                else: self.assertIn('BRANCH_ENVIRONMENT_MISMATCH',result.stderr)
                self.assertFalse(output.exists())

    def test_develop_can_still_build_and_diagnose_source_override(self):
        import os, subprocess, sys
        for build_only in ['false','true']:
            with self.subTest(build_only=build_only), tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp)/'output'
                env={**os.environ,'GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF_NAME':'develop','TARGET_ENVIRONMENT':'auto','BUILD_ONLY':build_only,'EXISTING_TAG':'','GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_OUTPUT':str(output)}
                result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','b'*40],env=env,capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                values=dict(line.split('=',1) for line in output.read_text().splitlines())
                self.assertEqual(values['build'],'true')
                self.assertEqual(values['target'],'devapp')

    def test_us_push_cannot_deploy(self):
        import os, subprocess, sys
        env={**os.environ,'GITHUB_EVENT_NAME':'push','GITHUB_REF_NAME':'main-us','BUILD_ONLY':'false'}
        result=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','b'*40],env=env,capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('RELEASE_EVENT_NOT_ALLOWED',result.stderr)

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
