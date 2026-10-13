"""Opt-in single fixture cannot enter a mutating multi-suite/ten-round lane."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def load(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
ci=load('cn-release-simulation-ci');sim=load('cn-release-simulation');unit=load('cn-release-simulation-unit')
class SingleMode(unittest.TestCase):
 def test_ci_rejects_before_mutation(self):
  for mode,rounds,suite,workers in [('other',1,'linux-six-business',1),('production-single',10,'all',3),('production-single',1,'all',1),('production-single',1,'targeted',1),('production-single',1,'linux-six-business',3)]:
   with self.subTest(mode=mode,rounds=rounds,suite=suite,workers=workers),patch.dict(os.environ,{'CN_SIX_WEB_MODE':mode}),patch.object(ci.tempfile,'mkdtemp')as create,patch.object(ci.subprocess,'run')as run:
    with self.assertRaisesRegex(ValueError,'SIX_'):ci.execute('a'*40,rounds,0,suite,workers)
    create.assert_not_called();run.assert_not_called()
 def test_simulation_cli_rejects_before_output_creation(self):
  with tempfile.TemporaryDirectory()as folder:
   for mode,rounds,suite,workers in [('unknown',1,'linux-six-business',1),('production-single',10,'all',3),('production-single',1,'all',1),('production-single',1,'linux-six-business',2)]:
    dest=Path(folder)/'must-not-exist'
    result=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/cn-release-simulation.py'),'--output',str(dest),'--rounds',str(rounds),'--suite',suite,'--workers',str(workers)],env={**os.environ,'CN_SIX_WEB_MODE':mode},capture_output=True,text=True)
    self.assertNotEqual(result.returncode,0);self.assertIn('SIX_',result.stderr);self.assertFalse(dest.exists())
 def test_workflow_gate_executes_before_setup(self):
  text=(ROOT/'.github/workflows/cn-release-simulation.yml').read_text()
  start=text.index('        run: |',text.index('- name: Reject partial ten-round'))
  stop=text.index('      - uses: actions/checkout',start)
  shell='\n'.join(line[10:]for line in text[start:stop].splitlines()[1:]if line.startswith('          '))
  for mode,rounds,lane,workers,accepted in [('dev','10','all','3',True),('production-single','1','linux-six-business','1',True),('bad','1','linux-six-business','1',False),('production-single','10','all','3',False),('production-single','1','targeted','1',False),('production-single','1','all','1',False),('production-single','1','linux-six-business','3',False)]:
   result=subprocess.run(['/bin/bash','-eu','-c',shell],env={'PATH':os.defpath,'SIX_WEB_MODE':mode,'ROUNDS':rounds,'LANE':lane,'WORKERS':workers},capture_output=True,text=True)
   self.assertEqual(result.returncode==0,accepted,(mode,rounds,lane,workers,result.stderr))
 def test_default_and_optin_timeout(self):
  self.assertEqual(sim.six_suite_timeout('dev'),1500);self.assertEqual(sim.six_suite_timeout('production-single'),2400)
  self.assertEqual(sim.validate_six_web_mode('dev',10,'all',3),'dev')
  self.assertEqual(sim.validate_six_web_mode('production-single',1,'linux-six-business',1),'production-single')
 def test_unit_rejects_existing_command_contract(self):
  base=[str(Path(sys.executable).absolute()),'-I','-B',str(ROOT/'scripts/cn-release-simulation.py'),'--output',str(Path('/tmp/cn-mode-output').resolve()),'--workers','1','--timeout-seconds','300','--rounds','1','--seed','0','--suite','linux-six-business']
  unit.validate_worker(base,ROOT,'production-single')
  for index,value in [(7,'3'),(11,'10'),(15,'all')]:
   candidate=base.copy();candidate[index]=value
   with self.assertRaises(RuntimeError):unit.validate_worker(candidate,ROOT,'production-single')
  with self.assertRaises(RuntimeError):unit.validate_worker(base,ROOT,'unknown')
 def test_export_is_explicit_and_bound(self):
  import ast
  wanted={'next-build-summary.json','next-build-observation.json','next-build-cleanup.json'}
  tree=ast.parse((ROOT/'scripts/cn-release-simulation-ci.py').read_text())
  values=[n.value for n in ast.walk(tree)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='six_names'for t in n.targets)]
  names=set(ast.literal_eval(values[0]));self.assertTrue(wanted<=names)
  self.assertTrue(wanted<=set(sim.EXPORT_NESTED_FILES['six-business']))
  for forbidden in ('files.json','summary.json','intent.json','build.log'):
   self.assertNotIn(forbidden,names);self.assertNotIn(forbidden,sim.EXPORT_NESTED_FILES['six-business'])
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);src=root/'cn-simulation'/'round-01'/'six-business';src.mkdir(parents=True);target=root/'cn-simulation-artifacts';target.mkdir(mode=0o700)
   (src/'next-build-summary.json').write_bytes(b'x'*16385)
   with self.assertRaisesRegex(ValueError,'EXPORT_FILE_REJECTED'):sim.export_reports(root)
 def test_export_exact_small_receipts_and_ignores_private_tree(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);src=root/'cn-simulation'/'round-01'/'six-business';src.mkdir(parents=True);target=root/'cn-simulation-artifacts';target.mkdir(mode=0o700)
   for name in ('next-build-summary.json','next-build-observation.json','next-build-cleanup.json'):(src/name).write_bytes(b'x'*16384)
   private=src/'production-web';private.mkdir();(private/'files.json').write_text('SECRET');(src/'build.log').write_text('SECRET')
   result=sim.export_reports(root);self.assertEqual(result['files'],3)
   exported=target/'round-01'/'six-business';self.assertEqual(sorted(p.name for p in exported.iterdir()),['next-build-cleanup.json','next-build-observation.json','next-build-summary.json'])
if __name__=='__main__':unittest.main()
