import json,sys,types,unittest
from unittest.mock import patch
import canonical_acceptance_receipt as m
class Tests(unittest.TestCase):
 def test_absent_fixed_compiled_module_rejects_without_sibling_load(self):
  with patch.dict(sys.modules,{'compiled_maintenance_activation':None}):
   with self.assertRaises(ModuleNotFoundError):m.canonical_receipt({})
 def test_explicit_local_preload_runs_source_and_canonical_has_no_owned_runs(self):
  calls=[]
  def checks(plan):calls.append('actual-source-invoked');return dict(status='passed',lockRetained=True,passedStages=8)
  source=types.SimpleNamespace(canonical_checks=checks,json=json,private=lambda *_:b'{"deploymentMarker":"marker"}')
  with patch.dict(sys.modules,{'compiled_maintenance_activation':source}):
   value=m.canonical_receipt(dict(identity={'attemptId':'local'},browserPlan=dict(path='local',sha256='hash')),lambda:1791133200)
  self.assertEqual(calls,['actual-source-invoked']);self.assertEqual(value['ownedAcceptanceRunIds'],[])
if __name__=='__main__':unittest.main()
