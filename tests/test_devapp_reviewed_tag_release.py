import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
P=Path(__file__).resolve().parents[1]/'scripts/devapp-reviewed-tag-release.py'
def module():
 s=importlib.util.spec_from_file_location('devapp_release',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class LedgerSafety(unittest.TestCase):
 def test_original_439_preserved_and_only_exact_eight_added(self):
  m=module();base={str(i):'a'*64 for i in range(439)}
  self.assertEqual(m.ledger_state(base,base),'BASELINE');self.assertEqual(m.ledger_state(base,{**base,**m.MIGRATIONS}),'COMPLETE')
  first=dict(list(m.MIGRATIONS.items())[:3]);self.assertEqual(m.ledger_state(base,{**base,**first}),'PARTIAL')
  for wrong in ({**base,'historical':'b'*64},{**base,'0':'b'*64},{**base,**m.MIGRATIONS,next(iter(m.MIGRATIONS)):'0'*64}):
   with self.assertRaises(ValueError):m.ledger_state(base,wrong)
 def test_epoch_never_activated_or_reset(self):
  m=module();m.check_epoch({'exists':False});m.check_epoch({'exists':True,'rows':[{'generation':None,'activated_at':None}]})
  for epoch in ({'exists':True,'rows':[]},{'exists':True,'rows':[{'generation':'live','activated_at':'now'}]}):
   with self.assertRaisesRegex(ValueError,'EPOCH'):m.check_epoch(epoch)
 def test_unknown_batch_never_automatically_retries(self):
  m=module();a=Mock();a.read.return_value={'state':'BASELINE'};a.apply.side_effect=TimeoutError();a.reconcile.return_value={'state':'PARTIAL'};record=Mock()
  with self.assertRaisesRegex(ValueError,'RECONCILIATION_REQUIRED'):m.apply_once(a,record)
  a.apply.assert_called_once();a.reconcile.assert_called_once()
 def test_complete_skips_runner_partial_rejects_without_runner(self):
  m=module()
  for state in ('COMPLETE','PARTIAL'):
   a=Mock();a.read.return_value={'state':state}
   if state=='COMPLETE':self.assertFalse(m.apply_once(a,Mock())['migrationExecuted'])
   else:
    with self.assertRaisesRegex(ValueError,'RECONCILIATION_REQUIRED'):m.apply_once(a,Mock())
   a.apply.assert_not_called()

class ExactRunnerContract(unittest.TestCase):
 def test_actual_fixed_source_sql_bytes_match_all_eight_pins(self):
  import subprocess,hashlib
  m=module();files={n:subprocess.check_output(['git','show',m.SOURCE+':apps/api/migrations/'+n],cwd=P.parents[1]) for n in m.MIGRATIONS}
  self.assertEqual(len(m.reviewed_sql(files)),8)
  changed=dict(files);name=next(iter(changed));changed[name]+=b'\n'
  with self.assertRaisesRegex(ValueError,'EXACT_EIGHT_SQL_REQUIRED'):m.reviewed_sql(changed)
 def test_epoch_presence_cannot_be_integer_or_null(self):
  m=module()
  for value in (None,0,1,'false'):
   with self.assertRaisesRegex(ValueError,'EPOCH'):m.check_epoch({'exists':value})
 def test_native_runner_is_scoped_to_exact_directory_without_force(self):
  source=P.read_text();self.assertIn('force:false,dir',source);self.assertIn("fs.mkdtempSync('/tmp/exact-eight-')",source);self.assertNotIn('force:true',source)

class FullWriterStateMachine(unittest.TestCase):
 def exercise(self,failure=None):
  import tempfile,json,types,contextlib
  from unittest.mock import patch
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);attempt=root/'attempt';attempt.mkdir();pending=root/'pending.json';pending.write_bytes(b'originalpending');events=[];state={'schema':'BASELINE','images':{'api':'old'},'running':True};baseline={str(i):'a'*64 for i in range(439)}
  def save(path,value):
   with open(path,'x') as f:json.dump(value,f)
   Path(path).chmod(0o600)
  def rows(images):return [{'Id':'oldcid' if image=='old' else 'newcid','Image':image,'Config':{'Labels':{'com.docker.compose.service':s}}} for s,image in images.items()]
  class D:
   def json(self,args):return {'services':{'api':{'image':'new' if 'candidate-images.json' in ' '.join(args) else 'old'}}}
   def run(self,args,**kw):
    if 'stop' in args:state['running']=False;events.append('stop')
    if 'start' in args:state['running']=True;events.append('start-old')
    if 'up' in args:state['running']=True;state['images']={'api':'new' if 'candidate-images.json' in ' '.join(args) else 'old'};events.append('up-'+state['images']['api'])
    return b''
  class DB:
   def __init__(self,ctx):pass
   def read(self):return {'state':state['schema'],'ledger':{**baseline,**(m.MIGRATIONS if state['schema']=='COMPLETE' else dict(list(m.MIGRATIONS.items())[:2]) if state['schema']=='PARTIAL' else {})},'epoch':{'exists':False} if state['schema']=='BASELINE' else {'exists':True,'rows':[{'generation':None,'activated_at':None}]}}
   def reconcile(self):events.append('reconcile');return self.read()
   def stopped(self):assert not state['running']
   def drain_sessions(self):events.append('drain-sessions')
   def drain(self):self.stopped();events.append('drain-unknown')
   def dump(self,out):
    self.stopped();events.append('backup');archive=out/'database.pgdump.enc';key=out/'backup.key';archive.write_bytes(b'e'*1100);key.write_bytes(b'a'*64);archive.chmod(0o600);key.chmod(0o600);return archive,key
   def apply(self):
    self.stopped();events.append('native-eight')
    if failure=='partial':state['schema']='PARTIAL';raise TimeoutError()
    state['schema']='COMPLETE';return {'status':'NATIVE_BATCH_COMPLETE'}
  core=types.SimpleNamespace(save=save,private_backup_files=lambda *a:None);engine=types.SimpleNamespace();act=types.SimpleNamespace(runtime_rows=lambda d,p,services,images:rows(images),live_config_cas=lambda *a:None)
  cfg={'stateDirectory':str(root),'project':'workspacex-image','services':{'api':'api'},'composeFiles':[],'envFile':{},'verificationFiles':[]};p={'historicalAdmission':{},'closurePins':{},'baseline':{'api':{'containerId':'oldcid','imageId':'old'}},'baselineLedger':baseline,'runtimeSeconds':10,'rollbackSeconds':60};identities=('environment','tag','sourceRevision','planSha256','manifestSha256');ctx={'p':p,'cfg':cfg,'attempt':attempt,'d':D(),'mods':{'schema-restore-rehearsal':core,'schema-tag-prepare':types.SimpleNamespace(),'minimal-docker-release':engine,'schema-release-handoff':types.SimpleNamespace(IDENTITY=identities)},'command':['compose'],'manifest':{'images':{'api':{'imageId':'new'}}},'requestRef':{},'policyRef':{},'request':{k:k for k in identities},'receipt':attempt/'result.json'}
  def business(ctx,phase):
   events.append('business-'+phase)
   if failure=='business' and phase=='candidate':raise ValueError('BUSINESS_FAILED')
   out=attempt/(phase+'-proof.json');save(out,{'actualFakeBusiness':True});return m.ref(out)
  def health(ctx,cmd,images,*args):assert state['running'];events.append('health-'+images['api']);return {'healthy':True}
  with contextlib.ExitStack() as stack:
   stack.enter_context(patch.object(m,'Database',DB));stack.enter_context(patch.object(m,'load',return_value=act));stack.enter_context(patch.object(m,'health',side_effect=health));stack.enter_context(patch.object(m,'business',side_effect=business));stack.enter_context(patch.object(m,'pinned',return_value=attempt));stack.enter_context(patch.object(m.signal,'setitimer'))
   try:m.writer(ctx);error=None
   except ValueError as e:error=e
  return m,ctx,state,events,pending,error
 def test_success_preserves_history_epoch_and_exact_one_native_batch(self):
  import json
  m,ctx,state,events,pending,error=self.exercise();self.assertIsNone(error);self.assertEqual(events.count('native-eight'),1);self.assertLess(events.index('backup'),events.index('native-eight'));self.assertLess(events.index('business-baseline-forward'),events.index('up-new'));self.assertTrue(pending.exists());proof=json.loads((ctx['attempt']/'migration-ledger.json').read_bytes());self.assertFalse(proof['force']);self.assertFalse(proof['resetPerformed']);self.assertEqual(len(proof['completeLedger']),447);m.check_epoch(proof['epoch']);self.assertEqual(state['images'],{'api':'new'})
 def test_partial_batch_failure_never_retries_and_restores_verified_old(self):
  import json
  m,ctx,state,events,pending,error=self.exercise('partial');self.assertRegex(str(error),'RECONCILIATION_REQUIRED');self.assertEqual(events.count('native-eight'),1);self.assertNotIn('up-new',events);self.assertEqual(state['schema'],'PARTIAL');self.assertEqual(state['images'],{'api':'old'});self.assertNotIn('business-recovery',events);self.assertIn('drain-unknown',events);self.assertFalse(state['running']);self.assertTrue(pending.exists());self.assertFalse(json.loads((ctx['attempt']/'failure.json').read_bytes())['sqlRollbackAttempted'])
 def test_failed_candidate_business_rolls_back_images_only(self):
  m,ctx,state,events,pending,error=self.exercise('business');self.assertRegex(str(error),'BUSINESS_FAILED');self.assertEqual(state['schema'],'COMPLETE');self.assertEqual(state['images'],{'api':'old'});self.assertTrue(pending.exists());self.assertTrue((pending.parent/('devapp-'+m.TAG+'-once.json')).exists());self.assertIn('business-recovery',events)

class CompleteEpochAndBudget(unittest.TestCase):
 def test_complete_requires_created_but_dormant_epoch(self):
  m=module()
  with self.assertRaisesRegex(ValueError,'COMPLETE_EPOCH_REQUIRED'):m.check_epoch({'exists':False},required=True)
  m.check_epoch({'exists':True,'rows':[{'generation':None,'activated_at':None}]},required=True)
 def test_verifier_budget_does_not_reserve_writer_twice(self):
  m=module();p={'writerSeconds':200,'rollbackSeconds':140,'verifierSeconds':30,'outerVerificationSeconds':120};cfg={'readinessTimeoutSeconds':120};m.release_budget(p,{'expiresAt':600},'writer',cfg,now=50);m.release_budget(p,{'expiresAt':600},'verifier',cfg,now=400)
  with self.assertRaisesRegex(ValueError,'RELEASE_TOTAL_BUDGET'):m.release_budget(p,{'expiresAt':600},'writer',cfg,now=400)

class UnknownDrainAndStorage(unittest.TestCase):
 def test_unknown_writer_must_be_drained_before_any_reconcile(self):
  m=module();a=Mock();a.read.return_value={'state':'BASELINE'};a.apply.side_effect=TimeoutError();a.drain.side_effect=ValueError('HELPER_NOT_GONE')
  with self.assertRaisesRegex(ValueError,'HELPER_NOT_GONE'):m.apply_once(a,Mock())
  a.apply.assert_called_once();a.drain.assert_called_once();a.reconcile.assert_not_called()
 def test_large_sparse_archive_is_bounded_above_old_128mib(self):
  import tempfile
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   archive=Path(tmp)/'archive';key=Path(tmp)/'key';key.write_bytes(b'a'*64);key.chmod(0o600)
   with open(archive,'wb') as f:f.truncate(129*1024*1024)
   archive.chmod(0o600);m.backup_files(archive,key)
   with open(archive,'wb') as f:f.truncate(m.BACKUP_LIMIT+1)
   with self.assertRaisesRegex(ValueError,'BACKUP_SIZE_BOUND'):m.backup_files(archive,key)
 def test_insufficient_disk_rejects_before_any_credentials_or_helper(self):
  import tempfile,types
  from unittest.mock import patch
  m=module()
  with tempfile.TemporaryDirectory() as tmp,patch.object(m.os,'statvfs',return_value=types.SimpleNamespace(f_bavail=0,f_frsize=4096)),patch.object(m.subprocess,'Popen') as popen:
   with self.assertRaisesRegex(ValueError,'BACKUP_DISK_RESERVE'):m.encrypted_source_dump(Mock(),tmp)
   popen.assert_not_called();self.assertEqual(list(Path(tmp).iterdir()),[])
 def test_shared_deadline_rejects_expired_and_caps_subprocess_budget(self):
  from unittest.mock import patch
  m=module()
  with patch.object(m.time,'monotonic',return_value=100):
   self.assertEqual(m.remaining({'operationDeadline':105},300),5)
   with self.assertRaisesRegex(ValueError,'OPERATION_DEADLINE'):m.remaining({'operationDeadline':99},300)

class NativeHelperBoundary(unittest.TestCase):
 def exercise(self,lost_ack=False):
  import tempfile,json,types,subprocess
  from unittest.mock import patch
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);out=Path(tmp.name);token='b'*32;pgid='c'*64;image='sha256:'+'d'*64;db=object.__new__(m.Database);db.p={'candidateImages':{'api':{'imageId':image}}};db.pg={'Id':pgid};db.ctx={'attempt':out};db.stopped=Mock();db.read=Mock(return_value={'state':'BASELINE'});files={n:subprocess.check_output(['git','show',m.SOURCE+':apps/api/migrations/'+n],cwd=P.parents[1]) for n in m.MIGRATIONS};db.prep=Mock();db.prep.exact_sql.return_value=files;db.prep.env_map.return_value={'POSTGRES_USER':'postgres','POSTGRES_PASSWORD':'fixture-password'};db.d=Mock();scans=[0]
  def command(args,**kw):
   if args[0]=='ps':
    scans[0]+=1;return b'ownedcid\n' if lost_ack and scans[0]==1 else b''
   return b''
  db.d.run.side_effect=command;db.prep.inspect_one.return_value={'Name':'/wsx-devapp-eight-'+token,'Image':image,'Config':{'Labels':{'wsx.devapp.eight':token}},'HostConfig':{'NetworkMode':'container:'+pgid}}
  completed=types.SimpleNamespace(returncode=0,stdout=json.dumps({'status':'NATIVE_BATCH_COMPLETE','applied':list(m.MIGRATIONS),'skipped':[]}).encode())
  with patch.object(m.uuid,'uuid4',return_value=types.SimpleNamespace(hex=token)),patch.object(m.subprocess,'run',side_effect=subprocess.TimeoutExpired('docker',1) if lost_ack else None,return_value=completed) as child:
   try:value=db.apply();error=None
   except subprocess.TimeoutExpired as exc:value=None;error=exc
  return m,out,db,child,value,error
 def test_native_helper_uses_minimal_daemon_environment_and_exact_eight_payload(self):
  import json
  m,out,db,child,value,error=self.exercise();self.assertIsNone(error);self.assertEqual(value['status'],'NATIVE_BATCH_COMPLETE');args=child.call_args.args[0];env=child.call_args.kwargs['env'];self.assertEqual(set(env),{'PATH','LANG'});self.assertNotIn('DOCKER_HOST',env);payload=json.loads(child.call_args.kwargs['input']);self.assertEqual(set(payload['files']),set(m.MIGRATIONS));self.assertEqual(payload['hashes'],m.MIGRATIONS);self.assertIn('force:false,dir',args[-1]);self.assertEqual(list(out.iterdir()),[])
 def test_lost_ack_reconciles_and_removes_only_owned_native_helper(self):
  m,out,db,child,value,error=self.exercise(True);self.assertIsNotNone(error);self.assertIn(['rm','--force','ownedcid'],[c.args[0] for c in db.d.run.call_args_list]);self.assertEqual(list(out.iterdir()),[]);child.assert_called_once()

class InventoryScope(unittest.TestCase):
 def test_only_api_exact_eight_added_no_other_image_schema_changes(self):
  m=module();change={'role':'api','added':list(m.MIGRATIONS),'removed':[],'changed':[]};m.exact_plan({'changes':[change]})
  for value in ({**change,'role':'agent'},{**change,'removed':['old.sql']},{**change,'changed':['old.sql']},{**change,'added':list(m.MIGRATIONS)[:-1]}):
   with self.assertRaisesRegex(ValueError,'EXACT_EIGHT_IMAGE_CHANGES'):m.exact_plan({'changes':[value]})
