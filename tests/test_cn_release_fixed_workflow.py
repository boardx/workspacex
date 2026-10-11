"""Execute workflow shell routing with a capturing sudo function, never a host command."""
import os
from pathlib import Path
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]
class WorkflowRoutingTests(unittest.TestCase):
 def script(self):
  text=(ROOT/'.github/workflows/release-cn-fixed.yml').read_text()
  self.assertIn("if: github.ref == 'refs/heads/main'",text)
  self.assertIn('environment: production-cn-promotion',text)
  self.assertIn('group: workspacex-cn-production-deploy',text)
  self.assertIn('cancel-in-progress: false',text)
  return '\n'.join(line[10:]for line in text.split('        run: |\n',1)[1].splitlines())
 def run_shell(self,lane,mode,fresh=''):
  script='sudo() { printf "ARG=%s\\n" "$@"; };\n'+self.script()
  return subprocess.run(['/bin/bash','-c',script],capture_output=True,text=True,env={'PATH':'/usr/bin:/bin','LANE':lane,'MODE':mode,'RELEASE_SHA':'a'*64,'RECOVERY_SHA':fresh})
 def test_only_fixed_release_and_fresh_recovery_arguments_reach_sudo(self):
  for lane,modes,fresh in [('release',['status','run','reconcile'],''),('recovery',['status','run','reconcile','readback','prepare-seal','seal','seal-reconcile'],'b'*64)]:
   for mode in modes:
    p=self.run_shell(lane,mode,fresh);self.assertEqual(p.returncode,0,p.stderr)
    expected=['-n','/usr/local/bin/workspacex-cn-fixed-'+('release'if lane=='release'else 'recovery'),mode,'a'*64]+([fresh]if lane=='recovery'else [])
    self.assertEqual(p.stdout.splitlines(),['ARG='+x for x in expected])
 def test_invalid_lane_mode_and_cross_lane_authority_never_invoke_sudo(self):
  for lane,mode,fresh in [('release','readback',''),('release','run','b'*64),('recovery','run',''),('recovery','run','$(id)'),('other','run',''),('recovery','run; id','b'*64)]:
   p=self.run_shell(lane,mode,fresh);self.assertNotEqual(p.returncode,0);self.assertEqual(p.stdout,'')
if __name__=='__main__':unittest.main()
