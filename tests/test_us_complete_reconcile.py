import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
S=Path(__file__).resolve().parents[1]/'scripts/us-complete-reconcile.py'
def module():
 s=importlib.util.spec_from_file_location('reconcile_test',S);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class ReconcileTests(unittest.TestCase):
 def test_closure_required_before_import(self):
  m=module()
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'load') as load:
   with self.assertRaisesRegex(ValueError,'COMPLETE_RECONCILE_CLOSURE'):m.reconcile_complete({})
   load.assert_not_called()
 def test_pending_archive_cas_keeps_pending_on_drift(self):
  import tempfile
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pending.json';p.write_bytes(b'changed');dest=p.with_name('pending-archive.json')
   with self.assertRaisesRegex(ValueError,'PENDING_CAS'):m.archive_pending(p,dest,'a'*64)
   self.assertEqual(p.read_bytes(),b'changed');self.assertFalse(dest.exists())
 def test_quiet_counts_are_actual_zeros(self):
  m=module()
  for bad in ({'activeRuns':1,'preparedTransactions':0},{'activeRuns':0,'preparedTransactions':1},{'activeRuns':False,'preparedTransactions':0}):
   with self.assertRaisesRegex(ValueError,'DATABASE_NOT_QUIET'):m.check_quiet(bad)
  m.check_quiet({'activeRuns':0,'preparedTransactions':0})
if __name__=='__main__':unittest.main()

class ArchiveAndQuietTests(unittest.TestCase):
 def test_successful_archive_preserves_exact_original_bytes(self):
  import tempfile,hashlib
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pending.json';raw=b'{ "original": "bytes" }\n';p.write_bytes(raw);p.chmod(0o600);dest=p.with_name('pending-complete-original.json')
   m.archive_pending(p,dest,hashlib.sha256(raw).hexdigest());self.assertFalse(p.exists());self.assertEqual(dest.read_bytes(),raw);self.assertEqual(dest.stat().st_mode&0o777,0o600)
 def test_archive_fsync_failure_restores_pending(self):
  import tempfile,hashlib
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pending.json';p.write_bytes(b'original');dest=p.with_name('pending-complete-original.json')
   with patch.object(m.os,'fsync',side_effect=[OSError('disk'),None]):
    with self.assertRaises(OSError):m.archive_pending(p,dest,hashlib.sha256(b'original').hexdigest())
   self.assertEqual(p.read_bytes(),b'original');self.assertFalse(dest.exists())
 def test_quiet_query_is_readonly_and_nonterminal_statuses(self):
  m=module();self.assertTrue(m.QUIET_SQL.startswith('BEGIN READ ONLY;'));self.assertTrue(m.QUIET_SQL.endswith('ROLLBACK;'))
  self.assertIn("status IS NULL OR status NOT IN ('succeeded','failed','cancelled')",m.QUIET_SQL)
  for forbidden in ('UPDATE ','INSERT ','DELETE ','ALTER ','DROP ','CREATE '):self.assertNotIn(forbidden,m.QUIET_SQL)
 def test_existing_archive_never_overwritten(self):
  import tempfile,hashlib
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'pending.json';p.write_bytes(b'pending');dest=p.with_name('pending-exists');dest.write_bytes(b'old archive')
   with self.assertRaisesRegex(ValueError,'PENDING_CAS'):m.archive_pending(p,dest,hashlib.sha256(b'pending').hexdigest())
   self.assertEqual(dest.read_bytes(),b'old archive');self.assertEqual(p.read_bytes(),b'pending')

class ProducerOrchestrationTests(unittest.TestCase):
 def exercise(self,fail=None,refresh_mode=False):
  import tempfile,json,hashlib,types,contextlib
  m=module();tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);root=Path(tmp.name);state=root/'state';state.mkdir();old=state/'tag-maintenance-old';old.mkdir();config=root/'config.json';original=root/'input.json';lock=root/'lock';lock.write_bytes(b'');lock.chmod(0o600);pending=state/'pending.json';pending.write_bytes(b'{ "historicalPending": true }');pending.chmod(0o600);events=[]
  def save(path,value):
   path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
   with open(path,'x') as f:json.dump(value,f,sort_keys=True)
   path.chmod(0o600)
  def read(path,*a):return json.loads(Path(path).read_bytes())
  def ref(path):return {'path':str(path),'sha256':m.sha(path)}
  policy={'baseline':{'api':{'containerId':'api','imageId':'old-image'}},'usDatabase':{'containerId':'pg'},'environment':'us','source':m.SOURCE,'tag':m.TAG,'project':'p'}
  save(old/'policy.json',policy);save(original,policy)
  for name in ('databaseCommand-apply.json','databaseCommand-reconcile.json','stopped-backup/qualification.json'):save(old/name,{'original':name})
  save(config,{'environment':'us','lockFile':str(lock),'docker':'/usr/bin/docker','stateDirectory':str(state),'project':'p'})
  def inventory(path):return {str(p):m.sha(p) for p in Path(path).rglob('*') if p.is_file()}
  old_inventory=inventory(old);pending_hash=m.sha(pending);pins={n:m.sha(m.HERE/n) for n in m.CLOSURE};inputs={};captureout=state/'capture'
  def capture_complete(*args,**kwargs):
   events.append('capture')
   if fail=='capture':raise ValueError('INJECTED_CAPTURE')
   captureout.mkdir();st=__import__('os').fstat(args[3]);binding={'postgresImageId':'tool','canonicalLock':{'path':str(lock),'device':st.st_dev,'inode':st.st_ino},'originalEvidenceHashes':{**old_inventory,str(config):m.sha(config),str(original):m.sha(original),str(pending):pending_hash}}
   for name,value in {'binding':binding,'snapshot':{},'baselineLedger':{},'completeLedger':{}}.items():save(captureout/(name+'.json'),value);inputs[name]=ref(captureout/(name+'.json'))
   return inputs
  capture=types.SimpleNamespace(CLOSURE=('us-complete-source-capture.py',),read=read,history=lambda *a,**kw:(policy,{},pending_hash),all_history_files=inventory,capture_complete=capture_complete,pinned=lambda ref:Path(ref['path']))
  def qualify(docker,image,refs,out):events.append('qualify');Path(out).mkdir();save(Path(out)/'qualification.json',{'actualFakeRestore':True})
  def validate(*args):events.append('validate-qualification');return {}
  complete=types.SimpleNamespace(qualify_complete=qualify,validate_qualification=validate)
  class Docker:
   def __init__(self,*a):pass
   def run(self,args,**kwargs):
    if args[0]=='ps':return b''
    events.append('quiet')
    return json.dumps({'activeRuns':1 if fail=='quiet' else 0,'preparedTransactions':0}).encode()
  rows=[{'Id':'api','Image':'old-image','Config':{},'NetworkSettings':{}}]
  def service(*a):return rows[0]
  class Host:
   def __init__(self,p,attempt,fd):self.attempt=attempt;self.fd=fd
   def run(self,*a,**kw):raise AssertionError('readiness fake should not need process')
   def adapter(self,name,mode):
    events.append(name)
    if fail=='business' and name=='oldApplicationProbe':raise ValueError('INJECTED_BUSINESS')
    if name=='bootstrapProbe':
     raw=self.attempt/('bootstrap-raw-'+'a'*32+'.txt');raw.write_bytes(b'raw');raw.chmod(0o600);st=__import__('os').fstat(self.fd)
     proof={'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE','rawOutput':ref(raw),'canonicalLock':{'path':str(lock),'device':st.st_dev,'inode':st.st_ino}}
     save(self.attempt/('bootstrap-receipt-'+'a'*32+'.json'),proof)
    else:
     proof={'status':'OLD_APPLICATION_VERIFIED'}
     if fail=='history':(old/'policy.json').write_text('{"changed":true}')
    save(self.attempt/(name+'-'+mode+'.json'),proof)
    if fail=='business_lost_ack' and name=='oldApplicationProbe':raise ValueError('BUSINESS_SUCCEEDED_ACK_LOST')
    return proof
  maint=types.SimpleNamespace(SERVICES={'api'},runtime_set=lambda *a:None,startup_marker=lambda r:'actual-marker',Host=Host,readiness_pair=lambda *a:(events.append('readiness') or {'apiHealth':True,'webMarker':True}))
  class Adapter:
   def __init__(self,*a):pass
   def run(self,mode):self_mode=mode;events.append('reconcile-'+mode);self.test_mode=mode;return {'status':'COMPLETE'}
  us=types.SimpleNamespace(inherited_lock=lambda *a:None,psql_args=lambda cid:['docker','exec','postgres'],Adapter=Adapter)
  modules={'us-complete-source-capture':capture,'schema-complete-restore':complete,'schema-restore-rehearsal':types.SimpleNamespace(save=save),'tag-maintenance-release':maint,'us-tag-migration-adapter':us,'schema-tag-prepare':types.SimpleNamespace(live_service=service),'minimal-docker-release':types.SimpleNamespace(Docker=Docker),'tag-migrated-activation':types.SimpleNamespace(recovery_identity=lambda *a:None),'tag-bootstrap-probe':types.SimpleNamespace()}
  with contextlib.ExitStack() as stack:
   for key,val in {'CONFIG':str(config),'OLD':str(old),'INPUT':str(original),'LOCK':str(lock)}.items():stack.enter_context(patch.object(m,key,val))
   stack.enter_context(patch.object(m,'trusted',side_effect=lambda p,*a,**kw:Path(p)));stack.enter_context(patch.object(m.os,'geteuid',return_value=0));stack.enter_context(patch.object(m,'load',side_effect=lambda name,pins:modules[name]))
   refresh=None
   if refresh_mode:
    original_archive=state/'pending-complete-original.json';original_archive.write_bytes(b'original maintenance pending');original_archive.chmod(0o600)
    prior={'pendingArchive':ref(original_archive)};refresh={'priorRecovery':{'path':'fixed-prior','sha256':'e'*64},'preBindFailureAudit':{'path':'audit','sha256':'f'*64}}
    stack.enter_context(patch.object(m,'refresh_inputs',return_value=(prior,{},refresh['priorRecovery'],ref(pending))))
   try:result=m.reconcile_complete(pins,refresh=refresh)
   except ValueError as error:
    if fail=='business_lost_ack':
     self.assertEqual(str(error),'BUSINESS_SUCCEEDED_ACK_LOST')
     try:m.reconcile_complete(pins,refresh=refresh)
     except ValueError as retry_error:error=retry_error
     else:raise AssertionError('lost-ACK retry must reject')
    return None,events,pending,old,root,error,old_inventory
  return result,events,pending,old,root,None,old_inventory
 def test_explicit_refresh_reuses_full_body_and_preserves_original_archive(self):
  import json
  result,events,pending,old,root,error,original=self.exercise(refresh_mode=True)
  self.assertIsNone(error);receipt=json.loads(Path(result['path']).read_bytes())
  self.assertEqual(Path(receipt['pendingArchive']['path']).read_bytes(),b'original maintenance pending')
  self.assertEqual(Path(receipt['preBindFailure']['pendingArchive']['path']).read_bytes(),b'{ "historicalPending": true }')
  self.assertFalse(pending.exists());self.assertIn('refreshOf',receipt)
  self.assertEqual(events.count('capture'),1);self.assertEqual(events.count('qualify'),1);self.assertEqual(events.count('bootstrapProbe'),1);self.assertEqual(events.count('oldApplicationProbe'),1)
  self.assertEqual(events.count('reconcile-reconcile'),1);self.assertNotIn('reconcile-apply',events)
  self.assertEqual(len(list(pending.parent.glob('complete-refresh-*.json'))),1)
 def test_refresh_lost_business_ack_blocks_second_bootstrap_or_business(self):
  result,events,pending,old,root,error,original=self.exercise('business_lost_ack',refresh_mode=True)
  self.assertIsNone(result);self.assertRegex(str(error),'RECONCILIATION_ALREADY_ATTEMPTED');self.assertTrue(pending.exists())
  self.assertEqual(events.count('bootstrapProbe'),1);self.assertEqual(events.count('oldApplicationProbe'),1)
  self.assertEqual(len(list(pending.parent.glob('complete-refresh-*.json'))),1)
 def test_real_entry_success_orders_proofs_then_archives_exact_bytes(self):
  import json
  result,events,pending,old,root,error,original=self.exercise()
  self.assertIsNone(error);self.assertFalse(pending.exists());receipt=json.loads(Path(result['path']).read_bytes());archive=Path(receipt['pendingArchive']['path']);self.assertEqual(archive.read_bytes(),b'{ "historicalPending": true }')
  self.assertLess(events.index('capture'),events.index('qualify'));self.assertLess(events.index('qualify'),events.index('readiness'));self.assertLess(events.index('readiness'),events.index('bootstrapProbe'));self.assertLess(events.index('bootstrapProbe'),events.index('oldApplicationProbe'))
  self.assertEqual(events.count('bootstrapProbe'),1);self.assertEqual(events.count('oldApplicationProbe'),1);self.assertEqual(events.count('reconcile-reconcile'),1);self.assertFalse(receipt['targetImageActivated']);self.assertFalse(receipt['productionMigrationExecuted'])
  self.assertEqual({str(p):module().sha(p) for p in old.rglob('*') if p.is_file()},original)
 def test_capture_business_or_quiet_failure_preserves_original_pending(self):
  for failure in ('capture','business','quiet'):
   with self.subTest(failure=failure):
    result,events,pending,old,root,error,_=self.exercise(failure);self.assertIsNone(result);self.assertIsNotNone(error);self.assertEqual(pending.read_bytes(),b'{ "historicalPending": true }');self.assertEqual(list(pending.parent.glob('pending-complete-*')),[])
 def test_history_drift_prevents_pending_archive(self):
  result,events,pending,old,root,error,_=self.exercise('history');self.assertIsNone(result);self.assertRegex(str(error),'ORIGINAL_HISTORY_DRIFT');self.assertTrue(pending.exists())

 def test_lost_business_ack_with_no_uncertain_marker_cannot_reenter(self):
  result,events,pending,old,root,error,_=self.exercise('business_lost_ack')
  self.assertRegex(str(error),'RECONCILIATION_ALREADY_ATTEMPTED');self.assertTrue(pending.exists());self.assertEqual(events.count('oldApplicationProbe'),1);self.assertEqual(events.count('bootstrapProbe'),1)
  self.assertEqual(len(list(pending.parent.glob('complete-reconciliation-*.json'))),1)
  self.assertEqual(len(list(pending.parent.glob('tag-maintenance-*/business-once-intent.json'))),1)

class RefreshTests(unittest.TestCase):
 def test_refresh_requires_explicit_fixed_prior_and_operator_audit(self):
  m=module()
  for value in ({},{'priorRecovery':{}},{'priorRecovery':{'path':'/foreign','sha256':'a'*64},'preBindFailureAudit':{}}):
   with self.assertRaises(ValueError):m.refresh_inputs(value,{},None,None,None,None,None,None,0)
 def test_prebind_file_set_rejects_writer_artifacts_and_missing_probe_cleanup(self):
  m=module();base={'images.json','manifest.json','receipt.json','schema-config.json','schema-plan.json','schema-request.json'}
  probes={name for i in range(6) for name in ('probe-'+format(i,'032x')+'.json','probe-'+format(i,'032x')+'-cleanup.json')}
  m.prebind_names(base|probes)
  for bad in ((base|probes|{'writer-receipt.json'}),(base|probes)-{'probe-'+format(0,'032x')+'-cleanup.json'},base):
   with self.assertRaises(ValueError):m.prebind_names(bad)
 def test_actual_refresh_audit_files_and_historical_time_are_bound(self):
  import tempfile,json,time,types
  m=module()
  with tempfile.TemporaryDirectory() as tmp:
   state=Path(tmp);attempt=state/'attempt-51c94e15ec2e485e89fe10bae71a8b44';attempt.mkdir();now=time.time()
   def write(path,value):
    path.write_text(json.dumps(value));path.chmod(0o600);return {'path':str(path),'sha256':m.sha(path)}
   def read(path):return json.loads(Path(path).read_bytes())
   def pin(ref):
    path=Path(ref['path'])
    if ref.get('private') and path.stat().st_mode&0o077:raise ValueError('PRIVATE_FILE_REQUIRED')
    if m.sha(path)!=ref['sha256']:raise ValueError('PIN_DRIFT')
    return path
   manifest=write(attempt/'manifest.json',{});request=write(attempt/'schema-request.json',{'manifest':manifest,'environment':'us'})
   write(attempt/'receipt.json',{'status':'FAILED_OR_UNCERTAIN','code':'SCHEMA_RELEASE_RECONCILIATION_REQUIRED','stage':'schema-release'})
   for name in ('images.json','schema-config.json','schema-plan.json'):write(attempt/name,{})
   for i in range(6):
    for suffix in ('.json','-cleanup.json'):write(attempt/('probe-'+format(i,'032x')+suffix),{})
   for path in attempt.iterdir():
    if path.name in ('images.json','manifest.json') or path.name.startswith('probe-'):path.chmod(0o644)
   pending=write(state/'pending.json',{'attempt':str(attempt),'requestSha256':request['sha256'],'tag':m.TAG,'route':'schema-preparation'})
   prior=write(state/'prior.json',{'createdAt':now-3600});rootpolicy={'completeRecovery':prior}
   auditvalue={'kind':'reviewed-pre-bind-failure-v1','attempt':str(attempt),'priorRecovery':prior,'reason':'MANIFEST_PRIVATE_FILE_REQUIRED_BEFORE_WRITER_BIND','writerNeverStarted':True,'automaticRetryAllowed':False,'createdAt':now,'files':{p.name:m.sha(p) for p in attempt.iterdir()},'pending':pending}
   audit=write(state/'audit.json',auditvalue);refresh={'priorRecovery':prior,'preBindFailureAudit':audit};capture=types.SimpleNamespace(pinned=pin,read=lambda path:rootpolicy if str(path)=='/etc/workspacex-image-release/us-tag-activation.json' else {} if str(path)==m.INPUT else read(path));activation=Mock();us=Mock()
   with patch.object(m,'PRIOR',prior['path']),patch.object(m,'FAILED_ATTEMPT',str(attempt)):
    m.refresh_inputs(refresh,{'stateDirectory':str(state)},capture,activation,Mock(),Mock(),us,3,now)
    self.assertEqual(activation.complete_recovery.call_args.kwargs['now'],now-3600)
    before=(state/'pending.json').read_bytes();activation.reset_mock();(attempt/'manifest.json').write_text('{"changed":true}')
    with self.assertRaisesRegex(ValueError,'PIN_DRIFT'):m.refresh_inputs(refresh,{'stateDirectory':str(state)},capture,activation,Mock(),Mock(),us,3,now)
    activation.complete_recovery.assert_not_called();self.assertEqual((state/'pending.json').read_bytes(),before)
