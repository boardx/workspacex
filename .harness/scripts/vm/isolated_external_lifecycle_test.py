import copy,datetime,hashlib,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).parent))
import isolated_rehearsal as m
import isolated_rehearsal_aliyun as a
import isolated_external_lifecycle as e
import isolated_rehearsal_test as fixtures

class ExternalTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(dir=Path('/tmp').resolve());self.root=Path(self.temp.name);self.b=fixtures.BindingTests().manifest();self.b.update(ecsRole='runner',cleanupRole='cleanup')
  self.n=0;self.secret=m.credentials(self.root,self.b)
  (self.root/'target-secret.json').unlink()
  self.descriptions={'migration_admin':'Isolated rehearsal '+self.b['attemptId']};accounts={};binding={k:self.b[k] for k in e.BINDING}
  for role in ('migration_admin',*m.ROLE_NAMES):
   if role=='migration_admin':intent=dict(kind='isolated-admin-account-intent',accountType='Super',role=role,**binding)
   else:
    intent=m.role_intent(self.b,role,'a'*32);self.descriptions[role]=m.role_description(intent)
   accounts[role]={'intent':self.ref(intent),'ack':self.ref({'RequestId':'created-'+role.replace('_','-')})}
  self.page={'RequestId':'accounts','PageNumber':1,'TotalRecordCount':7,'Accounts':{'DBInstanceAccount':[dict(AccountName=n,AccountType='Super' if n=='migration_admin' else 'Normal',AccountStatus='Available',DBInstanceId=self.b['targetInstanceId'],AccountDescription=d) for n,d in self.descriptions.items()]}}
  template=a.cleanup_template(self.b);tref=self.ref(template)
  self.oos={'RequestId':'list','Executions':[{'ExecutionId':'exec-owned','Description':'wsx-isolated-'+self.b['attemptId'],'Status':'Waiting'}]};self.detail={'RequestId':'template','Content':json.dumps(template)}
  self.prepared=dict(schemaVersion=1,kind='isolated-external-lifecycle-prepared-v1',binding=binding,runnerInstanceId=self.b['runnerLifetime']['instanceId'],ownerJournal=self.ref(dict(binding=binding,owner='mac-coordinator',state='prepared-no-unknown-writes')),observedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),emptyAccounts=self.ref({'parameters':{'RegionId':self.b['regionId'],'DBInstanceId':self.b['targetInstanceId'],'PageNumber':1,'PageSize':100},'response':{'RequestId':'empty','PageNumber':1,'TotalRecordCount':0,'Accounts':{'DBInstanceAccount':[]}}}),accounts=accounts,accountReadback=self.ref(self.page),oos=dict(executionId='exec-owned',startIntent=self.ref(dict(kind='isolated-oos-start-intent',binding=binding,templateSha256=tref['sha256'],clientToken='wsx-cleanup-'+self.b['attemptId'])),startAck=self.ref({'RequestId':'started','Execution':{'ExecutionId':'exec-owned'}}),template=tref,readback=self.ref(self.oos),templateReadback=self.ref(self.detail)))
  operations={}
  for name,item in accounts.items():
   sec=self.secret if name=='migration_admin' else self.secret['roles'][name]
   params=dict(RegionId=self.b['regionId'],DBInstanceId=self.b['targetInstanceId'],AccountName=name,AccountType='Super' if name=='migration_admin' else 'Normal',AccountDescription=self.descriptions[name],AccountPassword=sec['password'])
   operations['account:'+name]=self.dispatch('account:'+name,item['intent'],item['ack'],e.request_digest('rds','CreateAccount',params),binding)
  o=self.prepared['oos'];params=dict(RegionId=self.b['regionId'],ClientToken='wsx-cleanup-'+self.b['attemptId'],Mode='Automatic',TemplateContent=json.dumps(template,separators=(',',':')),Description='wsx-isolated-'+self.b['attemptId'])
  operations['oos']=self.dispatch('oos',o['startIntent'],o['startAck'],e.request_digest('oos','StartExecution',params),binding)
  self.owner=dict(schemaVersion=1,kind='isolated-owner-journal-projection-v1',binding=binding,owner='mac-coordinator',emptyAccounts=self.prepared['emptyAccounts'],operations=operations)
  self.prepared['ownerJournal']=self.ref(self.owner)
  self.b['lifecycle']=dict(mode=e.MODE,owner='mac-coordinator',preparedReceipt=self.ref(self.prepared),targetSecret=self.ref(self.secret))
 def dispatch(self,name,intent,ack,request_sha,binding):
  return dict(intent=intent,ack=ack,dispatch=self.ref(dict(schemaVersion=1,kind='isolated-owner-dispatch-v1',binding=binding,operation=name,intentSha256=intent['sha256'],requestSha256=request_sha,state='acknowledged',ackSha256=ack['sha256'])))
 def tearDown(self):self.temp.cleanup()
 def ref(self,v):
  self.n+=1;p=self.root/str(self.n);raw=json.dumps(v).encode();p.write_bytes(raw);p.chmod(0o600);return dict(path=str(p),sha256=hashlib.sha256(raw).hexdigest())
 def refresh(self):self.b['lifecycle']['preparedReceipt']=self.ref(self.prepared)
 def call(self,service,action,params):
  if action=='DescribeDBInstanceAttribute':return {'RequestId':'attrs','Items':{'DBInstanceAttribute':[dict(DBInstanceId=self.b['targetInstanceId'],CreationTime=self.b['providerCreatedUtc'],DBInstanceDescription=self.b['providerDescription'])]}}
  if action=='DescribeAccounts':return copy.deepcopy(self.page)
  if action=='ListExecutions':
   self.assertEqual(params,{'RegionId':'cn-shanghai','ExecutionId':'exec-owned','MaxResults':10});return copy.deepcopy(self.oos)
  if action=='GetExecutionTemplate':return copy.deepcopy(self.detail)
  self.fail('unexpected API')
 def invoke(self,op,p):
  self.calls.append(op)
  if op=='observe':return {k:self.b[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
  if op=='external-lifecycle-readback':return e.observe(self.b,self.call)
  self.assertIn(op,m.STAGES)
  return dict(accepted=True,databases=list(m.DBS),**{k:self.b[k] for k in ('attemptId','targetInstanceId','candidateSha')})
 def test_real_readback_and_loop_no_cloud_writes(self):
  self.calls=[];out=m.rehearse(self.b,self.root,self.invoke)
  self.assertTrue(out['stagesCompleted']);self.assertTrue(out['cleanupPending']);self.assertFalse(out['a3Accepted']);self.assertFalse(out['workloadStoppedProven']);self.assertNotIn('accepted',out);self.assertNotIn('deleted',out)
  self.assertEqual(self.calls.count('external-lifecycle-readback'),9);self.assertTrue((self.root/'workload-closed.json').exists());self.assertFalse((self.root/'target-secret.json').exists())
 def test_each_cloud_write_rejected_before_imds(self):
  with patch.object(a,'credential',side_effect=AssertionError('IMDS called')):
   for op in ('account-create','role-account-create','cleanup-register','cleanup','cleanup-registration-remove','cleanup-iam-remove','account-readback','arbitrary'):
    with self.subTest(op=op),self.assertRaisesRegex(ValueError,'EXTERNAL_CLOUD_WRITE_FORBIDDEN'):a.run(op,{'binding':self.b})
 def test_rpc_defence_rejects_writes_before_signing(self):
  for service,action in [('rds','CreateAccount'),('rds','DeleteDBInstance'),('oos','StartExecution'),('oos','CancelExecution'),('ram','DeleteRole')]:
   with self.subTest(action=action),self.assertRaisesRegex(ValueError,'EXTERNAL_RPC_WRITE_FORBIDDEN'):a.rpc(service,action,{}, {'_externalReadOnly':True})
 def test_wrong_mode_never_standalone(self):
  self.b['lifecycle']['mode']='external-owner-typo'
  with patch.object(a,'credential',side_effect=AssertionError('IMDS called')),self.assertRaisesRegex(ValueError,'EXTERNAL_LIFECYCLE_SCHEMA'):a.run('observe',{'binding':self.b})
 def test_actual_transitive_adapter_closure_requires_new_module(self):
  base=Path(__file__).parent
  def code_ref(name):
   p=base/name;return {'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  entry=dict(code_ref('isolated_rehearsal_aliyun.py'),modules={'isolated_rehearsal.py':code_ref('isolated_rehearsal.py')})
  with self.assertRaisesRegex(ValueError,'TRANSITIVE_MODULE_MISSING:isolated_external_lifecycle'):m.executable_closure(entry)
  entry['modules']['isolated_external_lifecycle.py']=code_ref('isolated_external_lifecycle.py')
  for p in base.glob('isolated_*.py'):
   if not p.name.endswith('_test.py') and p.name!='isolated_rehearsal_aliyun.py':entry['modules'][p.name]=code_ref(p.name)
  self.assertIn('isolated_external_lifecycle.py',m.executable_closure(entry))
 def test_prepared_replacement_and_owner_change_rejected(self):
  m.Admission(self.b,self.root);self.refresh()
  with self.assertRaisesRegex(ValueError,'ADMISSION_BINDING_CHANGED'):m.Admission(self.b,self.root)
  self.b.pop('lifecycle')
  with self.assertRaisesRegex(ValueError,'ADMISSION_BINDING_CHANGED'):m.Admission(self.b,self.root)
 def test_secret_mismatch_rejected(self):
  self.secret['attemptId']='other';self.b['lifecycle']['targetSecret']=self.ref(self.secret)
  with self.assertRaisesRegex(ValueError,'SECRET_TARGET_MISMATCH'):e.load(self.b)
 def test_empty_evidence_not_empty_or_wrong_query(self):
  self.prepared['emptyAccounts']=self.ref({'parameters':{'RegionId':'cn-shanghai','DBInstanceId':'pgm-wrong','PageNumber':1,'PageSize':100},'response':self.page});self.owner['emptyAccounts']=self.prepared['emptyAccounts'];self.prepared['ownerJournal']=self.ref(self.owner);self.refresh()
  with self.assertRaisesRegex(ValueError,'EXTERNAL_EMPTY_QUERY'):e.load(self.b)
 def test_nonce_intent_cannot_be_omitted(self):
  self.prepared['accounts']['app_rw']['intent']=self.ref({});self.refresh()
  with self.assertRaises(ValueError):e.load(self.b)
 def test_unknown_start_ack_not_adopted(self):
  self.prepared['oos']['startAck']=self.ref({'RequestId':'x','Execution':{'ExecutionId':'exec-other'}});self.refresh()
  with self.assertRaisesRegex(ValueError,'EXTERNAL_OOS_ACK'):e.load(self.b)
 def test_unknown_owner_journal_rejected(self):
  self.prepared['ownerJournal']=self.ref(dict(binding=self.prepared['binding'],owner='mac-coordinator',state='unknown'));self.refresh()
  with self.assertRaisesRegex(ValueError,'EXTERNAL_OWNER_JOURNAL'):e.load(self.b)
 def test_dispatch_unknown_or_wrong_request_never_admitted(self):
  original=copy.deepcopy(self.owner)
  for change in ({'state':'unknown'},{'requestSha256':'f'*64},{'ackSha256':'f'*64}):
   self.owner=copy.deepcopy(original);record=self.owner['operations']['account:app_rw'];value=e.read(record['dispatch']);value.update(change);record['dispatch']=self.ref(value)
   self.prepared['ownerJournal']=self.ref(self.owner);self.refresh()
   with self.subTest(change=change),self.assertRaisesRegex(ValueError,'EXTERNAL_DISPATCH_BINDING'):e.load(self.b)
 def test_ack_outside_owned_journal_rejected(self):
  self.prepared['accounts']['app_rw']['ack']=self.ref({'RequestId':'unrelated-valid-ack'});self.refresh()
  with self.assertRaisesRegex(ValueError,'EXTERNAL_JOURNAL_REFS'):e.load(self.b)
 def test_private_ref_hardlink_or_public_mode_rejected(self):
  path=Path(self.b['lifecycle']['targetSecret']['path']);path.chmod(0o644)
  with self.assertRaisesRegex(ValueError,'EXTERNAL_PRIVATE_REF'):e.load(self.b)
  path.chmod(0o600);import os;os.link(path,self.root/'linked-secret')
  with self.assertRaisesRegex(ValueError,'EXTERNAL_PRIVATE_REF'):e.load(self.b)
 def test_live_account_foreign_or_missing_page_refuses_stage(self):
  self.page['Accounts']['DBInstanceAccount'][0]['AccountDescription']='foreign';self.calls=[]
  with self.assertRaisesRegex(ValueError,'EXTERNAL_ACCOUNT_IDENTITY'):m.rehearse(self.b,self.root,self.invoke)
  self.assertNotIn('restore',self.calls);self.assertTrue((self.root/'workload-closed.json').exists())
 def test_live_oos_terminal_or_pagination_refuses(self):
  self.oos['NextToken']='more'
  with self.assertRaisesRegex(ValueError,'EXTERNAL_OOS_PAGE'):e.observe(self.b,self.call)
  self.oos.pop('NextToken');self.oos['Executions'][0]['Status']='Cancelled'
  with self.assertRaisesRegex(ValueError,'EXTERNAL_OOS_NOT_REGISTERED'):e.observe(self.b,self.call)
 def test_live_template_change_refuses(self):
  self.detail['Content']='{}'
  with self.assertRaisesRegex(ValueError,'EXTERNAL_OOS_TEMPLATE'):e.observe(self.b,self.call)
 def test_closed_no_stage_or_cleanup_cloud_dispatch(self):
  m.Admission(self.b,self.root).close();self.calls=[]
  with self.assertRaisesRegex(ValueError,'WORKLOAD_ADMISSION_CLOSED'):m.rehearse(self.b,self.root,self.invoke)
  self.assertEqual(self.calls,[])
 def test_close_failure_never_accepts_or_dispatches_cloud_cleanup(self):
  self.calls=[]
  with patch.object(m.Admission,'close',side_effect=OSError('full')),self.assertRaisesRegex(ValueError,'WORKLOAD_CLOSE_UNCONFIRMED'):m.rehearse(self.b,self.root,self.invoke)
  self.assertTrue(set(self.calls)<={'observe','external-lifecycle-readback',*m.STAGES})
 def test_unknown_read_is_not_retried(self):
  calls=[]
  def invoke(op,p):
   calls.append(op)
   if op=='observe':return {k:self.b[k] for k in ('targetInstanceId','peer','providerCreatedUtc')}
   raise m.UnknownOutcome('read timeout')
  with self.assertRaises(m.UnknownOutcome):m.rehearse(self.b,self.root,invoke)
  self.assertEqual(calls,['observe','external-lifecycle-readback'])

if __name__=='__main__':unittest.main()
