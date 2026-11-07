import importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('outcome',ROOT/'scripts/cn-release-development-outcome.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Outcome(unittest.TestCase):
 def test_private_bounded_identity_and_no_overwrite(self):
  with tempfile.TemporaryDirectory()as td:
   folder=Path(td).resolve()/'round-01';folder.mkdir(mode=0o700);path=folder/'linux-six-business.tests.outcome.json'
   env=dict(CN_SIMULATION_OUTCOME_PATH=str(path),CN_SIX_ROUND_ID='round-01',CN_SIX_SOURCE_COMMIT='a'*40,GITHUB_RUN_ID='123')
   with patch.dict(os.environ,env):
    m.write('linux-six-business',business_failure=True,inner_cleanup=True,reason='known-business-failure')
    self.assertLess(path.stat().st_size,16384);self.assertEqual(path.stat().st_mode&0o777,0o600)
    value=json.loads(path.read_bytes());self.assertEqual(value['commit'],'a'*40);self.assertFalse(value['productionAccepted'])
    with self.assertRaises(FileExistsError):m.write('linux-six-business',business_failure=True,inner_cleanup=True,reason='known-business-failure')
 def test_wrong_path_round_identity_and_raw_reason_reject(self):
  with tempfile.TemporaryDirectory()as td:
   folder=Path(td).resolve()/'round-01';folder.mkdir(mode=0o700);path=folder/'linux-six-business.tests.outcome.json'
   base=dict(CN_SIMULATION_OUTCOME_PATH=str(path),CN_SIX_ROUND_ID='round-01',CN_SIX_SOURCE_COMMIT='a'*40,GITHUB_RUN_ID='123')
   for key,val in [('CN_SIX_ROUND_ID','round-02'),('CN_SIX_SOURCE_COMMIT','unknown'),('CN_SIMULATION_OUTCOME_PATH',str(folder/'other.json'))]:
    with patch.dict(os.environ,{**base,key:val}),self.assertRaises(ValueError):m.write('linux-six-business',business_failure=True,inner_cleanup=True,reason='known-business-failure')
   with patch.dict(os.environ,base),self.assertRaises(ValueError):m.write('linux-six-business',business_failure=True,inner_cleanup=True,reason='secret raw exception')
   self.assertFalse(path.exists())
 def test_unknown_cleanup_is_persisted_false_not_upgraded(self):
  with tempfile.TemporaryDirectory()as td:
   folder=Path(td).resolve()/'round-01';folder.mkdir(mode=0o700);path=folder/'linux-six-business.tests.outcome.json'
   with patch.dict(os.environ,dict(CN_SIMULATION_OUTCOME_PATH=str(path),CN_SIX_ROUND_ID='round-01',CN_SIX_SOURCE_COMMIT='a'*40,GITHUB_RUN_ID='123')):
    m.write('linux-six-business',business_failure=True,inner_cleanup=False,reason='known-business-failure')
   self.assertFalse(json.loads(path.read_bytes())['innerCleanupVerified'])

class FixturePredicates(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  for key,file in [('six','cn_release_six_business_linux.py'),('complete','cn_release_application_recovery_complete_linux.py')]:
   spec=importlib.util.spec_from_file_location(key,ROOT/'tests'/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);setattr(cls,key,module)
 def complete_value(self):
  return {'stage':'original-durable-driver','reason':'DURABLE_CHAIN_FAILED','bridgeDiagnostic':{'reason':'EXECUTION_UNCERTAIN_RECONCILE_NO_RETRY','restoreTerminalDiagnostic':{'kind':'pg-restore-terminal-diagnostic-v1','terminal':{'reason':'EXITED','exitCode':1,'processGroupStillPresent':False}}}}
 def test_complete_requires_real_positive_terminal_even_if_driver_uncertain(self):
  import copy
  value=self.complete_value();self.assertTrue(self.complete.development_failure(value,1))
  for field,new in [('reason','TIMEOUT'),('reason','ISOLATION_UNPROVEN'),('exitCode',-9),('exitCode',0),('exitCode',None),('processGroupStillPresent',True)]:
   bad=copy.deepcopy(value);bad['bridgeDiagnostic']['restoreTerminalDiagnostic']['terminal'][field]=new
   self.assertFalse(self.complete.development_failure(bad,1))
  for terminal in (None,{}):
   bad=copy.deepcopy(value);bad['bridgeDiagnostic']['restoreTerminalDiagnostic']['terminal']=terminal
   self.assertFalse(self.complete.development_failure(bad,1))
  self.assertFalse(self.complete.development_failure(value,-9));self.assertFalse(self.complete.development_failure({},1))
 def six_value(self):
  return {'verified':False,'diagnostic':{'stage':'application','reason':'SIX_APPLICATION_FAILED','exitCode':1,'report':{'reportAvailable':True,'statistics':dict(expected=0,unexpected=0,flaky=0,skipped=0,duration=300000),'globalErrorCount':1,'globalErrors':[dict(messageBytes=100,messageSha256='a'*64,chatWarmup=True,budget300s=True)]}}}
 def test_six_requires_exact_known_warmup_report_not_signal_or_unknown(self):
  import copy
  value=self.six_value();self.assertTrue(self.six.development_failure(value))
  for key,val in [('exitCode',-9),('exitCode',2),('reason','SIX_APPLICATION_TIMEOUT'),('reason','SIX_APPLICATION_LOG_LIMIT'),('report',{'reportAvailable':False})]:
   bad=copy.deepcopy(value);bad['diagnostic'][key]=val;self.assertFalse(self.six.development_failure(bad))
  for key in ('chatWarmup','budget300s'):
   bad=copy.deepcopy(value);bad['diagnostic']['report']['globalErrors'][0][key]=False;self.assertFalse(self.six.development_failure(bad))
  bad=copy.deepcopy(value);bad['diagnostic']['report']['statistics']['skipped']=1;self.assertFalse(self.six.development_failure(bad))

if __name__=='__main__':unittest.main()
