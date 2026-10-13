import importlib.util,json,tempfile,unittest,uuid,datetime,hashlib,os,sys,subprocess,shutil
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
spec=importlib.util.spec_from_file_location('rehearsal',Path(__file__).with_name('isolated_rehearsal.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def role_fixture(p):
 role=p['role'];exists=role in p['ownedRoles']
 return dict(targetInstanceId=p['binding']['targetInstanceId'],attemptId=p['binding']['attemptId'],role=role,accountType='Normal',accountDescription=m.role_description(p['roleIntent']),exists=exists,absent=not exists)
class BindingTests(unittest.TestCase):
 def manifest(self):
  now=datetime.datetime.now(datetime.timezone.utc)
  attempt=str(uuid.uuid4())
  return dict(runnerLifetime={'instanceId':'i-isolatedtest','providerReadback':{'RequestId':'test-provider-request','Instances':{'Instance':[{'InstanceId':'i-isolatedtest','Description':'wsx-cn-isolated-'+attempt,'CreationTime':now.isoformat(),'AutoReleaseTime':(now+datetime.timedelta(hours=2)).isoformat()}]}}},providerDescription='wsx-cn-isolated-round2-'+attempt,readbackBudgetSeconds=0,deleteReadbackBudgetSeconds=0,accountId='1177216024653153',regionId='cn-shanghai',attemptId=attempt,targetInstanceId='pgm-isolatedtest',sourceInstanceId='pgm-uf6rg214cp381l49',providerCreatedUtc=now.isoformat(),candidateSha='1'*40,host='pgm-isolatedtest.rwlb.rds.aliyuncs.com',peer='10.0.0.2',peerSha256=hashlib.sha256(b'10.0.0.2').hexdigest(),tls={'sslmode':'verify-full'})
 def test_runner_lifetime_earlier_than_late_rds(self):
  b=self.manifest();end=m.runner_deadline(b);b['providerCreatedUtc']=(datetime.datetime.fromisoformat(b['providerCreatedUtc'])+datetime.timedelta(hours=1)).isoformat()
  self.assertEqual(m.workload_deadline(b),end-330)
 def test_runner_lifetime_invalid_provider_binding_rejected(self):
  import copy
  base=self.manifest()
  for mutate in (lambda b:b.pop('runnerLifetime'),lambda b:b['runnerLifetime'].update(instanceId='i-uf6ga92ewloganobbln6'),lambda b:b['runnerLifetime']['providerReadback']['Instances']['Instance'][0].update(InstanceId='i-another'),lambda b:b['runnerLifetime']['providerReadback']['Instances']['Instance'][0].update(Description='foreign'),lambda b:b['runnerLifetime']['providerReadback']['Instances']['Instance'][0].update(AutoReleaseTime='2026-10-10T19:00:00'),lambda b:b['runnerLifetime']['providerReadback']['Instances']['Instance'][0].update(AutoReleaseTime=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=3)).isoformat())):
   b=copy.deepcopy(base);mutate(b)
   with self.assertRaises(ValueError):m.runner_deadline(b)
 def test_admission_closed_irreversible_and_lifetime_cannot_extend(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b=self.manifest();root=Path(d);gate=m.Admission(b,root);gate.check();gate.close()
   with self.assertRaisesRegex(ValueError,'WORKLOAD_ADMISSION_CLOSED'):m.Admission(b,root).check()
   b['runnerLifetime']['providerReadback']['RequestId']='changed-observation'
   with self.assertRaisesRegex(ValueError,'ADMISSION_BINDING_CHANGED'):m.Admission(b,root)
 def test_closed_symlink_blocks_without_reading_target(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   root=Path(d);gate=m.Admission(self.manifest(),root);(root/'workload-closed.json').symlink_to('/no-such-secret')
   with self.assertRaisesRegex(ValueError,'WORKLOAD_ADMISSION_CLOSED'):gate.check()
 def test_monotonic_admission_cannot_extend_by_wallclock_rollback(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   with patch.object(m.time,'monotonic',return_value=10):gate=m.Admission(self.manifest(),Path(d))
   with patch.object(m.time,'monotonic',return_value=gate.end):
    with self.assertRaisesRegex(ValueError,'CLEANUP_RESERVE_REQUIRED'):gate.check()
 def test_external_close_between_observation_and_stage_blocks_stage(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b=self.manifest();root=Path(d);calls=[]
   def invoke(op,p):
    calls.append(op)
    if op=='observe':
     if calls.count('observe')==2:m.Admission(b,root).close()
     return {k:b[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
    if op=='cleanup-readback':return dict(registered=True,terminal='cleanup-registration-remove' in calls,targetInstanceId=b['targetInstanceId'],deleteBeginEpoch=m.created(b)+6900)
    if op=='role-account-readback':return role_fixture(p)
    if op=='account-readback':return dict(exists=True,user='migration_admin')
    if op=='cleanup-readback-deleted':return {'notFound':True}
    if op=='cleanup-registration-readback-removed':return {'removed':True}
    return dict(accepted=True,databases=list(m.DBS),**{k:b[k] for k in ('attemptId','targetInstanceId','candidateSha')})
   with self.assertRaisesRegex(ValueError,'WORKLOAD_ADMISSION_CLOSED'):m.rehearse(b,root,invoke)
   self.assertNotIn('restore',calls);self.assertIn('cleanup',calls)
 def test_closed_start_creates_no_secret_but_cleanup_still_runs(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b=self.manifest();root=Path(d);m.Admission(b,root).close();calls=[]
   with self.assertRaisesRegex(ValueError,'WORKLOAD_ADMISSION_CLOSED'):m.rehearse(b,root,lambda op,p:(calls.append(op) or {'notFound':True,'terminal':True,'removed':True}))
   self.assertFalse((root/'target-secret.json').exists());self.assertNotIn('observe',calls);self.assertIn('cleanup',calls)
 def test_close_failure_never_skips_cleanup_or_returns_accepted(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b=self.manifest();calls=[]
   def invoke(op,p):
    calls.append(op)
    if op=='observe':return {k:b[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
    if op=='cleanup-readback':return dict(registered=True,terminal='cleanup-registration-remove' in calls,targetInstanceId=b['targetInstanceId'],deleteBeginEpoch=m.created(b)+6900)
    if op=='role-account-readback':return role_fixture(p)
    if op=='account-readback':return dict(exists=True,user='migration_admin')
    if op=='cleanup-readback-deleted':return {'notFound':True}
    if op=='cleanup-registration-readback-removed':return {'removed':True}
    return dict(accepted=True,databases=list(m.DBS),**{k:b[k] for k in ('attemptId','targetInstanceId','candidateSha')})
   with patch.object(m.Admission,'close',side_effect=OSError('disk full')):
    with self.assertRaisesRegex(ValueError,'WORKLOAD_CLOSE_UNCONFIRMED_AFTER_CLEANUP'):m.rehearse(b,Path(d),invoke)
   for op in ('cleanup','cleanup-registration-remove','cleanup-iam-remove'):self.assertIn(op,calls)
 def test_runner_expiry_cleans_without_creating_secrets(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b=self.manifest();now=datetime.datetime.now(datetime.timezone.utc);row=b['runnerLifetime']['providerReadback']['Instances']['Instance'][0]
   row.update(CreationTime=(now-datetime.timedelta(hours=2)).isoformat(),AutoReleaseTime=now.isoformat());calls=[]
   with self.assertRaisesRegex(ValueError,'EXPIRED_ISOLATION'):m.rehearse(b,Path(d),lambda op,p:(calls.append(op) or {'notFound':True,'terminal':True,'removed':True}))
   self.assertNotIn('observe',calls);self.assertIn('cleanup',calls);self.assertFalse((Path(d)/'target-secret.json').exists())
 def test_production_and_peer_rejected(self):
  x=self.manifest();m.validate_binding(x)
  x['targetInstanceId']=x['sourceInstanceId']
  with self.assertRaises(ValueError):m.validate_binding(x)
  x=self.manifest();x['peer']='10.0.0.3'
  with self.assertRaises(ValueError):m.validate_binding(x)
 def test_tls_exception_not_inherited(self):
  x=self.manifest();x['tls']={'sslmode':'disable'}
  with self.assertRaises(ValueError):m.validate_binding(x)
 def test_credentials_create_once(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();a=m.credentials(Path(d),x);b=m.credentials(Path(d),x)
   self.assertEqual(a,b);self.assertEqual((Path(d)/'target-secret.json').stat().st_mode&0o777,0o600)
   x['attemptId']=str(uuid.uuid4())
   with self.assertRaises(ValueError):m.credentials(Path(d),x)
 def test_unknown_mutation_never_repeated(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   s=m.Journal(Path(d));calls=[]
   def fail():calls.append('create');raise TimeoutError()
   with self.assertRaises(TimeoutError):s.once('account',fail)
   with self.assertRaises(m.UnknownOutcome):s.once('account',fail)
   self.assertEqual(calls,['create'])
 def test_oos_readback_precedes_sql(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();calls=[]
   def invoke(op,payload):
    calls.append(op)
    if op=='observe':return {'targetInstanceId':x['targetInstanceId'],'peer':x['peer'],'providerCreatedUtc':x['providerCreatedUtc']}
    if op=='cleanup-readback':return {'registered':False,'terminal':'cleanup-registration-remove' in calls}
    if op=='cleanup-readback-deleted':return {'notFound':True}
    if op=='cleanup-registration-readback-removed':return {'removed':True}
    return {}
   with self.assertRaises(m.UnknownOutcome):m.rehearse(x,Path(d),invoke)
   self.assertFalse(any(c.startswith('restore') or c=='migrate' for c in calls))
 def test_expiry_cleans_without_sql(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();x['providerCreatedUtc']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=3)).isoformat();calls=[]
   with self.assertRaises(ValueError):m.rehearse(x,Path(d),lambda op,p:(calls.append(op) or {'notFound':True,'terminal':True,'removed':True}))
   self.assertEqual(calls,['cleanup','cleanup-readback-deleted','cleanup-registration-remove','cleanup-readback','cleanup-iam-remove','cleanup-registration-readback-removed'])
   self.assertFalse((Path(d)/'target-secret.json').exists())
 def test_real_process_invalid_receipt_rejected(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   p=Path(d)/'adapter.py';p.write_text('print("not json")')
   with self.assertRaises(ValueError):m.ProcessAdapter(p,hashlib.sha256(p.read_bytes()).hexdigest(),10)('observe',{})
 def test_whole_chain_and_resume_no_sql_replay(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();calls=[]
   def invoke(op,p):
    calls.append(op)
    if op=='observe':return {k:x[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
    if op=='cleanup-readback':return dict(registered='cleanup-registration-remove' not in calls,terminal='cleanup-registration-remove' in calls,targetInstanceId=x['targetInstanceId'],deleteBeginEpoch=m.created(x)+6900)
    if op=='role-account-readback':return role_fixture(p)
    if op=='account-readback':return dict(exists=True,user='migration_admin')
    if op=='cleanup-readback-deleted':return {'notFound':True}
    if op=='cleanup-registration-readback-removed':return {'removed':True}
    return dict(accepted=True,databases=list(m.DBS),**{k:x[k] for k in ('attemptId','targetInstanceId','candidateSha')})
   self.assertTrue(m.rehearse(x,Path(d),invoke)['deleted'])
   self.assertLess(calls.index('cleanup-readback'),calls.index('restore'))
   self.assertLess(calls.index('snapshot'),calls.index('cleanup'))
   for stage in m.STAGES:self.assertEqual(calls.count(stage),1)
 def test_malformed_three_database_receipt_stops_before_more_sql_and_cleans(self):
  for databases in (list(m.DBS)+[m.DBS[0]],dict.fromkeys(m.DBS),list(m.DBS[:2]),list(m.DBS[:2])+[False]):
   with self.subTest(databases=databases),tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
    x=self.manifest();calls=[]
    def invoke(op,p):
     calls.append(op)
     if op=='observe':return {k:x[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
     if op=='cleanup-readback':return dict(registered='cleanup-registration-remove' not in calls,terminal='cleanup-registration-remove' in calls,targetInstanceId=x['targetInstanceId'],deleteBeginEpoch=m.created(x)+6900)
     if op=='role-account-readback':return role_fixture(p)
     if op=='account-readback':return dict(exists=True,user='migration_admin')
     if op=='cleanup-readback-deleted':return {'notFound':True}
     if op=='cleanup-registration-readback-removed':return {'removed':True}
     return dict(accepted=True,databases=databases,**{k:x[k] for k in ('attemptId','targetInstanceId','candidateSha')})
    with self.assertRaisesRegex(ValueError,'THREE_DATABASE_CLOSURE:restore'):m.rehearse(x,Path(d),invoke)
    self.assertIn('cleanup',calls);self.assertNotIn('before',calls);self.assertNotIn('migrate',calls)
 def test_sql_failure_cleans_exact_clone(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();calls=[]
   def invoke(op,p):
    calls.append(op)
    if op=='observe':return {k:x[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
    if op=='cleanup-readback':return dict(registered='cleanup-registration-remove' not in calls,terminal='cleanup-registration-remove' in calls,targetInstanceId=x['targetInstanceId'],deleteBeginEpoch=m.created(x)+6900)
    if op=='role-account-readback':return role_fixture(p)
    if op=='account-readback':return dict(exists=True,user='migration_admin')
    if op=='cleanup-readback-deleted':return {'notFound':True}
    if op=='cleanup-registration-readback-removed':return {'removed':True}
    if op=='restore':raise RuntimeError('simulated process failure')
    return {}
   with self.assertRaises(RuntimeError):m.rehearse(x,Path(d),invoke)
   self.assertIn('cleanup',calls);self.assertNotIn('migrate',calls)
 def test_real_process_timeout_is_unknown(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   p=Path(d)/'adapter.py';p.write_text('import time;time.sleep(10)')
   with self.assertRaises(m.UnknownOutcome):m.ProcessAdapter(p,hashlib.sha256(p.read_bytes()).hexdigest(),0.05)('observe',{})
 def test_frozen_manifest_cannot_be_claimed_by_sha_string(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();p=Path(d)/'frozen.json';p.write_text(json.dumps({'candidateSha':x['candidateSha'],'frozen':False}));os.chmod(p,0o600)
   x.update(frozenManifestPath=str(p),frozenManifestSha256=hashlib.sha256(p.read_bytes()).hexdigest())
   with self.assertRaises(ValueError):m.preflight(x)
 def test_actual_node_database_validator_rejects_production(self):
  x=self.manifest();x['targetInstanceId']=x['sourceInstanceId']
  payload={'binding':x,'secret':dict(targetInstanceId=x['targetInstanceId'],attemptId=x['attemptId'],host=x['host'],peer=x['peer'],port=5432,user='migration_admin')}
  path=Path(__file__).with_name('isolated_rehearsal_databases.cjs')
  code="const m=require(process.argv[1]);const fs=require('fs');try{m.validate(JSON.parse(fs.readFileSync(0,'utf8')));process.exit(1)}catch(e){if(e.message!=='TARGET_BINDING_INVALID')throw e}"
  subprocess.run(['node','-e',code,str(path)],input=json.dumps(payload).encode(),check=True,capture_output=True)
 def test_cleanup_template_contains_only_exact_target(self):
  import isolated_rehearsal_aliyun as a
  x=self.manifest();x['cleanupRole']='exact-isolated-role';t=a.cleanup_template(x)
  self.assertEqual(t['Tasks'][1]['Properties']['Parameters']['DBInstanceId'],x['targetInstanceId'])
  self.assertNotIn(x['sourceInstanceId'],json.dumps(t))
 def test_aliyun_notfound_only_exact_code(self):
  import isolated_rehearsal_aliyun as a
  from unittest.mock import patch
  x=self.manifest();x['ecsRole']='test';p={'binding':x,'secret':{'user':'migration_admin'}}
  with patch.object(a,'credential',return_value={}),patch.object(a,'rpc',side_effect=a.ProviderError('InvalidDBInstanceId.NotFound')):
   self.assertTrue(a.run('cleanup-readback-deleted',p)['notFound'])
  with patch.object(a,'credential',return_value={}),patch.object(a,'rpc',side_effect=a.ProviderError('Forbidden')):
   with self.assertRaises(a.ProviderError):a.run('cleanup-readback-deleted',p)
 def test_verified_bytes_not_swapped_original_path_execute(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   p=Path(d)/'adapter.py';p.write_text('print(\'{"verified":true}\')')
   digest=hashlib.sha256(p.read_bytes()).hexdigest();original=m.trusted_bytes
   def read_then_swap(path,h):
    data=original(path,h);p.write_text('print(\'{"verified":false}\')');return data
   with patch.object(m,'trusted_bytes',side_effect=read_then_swap):self.assertTrue(m.ProcessAdapter(p,digest,10)('observe',{})['verified'])
 def test_reused_secret_wrong_user_and_tls_reject(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();m.credentials(Path(d),x);p=Path(d)/'target-secret.json';s=json.loads(p.read_text());s['user']='app_rw';p.write_text(json.dumps(s))
   with self.assertRaises(ValueError):m.credentials(Path(d),x)
 def test_pending_readbacks_do_not_repeat_mutations(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   x=self.manifest();x['readbackBudgetSeconds']=1;x['deleteReadbackBudgetSeconds']=1;calls=[];reads={'account-readback':0,'cleanup-readback-deleted':0}
   def invoke(op,p):
    calls.append(op)
    if op=='observe':return {k:x[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
    if op=='cleanup-readback':return dict(registered='cleanup-registration-remove' not in calls,terminal='cleanup-registration-remove' in calls,targetInstanceId=x['targetInstanceId'],deleteBeginEpoch=m.created(x)+6900)
    if op=='role-account-readback':return role_fixture(p)
    if op in reads:
     reads[op]+=1
     return {'exists':reads[op]>1,'user':'migration_admin'} if op=='account-readback' else {'notFound':reads[op]>1}
    if op=='cleanup-registration-readback-removed':return {'removed':True}
    return dict(accepted=True,databases=list(m.DBS),**{k:x[k] for k in ('targetInstanceId','attemptId','candidateSha')})
   with patch.object(m.time,'sleep',return_value=None):self.assertTrue(m.rehearse(x,Path(d),invoke)['deleted'])
   self.assertEqual(calls.count('account-create'),1);self.assertEqual(calls.count('cleanup'),1);self.assertEqual(reads['cleanup-readback-deleted'],2)
 def test_actual_delete_wrong_provider_description_never_submits(self):
  import isolated_rehearsal_aliyun as a
  from unittest.mock import patch
  x=self.manifest();x['ecsRole']='test';calls=[]
  def rpc(service,action,params,c):
   calls.append(action);return {'Items':{'DBInstanceAttribute':[dict(DBInstanceId=x['targetInstanceId'],CreationTime=x['providerCreatedUtc'],DBInstanceDescription='another-owner')]}}
  with patch.object(a,'credential',return_value={}),patch.object(a,'rpc',side_effect=rpc):
   with self.assertRaises(ValueError):a.run('cleanup',{'binding':x,'secret':{}})
  self.assertNotIn('DeleteDBInstance',calls)
 def test_oos_readback_follows_pagination(self):
  import isolated_rehearsal_aliyun as a
  from unittest.mock import patch
  x=self.manifest();x.update(ecsRole='test',cleanupRole='role');tokens=[]
  def rpc(service,action,params,c):
   if action=='GetExecutionTemplate':return {'Content':json.dumps(a.cleanup_template(x))}
   tokens.append(params.get('NextToken'))
   if params.get('NextToken') is None:return {'Executions':[],'NextToken':'next'}
   return {'Executions':[{'Description':'wsx-isolated-'+x['attemptId'],'ExecutionId':'exec-test','Status':'Running'}]}
  with patch.object(a,'credential',return_value={}),patch.object(a,'rpc',side_effect=rpc):self.assertTrue(a.run('cleanup-readback',{'binding':x,'secret':{}})['registered'])
  self.assertEqual(tokens,[None,'next'])
 def test_iam_cleanup_requires_actual_exclusive_policy(self):
  import isolated_rehearsal_aliyun as a
  from unittest.mock import patch
  x=self.manifest();fragment=x['attemptId'].replace('-','')[:16];role='WSXCNIsolatedCleanup'+fragment;policy='WSXCNIsolatedPolicy'+fragment
  trust={'Version':'1','Statement':[{'Effect':'Allow','Action':'sts:AssumeRole','Principal':{'Service':['oos.aliyuncs.com']}}]};doc={'Version':'1','Statement':[{'Effect':'Allow','Action':['rds:DeleteDBInstance'],'Resource':['acs:rds:cn-shanghai:'+x['accountId']+':dbinstance/'+x['targetInstanceId']]}]}
  digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  x.update(cleanupRole=role,cleanupIam={'role':role,'policy':policy,'roleTrustCanonicalSha256':digest(trust),'policyCanonicalSha256':digest(doc)})
  calls=[]
  def rpc(service,action,params,c):
   calls.append(action)
   if action=='GetRole':return {'Role':{'Arn':'acs:ram::'+x['accountId']+':role/test','AssumeRolePolicyDocument':json.dumps(trust)}}
   if action=='GetPolicy':return {'Policy':{'DefaultVersion':'v1'}}
   if action=='GetPolicyVersion':return {'PolicyVersion':{'PolicyDocument':json.dumps(doc)}}
   if action=='ListPoliciesForRole':return {'Policies':{'Policy':[{'PolicyName':policy,'PolicyType':'Custom'}]}}
   if action=='ListEntitiesForPolicy':return {'Roles':{'Role':[{'RoleName':role},{'RoleName':'another-role'}]}}
   raise AssertionError('mutation must not occur')
  with patch.object(a,'rpc',side_effect=rpc):
   with self.assertRaises(ValueError):a.iam_binding(x,{},remove=True)
  self.assertNotIn('DetachPolicyFromRole',calls)
 def test_migration_frozen_plan_and_actual_provider_validator(self):
  x=self.manifest();p={'binding':x,'secret':{'user':'migration_admin',**x},'providerObservation':dict(x,providerVerified=True,observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat()),'plan':{'prepared':True,'candidateSha':x['candidateSha'],'sourceSqlInventory':[{'name':'one.sql','sha256':'a'*64}]}}
  module=str(Path(__file__).with_name('isolated_rehearsal_migrate.cjs'))
  script="const p=JSON.parse(require('fs').readFileSync(0,'utf8'));require(process.argv[1]).validate(p);"
  def check(v):return subprocess.run(['node','-e',script,module],input=json.dumps(v).encode(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode
  self.assertEqual(check(p),0)
  p['plan']['prepared']=False;self.assertNotEqual(check(p),0);p['plan']['prepared']=True
  p['providerObservation']['peer']='10.0.0.3';self.assertNotEqual(check(p),0);p['providerObservation']['peer']=x['peer']
  p['binding']['targetInstanceId']=x['sourceInstanceId'];self.assertNotEqual(check(p),0)
 def test_canvas_expanded_sql_hash_rejects_before_canvas_execution(self):
  x=self.manifest();sql="BEGIN;SET LOCAL ROLE app_rw;ROLLBACK;"
  payload={'binding':x,'secret':{'user':'migration_admin',**x},'providerObservation':dict(x,providerVerified=True,observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat()),'operation':'canvas-audit','sql':sql,'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'plan':{'prepared':True,'candidateSha':x['candidateSha'],'sourceSqlInventory':[{'name':'one.sql','sha256':hashlib.sha256(b'SELECT 1').hexdigest()}],'canonicalMigratorSha256':hashlib.sha256(b'canonical').hexdigest()}}
  engine=str(Path(__file__).with_name('isolated_rehearsal_migrate.cjs'))
  script=r"""const Module=require('module'),fs=require('fs'),old=Module._load,p=JSON.parse(fs.readFileSync(0,'utf8'));let canvas=0;
const pg={Client:class{constructor(){this.connection={stream:{remoteAddress:p.binding.peer,remotePort:5432}};}async connect(){}async end(){}async query(q){if(q===p.sql)canvas++;if(q.includes('current_database()'))return{rows:[{db:'workspacex',username:'migration_admin',ro:'on'}]};if(q.includes('canvas_template_actor'))return{rows:[{actor:'',action:''}]};return{rows:[]};}}};
Module._load=function(n,...a){if(n==='pg')return pg;return old.call(this,n,...a);};const read=fs.readFileSync,list=fs.readdirSync;
fs.readdirSync=function(n,...a){if(n==='/opt/workspacex/apps/api/migrations')return['one.sql'];return list.call(this,n,...a);};
fs.readFileSync=function(n,...a){if(n==='/opt/workspacex/apps/api/migrations/one.sql')return Buffer.from('SELECT 1');if(n==='/opt/workspacex/apps/api/src/infrastructure/db/migrator.ts')return Buffer.from('canonical');return read.call(this,n,...a);};
require(process.argv[1]).main(p).then(()=>console.log(JSON.stringify({accepted:true,canvas}))).catch(()=>console.log(JSON.stringify({accepted:false,canvas})));"""
  def check(v):return json.loads(subprocess.check_output(['node','-e',script,engine],input=json.dumps(v).encode()))
  self.assertEqual(check(payload),{'accepted':True,'canvas':1})
  payload['sqlSha256']='0'*64;self.assertEqual(check(payload),{'accepted':False,'canvas':0})
 def test_sql_stage_foreign_container_is_never_removed(self):
  import isolated_rehearsal_sql_stage as stage
  from unittest.mock import patch
  x=self.manifest();entry={'plan':{'path':'/plan','sha256':'a'*64},'engine':{'path':'/engine','sha256':'b'*64},'immutableRuntimeId':'sha256:'+'c'*64,'timeoutSeconds':10}
  x.update(stageManifestPath='/manifest',stageManifestSha256='d'*64)
  payload={'binding':x,'operation':'migrate','secret':{}}
  data={'/manifest':json.dumps({'prepared':True,'candidateSha':x['candidateSha'],'stages':{'migrate':entry}}).encode(),'/plan':json.dumps({'prepared':True,'candidateSha':x['candidateSha']}).encode(),'/engine':b'engine','/ca':b'CA'}
  x['tls']['ca']={'path':'/ca','sha256':'e'*64};calls=[]
  class R:
   def __init__(self,out,code=0):self.stdout=out;self.returncode=code
  def cap(argv,check=True):
   calls.append(argv)
   if argv[:2]==['image','inspect']:return R(json.dumps([{'Id':entry['immutableRuntimeId'],'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':x['candidateSha']},'Env':[]}}]).encode())
   if argv[:2]==['network','create']:return R(b'network-id')
   if argv[:2]==['network','inspect']:return R(json.dumps([{'Id':'network-id','Labels':{'wsx.rehearsal.owner':argv[-1] if False else next(a.split('=',1)[1] for v in calls if v[:2]==['network','create'] for a in v if a.startswith('wsx.rehearsal.owner='))},'Containers':{}}]).encode())
   if argv[0]=='inspect':return R(json.dumps([{'Id':'foreign','Config':{'Labels':{'wsx.rehearsal.owner':'someone-else'}}}]).encode())
   raise AssertionError('must not delete foreign')
  class P:
   returncode=0
   def communicate(self,*a,**k):return json.dumps({'accepted':True,**{k:x[k] for k in ('targetInstanceId','attemptId','candidateSha')}}).encode(),b''
   def poll(self):return 0
  with patch.object(stage,'trusted_bytes',side_effect=lambda path,digest:data[str(path)]),patch.object(stage,'capture',side_effect=cap),patch.object(stage.subprocess,'Popen',return_value=P()):
   with self.assertRaisesRegex(ValueError,'FOREIGN_CONTAINER'):stage.run(payload)
  self.assertFalse(any(v[0]=='rm' for v in calls))
 def test_all_owned_python_stage_modules_compile(self):
  for name in ('isolated_rehearsal.py','isolated_rehearsal_aliyun.py','isolated_rehearsal_restore.py','isolated_rehearsal_sql_stage.py','isolated_rehearsal_snapshot.py'):
   source=Path(__file__).with_name(name).read_bytes();compile(source,name,'exec')
 def test_actual_node_membership_cleanup_refuses_changed_grantor(self):
  x=self.manifest();x['sourceDatabaseSpec']={'rdsInstanceId':x['sourceInstanceId'],'readOnly':True,'rollbackConfirmed':True,'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'databases':[{'name':n,'owner':owner,'encoding':'UTF8','collate':'C','ctype':'en_US.utf8','acl':None} for n,owner in [('workspacex','migration_owner'),('workspacex_agent','graph_owner'),('workspacex_memory','memory_owner')]]}
  roles=['app_diag_ro','app_rw','graph_owner','memory_owner','memory_rw','migration_owner'];rows=[{'role':n,'grantor':'migration_admin','admin_option':False,'inherit_option':False,'set_option':True} for n in roles]
  p={'binding':x,'secret':dict(x,user='migration_admin',port=5432,password='FAKE'),'preparationReceipt':{'targetId':x['targetInstanceId'],'temporarySetRoles':roles,'temporaryMembershipRows':rows}}
  script=r"""const M=require('module'),old=M._load,p=JSON.parse(require('fs').readFileSync(0,'utf8'));let revokes=0,rows=p.actual||p.preparationReceipt.temporaryMembershipRows;
const pg={Client:class{constructor(){this.connection={stream:{remoteAddress:p.binding.peer,remotePort:5432}};}async connect(){}async end(){}async query(sql){if(sql.startsWith('REVOKE')){revokes++;return {rows:[]};}if(sql.startsWith('SELECT r.rolname'))return{rows};if(sql.startsWith('SELECT a.roleid'))return{rowCount:revokes===6?0:6};return{rows:[]};}}};M._load=function(n,...a){return n==='pg'?pg:old.call(this,n,...a);};const f=require('fs');const read=f.readFileSync;f.readFileSync=function(n,...a){return n==='/run/ca.pem'?'CA':read.call(this,n,...a);};let text='';const write=process.stdout.write;process.stdout.write=x=>(text+=x,true);require(process.argv[1]).removeTemporary(p).then(()=>{process.stdout.write=write;console.log(JSON.stringify({accepted:true,revokes,secretLogged:text.includes(p.secret.password)}));}).catch(()=>{process.stdout.write=write;console.log(JSON.stringify({accepted:false,revokes,secretLogged:text.includes(p.secret.password)}));});"""
  module=str(Path(__file__).with_name('isolated_rehearsal_databases.cjs'))
  def check(v):return json.loads(subprocess.check_output(['node','-e',script,module],input=json.dumps(v).encode()))
  self.assertEqual(check(p),{'accepted':True,'revokes':6,'secretLogged':False})
  p['actual']=[dict(v,grantor='someone_else') for v in rows];self.assertEqual(check(p),{'accepted':False,'revokes':0,'secretLogged':False})
 def test_baseline_proof_is_actual_json_and_disk_hash(self):
  import isolated_rehearsal_snapshot as snapshot
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   result={'database':'workspacex','dataFidelityVerified':True,'targetRdsInstanceId':'pgm-isolatedtest'}
   ref=snapshot.write_baseline_proof(Path(d),'workspacex',result)
   self.assertEqual(m.private_json(Path(ref['path'])),result);self.assertEqual(ref['sha256'],hashlib.sha256(Path(ref['path']).read_bytes()).hexdigest());self.assertEqual(Path(ref['path']).stat().st_mode&0o777,0o600)
 def test_cms_private_key_public_permissions_rejected(self):
  import isolated_rehearsal_snapshot as snapshot
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   key=Path(d)/'key.pem';key.write_bytes(b'fixture-key-only');key.chmod(0o600);ref={'path':str(key),'sha256':hashlib.sha256(key.read_bytes()).hexdigest()}
   self.assertEqual(snapshot.private_key(ref),b'fixture-key-only');key.chmod(0o644)
   with self.assertRaisesRegex(ValueError,'PRIVATE_KEY_MODE'):snapshot.private_key(ref)
class OfflineClosureTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  # CI setup-node may be owned by another toolcache uid. Copy the actual executable
  # into a private current-user tree; never weaken the production root-owner gate.
  source=Path(shutil.which('node')).resolve();cls.node_directory=tempfile.TemporaryDirectory(dir=Path('/tmp').resolve());cls.node=Path(cls.node_directory.name)/'node'
  shutil.copyfile(source,cls.node);cls.node.chmod(0o700)
  if hashlib.sha256(cls.node.read_bytes()).digest()!=hashlib.sha256(source.read_bytes()).digest():raise ValueError('TEST_NODE_BYTE_DRIFT')
  original_which=shutil.which
  cls.node_resolver=patch.object(m.shutil,'which',side_effect=lambda command,*args,**kwargs:str(cls.node) if command=='node' else original_which(command,*args,**kwargs));cls.node_resolver.start()
 @classmethod
 def tearDownClass(cls):
  cls.node_resolver.stop();cls.node_directory.cleanup()
 def test_real_node_writable_permissions_rejected(self):
  self.node.chmod(0o777)
  try:
   with self.assertRaisesRegex(ValueError,'TRUSTED_NODE_REQUIRED'):m.offline_node('console.log(JSON.stringify({verified:true}))',{})
  finally:self.node.chmod(0o700)
  self.assertTrue(m.offline_node('console.log(JSON.stringify({verified:true}))',{})['verified'])
 def test_real_sticky_and_nonsticky_ancestor_guard(self):
  parent=Path(self.node_directory.name)/'ancestor';parent.mkdir(mode=0o700);private=parent/'private';private.mkdir(mode=0o700);node=private/'node';shutil.copyfile(self.node,node);node.chmod(0o700)
  original_resolver=m.shutil.which
  with patch.object(m.shutil,'which',side_effect=lambda command,*args,**kwargs:str(node) if command=='node' else original_resolver(command,*args,**kwargs)):
   parent.chmod(0o1777);self.assertTrue(m.offline_node('console.log(JSON.stringify({verified:true}))',{})['verified'])
   parent.chmod(0o777)
   with self.assertRaisesRegex(ValueError,'TRUSTED_NODE_ANCESTOR'):m.offline_node('console.log(JSON.stringify({verified:true}))',{})
   parent.chmod(0o1777);original=Path.lstat
   def foreign_owner(path):
    value=original(path)
    if path==parent:
     values=list(value);values[4]=os.geteuid()+9999;return os.stat_result(values)
    return value
   # Non-root portable tests cannot chown: only this ancestor UID is simulated.
   # The file, sticky mode, full process invocation and other metadata are real.
   with patch.object(Path,'lstat',foreign_owner):
    with self.assertRaisesRegex(ValueError,'TRUSTED_NODE_ANCESTOR'):m.offline_node('console.log(JSON.stringify({verified:true}))',{})
  self.assertIsNotNone(shutil.which('openssl'))
 def test_real_files_transitive_import_missing_and_hash_drift(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   root=Path(d);p=root/'entry.py';p.write_text('from isolated_dependency import value\nprint(value)\n');p.chmod(0o600)
   ref=lambda f:dict(path=str(f),sha256=hashlib.sha256(f.read_bytes()).hexdigest())
   entry=ref(p)
   with self.assertRaisesRegex(ValueError,'TRANSITIVE_MODULE_MISSING'):m.executable_closure(entry)
   dep=root/'isolated_dependency.py';dep.write_text('value=1');dep.chmod(0o600);entry['modules']={'isolated_dependency.py':ref(dep)}
   self.assertEqual(set(m.executable_closure(entry)),{'entry.py','isolated_dependency.py'})
   dep.write_text('value=2')
   with self.assertRaisesRegex(ValueError,'ADAPTER_HASH_MISMATCH'):m.executable_closure(entry)
 def fixture(self,root):
  b=BindingTests().manifest();b['candidateSha']='a'*40;sequence=[0]
  def ref(value):
   sequence[0]+=1;p=root/('input-'+str(sequence[0])+'.json');p.write_text(json.dumps(value));p.chmod(0o600)
   return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  def rawref(raw):
   sequence[0]+=1;p=root/('raw-'+str(sequence[0]));p.write_bytes(raw);p.chmod(0o600);return dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest())
  code=rawref(Path(__file__).with_name('isolated_rehearsal_databases.cjs').read_bytes());image='sha256:'+'a'*64
  keypath=root/'key.pem';certpath=root/'cert.pem';subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(keypath),'-out',str(certpath),'-days','1','-subj','/CN=fixture-only'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  key=rawref(keypath.read_bytes());cert=rawref(certpath.read_bytes());ca=cert
  b['tls']['ca']=ca
  migration=rawref((Path(__file__).parents[3]/'apps/api/migrations/20261001160000_canvas_template_audit.sql').read_bytes());canvas=rawref(Path(__file__).with_name('isolated_rehearsal_canvas.sql').read_bytes())
  sql={'20261001160000_canvas_template_audit.sql':migration['sha256']};body=json.loads(Path(__file__).with_name('fixtures').joinpath('isolated-canonical-historical/canvas-audit-law.json').read_text());law={'20261001160000_canvas_template_audit.sql':dict(sqlSha256=migration['sha256'],body=body,lawSha256=hashlib.sha256(json.dumps(body,separators=(',',':')).encode()).hexdigest(),reviewed=True)}
  engine=dict(code,runtimeSourceSha=b['candidateSha'],candidateSha=b['candidateSha'],actualSqlPeerChecks=True,language='node',immutableRuntimeId=image,timeoutSeconds=30,supervisor=code)
  canonical=dict(engine,language='python',runtimeSourceSha=b['candidateSha'],canonicalMigrationExtractorInvokeId='fixture-invoke',resources={'exact':{'source.py':code},'probe':{name:code for name in ('canonical-source-manifest.json','canonical-extractor.json','python-runtime-manifest.json')}})
  spec=dict(prepared=True,**{k:b[k] for k in ('attemptId','targetInstanceId','candidateSha')},conservationPlan=dict(schemaVersion=1,prepared=True,frozen=True,candidateSha=b['candidateSha'],sourceInstanceId=b['sourceInstanceId'],force=False,seed=False,fullSqlChecksums=sql,migrationLawBindings=law,pendingSqlChecksums=sql,expectedLedgerCount=1,canonicalSchemaPlanHashes={db:'a'*64 for db in ('workspacex_agent','workspacex_memory')},databases=list(m.DBS),canonicalSourceSha=b['candidateSha'],canonicalSourceFiles={name:'a'*64 for name in ('memory_deployment.py','postgres_checkpointer.py','self_hosted_runtime.py','pyproject.toml')}),sourceSqlInventory=ref({'sourceSha':b['candidateSha'],'files':[{'path':name,'sha256':digest} for name,digest in sql.items()]}),stages={})
  for stage in ('before','after'):spec['stages'][stage]={db:dict(engine=engine,**({'canonicalPlan':code} if db!='workspacex' else {})) for db in m.DBS}
  spec['stages']['canonical-setup']=canonical
  for stage in ('migrate','canvas-audit'):spec['stages'][stage]=dict(engine=code,sql=canvas,migration=migration,timeoutSeconds=30,immutableRuntimeId=image,plan=ref(dict(prepared=True,candidateSha=b['candidateSha'],sourceSqlInventory=[{'name':name,'sha256':digest} for name,digest in sql.items()],canonicalMigratorSha256='d'*64)))
  for stage in ('snapshot','recovery-verify','restore-fidelity'):spec['stages'][stage]=dict(clientVersion='16.15',clientImage=image,apiImage=image,apiSourceSha=b['candidateSha'],privateKey=key,certificate=cert,verifier=code)
  backups={}
  for db in m.DBS:
   cipher=ref('cipher fixture only');path=Path(cipher['path']);receipt=ref(dict(database=db,sourceRdsInstanceId=b['sourceInstanceId'],cleanupVerified=True,dumpExit=0,encryptionExit=0,recipientCertificateSha256=cert['sha256'],ciphertextSha256=cipher['sha256'],bytes=path.stat().st_size))
   backups[db]=dict(receiptPath=receipt['path'],receiptSha256=receipt['sha256'],ciphertextPath=cipher['path'])
  b['sourceDatabaseSpec']=dict(rdsInstanceId=b['sourceInstanceId'],readOnly=True,rollbackConfirmed=True,observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),databases=[dict(name=db,owner={'workspacex':'migration_owner','workspacex_agent':'graph_owner','workspacex_memory':'memory_owner'}[db],encoding='UTF8',collate='C',ctype='en_US.utf8',acl=None) for db in m.DBS])
  b['restore']=dict(clientImage=image,apiClientImage=image,isolatedNetwork='d'*64,apiClientSourceSha=b['candidateSha'],databases=backups,databasePreparationPath=code['path'],databasePreparationSha256=code['sha256'],recipientCertificatePath=cert['path'],recipientCertificateSha256=cert['sha256'],recipientKeyPath=key['path'])
  from isolated_conservation_inputs_test import CanonicalInputs
  canonical_spec,_,store,_=CanonicalInputs().fixture()
  refs={path:rawref(raw) for path,raw in store.items()}
  def rebind(value):
   if isinstance(value,dict):
    if 'path' in value and value['path'] in refs:return refs[value['path']]
    return {k:rebind(v) for k,v in value.items()}
   if isinstance(value,list):return [rebind(v) for v in value]
   return value
  canonical_spec=rebind(canonical_spec)
  spec['conservationPlan'].update(canonical_spec['conservationPlan'])
  spec['stages']['canonical-setup'].update(canonical_spec['stages']['canonical-setup'])
  for stage in ('before','after'):
   for db in ('workspacex_agent','workspacex_memory'):spec['stages'][stage][db]['canonicalPlan']=canonical_spec['stages'][stage][db]['canonicalPlan']
  return b,spec,ref
 def test_nested_files_pass_and_missing_source_resource_rejects(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b,spec,ref=self.fixture(Path(d));r=ref(spec);b.update(stageManifestPath=r['path'],stageManifestSha256=r['sha256']);self.assertEqual(m.stage_input_closure(b),spec)
   Path(spec['stages']['canonical-setup']['resources']['exact']['apps/deep-agent-service/uv.lock']['path']).unlink()
   with self.assertRaises(FileNotFoundError):m.stage_input_closure(b)
 def test_real_offline_semantic_rejections(self):
  import copy
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b,spec,ref=self.fixture(Path(d))
   def check(binding,manifest):
    r=ref(manifest);binding=dict(binding,stageManifestPath=r['path'],stageManifestSha256=r['sha256'])
    with self.assertRaises(ValueError):m.stage_input_closure(binding)
   wrong=copy.deepcopy(b);wrong['sourceDatabaseSpec']['databases'][0]['owner']='fixture';check(wrong,spec)
   wrong=copy.deepcopy(b);wrong['sourceDatabaseSpec']['databases'][0]['acl']='public';check(wrong,spec)
   wrong=copy.deepcopy(spec);next(iter(wrong['conservationPlan']['migrationLawBindings'].values()))['body']={'changed':True};check(b,wrong)
   wrong=copy.deepcopy(spec);wrong['stages']['canvas-audit']['migration']=wrong['stages']['canvas-audit']['engine'];check(b,wrong)
   wrong=copy.deepcopy(spec);old=wrong['stages']['canvas-audit']['sql'];wrong['stages']['canvas-audit']['sql']=ref(Path(old['path']).read_text().replace('ROLLBACK;',''));check(b,wrong)
   wrong=copy.deepcopy(spec);wrong['stages']['snapshot']['certificate']=wrong['stages']['snapshot']['verifier'];check(b,wrong)
   other=root=Path(d)/'other-key.pem';subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(other)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);other.chmod(0o600)
   wrong_b=copy.deepcopy(b);wrong=copy.deepcopy(spec);wrong_b['restore']['recipientKeyPath']=str(other)
   for stage in ('snapshot','recovery-verify','restore-fidelity'):wrong['stages'][stage]['privateKey']=dict(path=str(other),sha256=hashlib.sha256(other.read_bytes()).hexdigest())
   check(wrong_b,wrong)
 def test_each_runtime_required_field_missing_rejects(self):
  import copy
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   original,original_spec,ref=self.fixture(Path(d))
   locations=[('binding',('sourceDatabaseSpec',)),('binding',('restore','clientImage')),('binding',('restore','apiClientImage')),('binding',('restore','isolatedNetwork')),('binding',('restore','recipientKeyPath')),('binding',('restore','recipientCertificatePath')),('binding',('restore','databasePreparationPath'))]
   for stage in ('snapshot','recovery-verify','restore-fidelity'):
    locations.extend(('spec',('stages',stage,key)) for key in ('clientImage','clientVersion','apiImage','apiSourceSha','certificate','privateKey','verifier'))
   for stage in ('migrate','canvas-audit'):locations.extend(('spec',('stages',stage,key)) for key in ('plan','engine','immutableRuntimeId','timeoutSeconds'))
   locations.extend([('spec',('stages','canvas-audit','sql')),('spec',('stages','canvas-audit','migration')),('spec',('conservationPlan','pendingSqlChecksums')),('spec',('conservationPlan','expectedLedgerCount')),('spec',('conservationPlan','canonicalSourceFiles')),('spec',('conservationPlan','canonicalSchemaPlanHashes')),('spec',('stages','canonical-setup','runtimeSourceSha')),('spec',('stages','canonical-setup','resources')),('spec',('stages','canonical-setup','canonicalMigrationExtractorInvokeId'))])
   for kind,path in locations:
    with self.subTest(path=path):
     b=copy.deepcopy(original);spec=copy.deepcopy(original_spec);value=b if kind=='binding' else spec
     for key in path[:-1]:value=value[key]
     del value[path[-1]];r=ref(spec);b.update(stageManifestPath=r['path'],stageManifestSha256=r['sha256'])
     with self.assertRaises((ValueError,KeyError)):m.stage_input_closure(b)
 def test_old_candidate_private_key_and_draft_reject(self):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   b,spec,ref=self.fixture(Path(d));r=ref(spec);b.update(stageManifestPath=r['path'],stageManifestSha256=r['sha256'])
   key=Path(b['restore']['recipientKeyPath']);key.chmod(0o644)
   with self.assertRaisesRegex(ValueError,'PRIVATE_INPUT_MODE'):m.stage_input_closure(b)
   key.chmod(0o600);spec['stages']['snapshot']['apiSourceSha']='2'*40;r=ref(spec);b.update(stageManifestPath=r['path'],stageManifestSha256=r['sha256'])
   with self.assertRaisesRegex(ValueError,'SNAPSHOT_IMAGE_BINDING'):m.stage_input_closure(b)
   spec['prepared']=False;r=ref(spec);b.update(stageManifestPath=r['path'],stageManifestSha256=r['sha256'])
   with self.assertRaisesRegex(ValueError,'STAGE_MANIFEST_BINDING'):m.stage_input_closure(b)
class InputBuilderTests(unittest.TestCase):
 def test_real_transitive_module_map_and_missing_reference(self):
  import isolated_rehearsal_prepare as builder
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   def ref(name,text):
    p=Path(d)/name;p.write_text(text);p.chmod(0o600);return dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest())
   entry=ref('entry.py','from isolated_one import x\n');one=ref('isolated_one.py','from isolated_two import y\n');two=ref('isolated_two.py','y=1\n')
   with self.assertRaisesRegex(ValueError,'REVIEWED_MODULE_REQUIRED'):builder.modules_for(entry,{'isolated_one.py':one})
   result=builder.modules_for(entry,{'isolated_one.py':one,'isolated_two.py':two});self.assertEqual(set(result['modules']),{'isolated_one.py','isolated_two.py'})
   m.executable_closure(result)
 def test_neutral_template_readonly_no_invented_target(self):
  import isolated_rehearsal_prepare as builder
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   root=Path(d);script=root/'adapter.py';script.write_text('print(1)');script.chmod(0o600)
   b=dict(candidateSha='1'*40,adapterPath=str(script),adapterSha256=hashlib.sha256(script.read_bytes()).hexdigest(),stages={})
   template=root/'template.json';template.write_text(json.dumps(dict(prepared=True,candidateSha=b['candidateSha'],resources={'source':{'path':str(script),'sha256':b['adapterSha256']}})));template.chmod(0o600)
   request=dict(binding=b,stageTemplate=dict(path=str(template),sha256=hashlib.sha256(template.read_bytes()).hexdigest()),reviewedModules={})
   result=builder.review_template(request);self.assertTrue(result['targetBindingRequired']);self.assertFalse(result['liveAccepted']);self.assertNotIn('targetInstanceId',result)
   self.assertEqual(set(p.name for p in root.iterdir()),{'adapter.py','template.json'})
   script.unlink()
   with self.assertRaises(FileNotFoundError):builder.review_template(request)
 def test_prepare_failure_removes_only_new_files(self):
  import isolated_rehearsal_prepare as builder
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as d:
   root=Path(d);b=BindingTests().manifest();template=root/'reviewed.json';template.write_text(json.dumps(dict(prepared=True,candidateSha=b['candidateSha'],stages={})));template.chmod(0o600)
   script=root/'adapter.py';script.write_text('print(1)');script.chmod(0o600);b.update(adapterPath=str(script),adapterSha256=hashlib.sha256(script.read_bytes()).hexdigest(),stages={})
   request=dict(binding=b,stageTemplate=dict(path=str(template),sha256=hashlib.sha256(template.read_bytes()).hexdigest()),reviewedModules={})
   def reject(_):raise ValueError('SIMULATED_INPUT_MISSING')
   with self.assertRaisesRegex(ValueError,'SIMULATED_INPUT_MISSING'):builder.prepare(request,root,reject)
   self.assertFalse((root/'bound-stages.json').exists());self.assertTrue(template.exists())
   result=builder.prepare(request,root,lambda _:dict(preparedInputClosure=True));self.assertTrue(result['preparedInputClosure']);before=(root/'bound-stages.json').read_bytes()
   with self.assertRaises(FileExistsError):builder.prepare(request,root,reject)
   self.assertEqual((root/'bound-stages.json').read_bytes(),before)
class RoleBootstrapTests(unittest.TestCase):
 def fixture(self):
  import isolated_rehearsal_aliyun as adapter
  b=BindingTests.manifest(self);b['ecsRole']='test-role'
  secret=dict(roles={role:dict(b,user=role,port=5432,password='Aa1!'+'x'*28) for role in m.ROLE_NAMES})
  rows=[dict(DBInstanceId=b['targetInstanceId'],AccountName='migration_admin',AccountType='Super',AccountStatus='Available',AccountDescription='Isolated rehearsal '+b['attemptId'])]
  calls=[]
  def rpc(service,action,args,cred):
   self.assertEqual(service,'rds');self.assertEqual(args['DBInstanceId'],b['targetInstanceId']);calls.append((action,dict(args)))
   if action=='DescribeDBInstanceAttribute':return {'Items':{'DBInstanceAttribute':[dict(DBInstanceId=b['targetInstanceId'],CreationTime=b['providerCreatedUtc'],DBInstanceDescription=b['providerDescription'])]}}
   if action=='DescribeAccounts':return dict(Accounts=dict(DBInstanceAccount=[dict(r) for r in rows]),PageNumber=1,TotalRecordCount=len(rows))
   if action=='CreateAccount':
    rows.append(dict(DBInstanceId=b['targetInstanceId'],AccountName=args['AccountName'],AccountType=args['AccountType'],AccountDescription=args['AccountDescription'],AccountStatus='Available'));return {}
   raise AssertionError(action)
  def invoke(op,p):
   with patch.object(adapter,'credential',return_value={}),patch.object(adapter,'rpc',side_effect=rpc):return adapter.run(op,p)
  return b,secret,rows,calls,rpc,invoke,adapter
 def test_six_normal_created_once_then_readonly_resume(self):
  b,s,rows,calls,_,invoke,_=self.fixture()
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);m.bootstrap_role_accounts(b,root,s,invoke)
   self.assertEqual([a['AccountName'] for op,a in calls if op=='CreateAccount'],list(m.ROLE_NAMES))
   self.assertTrue(all(a['AccountType']=='Normal' for op,a in calls if op=='CreateAccount'))
   for role in m.ROLE_NAMES:
    receipt=json.loads((root/('role-'+role+'.receipt.json')).read_text());self.assertTrue(receipt['providerVerified']);self.assertNotIn('password',json.dumps(receipt))
   calls.clear();m.bootstrap_role_accounts(b,root,s,invoke);self.assertFalse(any(op=='CreateAccount' for op,_ in calls))
 def test_lost_ack_reconciles_without_second_create(self):
  b,s,rows,calls,_,invoke,_=self.fixture();lost=[False]
  def wrapper(op,p):
   result=invoke(op,p)
   if op=='role-account-create' and not lost[0]:lost[0]=True;raise m.UnknownOutcome('lost ack')
   return result
  with tempfile.TemporaryDirectory() as d:m.bootstrap_role_accounts(b,Path(d),s,wrapper)
  self.assertEqual(sum(op=='CreateAccount' for op,_ in calls),6)
 def test_existing_intent_without_remote_result_never_creates(self):
  b,s,rows,calls,_,invoke,_=self.fixture()
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);intent=m.role_intent(b,m.ROLE_NAMES[0],'a'*32);m.exclusive(root/('role-'+m.ROLE_NAMES[0]+'.intent.json'),intent)
   with self.assertRaises(m.UnknownOutcome):m.bootstrap_role_accounts(b,root,s,invoke)
   self.assertFalse(any(op=='CreateAccount' for op,_ in calls));self.assertFalse(list(root.glob('*.receipt.json')))
 def test_foreign_preexisting_account_refuses_without_intent(self):
  for role in (m.ROLE_NAMES[0],'foreign'):
   b,s,rows,calls,_,invoke,_=self.fixture();rows.append(dict(DBInstanceId=b['targetInstanceId'],AccountName=role,AccountType='Normal',AccountDescription='foreign',AccountStatus='Available'))
   with self.subTest(role=role),tempfile.TemporaryDirectory() as d:
    with self.assertRaisesRegex(ValueError,'ROLE_FOREIGN_ACCOUNT'):m.bootstrap_role_accounts(b,Path(d),s,invoke)
    self.assertFalse(list(Path(d).glob('*.intent.json')));self.assertFalse(any(op=='CreateAccount' for op,_ in calls))
 def test_intent_binding_and_symlink_rejected_before_provider(self):
  for variant in ('target','attempt','nonce','extra','symlink','mode'):
   b,s,rows,calls,_,invoke,_=self.fixture()
   with self.subTest(variant=variant),tempfile.TemporaryDirectory() as d:
    root=Path(d);value=m.role_intent(b,m.ROLE_NAMES[0],'a'*32);path=root/('role-'+m.ROLE_NAMES[0]+'.intent.json')
    if variant=='target':value['targetInstanceId']='pgm-other'
    if variant=='attempt':value['attemptId']=str(uuid.uuid4())
    if variant=='nonce':value['bootstrapNonce']='short'
    if variant=='extra':value['extra']=True
    m.exclusive(path,value)
    if variant=='mode':path.chmod(0o644)
    if variant=='symlink':path.rename(root/'other');path.symlink_to(root/'other')
    with self.assertRaises(ValueError):m.bootstrap_role_accounts(b,root,s,invoke)
    self.assertEqual(calls,[])
 def test_bad_provider_page_or_identity_never_creates(self):
  for variant in ('missing-total','partial','duplicate','wrong-target','missing-description','wrong-description','super'):
   b,s,rows,calls,rpc,_,adapter=self.fixture()
   def broken(service,action,args,cred):
    result=rpc(service,action,args,cred)
    if action=='DescribeAccounts':
     if variant=='missing-total':result.pop('TotalRecordCount')
     if variant=='partial':result['TotalRecordCount']+=1
     if variant=='duplicate':result['Accounts']['DBInstanceAccount']*=2;result['TotalRecordCount']=2
     if variant=='wrong-target':result['Accounts']['DBInstanceAccount'][0]['DBInstanceId']='pgm-other'
     if variant=='missing-description':result['Accounts']['DBInstanceAccount'][0].pop('AccountDescription')
     if variant=='wrong-description':result['Accounts']['DBInstanceAccount'][0]['AccountDescription']='another attempt'
     if variant=='super':result['Accounts']['DBInstanceAccount'][0]['AccountType']='Normal'
    return result
   def invoke(op,p):
    with patch.object(adapter,'credential',return_value={}),patch.object(adapter,'rpc',side_effect=broken):return adapter.run(op,p)
   with self.subTest(variant=variant),tempfile.TemporaryDirectory() as d:
    with self.assertRaises(ValueError):m.bootstrap_role_accounts(b,Path(d),s,invoke)
    self.assertFalse(any(op=='CreateAccount' for op,_ in calls))
 def test_unavailable_role_cannot_start_next_create(self):
  b,s,rows,calls,_,invoke,_=self.fixture()
  def wrapper(op,p):
   result=invoke(op,p)
   if op=='role-account-create':rows[-1]['AccountStatus']='Unavailable'
   return result
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(m.UnknownOutcome):m.bootstrap_role_accounts(b,Path(d),s,wrapper)
   self.assertFalse(list(Path(d).glob('*.receipt.json')))
  self.assertEqual(sum(op=='CreateAccount' for op,_ in calls),1)
 def test_receipt_alone_or_changed_nonce_cannot_claim_account(self):
  b,s,rows,calls,_,invoke,_=self.fixture()
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);m.bootstrap_role_accounts(b,root,s,invoke);path=root/('role-'+m.ROLE_NAMES[0]+'.intent.json');path.unlink();calls.clear()
   with self.assertRaisesRegex(ValueError,'ROLE_RECEIPT_BINDING'):m.bootstrap_role_accounts(b,root,s,invoke)
   self.assertEqual(calls,[])
 def test_normal_description_drift_and_wrong_password_binding_stop(self):
  for variant in ('description','secret'):
   b,s,rows,calls,_,invoke,_=self.fixture()
   def wrapper(op,p):
    if op=='role-account-create' and variant=='secret':p['secret']['roles'][p['role']]['attemptId']='wrong'
    result=invoke(op,p)
    if op=='role-account-create' and variant=='description':rows[-1]['AccountDescription']='foreign'
    return result
   with self.subTest(variant=variant),tempfile.TemporaryDirectory() as d:
    with self.assertRaises(ValueError):m.bootstrap_role_accounts(b,Path(d),s,wrapper)
    self.assertFalse(list(Path(d).glob('*.receipt.json')))
 def test_initial_admin_empty_guard_remains(self):
  b,s,rows,calls,_,invoke,_=self.fixture();s.update(dict(b,user='migration_admin',port=5432,password='Aa1!'+'x'*28))
  with self.assertRaisesRegex(ValueError,'ACCOUNT_NOT_EMPTY'):invoke('account-create',dict(binding=b,secret=s))
  self.assertFalse(any(op=='CreateAccount' for op,_ in calls))

if __name__=='__main__':unittest.main()
