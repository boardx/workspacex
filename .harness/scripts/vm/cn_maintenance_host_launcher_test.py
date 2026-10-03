"""Pure process-free launch admission tests; never execute Node or helpers."""
import importlib.util,json,pathlib,sys,types,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('launcher',pathlib.Path(__file__).with_name('cn-maintenance-host-launcher.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Launcher(unittest.TestCase):
 def fixture(self):
  identity={'sourceRevision':'a'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'c'*64,'attemptId':'one'}
  recovery_path='/etc/workspacex-cn/maintenance-recovery/'+identity['sourceRevision']+'/one/recovery-plan.json'
  recovery=b'{}';entry=b'entry';profile={'toolRevision':'d'*40,'filesSha256':{'controller':m.hashlib.sha256(entry).hexdigest(),'recovery':m.hashlib.sha256(entry).hexdigest()},'maintenanceHostController':{'path':'/usr/local/lib/workspacex-cn/controller.cjs','sha256':m.hashlib.sha256(entry).hexdigest(),'sourcePath':'controller','toolRevision':'d'*40},'maintenanceRecoveryExecutor':{'path':'/usr/local/lib/workspacex-cn/recovery.py','sha256':m.hashlib.sha256(entry).hexdigest(),'sourcePath':'recovery','toolRevision':'d'*40}}
  plan={'productionActionsAuthorized':True,'identity':identity,'recoveryPlanPath':recovery_path,'recoveryPlanSha256':m.hashlib.sha256(recovery).hexdigest()}
  raw=json.dumps(plan).encode();files={'/plan':raw,m.PROFILE:json.dumps(profile).encode(),recovery_path:recovery,'/usr/local/lib/workspacex-cn/controller.cjs':entry,'/usr/local/lib/workspacex-cn/recovery.py':entry}
  return files,identity,plan,profile,raw
 def run_reject(self,files,raw,result):
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'getegid',return_value=0),patch.object(m.sys,'platform','linux'),patch.object(m.sys,'argv',['launcher','--launch-reviewed-controller','/plan',m.hashlib.sha256(raw).hexdigest()]),patch.object(m,'protected_bytes',side_effect=lambda p,*a:files[p]),patch.object(m.subprocess,'run',return_value=result) as run,patch.object(m.os,'open') as opened,patch.object(m.os,'execve') as executed:
   with self.assertRaises(RuntimeError) as error:m.main()
   opened.assert_not_called();executed.assert_not_called()
   return str(error.exception),run
 def test_bad_preflight_cannot_open_lock(self):
  files,identity,plan,profile,raw=self.fixture();code,_=self.run_reject(files,raw,types.SimpleNamespace(returncode=0,stdout=b'true'));self.assertEqual(code,'RECOVERY_PREFLIGHT_INVALID')
 def test_exact_preflight_still_requires_node_binding(self):
  files,identity,plan,profile,raw=self.fixture();response={'schemaVersion':1,'kind':'production-recovery-preflight','identity':identity,'toolRevision':profile['toolRevision'],'planSha256':plan['recoveryPlanSha256'],'liveWritesHeldProven':False,'ready':False};code,run=self.run_reject(files,raw,types.SimpleNamespace(returncode=0,stdout=json.dumps(response).encode()));self.assertEqual(code,'NODE_RUNTIME_BINDING_MISSING');self.assertEqual(run.call_args.args[0][-2:],['--preflight-capability',plan['recoveryPlanPath']])
 def test_missing_executor_blocks_before_helper_or_lock(self):
  files,identity,plan,profile,raw=self.fixture();del profile['maintenanceRecoveryExecutor'];files[m.PROFILE]=json.dumps(profile).encode();code,run=self.run_reject(files,raw,None);self.assertEqual(code,'RECOVERY_DESCRIPTOR_INVALID');run.assert_not_called()
if __name__=='__main__':unittest.main()
