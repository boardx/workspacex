"""Pure CLI/bootstrap/provider tests. No service or provider command runs."""
import importlib.util,json,pathlib,subprocess,sys,unittest
from unittest import mock
ROOT=pathlib.Path(__file__).parent
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/file)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
class BootstrapTests(unittest.TestCase):
 def test_import_is_inert_before_explicit_entry(self):
  with mock.patch('subprocess.run',side_effect=AssertionError('command')),mock.patch('os.open',side_effect=AssertionError('file read')):
   module=load('bootstrap_inert','cn-production-recovery-executor.py')
  self.assertFalse(hasattr(module,'Executor'))
 def test_failed_trust_gate_precedes_runtime_import(self):
  module=load('bootstrap_rejected','cn-production-recovery-executor.py')
  with mock.patch.object(module,'bootstrap',side_effect=RuntimeError('BOOTSTRAP_CLOSURE')):
   with self.assertRaisesRegex(RuntimeError,'BOOTSTRAP_CLOSURE'):module.load_runtime()
  self.assertFalse(hasattr(module,'Executor'))
 def test_development_checkout_refused_with_only_redacted_json(self):
  result=subprocess.run([sys.executable,'-B',str(ROOT/'cn-production-recovery-executor.py'),'--preflight-capability','/not/read'],capture_output=True,text=True)
  self.assertEqual(result.returncode,1);self.assertEqual(result.stderr,'')
  self.assertEqual(json.loads(result.stdout),{'error':'PRODUCTION_RECOVERY_REJECTED','writesHeld':None,'writeState':'unproven','ready':False})
 def test_bootstrap_authorization_capability_and_guard_failures_never_claim_held(self):
  module=load('bootstrap_failure_state','cn-production-recovery-executor.py')
  for failure in ('BOOTSTRAP_CLOSURE','AUTHORIZATION_REJECTED','CAPABILITY_REJECTED','FIRST_GUARD_REJECTED','POST_MUTATION_GUARD_REJECTED'):
   with self.subTest(failure=failure),mock.patch.object(module,'main',side_effect=RuntimeError(failure)):
    code,value=module.cli(['--execute-production-recovery','/unused'])
    self.assertEqual(code,1);self.assertIsNone(value['writesHeld']);self.assertEqual(value['writeState'],'unproven');self.assertFalse(value['ready'])
class ProviderIdentityTests(unittest.TestCase):
 def setUp(self):self.module=load('provider_identity','cn-production-rds-identity-probe.py')
 def response(self,items,code=0):return subprocess.CompletedProcess([],code,json.dumps({'Items':{'DBInstanceAttribute':items}}).encode(),b'private')
 def item(self):return {'DBInstanceId':self.module.TARGET,'Engine':'PostgreSQL','RegionId':'cn-shanghai','ConnectionString':'fixture.invalid','EngineVersion':'16'}
 def invoke(self,response,args=None):
  with mock.patch.object(self.module.os,'geteuid',return_value=0),mock.patch.object(self.module.subprocess,'run',return_value=response) as command:
   value=self.module.main(args if args is not None else ['--read-only',self.module.TARGET])
   self.assertEqual(command.call_args.args[0],['/usr/bin/aliyun','rds','DescribeDBInstanceAttribute','--DBInstanceId',self.module.TARGET]);return value
 def test_exact_readonly_identity(self):self.assertEqual(self.invoke(self.response([self.item()]))['instanceId'],self.module.TARGET)
 def test_wrong_instance_and_engine_refused(self):
  for key,value in [('DBInstanceId','pgm-other'),('Engine','MySQL')]:
   item=self.item();item[key]=value
   with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'INSTANCE_IDENTITY'):self.invoke(self.response([item]))
 def test_cardinality_refused(self):
  for items in [[],[self.item(),self.item()]]:
   with self.subTest(items=items),self.assertRaisesRegex(RuntimeError,'INSTANCE_CARDINALITY'):self.invoke(self.response(items))
 def test_provider_failure_refused(self):
  with self.assertRaisesRegex(RuntimeError,'PROVIDER_REJECTED'):self.invoke(self.response([],code=1))
 def test_wrong_target_never_calls_provider(self):
  with mock.patch.object(self.module.os,'geteuid',return_value=0),mock.patch.object(self.module.subprocess,'run',side_effect=AssertionError('provider called')):
   with self.assertRaisesRegex(RuntimeError,'USAGE'):self.module.main(['--read-only','pgm-other'])
if __name__=='__main__':unittest.main()
