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
 def test_draft_never_ready(self):
  with self.assertRaisesRegex(ValueError,'FROZEN_CONSERVATION_PLAN_REQUIRED'):validate_plan(self.plan,{'candidateSha':self.plan['candidateSha']})
if __name__=='__main__':unittest.main()
