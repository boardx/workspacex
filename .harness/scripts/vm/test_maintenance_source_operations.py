"""Local dispatcher tests; host/SQL/capture boundaries are mocks, never production."""
import hashlib,json,pathlib,types,unittest
from unittest.mock import patch
import maintenance_source_operations as m

def raw(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()

class Fixture:
 def __init__(self):
  self.identity={'sourceRevision':'9b25bfa65662b96c0826fe67506b562ea46aa6d0','baselineRevision':'ba6343199f3c834d6a198f83d0c771614292c82b','migrationPlanSha256':'a'*64,'attemptId':'localmock'}
  self.host=types.SimpleNamespace(plan={'identity':self.identity,'toolRevision':'b'*40,'host':{'instanceId':'mock-host'},'holdGeneration':'c'*32},require_lock=lambda:None)
  self.blocks=0
  self.adapter=types.SimpleNamespace(verifyWritesBlocked=self.block)
  source_sha=hashlib.sha256(pathlib.Path(m.__file__).read_bytes()).hexdigest()
  self.profile={'toolRevision':'b'*40,'filesSha256':{'.harness/scripts/vm/maintenance_source_operations.py':source_sha},'installedFilesSha256':{},'maintenanceSourceOperations':{'schemaVersion':1,'sourcePath':'.harness/scripts/vm/maintenance_source_operations.py','sha256':source_sha,'inputs':{}}}
  self.files={};self.sync()
 def block(self,*args):self.blocks+=1
 def sync(self):self.files['/etc/workspacex-cn/trusted-tool-binding.json']=raw(self.profile)
 def approve(self,action,data):
  path='/etc/workspacex-cn/maintenance-source-inputs/'+self.identity['sourceRevision']+'/localmock/'+action+'.json'
  self.files[path]=raw({'schemaVersion':1,'identity':self.identity,'toolRevision':'b'*40,'data':data})
  ref={'path':path,'sha256':hashlib.sha256(self.files[path]).hexdigest()}
  self.profile['maintenanceSourceOperations']['inputs'][action]=ref;self.sync();return ref
 def create(self):return m.MaintenanceSourceOperations(self.host,self.adapter,types.SimpleNamespace(value={'identity':self.identity}),self.files.__getitem__)

class Tests(unittest.TestCase):
 def test_late_root_data_capability_does_not_change_source_authority(self):
  f=Fixture();op=f.create();ref=f.approve('held-candidate-readback',{'fixture':'data'})
  op.qualified={'fixture':'isolated-mock'}
  with patch('candidate_stage_host.CandidateStageHost',return_value='existing-host'),patch('candidate_stage_actions.held_readback',return_value={'facts':'observed'}) as call:
   value=op.dispatch('held-candidate-readback',f.identity,ref)
   self.assertEqual(call.call_args.args,({'fixture':'data'},'existing-host'))
  self.assertEqual(f.blocks,2);self.assertEqual(value['ready'],False);self.assertEqual(value['value'],{'facts':'observed'})
 def test_all_source_pins_remain_immutable_across_late_approvals(self):
  f=Fixture();op=f.create();ref=f.approve('held-candidate-readback',{})
  f.profile['filesSha256']['other']='d'*64;f.sync()
  with self.assertRaisesRegex(Exception,'PROFILE_DRIFT'):op.dispatch('held-candidate-readback',f.identity,ref)
  self.assertEqual(f.blocks,0)
 def test_data_reference_hash_and_identity_fail_before_host_mutation(self):
  for drift in ('hash','identity','path'):
   f=Fixture();ref=f.approve('held-candidate-readback',{});op=f.create()
   if drift=='hash':f.files[ref['path']]+=b' '
   elif drift=='identity':ref={**ref,'sha256':'e'*64}
   else:ref={**ref,'path':'/etc/workspacex-cn/other.json'}
   with self.assertRaises(Exception):op.dispatch('held-candidate-readback',f.identity,ref)
   self.assertEqual(f.blocks,0)
 def test_missing_actual_qualification_never_becomes_readback(self):
  f=Fixture();ref=f.approve('held-candidate-readback',{});op=f.create()
  with patch('candidate_stage_actions.held_readback') as call:
   with self.assertRaisesRegex(Exception,'BEFORE_QUALIFICATION'):op.dispatch('held-candidate-readback',f.identity,ref)
   call.assert_not_called()
  self.assertTrue(op.failed)
 def test_unknown_response_disables_replay_and_other_source_operations(self):
  f=Fixture();ref=f.approve('held-candidate-readback',{});op=f.create();op.qualified={}
  with patch('candidate_stage_host.CandidateStageHost',return_value='host'),patch('candidate_stage_actions.held_readback',side_effect=RuntimeError('lost response')) as call:
   with self.assertRaisesRegex(Exception,'lost response'):op.dispatch('held-candidate-readback',f.identity,ref)
   with self.assertRaisesRegex(Exception,'REQUEST_BINDING'):op.dispatch('held-candidate-readback',f.identity,ref)
   self.assertEqual(call.call_count,1)
 def test_success_is_not_replayed_or_treated_as_availability(self):
  f=Fixture();ref=f.approve('held-candidate-readback',{});op=f.create();op.qualified={}
  with patch('candidate_stage_host.CandidateStageHost',return_value='host'),patch('candidate_stage_actions.held_readback',return_value={'facts':[]}) as call:
   result=op.dispatch('held-candidate-readback',f.identity,ref)
   self.assertIs(result['productionAvailabilityProven'],False)
   with self.assertRaisesRegex(Exception,'ALREADY_EXECUTED'):op.dispatch('held-candidate-readback',f.identity,ref)
   self.assertEqual(call.call_count,1)
 def test_json_cannot_extend_action_or_module_registry(self):
  f=Fixture();f.profile['maintenanceSourceOperations']['inputs']['run-any-command']={'path':'/tmp/command','sha256':'f'*64};f.sync()
  with self.assertRaisesRegex(Exception,'INPUT_CLOSURE'):f.create()
 def test_canonical_requires_exact_retained_candidate(self):
  f=Fixture();ref=f.approve('canonical-candidate-acceptance',{});op=f.create();op.candidate={'path':'actual-private-plan','sha256':'a'*64}
  actor=types.SimpleNamespace(reference={'path':'foreign-plan','sha256':'a'*64})
  with patch('candidate_canonical_acceptance.persist_candidate_canonical_receipt') as call:
   with self.assertRaisesRegex(Exception,'CANDIDATE_BINDING'):op.dispatch('canonical-candidate-acceptance',f.identity,ref,actor)
   call.assert_not_called()
  self.assertEqual(f.blocks,0);self.assertTrue(op.failed)

if __name__=='__main__':unittest.main()
