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
    def test_push_never_builds_or_deploys(self):
        for branch in ('develop','main','main-us'):
            r,v=self.plan('push',branch);self.assertNotEqual(0,r.returncode);self.assertEqual({},v);self.assertIn('RELEASE_EVENT_NOT_ALLOWED',r.stderr)
    def test_manual_branch_routes_to_its_environment(self):
        for branch,target in [('develop','devapp'),('main','cn')]:
            with self.subTest(branch=branch):
                r,v=self.plan('workflow_dispatch',branch);self.assertEqual(0,r.returncode,r.stderr);self.assertEqual(target,v['target'])
    def test_existing_tag_reuses_images(self):
        for branch in ['main','develop']:
            r,v=self.plan('workflow_dispatch',branch,existing='b'*40+'-456-1');self.assertEqual(0,r.returncode,r.stderr);self.assertEqual('false',v['build']);self.assertEqual('b'*40+'-456-1',v['tag'])
    def test_manual_destination_is_explicit(self):
        for branch,target in [('main','devapp'),('main-us','devapp')]:
            r,v=self.plan('workflow_dispatch',branch,target);self.assertEqual(0,r.returncode,r.stderr);self.assertEqual(target,v['target'])
    def test_push_cannot_auto_deploy_any_branch(self):
        for branch in ['main','main-cn','feature/test']:
            r,_=self.plan('push',branch);self.assertNotEqual(0,r.returncode)
    def test_selected_branches_support_manual_builds(self):
        r,v=self.plan('workflow_dispatch','feature/test','devapp',True,existing='123-1');self.assertEqual(0,r.returncode,r.stderr)
        r,v=self.plan('workflow_dispatch','feature/test','devapp');self.assertEqual(0,r.returncode,r.stderr);self.assertEqual('true',v['build'])
    def test_existing_diagnostic_caller_uses_branch_aware_environment(self):
        caller=(ROOT/'.github/workflows/build-cn-release-artifacts.yml').read_text().split('  registry-probe:',1)[0]
        self.assertIn("environment: ${{ github.ref_name == 'main' && 'cn' || 'devapp' }}",caller)
        self.assertIn('build_only: true',caller)

    def test_workflow_activates_new_lane_and_retires_old_writers(self):
        w=(ROOT/'.github/workflows/image-release.yml').read_text()
        self.assertNotIn('\n  push:',w);self.assertIn('workflow_dispatch:',w);self.assertNotIn('WSX_IMAGE_RELEASE_ENABLED',w)
        self.assertIn("github.ref_type == 'branch'",w)
        old=(ROOT/'.github/workflows/backend-gates.yml').read_text()
        self.assertNotIn('\n  deploy:\n',old)
        self.assertNotIn('deploy-gate.sh',old)
        cn=(ROOT/'.github/workflows/deploy-cn-production.yml').read_text()
        self.assertNotIn('branches: [main-cn]',cn)


class UnifiedEnvironments(unittest.TestCase):
    plan=BranchPolicy.plan
    def test_all_environments_build_selected_branch_and_reuse_tag(self):
        for environment in ('devapp','cn','us'):
            for branch in ('develop','main','main-us','release/candidate'):
                for tag in ('','456-1'):
                    with self.subTest(environment=environment,branch=branch,tag=tag):
                        r,v=self.plan('workflow_dispatch',branch,environment,existing=tag)
                        self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(v['target'],environment)
                        self.assertEqual(v['build'],'false' if tag else 'true')

if __name__=='__main__':unittest.main()
