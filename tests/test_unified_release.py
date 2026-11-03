import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('unified',Path(__file__).parents[1]/'scripts/unified-release.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Adapter:
 def __init__(self,fail=None,pending=True):self.events=[];self.fail=fail;self.pending=pending
 def call(self,stage):
  self.events.append(stage)
  if self.fail==stage:raise RuntimeError(stage)
 def prepare(self,tag,attempt):self.call('prepare');return {'tag':tag,'images':{'api':'new'}}
 def baseline(self,attempt):self.call('baseline');return {'tag':'old','images':{'api':'old'}}
 def plan(self,candidate,attempt):self.call('plan');return {'status':'PENDING' if self.pending else 'COMPLETE'}
 def backup(self,attempt):self.call('backup')
 def migrate(self,candidate,attempt):self.call('migrate');return {'status':'COMPLETE'}
 def stop(self,baseline):self.call('stop')
 def start(self,version):self.call('rollback' if version['tag']=='old' else 'start')
 def verify(self,version):self.call('verify_old' if version['tag']=='old' else 'verify_new')
class Releases(unittest.TestCase):
 def run_release(self,a,root,tag='new'):return m.release(root,tag,a)
 def test_same_flow_all_environments(self):
  for env in ['devapp','cn','us']:
   with self.subTest(env=env),tempfile.TemporaryDirectory() as d:
    a=Adapter();r=self.run_release(a,Path(d));self.assertEqual(r['status'],'SUCCEEDED')
    self.assertEqual(a.events,['prepare','baseline','plan','stop','backup','migrate','start','verify_new'])
    state=json.loads((Path(d)/'current/release.json').read_text());self.assertEqual(state['tag'],'new')
    self.assertEqual(json.loads((Path(d)/'previous/release.json').read_text())['tag'],'old')
 def test_no_pending_sql_skips_backup_stop_and_migration(self):
  with tempfile.TemporaryDirectory() as d:
   a=Adapter(pending=False);self.run_release(a,Path(d));self.assertNotIn('backup',a.events);self.assertNotIn('stop',a.events)
 def test_preflight_failure_keeps_live_service(self):
  for stage in ['prepare','baseline','plan']:
   with self.subTest(stage=stage),tempfile.TemporaryDirectory() as d:
    a=Adapter(fail=stage);r=self.run_release(a,Path(d));self.assertEqual(r['status'],'FAILED');self.assertNotIn('stop',a.events);self.assertNotIn('rollback',a.events)
 def test_failure_after_stop_restores_old_and_preserves_database_outcome(self):
  for stage in ['backup','migrate','start','verify_new']:
   with self.subTest(stage=stage),tempfile.TemporaryDirectory() as d:
    a=Adapter(fail=stage);r=self.run_release(a,Path(d));self.assertEqual(r['status'],'ROLLED_BACK');self.assertIn('verify_old',a.events)
    self.assertFalse((Path(d)/'current/release.json').exists());self.assertEqual(r['database'],'COMPLETE' if stage in ['start','verify_new'] else 'UNCHANGED' if stage=='backup' else 'RECONCILE_REQUIRED')
 def test_failed_rollback_is_not_success(self):
  class Broken(Adapter):
   def start(self,v):self.call('start');raise RuntimeError('private details')
  with tempfile.TemporaryDirectory() as d:
   r=self.run_release(Broken(),Path(d));self.assertEqual(r['status'],'RECOVERY_REQUIRED');self.assertTrue((Path(d)/'log/active.json').exists());self.assertNotIn('private',json.dumps(r))
 def test_interrupted_attempt_blocks_until_recovery(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'log').mkdir();(root/'log/active.json').write_text('{}');a=Adapter()
   self.assertEqual(self.run_release(a,root)['status'],'RECOVERY_REQUIRED');self.assertEqual(a.events,[])
 def test_projection_failure_does_not_rollback_committed_release(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as d:
   original=m.atomic
   def write(path,value):
    if Path(path).name=='release.json':raise OSError('projection unavailable')
    return original(path,value)
   a=Adapter()
   with patch.object(m,'atomic',side_effect=write):r=self.run_release(a,Path(d))
   self.assertEqual(r['status'],'RECOVERY_REQUIRED');self.assertNotIn('rollback',a.events)
   self.assertEqual(json.loads((Path(d)/'config/versions.json').read_text())['current']['tag'],'new')
 def test_recovery_restores_original_baseline_without_replaying_sql(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);m.layout(root);m.atomic(root/'log/active.json',{'attempt':str(root/'log'),'candidate':{'tag':'new'},'baseline':{'tag':'old','images':{'api':'old'}},'stage':'migrate','database':'RECONCILE_REQUIRED'})
   a=Adapter();r=m.recover(root,a)
   self.assertEqual(r['status'],'ROLLED_BACK');self.assertEqual(a.events,['rollback','verify_old','plan']);self.assertFalse((root/'log/active.json').exists())
 def test_versions_replace_then_fsync_error_preserves_recoverable_intent(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as d:
   original=m.atomic
   def write(path,value):
    original(path,value)
    if Path(path).name=='versions.json':raise OSError('directory fsync failed')
   a=Adapter()
   with patch.object(m,'atomic',side_effect=write):r=self.run_release(a,Path(d))
   self.assertEqual(r['status'],'RECOVERY_REQUIRED');self.assertNotIn('rollback',a.events);self.assertTrue((Path(d)/'log/active.json').exists())
   self.assertEqual(m.recover(Path(d),a)['status'],'SUCCEEDED');self.assertEqual(json.loads((Path(d)/'current/release.json').read_text())['tag'],'new')
 def test_unknown_migration_result_retains_intent_until_fresh_query(self):
  class Unknown(Adapter):
   def migrate(self,candidate,attempt):self.call('migrate');return {'status':'RECONCILE_REQUIRED'}
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);a=Unknown();r=self.run_release(a,root)
   self.assertEqual(r['database'],'RECONCILE_REQUIRED');self.assertTrue((root/'log/active.json').exists())
   a.events=[];self.assertEqual(m.recover(root,a)['status'],'ROLLED_BACK');self.assertEqual(a.events,['rollback','verify_old','plan'])
