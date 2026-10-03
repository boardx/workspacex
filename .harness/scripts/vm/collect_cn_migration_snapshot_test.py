import importlib.machinery,importlib.util,pathlib,unittest,json,hashlib
p=pathlib.Path(__file__).with_name('collect-cn-migration-snapshot.py');loader=importlib.machinery.SourceFileLoader('collector',str(p));spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
class Collector(unittest.TestCase):
 def plan(self):
  plan={'identity':{'sourceRevision':'a'*40,'attemptId':'one'},'regionId':'cn-shanghai','accountId':'1177216024653153','ecsInstanceId':'i-uf6ga92ewloganobbln6'};script='/usr/bin/node /usr/local/lib/workspacex-cn/cn-migration-snapshot-query.cjs --readonly-ledger '+'a'*40+' one\n';plan['querySha256']=hashlib.sha256(script.encode()).hexdigest();return plan
 def test_real_provider_bytes_preserved(self):
  plan=self.plan();raw=json.dumps({'RequestId':'real-fixture-request','Invocation':{'TotalCount':1,'InvocationResults':{'InvocationResult':[{'InvokeId':'inv','CommandId':'cmd','InstanceId':plan['ecsInstanceId'],'InvocationStatus':'Success','ExitCode':0,'Dropped':0,'Output':'fixture','FinishedTime':'2026-10-03T10:00:00Z'}]}}}).encode();calls=[]
  def cli(args,raw=False):
   calls.append(args)
   if args[0]=='sts':return{'AccountId':plan['accountId']}
   if args[1]=='RunCommand':return{'InvokeId':'inv','CommandId':'cmd'}
   return response
  response=raw;actual,cloud=m.collect(plan,cli);self.assertEqual(actual,raw);self.assertEqual(cloud['invokeId'],'inv');self.assertEqual(calls[1][1],'RunCommand')
 def test_truncated_provider_output_never_success(self):
  plan=self.plan()
  def cli(args,raw=False):
   if args[0]=='sts':return{'AccountId':plan['accountId']}
   if args[1]=='RunCommand':return{'InvokeId':'inv','CommandId':'cmd'}
   return json.dumps({'Invocation':{'TotalCount':1,'InvocationResults':{'InvocationResult':[{'InvokeId':'inv','CommandId':'cmd','InstanceId':plan['ecsInstanceId'],'InvocationStatus':'Success','ExitCode':0,'Dropped':1}]}}}).encode()
  with self.assertRaisesRegex(RuntimeError,'PROVIDER_INCOMPLETE'):m.collect(plan,cli)
 def test_wrong_account_prevents_query(self):
  plan=self.plan();calls=[]
  def cli(args,raw=False):calls.append(args);return{'AccountId':'wrong'}
  with self.assertRaisesRegex(RuntimeError,'CREDENTIAL_ACCOUNT'):m.collect(plan,cli)
  self.assertEqual(len(calls),1)
 def test_command_hash_prevents_any_api(self):
  plan=self.plan();plan['querySha256']='0'*64
  with self.assertRaisesRegex(RuntimeError,'QUERY_COMMAND_HASH'):m.collect(plan,lambda *_:self.fail('API called'))
if __name__=='__main__':unittest.main()
