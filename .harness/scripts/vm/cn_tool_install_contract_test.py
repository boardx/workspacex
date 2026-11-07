"""Exact-source install metadata/root compatibility, no host operations."""
import ast,importlib.util,pathlib,subprocess,unittest,inspect
D=pathlib.Path(__file__).parent

def load(name):
 spec=importlib.util.spec_from_file_location(name.replace('-','_'),D/(name+'.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
p=load('prepare-cn-tool-install');t=load('cn-tool-install-transaction');identity=load('cn-build-tool-identity')
class Contract(unittest.TestCase):
 def test_auto_closure_and_no_new_unlisted_bin(self):
  expected={'verify-cn-release-promotion.sh':'/usr/local/bin/workspacex-cn-verify-promotion','export-cn-domestic-source.sh':'/usr/local/bin/workspacex-cn-export-source'}
  for name in ('cn-auto-isolated-target.mjs','cn-controlled-evidence.mjs','devapp-runtime-identity.mjs','cn-auto-evidence-stage.mjs','stage-cn-offline-source-cache.sh','cn_auto_source.py','cn_compose_baseline.py','cn_auto_prepare.py','cn_auto_prepare_provider.py','cn_auto_baseline_schema.py'):expected[name]='/usr/local/lib/workspacex-cn/'+name
  for source,target in expected.items():self.assertEqual(identity.FILES.get('.harness/scripts/vm/'+source),target)
  self.assertEqual(len([target for target in identity.FILES.values() if target]),len(set(target for target in identity.FILES.values() if target)))
 def test_source_only_closure_and_transaction_profile_bounds(self):
  for source in ('packages/cloud-deploy/src/cn-auto-preparation-cli.ts','packages/cloud-deploy/src/cn-auto-preparation-process.ts','packages/cloud-deploy/src/cn-auto-migration-snapshot.ts','.harness/scripts/vm/cn-release-browser-smoke.mjs','.harness/scripts/vm/cn-migration-runtime-probe.mjs'):
   self.assertIn(source,identity.FILES);self.assertIsNone(identity.FILES[source])
  self.assertLessEqual(sum(target is not None for target in identity.FILES.values())+1,128)
  rows={source:{'target':target,'newSha256':'a'*64} for source,target in identity.FILES.items()}
  schema=(D/'cn_tool_profile.py').read_bytes();rows[p.PROFILE_SCHEMA_SOURCE]['newSha256']=p.sha(schema)
  value=p.profile_content('a'*40,rows,schema,None)
  import json
  self.assertLess(len((json.dumps(value,sort_keys=True)+'\n').encode()),1048576)
  self.assertEqual(set(value['filesSha256']),set(identity.FILES))
 def test_public_drift_checks_readable_private_consumers_unchanged(self):
  raw=(D/'cn-build-tool-identity.py').read_bytes();modes=p.installation_modes(raw)
  for name in ('deploy-cn-production.sh','build-cn-release-candidate.sh','collect-cn-release-preflight.sh','verify-cn-release-promotion.sh','cn_auto_source.py','cn-auto-evidence-stage.mjs'):self.assertEqual(modes['.harness/scripts/vm/'+name],'0755')
  for name in ('cn_maintenance_hold.py','cn_auto_prepare.py','cn_auto_prepare_provider.py','cn_auto_baseline_schema.py','cn-production-recovery-executor.py','cn-maintenance-recovery-evidence-verifier.py'):self.assertEqual(modes['.harness/scripts/vm/'+name],'0700')
 def test_legacy_default_and_untrusted_metadata_rejected(self):
  raw=b"FILES={'a':'/usr/local/bin/a','b':None}\n";self.assertEqual(p.installation_modes(raw),{'a':'0700','b':'0600'})
  for override in ["{'a':0o777}","{'a':'0755'}","{'absent':0o755}","{'b':0o755}","None","{'a':True}"]:
   with self.subTest(override=override),self.assertRaises(Exception):p.installation_modes(raw+('INSTALL_MODES='+override+'\n').encode())
  self.assertEqual(p.installation_modes(raw+b"INSTALL_MODES={'a':0o755}\n"),{'a':'0755','b':'0600'})
  self.assertEqual(inspect.getsource(p.installation_modes),inspect.getsource(t.installation_modes))
 def test_root_from_exact_source_preserves_old_contract_and_uses_new_private_root(self):
  old=b"def check(value,tool):\n return value.get('toolRoot')=='/opt/workspacex-cn/release-tools/'+tool\n";sha='a'*40
  self.assertEqual(p.tool_root_contract(old,sha),'/opt/workspacex-cn/release-tools/'+sha)
  self.assertEqual(p.tool_root_contract((D/'cn-build-tool-identity.py').read_bytes(),sha),'/var/lib/workspacex-cn/auto-preparation-tools/'+sha)
 def test_recovery_source_root_comes_from_each_exact_version(self):
  recovery=load('cn-maintenance-recovery-evidence-verifier');tool='a'*40
  for prefix in ('/opt/workspacex-cn/release-tools/','/var/lib/workspacex-cn/auto-preparation-tools/'):
   raw=("def check(value,tool):\n return value.get('toolRoot')=="+repr(prefix)+"+tool\n").encode()
   self.assertEqual(str(recovery.declared_tool_root(raw,tool)),prefix+tool)
  for prefix in ('/tmp/','/opt/workspacex-cn/release-tools-other/'):
   with self.assertRaises(Exception):recovery.declared_tool_root(("def check(value,tool):\n return value.get('toolRoot')=="+repr(prefix)+"+tool\n").encode(),tool)
 def test_legacy_profile_structure_does_not_gain_unpinned_metadata(self):
  rows={'legacy':{'target':'/usr/local/lib/legacy','newSha256':'b'*64}}
  self.assertEqual(p.profile_content('a'*40,rows),{'toolRevision':'a'*40,'filesSha256':{'legacy':'b'*64}})
if __name__=='__main__':unittest.main()
