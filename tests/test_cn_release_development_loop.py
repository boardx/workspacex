"""Real runner loop with isolated result-file fixtures; no Docker/systemd claim."""
import contextlib,copy,importlib.util,io,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('development_runner',ROOT/'scripts/cn-release-simulation.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class DevelopmentLoop(unittest.TestCase):
 def row(self,name,folder,failed=False):
  cid=m.KNOWN_DEVELOPMENT_CASES.get(name,name+'-fixture')
  m.write_json(folder/(name+'.tests.inventory.json'),[dict(caseId=cid,status='notrun')])
  m.write_json(folder/(name+'.tests.cases.json'),[dict(caseId=cid,status='fail'if failed else'pass',durationSeconds=.001,layer='isolated-fixture')])
  if failed:m.write_json(folder/(name+'.tests.outcome.json'),dict(kind='cn-development-fixture-outcome-v1',suite=name,caseId=cid,commit='a'*40,runId='123',roundId=folder.name,businessFailure=True,innerCleanupVerified=True,reason='known-business-failure',sideEffectScope='isolated-local-fixture-only',productionAccepted=False))
  return dict(suite=name,status='failed'if failed else'passed',exitCode=1 if failed else 0,reason='test-failure-or-missing-stats'if failed else None,cleanup=dict(verified=True,populated=0),dockerCleanup=dict(verified=True),statistics=dict(tests=1,failures=int(failed),errors=0,skipped=0,expectedFailures=0,unexpectedSuccesses=0),casesEvidence=name+'.tests.cases.json',inventoryEvidence=name+'.tests.inventory.json',durationSeconds=.001)
 def invoke(self,mode,failed=True):
  with tempfile.TemporaryDirectory()as td:
   output=Path(td)/'out'
   def execute(name,command,folder,env,seconds):return self.row(name,folder,failed and name in m.KNOWN_DEVELOPMENT_CASES)
   with patch.object(m,'scheduled_execute',execute),patch.object(m.subprocess,'check_output',side_effect=lambda cmd,**kw:'a'*40+'\n'if'rev-parse'in cmd else''),patch.dict(os.environ,{'GITHUB_RUN_ID':'123'}),patch.object(sys,'argv',['simulation','--output',str(output),'--rounds','10','--mode',mode]),contextlib.redirect_stdout(io.StringIO())as stdout:
    code=m.main()
   summary=json.loads((output/'summary.json').read_bytes())
   return code,summary,stdout.getvalue()
 def test_acceptance_first_failure_stops_and_development_keeps_ten_failed_rounds(self):
  code,s,_=self.invoke('acceptance');self.assertEqual(code,1);self.assertEqual(s['completedRounds'],1)
  code,s,out=self.invoke('development');self.assertEqual(code,1);self.assertEqual(s['completedRounds'],10)
  self.assertEqual(s['status'],'failed');self.assertFalse(s['completeRegressionAccepted']);self.assertFalse(s['isolatedAcceptance'])
  self.assertTrue(all(r['status']=='failed'for r in s['rounds']));self.assertEqual(out.count('"event": "round-finished"'),10)
 def test_development_all_pass_is_never_final_acceptance(self):
  code,s,_=self.invoke('development',False);self.assertEqual(code,1);self.assertEqual(s['completedRounds'],10)
  self.assertEqual(s['testsStatus'],'passed');self.assertFalse(s['completeRegressionAccepted'])
  self.assertFalse(s['isolatedAcceptanceDecision']['isolatedAcceptance']);self.assertFalse(s['acceptanceGates']['accepted'])
 def test_gate_rejects_unknown_timeout_cleanup_missing_stats_inventory_or_source(self):
  name='linux-six-business'
  mutations=[lambda r:r.update(suite='unknown'),lambda r:r.update(reason='timeout'),lambda r:r.update(reason='log-limit'),lambda r:r.update(reason='runner-RuntimeError'),lambda r:r.update(cleanup=dict(verified=False,populated=1)),lambda r:r.update(statistics=None),lambda r:r['statistics'].update(skipped=1),lambda r:r.update(casesEvidence=None)]
  for mutate in mutations:
   with self.subTest(mutate=mutate),tempfile.TemporaryDirectory()as td:
    folder=Path(td)/'round-01';folder.mkdir();row=self.row(name,folder,True);mutate(row)
    value=dict(sourceUnchanged=True,status='failed',commit='a'*40,suites=[row])
    self.assertFalse(m.round_continuation('development',value,[name],folder,'123')['allowed'])
  for fault in ('missing','cleanup','binding','notrun','source','incomplete','duplicate'):
   with self.subTest(fault=fault),tempfile.TemporaryDirectory()as td:
    folder=Path(td)/'round-01';folder.mkdir();row=self.row(name,folder,True);value=dict(sourceUnchanged=True,status='failed',commit='a'*40,suites=[row]);receipt=folder/(name+'.tests.outcome.json')
    if fault=='missing':receipt.unlink()
    if fault in ('cleanup','binding'):
     raw=json.loads(receipt.read_bytes());raw['innerCleanupVerified'if fault=='cleanup'else'commit']=False if fault=='cleanup'else'b'*40;receipt.write_text(json.dumps(raw))
    if fault=='notrun':(folder/row['casesEvidence']).write_text(json.dumps([dict(caseId=m.KNOWN_DEVELOPMENT_CASES[name],status='notrun')]))
    if fault=='source':value['sourceUnchanged']=False
    if fault=='incomplete':value['suites']=[]
    if fault=='duplicate':value['suites']=[row,row]
    self.assertFalse(m.round_continuation('development',value,[name],folder,'123')['allowed'])
 def test_complete_requires_outer_daemon_cleanup(self):
  with tempfile.TemporaryDirectory()as td:
   folder=Path(td)/'round-01';folder.mkdir();name='linux-application-recovery-complete';row=self.row(name,folder,True);row['dockerCleanup']=None
   self.assertFalse(m.round_continuation('development',dict(sourceUnchanged=True,status='failed',commit='a'*40,suites=[row]),[name],folder,'123')['allowed'])
 def test_actual_function_case_ids_are_fixed(self):
  for cid in m.KNOWN_DEVELOPMENT_CASES.values():
   def f():pass
   f.__name__=cid;self.assertEqual(unittest.FunctionTestCase(f).id(),cid)
if __name__=='__main__':unittest.main()
