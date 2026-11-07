"""Installation regression: actual Electron package script, download trapped offline."""
import ast
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture_setup',ROOT/'scripts/cn-release-fullstack-fixture-setup.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FullstackSetup(unittest.TestCase):
 def test_fixed_environment_omits_only_desktop_binary_not_lifecycle_scripts(self):
  with patch.dict(os.environ,{'npm_config_ignore_scripts':'true','ELECTRON_SKIP_BINARY_DOWNLOAD':'0','NPM_CONFIG_PRODUCTION':'true','AWS_SECRET_ACCESS_KEY':'fixture-secret'}):
   env=m.install_environment(Path('/fixture/home'))
  self.assertEqual(env['ELECTRON_SKIP_BINARY_DOWNLOAD'],'1')
  for key in ('npm_config_ignore_scripts','NPM_CONFIG_PRODUCTION','AWS_SECRET_ACCESS_KEY'):self.assertNotIn(key,env)
  tree=ast.parse((ROOT/'scripts/cn-release-fullstack-fixture-setup.py').read_text())
  calls=[n for n in ast.walk(tree)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)and n.func.attr=='spawn']
  self.assertEqual(len(calls),1);argv=calls[0].args[0]
  literals=[n.value for n in argv.elts if isinstance(n,ast.Constant)]
  self.assertIn('install',literals);self.assertIn('--frozen-lockfile',literals)
  self.assertFalse(any('ignore-scripts'in str(x)or str(x).startswith('--filter')for x in literals))
  self.assertTrue(any(k.arg=='env'and isinstance(k.value,ast.Name)and k.value.id=='env'for k in calls[0].keywords))
 def test_original_electron_installer_no_switch_hits_download_but_fixed_env_does_not(self):
  node=os.environ.get('CN_API_STARTUP_NODE')or shutil.which('node');self.assertTrue(node,'Existing Node required')
  package=ROOT/'apps/desktop/package.json'
  resolved=subprocess.run([node,'-e',"const{createRequire}=require('node:module');console.log(createRequire(process.argv[1]).resolve('electron/install.js'))",str(package)],capture_output=True,text=True,timeout=15)
  self.assertEqual(resolved.returncode,0,resolved.stderr)
  installer=Path(resolved.stdout.strip());self.assertTrue(installer.is_file())
  with tempfile.TemporaryDirectory()as td:
   td=Path(td);hook=td/'trap.cjs';marker=td/'download-requested'
   # Actual upstream script runs unchanged. Intercept the sole downloader and
   # any network primitives; no installer files or live network are touched.
   hook.write_text("const Module=require('node:module'),fs=require('node:fs');const original=Module._load;Module._load=function(name,...args){if(name==='@electron/get')return{downloadArtifact:()=>{fs.writeFileSync(process.env.DOWNLOAD_MARKER,'attempt');process.exit(23)}};if(name==='extract-zip')return()=>{throw Error('EXTRACTION_FORBIDDEN')};return original.call(this,name,...args)};fs.existsSync=()=>false;for(const n of ['node:http','node:https']){const m=require(n);m.request=m.get=()=>{throw Error('NETWORK_FORBIDDEN')}};")
   base=m.install_environment(td);base['DOWNLOAD_MARKER']=str(marker)
   old=dict(base);old.pop('ELECTRON_SKIP_BINARY_DOWNLOAD')
   before=subprocess.run([node,'--require',str(hook),str(installer)],env=old,capture_output=True,text=True,timeout=15)
   self.assertEqual(before.returncode,23,before.stderr);self.assertEqual(marker.read_text(),'attempt');marker.unlink()
   after=subprocess.run([node,'--require',str(hook),str(installer)],env=base,capture_output=True,text=True,timeout=15)
   self.assertEqual(after.returncode,0,after.stderr);self.assertFalse(marker.exists())
if __name__=='__main__':unittest.main()
