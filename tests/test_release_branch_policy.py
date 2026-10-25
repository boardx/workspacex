"""Exercise real planner CLI: branch identity controls deployment destination."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]

class BranchPolicy(unittest.TestCase):
    def plan(self,event,branch,target='auto',build_only=False,existing=''):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'output'
            env={**os.environ,'GITHUB_EVENT_NAME':event,'GITHUB_REF_NAME':branch,'TARGET_ENVIRONMENT':target,'BUILD_ONLY':str(build_only).lower(),'BUILD_SERVICE':'all','EXISTING_TAG':existing,'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_OUTPUT':str(p)}
            r=subprocess.run([sys.executable,'-B',str(ROOT/'scripts/registry-images.py'),'plan','--source','a'*40],env=env,capture_output=True,text=True)
            return r,dict(x.split('=',1) for x in p.read_text().splitlines()) if p.exists() else {}
    def test_develop_push_builds_devapp(self):
        r,v=self.plan('push','develop');self.assertEqual(0,r.returncode,r.stderr)
        self.assertEqual(('devapp','true','workspacex-devapp-deploy'),(v['target'],v['build'],v['group']))
    def test_manual_branch_routes_to_its_environment(self):
        for branch,target in [('develop','devapp'),('main','cn')]:
            with self.subTest(branch=branch):
                r,v=self.plan('workflow_dispatch',branch);self.assertEqual(0,r.returncode,r.stderr);self.assertEqual(target,v['target'])
    def test_existing_tag_reuses_images(self):
        for branch in ['main','develop']:
            r,v=self.plan('workflow_dispatch',branch,existing='b'*40+'-456-1');self.assertEqual(0,r.returncode,r.stderr);self.assertEqual('false',v['build']);self.assertEqual('b'*40+'-456-1',v['tag'])
    def test_cross_environment_dispatch_rejected(self):
        for branch,target in [('main','devapp'),('develop','cn')]:
            r,v=self.plan('workflow_dispatch',branch,target);self.assertNotEqual(0,r.returncode);self.assertIn('BRANCH_ENVIRONMENT_MISMATCH',r.stderr)
    def test_only_develop_push_can_auto_deploy(self):
        for branch in ['main','main-cn','feature/test']:
            r,_=self.plan('push',branch);self.assertNotEqual(0,r.returncode)
    def test_other_branches_are_build_only_diagnostics(self):
        r,v=self.plan('workflow_dispatch','feature/test','devapp',True);self.assertEqual(0,r.returncode,r.stderr)
        r,_=self.plan('workflow_dispatch','feature/test','devapp');self.assertNotEqual(0,r.returncode)
    def test_existing_diagnostic_caller_uses_branch_aware_environment(self):
        caller=(ROOT/'.github/workflows/build-cn-release-artifacts.yml').read_text().split('  registry-probe:',1)[0]
        self.assertIn("environment: ${{ github.ref_name == 'main' && 'cn' || 'devapp' }}",caller)
        self.assertIn('build_only: true',caller)

    def test_workflow_activates_new_lane_and_retires_old_writers(self):
        w=(ROOT/'.github/workflows/image-release.yml').read_text()
        self.assertIn('branches: [develop]',w);self.assertNotIn('WSX_IMAGE_RELEASE_ENABLED',w)
        self.assertIn("github.ref == 'refs/heads/develop'",w)
        old=(ROOT/'.github/workflows/backend-gates.yml').read_text()
        self.assertNotIn('\n  deploy:\n',old)
        self.assertNotIn('deploy-gate.sh',old)
        cn=(ROOT/'.github/workflows/deploy-cn-production.yml').read_text()
        self.assertNotIn('branches: [main-cn]',cn)

if __name__=='__main__':unittest.main()
