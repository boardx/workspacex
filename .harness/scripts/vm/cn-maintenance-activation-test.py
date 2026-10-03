import importlib.util,pathlib,unittest,json,hashlib
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('activation',pathlib.Path(__file__).with_name('cn-maintenance-activation.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_unbound_live_api_cannot_claim_drained(self):
  with self.assertRaises((KeyError,RuntimeError)):m.operations({'ready':True},'read-run-drain')
 def test_health_only_cannot_claim_canonical(self):
  with self.assertRaises((KeyError,RuntimeError)):m.operations({'ready':True},'verify-canonical')
 def test_browser_flags_cannot_replace_trusted_runtime(self):
  with patch.object(m,'private',return_value=b'{}'):
   with self.assertRaisesRegex(RuntimeError,'TRUSTED_BROWSER_RUNTIME_CLOSURE_MISSING'):m.operations({'login':True},'browser-acceptance')
 def test_image_only_runtime_recovery_is_rejected_before_compose(self):
  with patch.object(m,'private',return_value=json.dumps({'identity':{}}).encode()),patch.object(m,'invoke') as invoke:
   with self.assertRaises((KeyError,RuntimeError)):m.operations({'identity':{},'recoveryResult':{'path':'fixture'}},'restore-baseline-runtime')
   invoke.assert_not_called()
 def test_actual_three_database_readback_precedes_runtime_recovery(self):
  p={'identity':{'attempt':'fixture'},'recoveryResult':{'path':'result'},'candidateNginx':{'sha256':'candidate'},'baselineNginx':{'path':'baseline','sha256':'baseline'}}
  r={'identity':p['identity'],'productionInstanceId':'pgm-uf6rg214cp381l49','writesHeld':True,'databases':{d:{'database':d,'targetRdsInstanceId':'pgm-uf6rg214cp381l49','readOnly':True,'rollbackComplete':True,'dataFidelityVerified':True} for d in ['workspacex','workspacex_agent','workspacex_memory']}}
  raw=json.dumps(r).encode()
  with patch.object(m,'private',side_effect=lambda path,*args:raw if path=='result' else b'nginx'),patch.object(m,'verify_compose',return_value='compose'),patch.object(m,'replace'),patch.object(m,'invoke',return_value=b'') as invoke:
   out=m.operations(p,'restore-baseline-runtime');self.assertEqual(out['databaseRecoveryReceiptSha256'],hashlib.sha256(raw).hexdigest());self.assertIn('--pull',invoke.call_args_list[0].args[2]);self.assertIn('never',invoke.call_args_list[0].args[2])
 def test_canonical_uses_only_named_readonly_jobs_and_public_get_probe(self):
  app='9'*40;nginx=b'nginx';config=b'config';calls=[]
  p={'identity':{'sourceRevision':app},'compose':{'images':{s:'fixed@sha256:'+('1'*64) for s in m.SERVICES}},'candidateConfig':{'sha256':m.digest(config)},'candidateNginx':{'sha256':m.digest(nginx)},'browserPlan':{'path':'browser','sha256':'fixture'}}
  def invoke(plan,binary,args,*extra):
   calls.append(args)
   if binary=='node':return b'{"publicReadOnlyVerified":true}'
   if args[:2]==['image','inspect']:return b'[{"Id":"fixed-image"}]'
   return json.dumps([{'Image':'fixed-image','State':{'Running':True,'Paused':False},'Config':{'Labels':{'org.opencontainers.image.revision':app}}}]).encode()
  def read(path,*args):return config if path==m.FIXED else nginx if path==m.NGINX else b'{"publicUrl":"https://example.com/","deploymentMarker":"fixed"}'
  def job(plan,script):
   calls.append([script]);return {'ok':True,'database':True,'migrations':True,'redis':True} if script=='scripts/data-readiness.ts' else {'ok':True,'web':True,'api':True,'agentGraphs':True}
  with patch.object(m,'verify_compose'),patch.object(m,'actual_api'),patch.object(m,'private',side_effect=read),patch.object(m,'installed_code',return_value=b'fixture'),patch.object(m,'invoke',side_effect=invoke),patch.object(m,'api_job',side_effect=job):
   self.assertEqual(m.canonical_checks(p),{'status':'passed','lockRetained':True,'passedStages':8})
  self.assertIn(['scripts/data-readiness.ts'],calls);self.assertIn(['scripts/cloud-service-readiness.ts'],calls)
  self.assertFalse(any('migrate' in str(c) or 'provision' in str(c) or 'business-probe' in str(c) for c in calls))
 def test_arbitrary_or_mutating_canonical_job_is_forbidden(self):
  for script in ('src/infrastructure/db/migrate-cli.ts','scripts/provision-admin.ts','scripts/cloud-business-probe.ts'):
   with self.assertRaisesRegex(RuntimeError,'FIXED_CANONICAL_SCRIPT'):m.api_job({},script)
 def test_held_drain_never_executes_or_unpauses_baseline_api(self):
  with patch.object(m,'actual_api') as api,patch.object(m,'invoke') as command:
   with self.assertRaisesRegex(RuntimeError,'SEALED_DIAGNOSTIC_DRAIN_REQUIRED'):m.live_drain({'ready':True})
   api.assert_not_called();command.assert_not_called()
if __name__=='__main__':unittest.main()
