import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
P=Path(__file__).resolve().parents[1]/'scripts/devapp-reviewed-tag-release.py'
def module():
 s=importlib.util.spec_from_file_location('devapp_release',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class LedgerSafety(unittest.TestCase):
 def test_original_439_preserved_and_only_exact_eight_added(self):
  m=module();base={str(i):'a'*64 for i in range(m.BASELINE_LEDGER_COUNT)}
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
 def exercise(self,failure=None,resume=False,initial_state=None,diagnostic=False,active=None,active_database=None):
  import tempfile,json,types,contextlib
  from unittest.mock import patch
  m=active.base if active else module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);attempt=root/'attempt';attempt.mkdir();pending=root/'pending.json';pending.write_bytes(b'originalpending');events=[];state={'schema':initial_state or ('COMPLETE' if resume else 'BASELINE'),'images':{'api':'old'},'running':True};baseline={str(i):'a'*64 for i in range(439)}
  def save(path,value):
   with open(path,'x') as f:json.dump(value,f)
   Path(path).chmod(0o600)
  def rows(images):return [{'Id':'oldcid' if image=='old' else 'newcid','Image':image,'Config':{'Labels':{'com.docker.compose.service':s}}} for s,image in images.items()]
  class D:
   def json(self,args):return {'services':{'api':{'image':'new' if 'candidate-images.json' in ' '.join(args) else 'old'}}}
   def run(self,args,**kw):
    if 'stop' in args:
     if failure=='recovery-stop' and 'business-recovery' in events:raise ValueError('STOP_FAILED')
     state['running']=False;events.append('stop')
    if 'start' in args:state['running']=True;events.append('start-old')
    if 'up' in args:state['running']=True;state['images']={'api':'new' if 'candidate-images.json' in ' '.join(args) else 'old'};events.append('up-'+state['images']['api'])
    return b''
  class DB:
   def __init__(self,ctx):pass
   def read(self):return {'state':state['schema'],'ledger':{**baseline,**(m.MIGRATIONS if state['schema']=='COMPLETE' else dict(list(m.MIGRATIONS.items())[:2]) if state['schema']=='PARTIAL' else {})},'epoch':{'exists':True,'rows':[{'generation':'billing-credits-2026-11-v1','activated_at':'2026-11-02T13:00:00+00:00'}]} if active else ({'exists':False} if state['schema']=='BASELINE' else {'exists':True,'rows':[{'generation':None,'activated_at':None}]})}
   def reconcile(self):events.append('reconcile');return self.read()
   def quiet_jobs(self):
    events.append('quiet-jobs')
    if failure=='active-jobs':raise ValueError('RESUME_ACTIVE_ASYNC_JOBS')
   def stopped(self):assert not state['running']
   def drain_sessions(self):events.append('drain-sessions')
   def drain(self):self.stopped();events.append('drain-unknown')
   def dump(self,out):
    self.stopped();events.append('backup');archive=out/'database.pgdump.enc';key=out/'backup.key';archive.write_bytes(b'e'*1100);key.write_bytes(b'a'*64);archive.chmod(0o600);key.chmod(0o600);return archive,key
   def apply(self):
    self.stopped();events.append('native-eight')
    if resume:raise AssertionError('NATIVE RUNNER FORBIDDEN')
    if failure=='partial':state['schema']='PARTIAL';raise TimeoutError()
    state['schema']='COMPLETE'
    if active:
     path=attempt/'financial-migration-proof.json';save(path,{'before':{},'after':{}});ctx['additionalMigrationProof']={'financialInvariant':m.ref(path)}
    return {'status':'NATIVE_BATCH_COMPLETE'}
  core=types.SimpleNamespace(save=save,private_backup_files=lambda *a:None);engine=types.SimpleNamespace();act=types.SimpleNamespace(runtime_rows=lambda d,p,services,images:rows(images),live_config_cas=lambda *a:None)
  cfg={'stateDirectory':str(root),'project':'workspacex-image','services':{'api':'api'},'composeFiles':[],'envFile':{},'verificationFiles':[],'verificationCommand':['/fixed/probe']};p={'historicalAdmission':{},'closurePins':{},'baseline':{'api':{'containerId':'oldcid','imageId':'old'}},'baselineLedger':baseline,'runtimeSeconds':10,'rollbackSeconds':60};identities=('environment','tag','sourceRevision','planSha256','manifestSha256');ctx={'p':p,'cfg':cfg,'attempt':attempt,'d':D(),'mods':{'schema-restore-rehearsal':core,'schema-tag-prepare':types.SimpleNamespace(),'minimal-docker-release':engine,'schema-release-handoff':types.SimpleNamespace(IDENTITY=identities)},'command':['compose'],'manifest':{'images':{'api':{'imageId':'new'}}},'requestRef':{},'policyRef':{},'request':{k:k for k in identities},'receipt':attempt/'result.json'}
  def business(ctx,phase):
   events.append('business-'+phase)
   if m.owned_business(ctx):
    save(attempt/(phase+'-once.json'),{'source':m.SOURCE,'tag':m.TAG});save(attempt/(phase+'-outcome.json'),{'phase':phase,'source':m.SOURCE,'tag':m.TAG,'command':cfg['verificationCommand'],'processGroupOwned':True,'ownedProcessGroupGone':not (failure=='cleanup' and phase=='candidate'),'status':'SUCCEEDED','exitCode':0})
    if failure=='cleanup' and phase=='candidate':raise ValueError('OWNED_PROCESS_GROUP_NOT_REAPED')
   if failure in ('recovery-business','recovery-stop') and phase in ('candidate','recovery'):raise ValueError('BUSINESS_FAILED')
   if failure=='business' and phase=='candidate':raise ValueError('BUSINESS_FAILED')
   out=attempt/(phase+'-proof.json');save(out,{'actualFakeBusiness':True});return m.ref(out)
  def health(ctx,cmd,images,*args):assert state['running'];events.append('health-'+images['api']);return {'healthy':True}
  if resume:
   p.update(expectedSchemaState='COMPLETE',resumeOriginal={'explicit':'root-capability'});(root/('devapp-'+m.TAG+'-once.json')).write_bytes(b'original spent once preserved')
  if active:
   p.update(activeEpochThree=True);active_database.side_effect=DB
  if diagnostic:
   p.update(resumePrevious={},activationNonce="b"*32,diagnosticBrowser=True);(root/("devapp-"+m.TAG+"-resume-23ecfeea853840acb7638e629c8f50d5.json")).write_bytes(b"previous spent once preserved")
  with contextlib.ExitStack() as stack:
   if resume:
    stack.enter_context(patch.object(m,'validate_resume',return_value={'original':'verified'}));stack.enter_context(patch.object(m,'resume_business_cleanup',return_value=failure!='cleanup'))
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
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);out=Path(tmp.name);token='b'*32;pgid='c'*64;image='sha256:'+'d'*64;db=object.__new__(m.Database);db.p={'candidateImages':{'api':{'imageId':image}}};db.pg={'Id':pgid};db.ctx={'attempt':out,'p':{}};db.stopped=Mock();db.read=Mock(return_value={'state':'BASELINE'});files={n:subprocess.check_output(['git','show',m.SOURCE+':apps/api/migrations/'+n],cwd=P.parents[1]) for n in m.MIGRATIONS};db.prep=Mock();db.prep.exact_sql.return_value=files;db.prep.env_map.return_value={'POSTGRES_USER':'postgres','POSTGRES_PASSWORD':'fixture-password'};db.d=Mock();scans=[0]
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

class IndependentVerifierSemantics(unittest.TestCase):
 def exercise(self,mutate=None,resume=False,history_error=False):
  import tempfile,json,types,contextlib,time
  from unittest.mock import patch
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);out=Path(tmp.name);baseline={str(i):'a'*64 for i in range(439)};complete={**baseline,**m.MIGRATIONS};epoch={'exists':True,'rows':[{'generation':None,'activated_at':None}]};current={'state':'COMPLETE','ledger':complete,'epoch':epoch}
  def save(name,value):
   path=out/name;path.write_text(json.dumps(value));path.chmod(0o600);return m.ref(path)
  command=['/fixed/business'];biz={'source':m.SOURCE,'tag':m.TAG,'command':command,'exitCode':0,'createdAt':time.time()}
  baseline_value=dict(biz);candidate_value=dict(biz)
  if resume:
   for phase,value in [('baseline-forward',baseline_value),('candidate',candidate_value)]:value['outcome']=save(phase+'-outcome.json',{**biz,'phase':phase,'status':'SUCCEEDED','processGroupOwned':True,'ownedProcessGroupGone':True})
  baseline_business=save('baseline-forward-business.json',baseline_value);candidate_business=save('candidate-business.json',candidate_value)
  archive=out/'archive';archive.write_bytes(b'e'*1100);archive.chmod(0o600);key=out/'key';key.write_bytes(b'a'*64);key.chmod(0o600)
  proof={'backup-restore':{'restoreNotPerformed':True,'archive':m.ref(archive),'key':m.ref(key),'source':save('source.json',{'ledger':baseline,'epoch':{'exists':False}})},'baseline-compatibility':{'oldImages':{'api':'old'},'actualForwardSchemaHealth':True,'resetPerformed':False,'business':baseline_business},'migration-ledger':{'baselineLedger':baseline,'completeLedger':complete,'epoch':epoch,'force':False,'resetPerformed':False,'migrationExecuted':False,'sqlReplayed':False},'candidate-acceptance':{'images':{'api':'new'},'business':candidate_business}}
  if mutate:mutate(proof,biz,save)
  refs={name:save(name+'.json',{**value,'sourceRevision':m.SOURCE,'tag':m.TAG,'createdAt':time.time()}) for name,value in proof.items()};receipt=save('result.json',{'restoreNotPerformed':True,'proofs':refs,**({'activationOnly':True,'originalResumeEvidence':{'original':'verified'}} if resume else {})})
  ctx={'receipt':Path(receipt['path']),'attempt':out,'request':{},'mods':{'schema-release-handoff':types.SimpleNamespace(verify_receipt=lambda *a:None),'schema-restore-rehearsal':types.SimpleNamespace(),'minimal-docker-release':types.SimpleNamespace()},'p':{'baselineLedger':baseline,'baseline':{'api':{'imageId':'old'}},'closurePins':{}},'cfg':{'services':{'api':'api'},'verificationCommand':command,'project':'p'},'manifest':{'images':{'api':{'imageId':'new'}}},'command':[],'d':types.SimpleNamespace(json=lambda *a:{})}
  act=types.SimpleNamespace(runtime_rows=lambda *a:[],live_config_cas=lambda *a:None)
  if resume:ctx['p'].update(resumeOriginal={},expectedSchemaState='COMPLETE')
  with contextlib.ExitStack() as stack:
   if resume:stack.enter_context(patch.object(m,'validate_resume',side_effect=ValueError('ORIGINAL_HISTORY_DRIFT') if history_error else None,return_value={'original':'verified'}))
   stack.enter_context(patch.object(m,'trusted',side_effect=lambda path,*a:Path(path)));stack.enter_context(patch.object(m,'Database',return_value=types.SimpleNamespace(read=lambda:current)));stack.enter_context(patch.object(m,'health',return_value={}));stack.enter_context(patch.object(m,'load',return_value=act))
   m.verifier(ctx)
 def test_all_original_semantics_pass(self):self.exercise()
 def test_correct_hash_cannot_hide_missing_or_wrong_baseline_business(self):
  mutations=[lambda p,b,s:p['baseline-compatibility'].pop('business'),lambda p,b,s:p['baseline-compatibility'].update(oldImages={'api':'wrong'}),lambda p,b,s:p['baseline-compatibility'].update(actualForwardSchemaHealth=False),lambda p,b,s:p['baseline-compatibility'].update(resetPerformed=True),lambda p,b,s:p['baseline-compatibility'].update(business=s('baseline-forward-business.json',{**b,'tag':'foreign'})),lambda p,b,s:p['baseline-compatibility'].update(business=s('wrong-phase.json',b))]
  for index,mutate in enumerate(mutations):
   with self.subTest(index=index),self.assertRaises(ValueError):self.exercise(mutate)
 def test_candidate_business_tag_and_current_epoch_must_match(self):
  for mutate in (lambda p,b,s:p['candidate-acceptance'].update(business=s('candidate-business.json',{**b,'tag':'foreign'})),lambda p,b,s:p['migration-ledger'].update(epoch={'exists':False})):
   with self.assertRaises(ValueError):self.exercise(mutate)

class DevappHostDatabaseBinding(unittest.TestCase):
 def fixture(self):
  m=module();mapping={'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55433'}]};api={'Config':{'Env':['PGHOST=127.0.0.1','PGPORT=55433','PGDATABASE=workspacex','APP_DB_USER=app_rw']},'HostConfig':{'NetworkMode':'host'},'NetworkSettings':{'Networks':{'host':{}}}};pg={'Id':'9d94859e93f065341b1acdb882f0c1ce57380d6c5040e76ac3e14c4dc9e2128b','Image':'sha256:ac24ce4f1fbd05eac05b966e3b7a4e189709c8bdff0bf822a4bcb73337449367','State':{'Running':True},'Config':{'Env':['POSTGRES_USER=postgres']},'HostConfig':{'NetworkMode':'workspacex_default','PortBindings':mapping},'NetworkSettings':{'Networks':{'workspacex_default':{'IPAddress':'172.19.0.5'}},'Ports':mapping}}
  return m,api,pg
 def test_actual_host_loopback_binding_is_proven(self):
  m,api,pg=self.fixture();m.source_binding(api,pg)
 def test_foreign_endpoint_source_or_mapping_rejects(self):
  import copy
  for kind in ('host','port','database','user','api-network','pg-id','pg-image','pg-network','configured-map','actual-map','extra-map','owner'):
   with self.subTest(kind=kind):
    m,api,pg=self.fixture();api=copy.deepcopy(api);pg=copy.deepcopy(pg)
    if kind in ('host','port','database','user'):
     key,value={'host':('PGHOST','remote'),'port':('PGPORT','5432'),'database':('PGDATABASE','foreign'),'user':('APP_DB_USER','postgres')}[kind];api['Config']['Env']=[line if not line.startswith(key+'=') else key+'='+value for line in api['Config']['Env']]
    elif kind=='api-network':api['HostConfig']['NetworkMode']='bridge'
    elif kind=='pg-id':pg['Id']='a'*64
    elif kind=='pg-image':pg['Image']='sha256:'+'a'*64
    elif kind=='pg-network':pg['HostConfig']['NetworkMode']='host'
    elif kind=='configured-map':pg['HostConfig']['PortBindings']={}
    elif kind=='actual-map':pg['NetworkSettings']['Ports']={}
    elif kind=='extra-map':pg['NetworkSettings']['Ports']={**pg['NetworkSettings']['Ports'],'5433/tcp':[{'HostIp':'0.0.0.0','HostPort':'55433'}]}
    else:pg['Config']['Env']=['POSTGRES_USER=foreign']
    with self.assertRaisesRegex(ValueError,'DEVAPP_SOURCE_BINDING'):m.source_binding(api,pg)

class ActivationOnlyFlow(unittest.TestCase):
 exercise=FullWriterStateMachine.exercise
 def test_new_resume_once_preserves_old_once_and_cannot_apply_native(self):
  import json
  m,ctx,state,events,pending,error=self.exercise(resume=True);self.assertIsNone(error);self.assertNotIn('native-eight',events);self.assertEqual(state['schema'],'COMPLETE');self.assertEqual((pending.parent/('devapp-'+m.TAG+'-once.json')).read_bytes(),b'original spent once preserved');self.assertTrue((pending.parent/('devapp-'+m.TAG+'-resume-23ecfeea853840acb7638e629c8f50d5.json')).exists());self.assertFalse(json.loads((ctx['attempt']/'migration-ledger.json').read_bytes())['migrationExecuted'])
 def test_resume_baseline_never_spends_new_once_or_stops_apps(self):
  m,ctx,state,events,pending,error=self.exercise(resume=True,initial_state='BASELINE');self.assertRegex(str(error),'RESUME_COMPLETE_SCHEMA_REQUIRED');self.assertNotIn('stop',events);self.assertNotIn('native-eight',events);self.assertFalse((pending.parent/('devapp-'+m.TAG+'-resume-23ecfeea853840acb7638e629c8f50d5.json')).exists())
 def test_native_method_itself_is_forbidden_in_resume(self):
  m=module();db=object.__new__(m.Database);db.ctx={'p':{'resumeOriginal':{}}};db.stopped=Mock()
  with self.assertRaisesRegex(ValueError,'NATIVE_APPLY_FORBIDDEN_IN_RESUME'):db.apply()
  db.stopped.assert_not_called()

class ResumeOriginalHistory(unittest.TestCase):
 def fixture(self):
  import tempfile,json,types
  from unittest.mock import patch
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);old=root/m.ORIGINAL_RESUME;old.mkdir(mode=0o700);(old/'backup').mkdir(mode=0o700);new=root/'new';new.mkdir();base={str(i):'a'*64 for i in range(439)};command=['/fixed/probe']
  def save(path,value):path.write_text(json.dumps(value));path.chmod(0o600)
  save(old/'schema-config.json',{'verificationCommand':command});save(old/'schema-request.json',{'environment':'devapp','sourceRevision':m.SOURCE,'tag':m.TAG,'config':m.ref(old/'schema-config.json')});save(old/'failure.json',{'status':'OLD_APPLICATION_RESTORED_ON_OBSERVED_SCHEMA','schemaState':'COMPLETE','sqlRollbackAttempted':False,'automaticRetryAllowed':False});save(old/'candidate-once.json',{'attempted':True});save(old/'migration-event-3.json',{'status':'POST_BATCH_RECONCILE','result':{'state':'COMPLETE','ledger':{**base,**m.MIGRATIONS},'epoch':{'exists':True,'rows':[{'generation':None,'activated_at':None}]}}})
  for phase in ('baseline-forward','recovery'):save(old/(phase+'-business.json'),{'source':m.SOURCE,'tag':m.TAG,'command':command,'exitCode':0})
  save(old/'migration-event-1.json',{'status':'NATIVE_BATCH_INTENT','source':m.SOURCE,'tag':m.TAG});save(old/'migration-event-2.json',{'status':'NATIVE_BATCH_RETURN','result':{'status':'NATIVE_BATCH_COMPLETE','applied':list(m.MIGRATIONS),'skipped':[]}});save(old/'backup/source.json',{'state':'BASELINE','ledger':base,'epoch':{'exists':False}});archive=old/'backup/database.pgdump.enc';archive.write_bytes(b'e'*1100);archive.chmod(0o600);key=old/'backup/backup.key';key.write_bytes(b'a'*64);key.chmod(0o600)
  once=root/('devapp-'+m.TAG+'-once.json');save(once,{'source':m.SOURCE,'tag':m.TAG,'request':m.ref(old/'schema-request.json')});files={str(path.relative_to(old)):m.file_sha(path) for path in old.rglob('*') if path.is_file()};pending_archive=root/'pending-original.json';save(pending_archive,{'tag':m.TAG,'attempt':str(old),'requestSha256':files['schema-request.json'],'automaticRetry':False})
  ctx={'p':{'expectedSchemaState':'COMPLETE','baselineLedger':base,'resumeOriginal':{'attempt':str(old),'files':files,'once':m.ref(once),'pendingArchive':m.ref(pending_archive)}},'cfg':{'stateDirectory':str(root),'verificationCommand':command},'attempt':new};patcher=patch.object(m,'trusted',side_effect=lambda path,*a:Path(path));patcher.start();self.addCleanup(patcher.stop);return m,ctx,old,once,save
 def test_original_committed_history_and_spent_once_are_read_only(self):
  m,ctx,old,once,save=self.fixture();original=m.file_sha(once);proof=m.validate_resume(ctx);self.assertFalse(proof['originalFilesModified']);self.assertEqual(m.file_sha(once),original)
 def test_original_tamper_or_extra_files_or_wrong_once_reject(self):
  for mode in ('tamper','extra','once'):
   with self.subTest(mode=mode):
    m,ctx,old,once,save=self.fixture()
    if mode=='tamper':save(old/'failure.json',{})
    elif mode=='extra':save(old/'extra.json',{})
    else:save(once,{'source':'foreign'})
    with self.assertRaises(ValueError):m.validate_resume(ctx)

class SafeBusinessOutcome(unittest.TestCase):
 def test_nonzero_and_timeout_keep_safe_phase_outcome_without_raw_output(self):
  import tempfile,json,types,subprocess
  from unittest.mock import patch
  m=module()
  for timeout in (False,True):
   with self.subTest(timeout=timeout),tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp);child=Mock();child.returncode=1;child.poll.return_value=None;child.communicate.side_effect=[subprocess.TimeoutExpired('probe',1),(b'',b'')] if timeout else [(b'REDACTED_PRIVATE_OUTPUT',b'')]
    def save(p,v):p.write_text(json.dumps(v));p.chmod(0o600)
    ctx={'attempt':path,'fd':3,'mods':{'schema-restore-rehearsal':types.SimpleNamespace(save=save)}}
    with patch.object(m.subprocess,'Popen',return_value=child):
     with self.assertRaises(Exception):m.run(ctx,['fixed'],1,phase='candidate')
    raw=(path/'candidate-outcome.json').read_text();self.assertNotIn('REDACTED_PRIVATE_OUTPUT',raw);self.assertEqual(json.loads(raw)['status'],'TIMEOUT' if timeout else 'RETURN_NONZERO')

class OwnedBusinessProcessGroup(unittest.TestCase):
 def test_timeout_reaps_only_its_owned_parent_and_child_and_keeps_safe_diag(self):
  import tempfile,types,sys,os,subprocess,json,time
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);pidfile=root/'child.pid';fd=os.open(root/'lock',os.O_RDWR|os.O_CREAT,0o600)
   def save(path,value):path.write_text(json.dumps(value));path.chmod(0o600)
   ctx={'attempt':root,'fd':fd,'p':{'resumeOriginal':{}},'mods':{'schema-restore-rehearsal':types.SimpleNamespace(save=save)}}
   script="import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']);print('BROWSER_DIAG '+ '{\"phase\":\"startup\",\"code\":\"TIMEOUT\",\"secret\":\"private-value\"}',file=sys.stderr,flush=True);open("+repr(str(pidfile))+",'w').write(str(p.pid));time.sleep(60)"
   try:
    from unittest.mock import patch
    clock=time.monotonic;started=clock();ready=[None]
    def relative_ready_clock():
     if clock()-started>30:raise AssertionError('fixture child failed to become ready')
     if not pidfile.exists():return 0
     if ready[0] is None:ready[0]=clock()
     return clock()-ready[0]
    with patch.object(m.time,'monotonic',side_effect=relative_ready_clock):
     with self.assertRaises(subprocess.TimeoutExpired):m.run_resume_business(ctx,[sys.executable,'-c',script],.25,'candidate')
    child=int(pidfile.read_text());r=subprocess.run(['ps','-p',str(child),'-o','stat='],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5);self.assertTrue(r.returncode!=0 or r.stdout.strip().startswith(b'Z'),r.stdout)
    raw=(root/'candidate-outcome.json').read_text();v=json.loads(raw);self.assertEqual(v['status'],'TIMEOUT');self.assertTrue(v['processGroupOwned']);self.assertEqual(v['browserDiagnostics'],[{'phase':'startup','code':'TIMEOUT'}]);self.assertNotIn('private-value',json.dumps({k:value for k,value in v.items() if k!='command'}))
   finally:os.close(fd)
 def test_unrecognized_diagnostic_keys_and_values_never_escape(self):
  m=module();self.assertEqual(m.browser_diagnostics(b'BROWSER_DIAG {"phase":"attacker-secret","code":"unknown-secret","url":"private"}\n'),[])

class ResumeAsyncSafety(unittest.TestCase):
 exercise=FullWriterStateMachine.exercise
 def test_actual_text_diagnostics_only_allow_known_tokens(self):
  m=module();value=m.browser_diagnostics(b'BROWSER_DIAG phase=billing-contract errorType=TimeoutError netCode=ERR_TIMED_OUT\nBROWSER_DIAG phase=secret errorType=Error netCode=ERR_PRIVATE\n');self.assertEqual(value,[{'phase':'billing-contract','errorType':'TimeoutError','netCode':'ERR_TIMED_OUT'}])

class ResumeIndependentVerifier(unittest.TestCase):
 exercise=IndependentVerifierSemantics.exercise
 def test_verifier_rechecks_original_history_and_no_native_migration(self):
  self.exercise(resume=True)
  with self.assertRaisesRegex(ValueError,'ORIGINAL_HISTORY_DRIFT'):self.exercise(resume=True,history_error=True)
  with self.assertRaisesRegex(ValueError,'VERIFIER_ACTIVATION_ONLY'):self.exercise(lambda p,b,s:p['migration-ledger'].update(migrationExecuted=True),resume=True)

class CleanupFailureRecovery(unittest.TestCase):
 exercise=FullWriterStateMachine.exercise
 def test_cleanup_not_proven_restores_images_health_only_without_second_business(self):
  import json
  m,ctx,state,events,pending,error=self.exercise('cleanup',resume=True);self.assertRegex(str(error),'OWNED_PROCESS_GROUP_NOT_REAPED');self.assertNotIn('business-recovery',events);self.assertEqual(state['images'],{'api':'old'});proof=json.loads((ctx['attempt']/'failure.json').read_bytes());self.assertEqual(proof['status'],'RECONCILIATION_REQUIRED');self.assertEqual(proof['recovery'],'OPERATOR_REQUIRED');self.assertTrue(proof['businessRecoverySkipped']);self.assertTrue(proof['readonlyHealthVerified']);self.assertTrue(pending.exists())
class VerifierRequiresGroupOutcome(unittest.TestCase):
 exercise=IndependentVerifierSemantics.exercise
 def test_valid_hash_and_zero_leader_exit_do_not_replace_group_terminal_proof(self):
  import time
  def mutate(p,b,save):
   outcome=save('candidate-outcome.json',{**b,'phase':'candidate','status':'SUCCEEDED','exitCode':0,'processGroupOwned':True,'ownedProcessGroupGone':False});p['candidate-acceptance']['business']=save('candidate-business.json',{**b,'outcome':outcome})
  with self.assertRaisesRegex(ValueError,'BUSINESS_OUTCOME_NOT_TERMINAL'):self.exercise(mutate,resume=True)

class DiagnosticResumeHistory(ResumeOriginalHistory):
 def previous(self):
  import time
  m,ctx,original,once,save=self.fixture();old=original.parent/m.PREVIOUS_RESUME;old.mkdir(mode=0o700);(old/'backup').mkdir(mode=0o700);command=['/original/probe'];stamp=time.time()-3600
  save(old/'schema-config.json',{'verificationCommand':command});save(old/'schema-request.json',{'environment':'devapp','sourceRevision':m.SOURCE,'tag':m.TAG,'config':m.ref(old/'schema-config.json')});save(old/'failure.json',{'status':'OLD_APPLICATION_RESTORED_ON_OBSERVED_SCHEMA','schemaState':'COMPLETE','sqlRollbackAttempted':False});save(old/'candidate-once.json',{'source':m.SOURCE,'tag':m.TAG})
  for phase in ('baseline-forward','recovery','candidate'):
   outcome={'phase':phase,'source':m.SOURCE,'tag':m.TAG,'command':command,'status':'RETURN_NONZERO' if phase=='candidate' else 'SUCCEEDED','exitCode':1 if phase=='candidate' else 0,'processGroupOwned':True,'ownedProcessGroupGone':True,'createdAt':stamp};save(old/(phase+'-outcome.json'),outcome)
   if phase!='candidate':
    path=old/(phase+'-business.json');save(path,{'source':m.SOURCE,'tag':m.TAG,'command':command,'exitCode':0,'createdAt':stamp,'outcome':m.ref(old/(phase+'-outcome.json'))});__import__('os').utime(path,(stamp+1,stamp+1))
  save(old/'backup/source.json',{'state':'COMPLETE','ledger':{**ctx['p']['baselineLedger'],**m.MIGRATIONS},'epoch':{'exists':True,'rows':[{'generation':None,'activated_at':None}]}})
  for name in ('database.pgdump.enc','backup.key'):
   path=old/'backup'/name;path.write_bytes(b'e'*1100 if name.endswith('enc') else b'a'*64);path.chmod(0o600)
  prioronce=old.parent/('devapp-'+m.TAG+'-resume-23ecfeea853840acb7638e629c8f50d5.json');save(prioronce,{'source':m.SOURCE,'tag':m.TAG,'request':m.ref(old/'schema-request.json')});ctx['p'].update(diagnosticBrowser=True,activationNonce='a'*32,resumePrevious={'attempt':str(old),'files':{},'once':m.ref(prioronce)})
  def refresh():ctx['p']['resumePrevious']['files']={str(p.relative_to(old)):m.file_sha(p) for p in old.rglob('*') if p.is_file()}
  refresh();return m,ctx,old,save,refresh
 def test_previous_successful_recovery_is_historical_not_renewed(self):
  m,ctx,old,save,refresh=self.previous();before=(old/'recovery-business.json').stat().st_mtime;self.assertEqual(m.validate_resume(ctx)['previous']['activationNonce'],'a'*32);self.assertEqual(before,(old/'recovery-business.json').stat().st_mtime)
 def test_wrong_terminal_candidate_or_nonce_or_extra_sql_rejects(self):
  for mode in ('timeout','group','nonce','native','recovery'):
   with self.subTest(mode=mode):
    m,ctx,old,save,refresh=self.previous()
    if mode=='nonce':ctx['p']['activationNonce']='bad'
    elif mode=='native':save(old/'migration-event-1.json',{})
    else:
     import json
     path=old/('recovery-outcome.json' if mode=='recovery' else 'candidate-outcome.json');value=json.loads(path.read_bytes());value.update({'ownedProcessGroupGone':False} if mode=='group' else {'status':'TIMEOUT'});save(path,value)
    refresh()
    with self.assertRaises(ValueError):m.validate_resume(ctx)

class DiagnosticActivationFlow(unittest.TestCase):
 exercise=FullWriterStateMachine.exercise
 def test_explicit_nonce_spends_new_once_without_reusing_two_originals(self):
  m,ctx,state,events,pending,error=self.exercise(resume=True,diagnostic=True);self.assertIsNone(error);self.assertNotIn('native-eight',events);root=pending.parent;self.assertTrue((root/('devapp-'+m.TAG+'-activation-'+'b'*32+'-once.json')).exists());self.assertEqual((root/('devapp-'+m.TAG+'-resume-23ecfeea853840acb7638e629c8f50d5.json')).read_bytes(),b'previous spent once preserved');self.assertEqual((root/('devapp-'+m.TAG+'-once.json')).read_bytes(),b'original spent once preserved')

class FailedRecoveryStopsApplications(unittest.TestCase):
 exercise=FullWriterStateMachine.exercise
 def test_failed_recovery_business_stops_and_proves_stopped(self):
  import json
  m,ctx,state,events,pending,error=self.exercise('recovery-business',resume=True);self.assertIsNotNone(error);self.assertFalse(state['running']);proof=json.loads((ctx['attempt']/'failure.json').read_bytes());self.assertEqual(proof['status'],'RECONCILIATION_REQUIRED');self.assertEqual(proof['trafficControl'],'stopped-five-applications');self.assertTrue(proof['applicationsStoppedVerified']);self.assertTrue(pending.exists());self.assertEqual(events[-1],'stop')
 def test_stop_failure_records_unknown_never_claims_maintenance(self):
  import json
  m,ctx,state,events,pending,error=self.exercise('recovery-stop',resume=True);proof=json.loads((ctx['attempt']/'failure.json').read_bytes());self.assertEqual(proof['trafficControl'],'UNKNOWN');self.assertFalse(proof['applicationsStoppedVerified']);self.assertEqual(proof['stopOutcome'],'UNKNOWN_OPERATOR_REQUIRED');self.assertTrue(pending.exists())
 def test_group_uncertain_health_only_recovery_also_stops_before_exit(self):
  import json
  m,ctx,state,events,pending,error=self.exercise('cleanup',resume=True);proof=json.loads((ctx['attempt']/'failure.json').read_bytes());self.assertFalse(state['running']);self.assertTrue(proof['applicationsStoppedVerified']);self.assertNotIn('business-recovery',events)
 def test_verified_successful_recovery_describes_actual_running_state(self):
  import json
  m,ctx,state,events,pending,error=self.exercise('business',resume=True);proof=json.loads((ctx['attempt']/'failure.json').read_bytes());self.assertTrue(state['running']);self.assertEqual(proof['trafficControl'],'verified-old-application-running')
