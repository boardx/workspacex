import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
s=importlib.util.spec_from_file_location('activation',Path(__file__).resolve().parents[1]/'scripts/tag-migrated-activation.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_fresh_complete_backup_is_revalidated_instead_of_replaying_old_backup(self):
  validator=Mock(return_value={'status':'COMPLETE_SCHEMA_RESTORE_QUALIFIED'})
  adapter=Mock()
  ctx={'adapter':adapter,'complete_backup':{'validate':validator,'inputs':{'archive':'pinned'},'image':'immutable','output':'owned'}}
  m.require_current_backup(ctx)
  validator.assert_called_once_with({'archive':'pinned'},'immutable','owned')
  adapter.require_backup.assert_not_called()
  validator.side_effect=ValueError('COMPLETE_SOURCE_EXPIRED')
  with self.assertRaisesRegex(ValueError,'COMPLETE_SOURCE_EXPIRED'):m.require_current_backup(ctx)
  adapter.require_backup.assert_not_called()
 def test_legacy_backup_gate_remains_mandatory_without_explicit_complete_proof(self):
  adapter=Mock();m.require_current_backup({'adapter':adapter});adapter.require_backup.assert_called_once_with()
 def test_budget_reserves_recovery_verifier_and_outer_probe(self):
  p={'bootstrapProbe':{'timeoutSeconds':10},'activationSeconds':140,'rollbackSeconds':120,'verifierSeconds':30,'outerVerificationSeconds':120,'runtimeSeconds':20,'candidateProbe':{'timeoutSeconds':30},'oldProbe':{'timeoutSeconds':30}}
  m.budget(p,{'expiresAt':600},now=1)
  for change in [{'expiresAt':300},{'expiresAt':700}]:
   with self.assertRaises(ValueError):m.budget(p,change,now=1)
  p['oldProbe']['timeoutSeconds']=300
  with self.assertRaises(ValueError):m.budget(p,{'expiresAt':600},now=1)
 def test_missing_bootstrap_gate_is_not_optional(self):
  p={'bootstrapProbe':{'timeoutSeconds':10},'activationSeconds':140,'rollbackSeconds':120,'verifierSeconds':30,'outerVerificationSeconds':120,'runtimeSeconds':20,'candidateProbe':{'timeoutSeconds':30},'oldProbe':{'timeoutSeconds':30}}
  p.pop('bootstrapProbe')
  with self.assertRaisesRegex(ValueError,'BOOTSTRAP_PROBE_REQUIRED'):m.budget(p,{'expiresAt':599},now=0)
 def test_bootstrap_runtime_and_cleanup_explicitly_count_toward_activation_budget(self):
  p={'bootstrapProbe':{'timeoutSeconds':60},'activationSeconds':140,'rollbackSeconds':120,'verifierSeconds':30,'outerVerificationSeconds':120,'runtimeSeconds':20,'candidateProbe':{'timeoutSeconds':30},'oldProbe':{'timeoutSeconds':30}}
  with self.assertRaisesRegex(ValueError,'CANDIDATE_BUDGET'):m.budget(p,{'expiresAt':599},now=0)
 def test_only_exact_three_api_additions_can_activate(self):
  plan={'complete':True,'route':'schema-preparation','changes':[{'role':'api','added':['a','b','c'],'removed':[],'changed':[]}]};m.exact_changes(plan,{'a':1,'b':2,'c':3})
  for value in [dict(plan,complete=False),dict(plan,route='maintenance-review'),dict(plan,changes=[{'role':'agent','added':['a','b','c'],'removed':[],'changed':[]}])]:
   with self.assertRaises(ValueError):m.exact_changes(value,{'a':1,'b':2,'c':3})
 def test_changed_live_config_rejected_despite_same_images(self):
  engine=Mock();engine.resolved_config_hash.return_value=['api','current-config']
  rows=[{'Config':{'Labels':{'com.docker.compose.service':'api','com.docker.compose.config-hash':'stale-config'}}}]
  with self.assertRaisesRegex(ValueError,'LIVE_CONFIG_DRIFT'):m.live_config_cas(engine,Mock(),{},'project',rows,Path('/private'))
  rows[0]['Config']['Labels']['com.docker.compose.config-hash']='current-config'
  m.live_config_cas(engine,Mock(),{},'project',rows,Path('/private'))
 def test_health_uses_loopback_route_with_real_tls_hostname(self):
  for environment,host in [('us','appv1.boardx.us'),('cn','app.boardx.com.cn')]:
   run=Mock(return_value=b'{"trustworthy":true}\n200')
   result=m.loopback_health(environment,{'url':'https://'+host+'/api/healthz','expected':{'trustworthy':True}},3,run)
   args=run.call_args.args[0];self.assertEqual(args[:2],['/usr/bin/curl','--disable']);self.assertTrue(result['tlsVerification']);self.assertIn(host+':443:127.0.0.1',args);self.assertEqual(args[-1],'https://'+host+'/api/healthz');self.assertIn('--fail',args);self.assertNotIn('--insecure',args);self.assertNotIn('-k',args);self.assertNotIn('--location',args);self.assertEqual(args[args.index('--write-out')+1],r'\n%{http_code}')
 def test_health_rejects_foreign_host_http_redirect_or_wrong_body(self):
  config={'url':'https://appv1.boardx.us/api/healthz','expected':{'trustworthy':True}}
  run=Mock(return_value=b'{"trustworthy":true}\n200')
  for url in ['http://appv1.boardx.us/api/healthz','https://evil/api/healthz','https://appv1.boardx.us:444/api/healthz','https://appv1.boardx.us/api/healthz?skip=1']:
   with self.assertRaises(ValueError):m.loopback_health('us',{**config,'url':url},3,run)
  run.assert_not_called()
  for raw in [b'{"trustworthy":true}\n503',b'{"trustworthy":true}\n301',b'{"trustworthy":false}\n200',b'[]\n200']:
   with self.assertRaises(ValueError):m.loopback_health('us',config,3,Mock(return_value=raw))
  with self.assertRaises(RuntimeError):m.loopback_health('us',config,3,Mock(side_effect=RuntimeError('certificate verification failed')))
 def test_held_runtime_scopes_transport_and_restores_engine_health(self):
  from types import SimpleNamespace
  original=Mock(side_effect=RuntimeError('public health is blocked by maintenance'))
  engine=SimpleNamespace(health=original)
  engine.verify_runtime=lambda d,command,services,images,config:engine.health(config['health'],timeout=3)
  host=SimpleNamespace(run=Mock(return_value=b'{"trustworthy":true}\n200'))
  ctx={'engine':engine,'maint':SimpleNamespace(Host=Mock(return_value=host)),'old_policy':{},'attempt':Path('/private'),'fd':3,'request':{'environment':'us'},'config':{'services':{},'health':{'url':'https://appv1.boardx.us/api/healthz','expected':{'trustworthy':True}}},'d':None,'p':{'runtimeSeconds':10}}
  self.assertEqual(m.verify_held_runtime(ctx,[],{})['httpStatus'],200);self.assertIs(engine.health,original);original.assert_not_called()
  host.run.side_effect=RuntimeError('TLS failed')
  with self.assertRaises(RuntimeError):m.verify_held_runtime(ctx,[],{})
  self.assertIs(engine.health,original)
 def test_no_ddl_or_schema_equal_waiver(self):
  text=Path(m.__file__).read_text();self.assertNotIn("run('apply')",text);self.assertNotIn('engine.release(',text);self.assertNotIn('schemaInventoriesEqual=True',text)
if __name__=='__main__':unittest.main()

class ActivationFlow(unittest.TestCase):
 def execute(self,fail_candidate=False,fail_bootstrap=False):
  import tempfile,json,copy
  from unittest.mock import patch
  from types import SimpleNamespace
  ms=importlib.util.spec_from_file_location('maintenance_flow',Path(m.__file__).with_name('tag-maintenance-release.py'));maint=importlib.util.module_from_spec(ms);ms.loader.exec_module(maint)
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);nginx=root/'nginx';nginx.write_bytes(b'server { server_name appv1.boardx.us; }');attempt=root/'attempt';attempt.mkdir();old_attempt=root/'old';old_attempt.mkdir();(old_attempt/'receipt.json').write_text('{}');(old_attempt/'stopped-backup').mkdir();(old_attempt/'stopped-backup/qualification.json').write_text('{}')
   services={'api':'api','web':'web','agent':'agent','sandbox':'sandbox','sandbox-sessions':'sandbox'}
   old={s:'old-'+s for s in services};new={s:'new-'+role for s,role in services.items()};original={'services':{s:{'image':old[s],'environment':{'PRESERVED':'yes'}} for s in services}}
   class Docker:
    def __init__(self):self.images=dict(old);self.up=[]
    def run(self,args,**kw):
     if args[0]=='ps':return ('id-'+args[-1].split('=')[-1]).encode()
     if 'up' in args:
      overlay=Path(args[args.index('--file')+1]);self.images={s:v['image'] for s,v in json.loads(overlay.read_text())['services'].items()};self.up.append(dict(self.images))
     return b''
    def json(self,args,**kw):
     if args[0]=='inspect':
      service=args[1][3:];return [{'Id':'id-'+service,'Image':self.images[service],'State':{'Running':True},'Config':{'Labels':{'com.docker.compose.service':service,'com.docker.compose.project':'project','com.docker.compose.config-hash':'same'}}}]
     result=copy.deepcopy(original)
     if '--file' in args:
      overlay=Path(args[args.index('--file')+1]);change=json.loads(overlay.read_text())
      for s,v in change['services'].items():result['services'][s]['image']=v['image']
     return result
   d=Docker();engine=Mock();engine.save=maint.save;engine.sha_file=lambda p:__import__('hashlib').sha256(Path(p).read_bytes()).hexdigest();engine.resolved_config_hash=lambda d,o,p,s,a:[s,'same'];engine.schema=lambda *a:{};engine.verify_runtime.return_value={'healthy':True}
   class Host:
    def __init__(self,*args):pass
    def adapter(self,name,mode):
     if fail_bootstrap:raise RuntimeError('dynamic bootstrap failed')
     return {'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE'}
    def nginx(self,a,b):
     if nginx.read_bytes()!=a:raise ValueError('nginxcas')
     nginx.write_bytes(b)
   fake_maint=SimpleNamespace(save=maint.save,pinned=lambda ref,**kw:Path(ref['path']),maintenance_bytes=maint.maintenance_bytes,Host=Host)
   request={'sourceRevision':m.SOURCE,'tag':m.TAG,'environment':'us','expiresAt':__import__('time').time()+599,'planSha256':'plan','manifestSha256':'manifest'}
   p={'bootstrapProbe':{'timeoutSeconds':10},'activationSeconds':140,'rollbackSeconds':120,'verifierSeconds':30,'outerVerificationSeconds':120,'runtimeSeconds':20,'candidateProbe':{'timeoutSeconds':30},'oldProbe':{'timeoutSeconds':30},'nginx':{'path':str(nginx)}}
   ctx={'p':p,'request':request,'maint':fake_maint,'engine':engine,'attempt':attempt,'d':d,'config':{'project':'project','services':services,'composeFiles':[],'envFile':{'path':'env'}},'base':['compose'],'images':new,'old_policy':{'baseline':{s:{'containerId':'id-'+s,'imageId':old[s]} for s in services}},'plan':{'baselineInventories':{'api':{},'agent':{}},'candidateInventories':{'api':{},'agent':{}}},'old_attempt':old_attempt,'fd':3,'adapter':Mock(),'handoff':SimpleNamespace(IDENTITY=('environment','tag','sourceRevision','planSha256','manifestSha256'))};ctx['adapter'].run.return_value={'status':'COMPLETE'}
   def probe(c,which,a):
    if which=='candidateProbe' and fail_candidate:raise RuntimeError('businessfailure')
    return {'status':'OLD_APPLICATION_VERIFIED','source':m.SOURCE,'tag':m.TAG,'environment':'us'}
   with patch.object(m,'probe',side_effect=probe):
    try:m.activate(ctx,attempt/'result.json');result=json.loads((attempt/'result.json').read_text())
    except RuntimeError:result=json.loads((attempt/'activation-failure.json').read_text())
   return result,d.up,nginx.read_bytes(),ctx['adapter'].run.call_args_list
 def test_success_activates_only_expected_images_without_ddl(self):
  result,up,nginx,calls=self.execute();self.assertEqual(result['status'],'SUCCEEDED');self.assertEqual(len(up),1);self.assertNotIn(b'return 503',nginx);self.assertTrue(all(c.args==('reconcile',) for c in calls))
 def test_candidate_failure_restores_forward_schema_old_images(self):
  result,up,nginx,calls=self.execute(True);self.assertEqual(result['status'],'OLD_APPLICATION_RESTORED_ON_FORWARD_SCHEMA');self.assertEqual(len(up),2);self.assertTrue(all(x.startswith('old-') for x in up[-1].values()));self.assertNotIn(b'return 503',nginx);self.assertFalse(result['sqlRollbackAttempted'])

 def test_bootstrap_failure_prevents_target_up_but_old_recovery_still_runs(self):
  result,up,nginx,calls=self.execute(fail_bootstrap=True);self.assertEqual(result['status'],'OLD_APPLICATION_RESTORED_ON_FORWARD_SCHEMA');self.assertEqual(up,[]);self.assertNotIn(b'return 503',nginx)


class FreshRecoveryAdmission(unittest.TestCase):
 def test_complete_recovery_identity_cannot_replace_or_retime_original(self):
  from pathlib import Path
  receipt={'kind':'complete-schema-recovery-v1','status':'COMPLETE_SCHEMA_RECOVERY_VERIFIED','environment':'us','sourceRevision':m.SOURCE,'tag':m.TAG,'createdAt':99,'originalAttempt':'/private/original','originalPolicy':{'path':'/private/policy','sha256':'a'*64}}
  m.recovery_identity(receipt,'us',Path('/private/original'),receipt['originalPolicy'],100)
  for patch in [{'status':'SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE'},{'environment':'cn'},{'createdAt':-1801},{'originalAttempt':'/private/other'},{'originalPolicy':{'path':'/changed','sha256':'a'*64}}]:
   with self.assertRaises(ValueError):m.recovery_identity({**receipt,**patch},'us',Path('/private/original'),receipt['originalPolicy'],100)
 def test_new_core_wrong_tool_pin_prevents_import(self):
  from unittest.mock import patch,Mock
  import tempfile,json
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);binding=root/'binding.json';binding.write_text(json.dumps({'toolPins':{'schema-complete-restore.py':'a'*64}}))
   maint=Mock();maint.pinned.return_value=binding
   with patch.object(m,'load') as load,self.assertRaises(ValueError):m.load_complete_core({'binding':{}},maint)
   load.assert_not_called()

class CompleteRecoveryFixtures(unittest.TestCase):
 """Filesystem/hash fixtures, mocked historical DB and fresh restore validators."""
 def execute(self,mutation=None):
  import tempfile,json,hashlib,time,copy
  from types import SimpleNamespace
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);original=root/('tag-maintenance-'+'a'*32);original.mkdir();fresh=root/('tag-maintenance-'+'b'*32);fresh.mkdir()
   def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value));path.chmod(0o600);return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
   def ref(path):return {'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
   def read(r):
    path=Path(r['path']);self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),r['sha256']);return json.loads(path.read_text())
   def pinned(r,**kw):readable=Path(r['path']);self.assertEqual(hashlib.sha256(readable.read_bytes()).hexdigest(),r['sha256']);return readable
   base={f'old_{i}.sql':'a'*64 for i in range(435)};new={f'new_{i}.sql':'b'*64 for i in range(3)};pgimage='sha256:'+'c'*64;pgcid='d'*64;apiid='sha256:'+'e'*64;apidigest='sha256:'+'f'*64
   db={'baselineLedger':base,'containerId':pgcid,'imageId':pgimage,'targetApiImageId':apiid};old_policy={'project':'project','baseline':{'api':{'imageId':'old-api','containerId':'old-api-cid'}},'usDatabase':db}
   policy_ref=write(original/'policy.json',old_policy)
   input_path=root/'original-input-policy.json';input_path.write_text(json.dumps(old_policy,indent=2));input_path.chmod(0o600);input_ref=ref(input_path);self.assertNotEqual(input_ref['sha256'],policy_ref['sha256'])
   ack_ref=write(original/'databaseCommand-apply.json',{'status':'COMMITTED','commitAcknowledged':True,'ledgerCount':438,'source':m.SOURCE,'tag':m.TAG,'environment':'us'})
   write(original/'databaseCommand-reconcile.json',{'status':'COMPLETE','source':m.SOURCE,'tag':m.TAG,'environment':'us'})
   for name in ['qualification.json','database.pgdump.enc','backup.key','isolated/intent.json','isolated/restored.json','isolated/receipt.json','isolated/cleanup.json']:write(original/'stopped-backup'/name,{'historicalFixture':True})
   history={str(p.relative_to(original)):ref(p)['sha256'] for p in original.rglob('*') if p.is_file()}
   binding={'baselineEnvSha256':'1'*64,'adminEnv':{'sha256':'2'*64},'network':'network'};spec={'binding':binding,'timeoutSeconds':10,'inputs':[{'fixture':True}],'executable':{'fixture':True}}
   fp={**old_policy,'kind':'complete-schema-recovery','preparedAt':time.time(),'environment':'us','source':m.SOURCE,'tag':m.TAG,'bootstrapProbe':spec}
   fp_ref=write(fresh/'policy.json',fp)
   output=fresh/'restore';qref=write(output/'qualification.json',{'fixture':True});inputrefs={'baselineLedger':write(fresh/'base.json',base),'completeLedger':write(fresh/'complete.json',{**base,**new}),'binding':write(fresh/'binding.json',{})}
   source_binding={'environment':'us','sourceRevision':m.SOURCE,'tag':m.TAG,'postgresImageId':pgimage,'sourceContainerId':pgcid,'targetApiImageId':apiid,'targetApiRepoDigest':'registry/api@'+apidigest}
   fresh_validator=Mock(return_value={'sourceBinding':source_binding,'qualificationSha256':qref['sha256']});fc=SimpleNamespace(validate_qualification=fresh_validator)
   lock={'path':'/run/fixed','device':1,'inode':2};manifest_ref=write(fresh/'manifest.json',{'images':{'api':{'image': 'registry/api@'+apidigest,'imageId':apiid}}})
   raw_path=fresh/('bootstrap-raw-'+'c'*32+'.txt');raw_path.write_text('CN_BOOTSTRAP_COMPAT_JSON={}\n');raw_path.chmod(0o600);raw_ref=ref(raw_path)
   boot_ref=write(fresh/('bootstrap-receipt-'+'c'*32+'.json'),{'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE','source':m.SOURCE,'tag':m.TAG,'environment':'us','imageId':apiid,'imageDigest':apidigest,'rawOutput':raw_ref,'attempt':str(fresh),'createdAt':time.time(),'baselineEnvSha256':binding['baselineEnvSha256'],'adminEnvSha256':binding['adminEnv']['sha256'],'network':'network','canonicalLock':lock})
   business_ref=write(fresh/'business.json',{'status':'OLD_APPLICATION_VERIFIED','source':m.SOURCE,'tag':m.TAG,'environment':'us'})
   pending_ref=write(root/'pending-archived.json',{'attempt':str(original),'policySha256':input_ref['sha256'],'source':m.SOURCE,'tag':m.TAG})
   record={'kind':'complete-schema-recovery-v1','status':'COMPLETE_SCHEMA_RECOVERY_VERIFIED','environment':'us','sourceRevision':m.SOURCE,'tag':m.TAG,'createdAt':time.time(),'originalAttempt':str(original),'originalPolicy':policy_ref,'originalInputPolicy':input_ref,'originalHistory':{'files':history},'originalAck':ack_ref,'originalBackup':{'qualification':ref(original/'stopped-backup/qualification.json'),'validAt':Path(ack_ref['path']).stat().st_mtime},'pendingArchive':pending_ref,'freshPolicy':fp_ref,'recoveryAttempt':str(fresh),'freshBackup':{'inputs':inputrefs,'image':pgimage,'output':str(output),'qualification':qref},'bootstrap':{'raw':raw_ref,'receipt':boot_ref},'business':business_ref}
   if mutation=='ack-time':record['originalBackup']['validAt']+=1
   if mutation=='history':record['originalHistory']['files'].pop('policy.json')
   if mutation=='input-semantic':record['originalInputPolicy']=write(input_path,{**old_policy,'project':'foreign'})
   if mutation=='input-hash':record['originalInputPolicy']={**input_ref,'sha256':'0'*64}
   if mutation=='expired':record['createdAt']-=1801
   if mutation=='fresh-expired':fresh_validator.side_effect=ValueError('BACKUP_EXPIRED')
   if mutation=='pending':record['pendingArchive']=write(root/'pending-archived.json',{'attempt':'foreign','source':m.SOURCE,'tag':m.TAG})
   if mutation=='boot-digest':record['bootstrap']['receipt']=write(Path(boot_ref['path']),{**read(boot_ref),'imageDigest':'sha256:'+'0'*64})
   record_ref=write(fresh/'recovery-receipt.json',record);p={'completeRecovery':record_ref,'maintenancePolicy':policy_ref,'bootstrapProbe':spec,'closure':[{'path':str(m.HERE/n)} for n in ('tag-bootstrap-probe.py','schema-tag-prepare.py')]}
   maint=SimpleNamespace(pinned=pinned,require_bootstrap=lambda p:None);us=SimpleNamespace(validate_backup=Mock());adapter=Mock();adapter.backup_identity.return_value={'attempt':str(original)};probe=SimpleNamespace(validate_output=Mock())
   before={str(p):p.read_bytes() for p in original.rglob('*') if p.is_file()}
   with patch.object(m,'trusted',side_effect=lambda p,*a:Path(p)),patch.object(m,'load_complete_core',return_value=fc),patch.object(m,'load',return_value=probe):
    result=m.complete_recovery(p,{'environment':'us','manifest':manifest_ref,'canonicalLock':lock},{'stateDirectory':str(root)},old_policy,original,adapter,Mock(),maint,SimpleNamespace(MIGRATIONS=new),us,read)
   self.assertEqual(before,{str(p):p.read_bytes() for p in original.rglob('*') if p.is_file()});us.validate_backup.assert_called_once();self.assertEqual(us.validate_backup.call_args.kwargs['now'],Path(ack_ref['path']).stat().st_mtime);adapter.require_backup.assert_not_called();self.assertEqual(result['attempt'],fresh)
   return result
 def test_explicit_complete_recovery_uses_fresh_proof_and_preserves_original(self):self.execute()
 def test_missing_history_wrong_ack_time_expired_spliced_records_fail_closed(self):
  for mode in ('ack-time','history','expired','fresh-expired','pending','boot-digest','input-semantic'):
   with self.subTest(mode=mode),self.assertRaises(ValueError):self.execute(mode)
