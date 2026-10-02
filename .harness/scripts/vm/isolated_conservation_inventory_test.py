import copy,unittest
from isolated_conservation_plan import verify_final_sql_inventory,validate_plan
class Inventory(unittest.TestCase):
 def setUp(self):
  self.plan={'prepared':False,'frozen':False,'candidateSha':'a'*40,'fullSqlChecksums':{'0001.sql':'b'*64,'0002.sql':'c'*64}}
  self.ob={'sourceSha':'a'*40,'files':[{'path':'apps/api/migrations/'+name,'sha256':digest} for name,digest in self.plan['fullSqlChecksums'].items()]}
 def test_complete_fixture_set_equal(self):self.assertTrue(verify_final_sql_inventory(self.plan,self.ob))
 def test_one_sql_changed(self):
  self.ob['files'][-1]['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'FINAL_SQL_CLOSURE_DRIFT'):verify_final_sql_inventory(self.plan,self.ob)
 def test_one_sql_missing(self):
  self.ob['files'].pop()
  with self.assertRaises(ValueError):verify_final_sql_inventory(self.plan,self.ob)
 def test_attachment_validator_missing_rejects_before_runtime(self):
  self.plan.update(schemaVersion=1,prepared=True,frozen=True,force=False,seed=False)
  name='20261001170000_pending_attachment_cancellation.sql';self.plan['fullSqlChecksums']={name:'b'*64};self.plan['migrationLawBindings']={name:dict(sqlSha256='b'*64,reviewed=True,lawSha256='c'*64)}
  with self.assertRaisesRegex(ValueError,'ATTACHMENT_VALIDATOR_CLOSURE_REQUIRED'):validate_plan(self.plan,{'candidateSha':self.plan['candidateSha']})
  self.plan['pendingAttachmentValidatorSha256']='bad'
  with self.assertRaisesRegex(ValueError,'ATTACHMENT_VALIDATOR_CLOSURE_REQUIRED'):validate_plan(self.plan,{'candidateSha':self.plan['candidateSha']})
 def test_role_scope_validator_missing_rejects_before_runtime(self):
  self.plan.update(schemaVersion=1,prepared=True,frozen=True,force=False,seed=False)
  for name in ['20261001094500_official_role_pending_skill_bindings.sql','20261001095000_agent_run_skill_scope.sql']:
   self.plan['fullSqlChecksums']={name:'b'*64};self.plan['migrationLawBindings']={name:dict(sqlSha256='b'*64,reviewed=True,lawSha256='c'*64)}
   for digest in [None,'bad']:
    self.plan['roleScopeValidatorSha256']=digest or ''
    with self.assertRaisesRegex(ValueError,'ROLE_SCOPE_VALIDATOR_CLOSURE_REQUIRED'):validate_plan(self.plan,{'candidateSha':self.plan['candidateSha']})
 def test_draft_never_ready(self):
  with self.assertRaisesRegex(ValueError,'FROZEN_CONSERVATION_PLAN_REQUIRED'):validate_plan(self.plan,{'candidateSha':self.plan['candidateSha']})
if __name__=='__main__':unittest.main()
