import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
S=Path(__file__).resolve().parents[1]/'scripts/cn-reviewed-tag-release.py'
def module():
 s=importlib.util.spec_from_file_location('cn_once',S);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class TransactionTests(unittest.TestCase):
 def test_complete_never_replays(self):
  m=module();a=Mock();a.execute.return_value={'status':'COMPLETE'};events=[]
  result=m.migrate_once(a,lambda x:events.append(x));self.assertEqual(result['status'],'COMPLETE');self.assertFalse(result['migrationExecuted']);self.assertEqual([c.args[0] for c in a.execute.call_args_list],['preflight'])
 def test_baseline_exactly_one_apply_then_reconcile(self):
  m=module();a=Mock();a.execute.side_effect=[{'status':'BASELINE'},{'status':'DRAINED','ledgerStatus':'BASELINE'},{'status':'COMMITTED','commitAcknowledged':True},{'status':'COMPLETE'}];events=[]
  result=m.migrate_once(a,lambda x:events.append(x));self.assertEqual([c.args[0] for c in a.execute.call_args_list],['preflight','drain','apply','reconcile']);self.assertEqual(events[0]['status'],'TRANSACTION_INTENT');self.assertTrue(result['migrationExecuted'])
 def test_lost_ack_reconciles_never_reapplies(self):
  m=module();a=Mock();a.execute.side_effect=[{'status':'BASELINE'},{'status':'DRAINED','ledgerStatus':'BASELINE'},TimeoutError(),{'status':'DRAINED','ledgerStatus':'COMPLETE'},{'status':'COMPLETE'}]
  result=m.migrate_once(a,lambda x:None);self.assertEqual([c.args[0] for c in a.execute.call_args_list].count('apply'),1);self.assertTrue(result['commitAcknowledgementLost']);self.assertEqual(result['status'],'COMPLETE')
 def test_partial_or_drift_never_writes(self):
  m=module();a=Mock();a.execute.return_value={'status':'DRIFT'}
  with self.assertRaisesRegex(ValueError,'SOURCE_LEDGER'):m.migrate_once(a,lambda x:None)
  self.assertEqual(a.execute.call_count,1)
if __name__=='__main__':unittest.main()

class WriterOrchestrationTests(unittest.TestCase):
 def exercise(self,failure=None,capability=None,initial_ledger='BASELINE'):
  import tempfile,json,types,hashlib
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);attempt=root/'attempt';attempt.mkdir();events=[];state={'ledger':initial_ledger,'images':{'api':'old'},'running':True};nginx=root/'nginx';nginx.write_bytes(b'original');pending=root/'pending.json';pending.write_bytes(b'pending');(attempt/'schema-request.json').write_bytes(b'request')
  def save(path,value):
   with open(path,'x') as f:json.dump(value,f)
   Path(path).chmod(0o600)
   if Path(path).name=='cn-reviewed-'+m.TAG+'-once.json':events.append('reserve-once')
  def sha(raw):return hashlib.sha256(raw).hexdigest()
  base={'environment':'cn','source':m.SOURCE,'tag':m.TAG,'baseline':{'api':{'containerId':'old-cid','imageId':'old'}},'nginx':{'path':str(nginx)},'configurationPins':[],'project':'p','bootstrapProbe':{'binding':{'baselineEnvSha256':sha(json.dumps({'PGHOST':'rds','PGDATABASE':'database','PGPORT':'5432','APP_DB_USER':'app_rw'},sort_keys=True).encode())}}}
  cfg={'stateDirectory':str(root),'project':'p','services':{'api':'api'},'composeFiles':[],'envFile':{'path':str(nginx)},'verificationCommand':['public-probe']}
  def rows(images):return [{'Id':('old-cid' if image=='old' else 'new-cid'),'Image':image,'Config':{'Labels':{'com.docker.compose.service':s}}} for s,image in images.items()]
  class D:
   def json(self,args):
    return {'services':{'api':{'image':'new' if 'candidate-images.json' in ' '.join(args) else 'old'}}}
   def run(self,args,**kw):
    if 'up' in args:state['images']={'api':'old' if 'old-images.json' in ' '.join(args) else 'new'};state['running']=True;events.append('up-'+state['images']['api'])
    if 'stop' in args:state['running']=False;events.append('stop-current')
    return b''
  class Host:
   def __init__(self,p,a,fd):self.p=p;self.a=a
   def runtime(self):return rows(state['images'])
   def stop(self):state['running']=False;events.append('stop-old')
   def start(self):state['running']=True;events.append('start-old')
   def nginx(self,expected,replacement):
    if nginx.read_bytes()!=expected:raise ValueError('NGINX_CAS')
    nginx.write_bytes(replacement);events.append('nginx-'+replacement.decode())
   def adapter(self,name,mode):
    import re
    if name=='oldApplicationProbe' and self.a!=attempt:assert re.fullmatch('tag-maintenance-[a-f0-9]{32}',self.a.name)
    events.append(name);return {'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE' if name=='bootstrapProbe' else 'OLD_APPLICATION_VERIFIED'}
   def run(self,args,**kw):
    events.append('public-business')
    if failure=='public':raise ValueError('PUBLIC_FAIL')
    return b'CN_PUBLIC_BROWSER_PASSED\n'
  class Adapter:
   def __init__(self,*a):
    self.base={'baseline':'a'*64};self.cn=types.SimpleNamespace(HOST='rds',DB='database',SHELL='readonly ',read_source=self.read_source,helper=lambda d,operation,fn:fn(['docker','dump']))
   def read_source(self,d):
    if failure=='stopped-metadata':state['ledger']='BASELINE'
    return {'ledger':self.base if state['ledger']=='BASELINE' else {**self.base,**migrations}}
   def stopped(self):
    if state['running']:raise ValueError('NOT_STOPPED')
   def execute(self,mode):
    events.append('sql-'+mode)
    if mode=='preflight' and failure=='ledger-preflight':return {'status':'DRIFT'}
    if mode=='preflight' and failure=='migration-entry' and events.count('sql-preflight')==2:state['ledger']='BASELINE'
    if mode=='drain':return {'status':'DRAINED','ledgerStatus':state['ledger']}
    if mode=='apply':
     self.stopped();state['ledger']='COMPLETE'
     if failure=='ack':raise TimeoutError()
     return {'status':'COMMITTED','commitAcknowledged':True}
    return {'status':state['ledger']}
  migrations={'one':'b'*64,'two':'c'*64,'three':'d'*64}
  def encrypt(args,out):
   self.assertNotIn('--no-owner',args[-1]);self.assertNotIn('--no-acl',args[-1]);events.append('backup');archive=out/'database.pgdump.enc';key=out/'backup.key';archive.write_bytes(b'x'*1100);key.write_bytes(b'a'*64);return archive,key
  core=types.SimpleNamespace(save=save,MIGRATIONS=migrations,sha=sha,encrypt_dump=encrypt,private_backup_files=lambda *a:None)
  def health(ctx,command,images):events.append('health-'+images['api']);self.assertTrue(state['running']);return {'healthy':True}
  act=types.SimpleNamespace(runtime_rows=lambda d,p,services,images:rows(images),live_config_cas=lambda *a: (_ for _ in ()).throw(ValueError('LIVE_CONFIG_DRIFT')) if failure=='config-preflight' else None,verify_held_runtime=health)
  maint=types.SimpleNamespace(Host=Host,runtime_set=lambda *a:None,pinned=lambda ref,**kw: (_ for _ in ()).throw(ValueError('INPUT_HASH_DRIFT')) if failure=='env-drift' and 'backup' in events and ref['path']==str(nginx) else Path(ref['path']),maintenance_bytes=lambda raw,env:b'held')
  request={k:k for k in ('environment','tag','sourceRevision','planSha256','manifestSha256')}
  ctx={'policy':{'runtimeSeconds':10,'businessSeconds':10,'rollbackSeconds':30},'policyRef':{'path':'policy','sha256':'a'*64},'mods':{'schema-restore-rehearsal':core,'tag-maintenance-release':maint,'tag-migrated-activation':act,'minimal-docker-release':types.SimpleNamespace(),'cn-tag-migration-adapter':types.SimpleNamespace(Adapter=Adapter),'schema-tag-prepare':types.SimpleNamespace(env_map=lambda r:{'PGHOST':'rds','PGDATABASE':'database','PGPORT':'5433' if failure=='api-env' else '5432','APP_DB_USER':'app_rw'}),'schema-release-handoff':types.SimpleNamespace(IDENTITY=tuple(request))},'attempt':attempt,'config':cfg,'d':D(),'base':base,'fd':3,'manifest':{'images':{'api':{'imageId':'new'}}},'command':['compose'],'request':request,'receipt':attempt/'result.json'}
  ctx['policy'].update(capability or {})
  # Failure recovery arms a bounded alarm; suppress it only inside fake orchestration.
  from unittest.mock import patch
  if failure=='old-once':(root/('cn-reviewed-'+m.TAG+'-once.json')).write_bytes(b'original spent capability')
  with patch.object(m.signal,'setitimer'):
   try:m.writer(ctx);error=None
   except ValueError as e:error=e
  return m,ctx,state,events,nginx,pending,error
 def test_success_fixed_flow_preserves_honest_scope(self):
  import json
  m,ctx,state,events,nginx,pending,error=self.exercise();self.assertIsNone(error);result=json.loads(ctx['receipt'].read_bytes());self.assertTrue(result['restoreNotPerformed']);self.assertEqual(state['ledger'],'COMPLETE');self.assertEqual(state['images'],{'api':'new'});self.assertEqual(nginx.read_bytes(),b'original')
  self.assertLess(events.index('backup'),events.index('sql-apply'));self.assertLess(events.index('health-old'),events.index('up-new'));self.assertEqual(events.count('sql-apply'),1)
  backup=json.loads((ctx['attempt']/'backup-restore.json').read_bytes());self.assertEqual(backup['restoreAcceptance'],'NOT_PERFORMED');self.assertTrue(backup['restoreNotPerformed']);self.assertTrue(pending.exists())
  with self.assertRaisesRegex(ValueError,'CAPABILITY_ALREADY_SPENT'):m.writer(ctx)
 def test_lost_ack_uses_one_apply_then_actual_reconcile(self):
  m,ctx,state,events,nginx,pending,error=self.exercise('ack');self.assertIsNone(error);self.assertEqual(events.count('sql-apply'),1);self.assertEqual(state['ledger'],'COMPLETE');self.assertEqual(nginx.read_bytes(),b'original')
 def test_candidate_public_failure_restores_old_apps_keeps_forward_schema(self):
  import json
  m,ctx,state,events,nginx,pending,error=self.exercise('public');self.assertIsNotNone(error);self.assertEqual(state['ledger'],'COMPLETE');self.assertEqual(state['images'],{'api':'old'});self.assertEqual(nginx.read_bytes(),b'original');self.assertTrue(pending.exists());failure=json.loads((ctx['attempt']/'cn-once-failure.json').read_bytes());self.assertFalse(failure['sqlRollbackAttempted']);self.assertEqual(failure['status'],'OLD_APPLICATION_RESTORED')

class BudgetTests(unittest.TestCase):
 def test_verifier_reserves_only_remaining_stages(self):
  m=module();p={'writerSeconds':240,'rollbackSeconds':100,'verifierSeconds':30,'outerVerificationSeconds':120}
  m.release_budget(p,600,'writer',now=100);m.release_budget(p,600,'verifier',now=400)
  with self.assertRaisesRegex(ValueError,'RELEASE_TOTAL_BUDGET'):m.release_budget(p,600,'writer',now=400)
  with self.assertRaisesRegex(ValueError,'RELEASE_TOTAL_BUDGET'):m.release_budget(p,600,'verifier',now=450)

class SourceBindingTests(unittest.TestCase):
 exercise=WriterOrchestrationTests.exercise
 def test_wrong_live_api_database_port_fails_before_stop_or_sql(self):
  m,ctx,state,events,nginx,pending,error=self.exercise('api-env');self.assertRegex(str(error),'API_SOURCE_DATABASE_ENV_DRIFT');self.assertEqual(events,[]);self.assertEqual(nginx.read_bytes(),b'original');self.assertEqual(state['ledger'],'BASELINE')

class ManifestPermissionTests(unittest.TestCase):
 def test_0644_manifest_accepts_root_hash_contract_but_private_proof_rejects(self):
  import tempfile,stat,types
  from unittest.mock import patch
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'manifest.json';path.write_bytes(b'{"images":{}}');path.chmod(0o644);pin={'path':str(path),'sha256':m.sha(path)};original=Path.lstat
   def root_stat(p):
    if p==path:
     actual=original(p);return types.SimpleNamespace(st_uid=0,st_mode=actual.st_mode)
    return types.SimpleNamespace(st_uid=0,st_mode=stat.S_IFDIR|0o755)
   with patch.object(Path,'lstat',root_stat):
    self.assertEqual(m.read(m.pinned(pin,private=False),private=False),{'images':{}})
    with self.assertRaisesRegex(ValueError,'PRIVATE_FILE'):m.pinned(pin)
    with self.assertRaisesRegex(ValueError,'PIN_DRIFT'):m.pinned({**pin,'sha256':'0'*64},private=False)

class PreUpDriftTests(unittest.TestCase):
 exercise=WriterOrchestrationTests.exercise
 def test_environment_drift_after_backup_rejects_before_candidate_up(self):
  m,ctx,state,events,nginx,pending,error=self.exercise('env-drift');self.assertRegex(str(error),'INPUT_HASH_DRIFT');self.assertNotIn('up-new',events);self.assertEqual(state['images'],{'api':'old'});self.assertEqual(state['ledger'],'COMPLETE')

class ReservationBoundaryTests(unittest.TestCase):
 exercise=WriterOrchestrationTests.exercise
 def test_readonly_config_or_ledger_preflight_failure_never_reserves_or_recovers(self):
  for failure,code in [('config-preflight','LIVE_CONFIG_DRIFT'),('ledger-preflight','INITIAL_LEDGER')]:
   with self.subTest(failure=failure):
    m,ctx,state,events,nginx,pending,error=self.exercise(failure);self.assertRegex(str(error),code);self.assertFalse((pending.parent/('cn-reviewed-'+m.TAG+'-once.json')).exists());self.assertFalse((ctx['attempt']/'cn-once-failure.json').exists());self.assertNotIn('stop-old',events);self.assertNotIn('nginx-held',events);self.assertEqual(nginx.read_bytes(),b'original');self.assertTrue(state['running']);self.assertEqual(state['ledger'],'BASELINE')
 def test_durable_reservation_between_readonly_preflight_and_first_hold(self):
  m,ctx,state,events,nginx,pending,error=self.exercise();self.assertIsNone(error);self.assertLess(events.index('sql-preflight'),events.index('reserve-once'));self.assertLess(events.index('reserve-once'),events.index('nginx-held'));self.assertEqual(events.count('reserve-once'),1)
 def test_preexisting_spent_capability_still_rejects_and_is_never_rewritten(self):
  m,ctx,state,events,nginx,pending,error=self.exercise('old-once');self.assertRegex(str(error),'CAPABILITY_ALREADY_SPENT');self.assertEqual(events,[]);self.assertEqual((pending.parent/('cn-reviewed-'+m.TAG+'-once.json')).read_bytes(),b'original spent capability');self.assertFalse((ctx['attempt']/'policy.json').exists());self.assertTrue(pending.exists())

class CompleteOnlyResumeTests(unittest.TestCase):
 exercise=WriterOrchestrationTests.exercise
 def test_complete_capability_real_writer_never_applies_sql(self):
  import json
  m,ctx,state,events,nginx,pending,error=self.exercise(capability={'expectedSchemaState':'COMPLETE'},initial_ledger='COMPLETE');self.assertIsNone(error);self.assertNotIn('sql-apply',events);self.assertNotIn('database-event-1.json',[p.name for p in ctx['attempt'].iterdir()]);self.assertEqual(state['images'],{'api':'new'});proof=json.loads((ctx['attempt']/'migration-ledger.json').read_bytes());self.assertFalse(proof['migrationExecuted']);self.assertEqual(proof['status'],'COMPLETE')
 def test_baseline_rejects_before_reservation_hold_or_stop(self):
  m,ctx,state,events,nginx,pending,error=self.exercise(capability={'expectedSchemaState':'COMPLETE'});self.assertRegex(str(error),'COMPLETE_SCHEMA_REQUIRED');self.assertNotIn('reserve-once',events);self.assertNotIn('nginx-held',events);self.assertNotIn('stop-old',events);self.assertNotIn('sql-apply',events);self.assertEqual(nginx.read_bytes(),b'original');self.assertTrue(pending.exists())
 def test_stopped_backup_and_migration_entry_drift_never_apply_and_restore_old(self):
  import json
  for failure,code in [('stopped-metadata','COMPLETE_BACKUP_LEDGER_REQUIRED'),('migration-entry','COMPLETE_SCHEMA_REQUIRED')]:
   with self.subTest(failure=failure):
    m,ctx,state,events,nginx,pending,error=self.exercise(failure,{'expectedSchemaState':'COMPLETE'},'COMPLETE');self.assertRegex(str(error),code);self.assertNotIn('sql-apply',events);self.assertNotIn('up-new',events);self.assertEqual(state['images'],{'api':'old'});self.assertEqual(nginx.read_bytes(),b'original');self.assertEqual(json.loads((ctx['attempt']/'cn-once-failure.json').read_bytes())['status'],'OLD_APPLICATION_RESTORED')
 def test_invalid_explicit_capability_values_fail_before_any_action(self):
  for value in (None,'','BASELINE','complete',True,0,[],{}):
   with self.subTest(value=value):
    m,ctx,state,events,nginx,pending,error=self.exercise(capability={'expectedSchemaState':value},initial_ledger='COMPLETE');self.assertRegex(str(error),'EXPECTED_SCHEMA_STATE_INVALID');self.assertEqual(events,[]);self.assertFalse((ctx['attempt']/'policy.json').exists())
 def test_migrate_complete_scope_rejects_baseline_without_draining_or_apply(self):
  m=module();a=Mock();a.execute.return_value={'status':'BASELINE'};record=Mock()
  with self.assertRaisesRegex(ValueError,'COMPLETE_SCHEMA_REQUIRED'):m.migrate_once(a,record,expected_state='COMPLETE')
  self.assertEqual([c.args[0] for c in a.execute.call_args_list],['preflight']);a.stopped.assert_not_called();record.assert_not_called()
