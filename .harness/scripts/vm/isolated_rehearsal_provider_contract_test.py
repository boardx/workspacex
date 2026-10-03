import importlib.util,sys,unittest,hashlib,copy
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import isolated_rehearsal as core
import tempfile
spec=importlib.util.spec_from_file_location('fixed_adapter',Path(__file__).with_name('isolated_rehearsal_aliyun.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ObserveTests(unittest.TestCase):
 def setUp(self):
  t='pgm-uf621jolsgp8mp9c';c='2026-10-02T21:47:42Z';peer='192.168.100.49';a='b7f96aa5-9b2b-46e1-851a-2067955ba8e8'
  self.b=dict(accountId='1177216024653153',regionId='cn-shanghai',targetInstanceId=t,sourceInstanceId='pgm-uf6rg214cp381l49',attemptId=a,providerCreatedUtc=c,providerDescription='wsx-cn-isolated-round2-'+a,host=t+'.rwlb.rds.aliyuncs.com',peer=peer,peerSha256=hashlib.sha256(peer.encode()).hexdigest(),candidateSha='9b25bfa65662b96c0826fe67506b562ea46aa6d0',ecsRole='WorkspacexCnProductionEcsRole',tls=dict(sslmode='disable',approvedException='aliyun-postgresql-serverless-no-tls',providerSslEvidence=dict(targetInstanceId=t,providerCreatedUtc=c,sslEnabled=False)))
 def observe(self,ssl,change=None):
  b=self.b;attrs=dict(DBInstanceId=b['targetInstanceId'],CreationTime=b['providerCreatedUtc'],DBInstanceDescription=b['providerDescription'],Engine='PostgreSQL',EngineVersion='16.0');net=dict(ConnectionString=b['host'],Port='5432',IPAddress=b['peer'])
  if change:change(attrs,net)
  def rpc(service,action,args,cred):
   self.assertEqual(service,'rds');self.assertEqual(args['DBInstanceId'],b['targetInstanceId']);self.assertEqual(args['RegionId'],'cn-shanghai')
   return {'DescribeDBInstanceAttribute':{'Items':{'DBInstanceAttribute':[attrs]}},'DescribeDBInstanceNetInfo':{'DBInstanceNetInfos':{'DBInstanceNetInfo':[net]}},'DescribeDBInstanceSSL':{'SSLEnabled':ssl}}[action]
  with patch.object(m,'credential',return_value={}),patch.object(m,'rpc',side_effect=rpc):return m.run('observe',{'binding':b})
 def test_known_disabled_provider_values(self):
  for v in ('No','Disabled','off'):
   with self.subTest(v=v):self.assertTrue(self.observe(v)['providerVerified'])
 def test_other_values_rejected(self):
  for v in ('on','Yes','Enabled',None,'unknown','OFF',' Off',False):
   with self.subTest(v=v),self.assertRaisesRegex(ValueError,'TLS_EXCEPTION_NOT_ACTUAL'):self.observe(v)
 def test_wrong_provider_target(self):
  with self.assertRaisesRegex(ValueError,'PROVIDER_ID_TIME'):self.observe('off',lambda a,n:a.update(DBInstanceId='pgm-wrong'))
 def test_wrong_provider_creation(self):
  with self.assertRaisesRegex(ValueError,'PROVIDER_ID_TIME'):self.observe('off',lambda a,n:a.update(CreationTime='2026-10-02T21:47:43Z'))
 def test_wrong_peer(self):
  with self.assertRaisesRegex(ValueError,'PROVIDER_PEER'):self.observe('off',lambda a,n:n.update(IPAddress='192.168.100.50'))
 def test_unapproved_tls_exception_rejected(self):
  self.b['tls']['approvedException']='anything'
  with self.assertRaisesRegex(ValueError,'FRESH_TLS_EVIDENCE_REQUIRED'):self.observe('off')
 def test_production_target_rejected(self):
  self.b['targetInstanceId']=self.b['sourceInstanceId']
  with self.assertRaisesRegex(ValueError,'PRODUCTION_TARGET_FORBIDDEN'):self.observe('off')
class ContractTests(ObserveTests):
 def test_generated_secret_roundtrip_and_provider_create(self):
  with tempfile.TemporaryDirectory() as d:
   secret=core.credentials(Path(d),self.b)
   self.assertEqual(core.credentials(Path(d),self.b),secret)
   self.assertEqual(len(secret['password']),32)
   self.assertEqual(len(set([secret['password']]+[r['password'] for r in secret['roles'].values()])),7)
   self.assertTrue(all(len(r['password'])==32 for r in secret['roles'].values()))
   calls=[]
   def rpc(service,action,args,cred):
    calls.append(action)
    if action=='DescribeAccounts':return {'Accounts':{'DBInstanceAccount':[]}}
    self.assertEqual(action,'CreateAccount');self.assertEqual(len(args['AccountPassword']),32);return {}
   with patch.object(m,'credential',return_value={}),patch.object(m,'rpc',side_effect=rpc):self.assertTrue(m.run('account-create',{'binding':self.b,'secret':secret})['submitted'])
   self.assertEqual(calls,['DescribeAccounts','CreateAccount'])
 def test_old_and_invalid_password_rejected_before_rpc(self):
  with tempfile.TemporaryDirectory() as d:
   secret=core.credentials(Path(d),self.b)
   for pw in ('Aa1!'+'x'*32,'Aa1!'+'x'*27,'Aa1!'+'x'*29,'Aa1!'+'/'*28):
    with self.subTest(length=len(pw)),patch.object(m,'credential',return_value={}),patch.object(m,'rpc') as rpc:
     secret['password']=pw
     with self.assertRaisesRegex(ValueError,'ACCOUNT_SECRET_BINDING'):m.run('account-create',{'binding':self.b,'secret':secret})
     rpc.assert_not_called()
 def test_exact_notfound_codes_only(self):
  for op in ('cleanup','cleanup-readback-deleted'):
   for code in ('InvalidDBInstanceId.NotFound','InvalidDBInstanceName.NotFound','Forbidden','InvalidDBInstanceName.NotFound.extra','NotFound'):
    with self.subTest(op=op,code=code),patch.object(m,'credential',return_value={}),patch.object(m,'rpc',side_effect=m.ProviderError(code)):
     if code in ('InvalidDBInstanceId.NotFound','InvalidDBInstanceName.NotFound'):
      result=m.run(op,{'binding':self.b});self.assertTrue(result.get('notFound',result.get('deleteSubmitted')))
     else:
      with self.assertRaises(m.ProviderError):m.run(op,{'binding':self.b})
if __name__=='__main__':unittest.main(verbosity=2)
