"""Mechanical no-write gate for the synthetic negative branch; no Docker used."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('outer_fixture',ROOT/'tests/cn_release_api_outer_recovery_linux.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReadonlyNegative(unittest.TestCase):
 def test_real_guard_executes_only_exact_token_ps_and_rejects_writes(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);called=root/'called';real=root/'real-docker'
   real.write_text('#!'+sys.executable+'\nfrom pathlib import Path\nPath('+repr(str(called))+').write_text("called")\n');real.chmod(0o700)
   guard=root/'docker';guard.write_text(m.readonly_docker_script(str(real),'a'*32));guard.chmod(0o700)
   allowed=['ps','--all','--quiet','--no-trunc','--filter','label=cn-startup-fixture='+'a'*32]
   for args in (['run'],['create'],['start'],['rm','--force','x'],['ps'],allowed+['--filter','id=x'],allowed[:-1]+['label=cn-startup-fixture='+'b'*32]):
    result=subprocess.run([str(guard),*args],capture_output=True,timeout=3)
    self.assertEqual(result.returncode,91);self.assertFalse(called.exists())
   result=subprocess.run([str(guard),*allowed],capture_output=True,timeout=3)
   self.assertEqual(result.returncode,0);self.assertEqual(called.read_text(),'called')
 def test_negative_registry_is_not_an_active_recovery_root(self):
  import ast
  tree=ast.parse((ROOT/'tests/cn_release_api_outer_recovery_linux.py').read_text())
  # Exact roots expression is tested structurally; no side effects on import.
  assignments=[n for n in ast.walk(tree)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='roots'for t in n.targets)]
  self.assertEqual(len(assignments),1)
  names=ast.literal_eval(assignments[0].value.generators[0].iter)
  self.assertEqual(names,('target','control'))
if __name__=='__main__':unittest.main()
