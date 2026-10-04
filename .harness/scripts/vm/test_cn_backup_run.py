import ast
import builtins
import hashlib
import json
import pathlib
import unittest
from unittest.mock import patch
import cn_backup_run as runner

class BackupBootstrapTests(unittest.TestCase):
 def test_hash_drift_rejects_before_any_business_import(self):
  payload=b'raise AssertionError("DRIFT_MODULE_EXECUTED")\n'
  hashes={str(runner.ROOT/name):hashlib.sha256(payload).hexdigest() for name in runner.CLOSURE}
  profile=json.dumps({'installedFilesSha256':hashes}).encode();imports=[]
  def read(path,mode):
   if path=='/etc/workspacex-cn/trusted-tool-binding.json':return profile
   return b'drift' if path.endswith('/cn_backup_host.py') else payload
  real_import=builtins.__import__
  def tracked(name,*args,**kwargs):
   if name in ('host_transport','cn_backup_host','cn_backup_package','writer_fence','cn_maintenance_hold'):imports.append(name)
   return real_import(name,*args,**kwargs)
  original=runner.bootstrap
  with patch.object(runner,'__file__',str(runner.ROOT/'cn_backup_run.py')),patch.object(runner.os,'geteuid',return_value=0),patch.object(runner.os,'getegid',return_value=0),patch.object(runner.sys,'platform','linux'),patch.object(runner,'bootstrap',side_effect=lambda:original(read)),patch.object(builtins,'__import__',side_effect=tracked):
   with self.assertRaisesRegex(RuntimeError,'SOURCE_CLOSURE'):runner.load_runtime()
  self.assertEqual(imports,[])
 def test_query_table_mode_and_transitive_closure_match_consumers(self):
  payload=b'fixture';hashes={str(runner.ROOT/name):hashlib.sha256(payload).hexdigest() for name in runner.CLOSURE};seen={}
  def read(path,mode):
   seen[path]=mode
   return json.dumps({'installedFilesSha256':hashes}).encode() if path=='/etc/workspacex-cn/trusted-tool-binding.json' else payload
  with patch.object(runner,'__file__',str(runner.ROOT/'cn_backup_run.py')),patch.object(runner.os,'geteuid',return_value=0),patch.object(runner.os,'getegid',return_value=0),patch.object(runner.sys,'platform','linux'),patch.object(runner.sys,'path',list(runner.sys.path)):
   runner.bootstrap(read)
  self.assertEqual(seen[str(runner.ROOT/'cn-backup-fixed-queries.json')],0o700)
  self.assertTrue({'fixed_probes.py','control_connection.py','host_transport.py'}<=set(runner.CLOSURE))
 def test_direct_watchdog_rejects_before_business_import_and_launch_uses_runner(self):
  text=pathlib.Path(__file__).with_name('cn_backup_watchdog.py').read_text();tree=ast.parse(text)
  guard=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.If) and "__main__" in ast.unparse(n.test))
  first_business=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.ImportFrom) and n.module=='cn_backup_package')
  self.assertLess(guard,first_business)
  self.assertIn('sys.exit(1)',ast.unparse(tree.body[guard]))
  launches=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='Popen']
  self.assertEqual(len(launches),1)
  self.assertIn('cn_backup_run.py',text)
  self.assertIn('--backup-watchdog',ast.unparse(launches[0]))

if __name__=='__main__':unittest.main()
