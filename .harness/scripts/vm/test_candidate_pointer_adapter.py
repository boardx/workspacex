import copy
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import candidate_pointer_adapter as m
from writer_fence import Journal,digest
from candidate_completion_contract import ledger_sha

spec=importlib.util.spec_from_file_location('compiled_maintenance_activation',pathlib.Path(__file__).with_name('cn-maintenance-activation.py'))
activation=importlib.util.module_from_spec(spec);spec.loader.exec_module(activation)

def raw(value):return (json.dumps(value,sort_keys=True)+'\n').encode()
def sha(value):return hashlib.sha256(value).hexdigest()

class Fixture:
 def __init__(self,root):
  self.root=pathlib.Path(root);self.files={};self.calls=[];self.hold=True;self.closed=True;self.fail=None
  self.identity={'sourceRevision':m.APP,'baselineRevision':m.BASELINE,'attemptId':'local-attempt','migrationPlanSha256':'a'*64}
  self.p={'identity':self.identity,'host':{'instanceId':'i-local','bootId':'local-boot'},'holdGeneration':'b'*32,'epoch':'c'*64,
          'migrationLedgerSha256':'d'*64,'closedAdmission':{'kind':'role-login-v1','login':{'workspacex':{'writer':False}}},
          'candidateWriters':[],'baselineWriters':[]}
  self.ledger=[{'name':'0001_local','checksum':'f'*64}]
  self.p['migrationLedgerSha256']=ledger_sha(self.ledger)
  self.diagnostic_binding={'pid':200,'source':'local-retained-diagnostic'}
  def query(operation):
   assert operation=='migration-ledger'
   return {'rowCount':len(self.ledger),'ledger':copy.deepcopy(self.ledger)}
  self.host=types.SimpleNamespace(plan={'toolRevision':'e'*40,'diagnosticSessions':{'workspacex':self.diagnostic_binding}},
   diagnostic_connections={'workspacex':types.SimpleNamespace(binding=self.diagnostic_binding,query=query)})
  now=datetime.datetime.now(datetime.timezone.utc)
  stamp=lambda delta:(now+datetime.timedelta(seconds=delta)).isoformat().replace('+00:00','Z')
  self.native_completion=dict(schemaVersion=1,scope='validated-production-migration-completion',sourceRevision=m.APP,
   baselineRevision=m.BASELINE,attemptId=self.identity['attemptId'],release='2026.10.3-cn.1',
   originalPlanSha256=self.identity['migrationPlanSha256'],completionPlanSha256='1'*64,sourceInventorySha256='2'*64,
   sourceBindingSha256='3'*64,snapshotSha256='4'*64,fullResponseSha256='5'*64,ledgerSha256=ledger_sha(self.ledger),
   appliedSqlCount=len(self.ledger),pendingCount=0,driftCount=0,unknownAppliedCount=0,capturedAt=stamp(-60),
   providerFinishedAt=stamp(-30),expiresAt=stamp(3000),productionMutationAuthorized=False)
  self.plan=self.p
  self.journal=Journal(root,self.identity,uid=os.getuid(),boundary=root)
  self.live=[]
  for side,revision in [('candidateWriters',m.APP),('baselineWriters',m.BASELINE)]:
   for i,service in enumerate(sorted(m.SERVICES)):
    cid=sha((side+service).encode());compose='/etc/workspacex-cn/'+side+'.json';self.put(compose,b'local-compose-'+side.encode())
    cfg={'Labels':{'org.opencontainers.image.revision':revision,'com.docker.compose.service':service,
         'com.docker.compose.project':side,'com.docker.compose.project.config_files':compose}}
    image='sha256:'+sha((revision+service).encode())
    binding={'containerId':cid,'imageId':image,'configSha256':digest(cfg),'composePath':compose,
             'composeSha256':sha(self.private(compose)),'service':service}
    self.p[side].append({'key':side+service,'binding':binding})
    self.live.append({'Id':cid,'Image':image,'Config':cfg,'State':{'Running':False,'Paused':False}})
  configroot='/etc/workspacex-cn/candidate-configs/'+m.APP+'/local-attempt/'
  self.binding=dict(identity=self.identity,toolRevision='e'*40,host=self.p['host'],holdGeneration=self.p['holdGeneration'],epoch=self.p['epoch'])
  for name,path,value in [
    ('baselineConfig',configroot+'baseline.json',raw({'schemaVersion':1,'environment':{'profile':'production'},'provision':{'release':'2026.9.30-cn.1'}})),
    ('candidateConfig',configroot+'deployment.json',raw({'schemaVersion':1,'environment':{'profile':'production'},'provision':{'release':'2026.10.3-cn.1'}})),
    ('baselineNginx',f'/var/lib/workspacex-cn/runtime/{m.APP}/baseline-nginx.conf',b'local baseline nginx'),
    ('candidateNginx',f'/var/lib/workspacex-cn/runtime/{m.APP}/nginx.conf',b'local candidate nginx'),
    ('migrationCompletion',f'/etc/workspacex-cn/migration-completion-inputs/{m.APP}/local-attempt.completed.json',
      raw(self.native_completion))]:
   self.put(path,value);self.binding[name]={'path':path,'sha256':sha(value)}
  self.binding['binaries']={name:{'path':path,'sha256':'f'*64} for name,path in [('nginx','/usr/sbin/nginx'),('systemctl','/usr/bin/systemctl')]}
  self.p['migrationCompletionSha256']=self.binding['migrationCompletion']['sha256']
  ref=self.binding['migrationCompletion'];self.journal.value.update(migrationCompletionReceipt=ref,migrationCompletionIntent=ref)
  self.journal.record('migration-completion-durable',receipt=ref,holdGeneration=self.p['holdGeneration'])
  for target,name in [(m.FIXED,'baselineConfig'),(m.NGINX,'baselineNginx')]:self.put(target,self.private(self.binding[name]['path']))
  self.refresh_profile()
 def put(self,path,value):
  local=self.files.setdefault(path,self.root/(sha(path.encode())+'.private'))
  local.write_bytes(value);local.chmod(0o600)
 def private(self,path,expected=None):
  value=self.files[path].read_bytes()
  if expected is not None and sha(value)!=expected:raise RuntimeError('INPUT_HASH')
  return value
 def refresh_profile(self):
  closure={m.SOURCE:sha(pathlib.Path(m.__file__).read_bytes()),m.ACTIVATION_SOURCE:sha(pathlib.Path(activation.__file__).read_bytes())}
  self.profile={'toolRevision':'e'*40,'filesSha256':closure,'candidateComposeEmitter':{'configRef':copy.deepcopy(self.binding['candidateConfig'])},'candidatePointerPromotion':{'schemaVersion':1,'sourcePath':m.SOURCE,'sha256':closure[m.SOURCE],'binding':copy.deepcopy(self.binding)}}
  manifest_path='/etc/workspacex-cn/approved-test-manifest.json'
  manifest=raw({'sourceRevision':self.identity['sourceRevision'],'release':'2026.10.3-cn.1'});self.put(manifest_path,manifest)
  options_path='/etc/workspacex-cn/approved-test-options.json'
  options=raw({'manifestRef':{'path':manifest_path,'sha256':sha(manifest)}});self.put(options_path,options)
  self.profile['candidateComposeEmitter']['optionsRef']={'path':options_path,'sha256':sha(options)}
  self.put(m.PROFILE,raw(self.profile))
 def require_lock(self):
  if not self.hold:raise RuntimeError('LOCK_OR_HOLD_LOST')
 def _guard(self,plan):self.require_lock()
 def verify_staging(self,plan):self.require_lock();return {'held':True}
 def _inventory(self,plan):
  return {w['key']:{'binding':w['binding'],'state':'running' if next(c for c in self.live if c['Id']==w['binding']['containerId'])['State']['Running'] else 'stopped'}
          for w in self.p['candidateWriters']+self.p['baselineWriters']}
 def docker_inventory(self):return copy.deepcopy(self.live)
 def verify_completed_migration(self,plan,nonce):
  return dict(identity=self.identity,epoch=self.p['epoch'],holdGeneration=self.p['holdGeneration'],
              completionSha256=self.p['migrationCompletionSha256'],ledgerSha256=self.p['migrationLedgerSha256'])
 def replace(self,path,expected,value):
  name='config' if path==m.FIXED else 'nginx';self.calls.append(('cas',name))
  durable=json.loads((self.root/'writer-fence.json').read_bytes())
  assert durable['candidatePointerIntents'][name]['expectedSha256']==expected
  assert any(e['state']=='candidate-pointer-intent' and e['pointer']==name for e in durable['events'])
  if self.fail==name+'-before':raise RuntimeError('local lost request')
  local=self.files[path]
  # Execute the existing real atomic CAS + fsync primitive on isolated local files;
  # only the root-private reader is replaced with a test-local ownership boundary.
  def local_private(p,expected=None):
   value=pathlib.Path(p).read_bytes()
   if expected is not None and sha(value)!=expected:raise RuntimeError('INPUT_HASH')
   return value
  with patch.object(activation,'private',side_effect=local_private):self.replace_original(local,expected,value)
  if self.fail==name+'-after':raise RuntimeError('local lost reply')
 def invoke(self,plan,binary,args,*extra):
  self.calls.append(('invoke',binary,tuple(args)))
  assert plan=={'binaries':self.binding['binaries']}
  assert (binary,args) in [('nginx',['-t']),('systemctl',['reload','nginx'])]
  if self.fail==binary:raise RuntimeError('local command failure')
  return b''
 def probes(self,host):
  fixture=self
  class Probes:
   def admission(self):
    return (fixture.p['closedAdmission'] if fixture.closed else {'kind':'role-login-v1','login':{'workspacex':{'writer':True}}}),{}
  return Probes()
 def contexts(self):
  return [patch.dict(sys.modules,{'compiled_maintenance_activation':activation}),
          patch.object(activation,'private',side_effect=self.private),patch.object(activation,'replace',side_effect=self.replace),
          patch.object(activation,'invoke',side_effect=self.invoke),patch.object(m,'FixedProbes',side_effect=self.probes),
          patch.object(m,'verify_bound_transport',side_effect=lambda plan,db,mode,binding: self.require_lock())]

class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='candidate-pointer-');os.chmod(self.tmp.name,0o700);self.f=Fixture(self.tmp.name)
  self.real_replace=activation.replace
  # The wrapper must retain the unpatched real primitive for local CAS.
  self.f.replace_original=self.real_replace
  self.contexts=self.f.contexts()
  for c in self.contexts:c.start()
 def tearDown(self):
  for c in reversed(self.contexts):c.stop()
  self.f.journal.close();self.tmp.cleanup()
 def adapter(self):return m.CandidatePointerAdapter(self.f,self.f.binding)
 def test_real_local_cas_has_durable_intents_and_fixed_reload_then_idempotent_readback(self):
  a=self.adapter();proof=a.promote_under_hold();self.assertTrue(proof['writesHeld']);self.assertTrue(proof['lockRetained'])
  self.assertEqual(self.f.calls,[('cas','config'),('cas','nginx'),('invoke','nginx',('-t',)),('invoke','systemctl',('reload','nginx'))])
  before=list(self.f.calls);self.assertEqual(a.promote_under_hold(),proof);self.assertEqual(self.f.calls,before)
  disk=json.loads((self.f.root/'writer-fence.json').read_bytes());self.assertEqual(disk['candidatePointerPromotion'],proof)
 def test_each_lost_reply_and_reload_failure_retains_unknown_without_baseline_restore(self):
  for failure in ('config-before','config-after','nginx-before','nginx-after','nginx','systemctl'):
   with self.subTest(failure=failure):
    self.tearDown();self.setUp();self.f.fail=failure
    with self.assertRaisesRegex(RuntimeError,'OUTCOME_UNKNOWN_LOCK_RETAINED'):self.adapter().promote_under_hold()
    self.assertTrue(self.f.journal.value['candidatePointerUnknown']['lockRetained'])
    self.assertTrue(self.f.hold);self.assertTrue(self.f.closed)
    self.assertLessEqual(sum(c[0]=='cas' for c in self.f.calls),2)
    if failure.endswith('after') or failure.startswith('nginx') or failure=='systemctl':
     self.assertEqual(self.f.private(m.FIXED),self.f.private(self.f.binding['candidateConfig']['path']))
    self.f.fail=None
    with self.assertRaisesRegex(RuntimeError,'RECONCILIATION_REQUIRED'):self.adapter().promote_under_hold()
 def test_baseline_drift_refuses_before_intent_and_cas(self):
  self.f.put(m.FIXED,b'foreign mutation')
  with self.assertRaisesRegex(RuntimeError,'BASELINE_CAS'):self.adapter().promote_under_hold()
  self.assertEqual(self.f.calls,[]);self.assertNotIn('candidatePointerIntents',self.f.journal.value)
 def test_candidate_pointer_without_durable_completion_is_not_success(self):
  self.f.journal.value.pop('migrationCompletionReceipt')
  with self.assertRaisesRegex(RuntimeError,'COMPLETION_NOT_DURABLE'):self.adapter().promote_under_hold()
  self.assertEqual(self.f.calls,[])
 def test_profile_source_and_reference_bindings_fail_closed(self):
  for mutation in ('source','target','binary','epoch'):
   with self.subTest(mutation=mutation):
    self.tearDown();self.setUp()
    if mutation=='source':self.f.profile['filesSha256'][m.ACTIVATION_SOURCE]='0'*64;self.f.put(m.PROFILE,raw(self.f.profile))
    else:
     if mutation=='target':self.f.binding['candidateConfig']['path']=m.FIXED
     if mutation=='binary':self.f.binding['binaries']['nginx']['path']='/tmp/nginx'
     if mutation=='epoch':self.f.binding['epoch']='0'*64
     self.f.refresh_profile()
    with self.assertRaises(RuntimeError):self.adapter().promote_under_hold()
    self.assertEqual(self.f.calls,[])
 def test_running_candidate_or_open_roles_cannot_promote(self):
  for mutation in ('running','roles'):
   with self.subTest(mutation=mutation):
    self.tearDown();self.setUp()
    if mutation=='running':self.f.live[0]['State']['Running']=True
    else:self.f.closed=False
    with self.assertRaises(RuntimeError):self.adapter().promote_under_hold()
    self.assertEqual(self.f.calls,[])
 def test_runtime_revision_and_config_drift_refuse(self):
  self.f.live[0]['Config']['Labels']['org.opencontainers.image.revision']=m.BASELINE
  with self.assertRaisesRegex(RuntimeError,'RUNTIME_SOURCE'):self.adapter().promote_under_hold()
  self.assertEqual(self.f.calls,[])
 def test_native_stage_config_cannot_diverge_from_promoted_config(self):
  self.f.profile['candidateComposeEmitter']['configRef']['sha256']='0'*64
  self.f.put(m.PROFILE,raw(self.f.profile))
  with self.assertRaisesRegex(RuntimeError,'NATIVE_CONFIG_BINDING'):self.adapter().promote_under_hold()
  self.assertEqual(self.f.calls,[])
 def test_journal_intent_persistence_failure_never_calls_cas(self):
  original=self.f.journal.record
  def fail_intent(state,**facts):
   if state=='candidate-pointer-intent':raise RuntimeError('local disk failure')
   original(state,**facts)
  with patch.object(self.f.journal,'record',side_effect=fail_intent):
   with self.assertRaisesRegex(RuntimeError,'OUTCOME_UNKNOWN_LOCK_RETAINED'):self.adapter().promote_under_hold()
  self.assertEqual(self.f.calls,[])
  self.assertTrue(self.f.journal.value['candidatePointerUnknown']['lockRetained'])
 def test_profile_race_after_first_cas_records_unknown_before_second_mutation(self):
  original=self.f.replace
  def drift(path,expected,value):
   original(path,expected,value)
   if path==m.FIXED:self.f.put(m.PROFILE,b'changed profile')
  with patch.object(activation,'replace',side_effect=drift):
   with self.assertRaisesRegex(RuntimeError,'OUTCOME_UNKNOWN_LOCK_RETAINED'):self.adapter().promote_under_hold()
  self.assertEqual(self.f.calls,[('cas','config')]);self.assertTrue(self.f.journal.value['candidatePointerUnknown'])
 def rebind_completion(self,value):
  ref=copy.deepcopy(self.f.binding['migrationCompletion']);value=raw(value);self.f.put(ref['path'],value)
  ref['sha256']=sha(value);self.f.binding['migrationCompletion']=ref;self.f.p['migrationCompletionSha256']=ref['sha256']
  self.f.journal.value.update(migrationCompletionReceipt=copy.deepcopy(ref),migrationCompletionIntent=copy.deepcopy(ref))
  self.f.journal.record('migration-completion-durable',receipt=copy.deepcopy(ref),holdGeneration=self.f.p['holdGeneration'])
  self.f.refresh_profile()
 def test_native_completion_rejects_legacy_wrapper_pending_expired_and_live_ledger_drift(self):
  for mutation in ('wrapper','pending','expired','live-ledger','source'):
   with self.subTest(mutation=mutation):
    self.tearDown();self.setUp();value=copy.deepcopy(self.f.native_completion)
    if mutation=='wrapper':value={'schemaVersion':1,'kind':'validated-migration-completion','identity':self.f.identity,'toolRevision':'e'*40}
    if mutation=='pending':value['pendingCount']=1
    if mutation=='expired':value['expiresAt']='2020-01-01T00:00:00Z'
    if mutation=='source':value['sourceRevision']=m.BASELINE
    if mutation=='live-ledger':self.f.ledger[0]['checksum']='0'*64
    self.rebind_completion(value)
    with self.assertRaises(RuntimeError):self.adapter().promote_under_hold()
    self.assertEqual(self.f.calls,[])
 def test_native_completion_requires_actual_retained_diagnostic_binding(self):
  self.f.host.plan['diagnosticSessions']['workspacex']={'pid':999}
  with self.assertRaisesRegex(RuntimeError,'DIAGNOSTIC_BINDING'):self.adapter().promote_under_hold()
  self.assertEqual(self.f.calls,[])
 def test_missing_preloaded_activation_module_has_no_fallback(self):
  with patch.dict(sys.modules,{'compiled_maintenance_activation':None}):
   with self.assertRaises(ModuleNotFoundError):self.adapter()
 def test_real_cas_rejects_wrong_expected_hash_without_replacing_local_file(self):
  target=self.f.root/'local-cas';target.write_bytes(b'old');target.chmod(0o600)
  with patch.object(activation,'private',side_effect=lambda p,*args:pathlib.Path(p).read_bytes()):
   with self.assertRaisesRegex(RuntimeError,'POINTER_CAS'):self.real_replace(target,'0'*64,b'new')
  self.assertEqual(target.read_bytes(),b'old')
if __name__=='__main__':unittest.main()
