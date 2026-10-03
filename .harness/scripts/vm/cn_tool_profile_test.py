import hashlib,importlib.util,pathlib,unittest
from cn_tool_profile import build_profile,VERIFIER_SOURCE,VERIFIER_TARGET
ROOT=pathlib.Path(__file__).parent
class ProfileTests(unittest.TestCase):
 def rows(self):return {'.harness/scripts/vm/cn_tool_profile.py':{'newSha256':hashlib.sha256((ROOT/'cn_tool_profile.py').read_bytes()).hexdigest(),'target':'/usr/local/lib/workspacex-cn/cn_tool_profile.py'},VERIFIER_SOURCE:{'newSha256':'c'*64,'target':VERIFIER_TARGET}}
 def test_full_static_closure(self):
  p=build_profile('a'*40,self.rows());self.assertEqual(p['maintenanceRecoveryVerifier']['sha256'],'c'*64);self.assertEqual(len(p['installedTargets']),2);self.assertNotIn('maintenanceRecoveryArtifacts',p)
 def test_wrong_verifier_target_rejected(self):
  rows=self.rows();rows[VERIFIER_SOURCE]['target']='/usr/local/bin/other'
  with self.assertRaisesRegex(ValueError,'PROFILE_VERIFIER_TARGET'):build_profile('a'*40,rows)
 def test_duplicate_targets_rejected(self):
  rows=self.rows();rows[VERIFIER_SOURCE]['target']=next(iter(rows.values()))['target']
  with self.assertRaisesRegex(ValueError,'PROFILE_DUPLICATE_TARGET'):build_profile('a'*40,rows)
 def test_runtime_only_from_complete_trusted_inventory(self):
  runtime={'path':'/usr/bin/node','sha256':'d'*64,'mode':'0755','uid':0,'gid':0,'links':1,'regular':True,'symlink':False}
  self.assertEqual(build_profile('a'*40,self.rows(),runtime)['maintenanceNodeRuntime'],{'path':'/usr/bin/node','sha256':'d'*64})
  for key,value in [('symlink',True),('uid',False),('mode','0777'),('path','/tmp/node')]:
   with self.subTest(key=key),self.assertRaises(ValueError):build_profile('a'*40,self.rows(),{**runtime,key:value})
 def test_producer_and_installer_use_same_exact_schema(self):
  rows=self.rows();raw=(ROOT/'cn_tool_profile.py').read_bytes();values=[]
  for filename in ['prepare-cn-tool-install.py','cn-tool-install-transaction.py']:
   spec=importlib.util.spec_from_file_location(filename,ROOT/filename);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
   values.append(module.profile_content('a'*40,rows,raw))
   with self.assertRaisesRegex((ValueError,RuntimeError),'PROFILE_SCHEMA_SOURCE_BINDING'):module.profile_content('a'*40,rows,b'drift')
  self.assertEqual(values[0],values[1])
if __name__=='__main__':unittest.main()
