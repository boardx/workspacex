import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock
P=Path(__file__).resolve().parents[1]/'scripts/schema-tag-prepare-cn.py'
s=importlib.util.spec_from_file_location('cn_prepare',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class CnSource(unittest.TestCase):
 def test_only_fixed_readonly_operations(self):
  for op in ('dump','metadata'):
   args=m.command(op);self.assertIn(m.TOOL,args);self.assertIn(m.ENV,args)
   self.assertIn('default_transaction_read_only=on',args[-1]);self.assertNotIn('BEGIN;',args[-1])
  self.assertIn('BEGIN READ ONLY',m.command('metadata')[-1])
  with self.assertRaises(ValueError):m.command('apply')
 def test_wrong_source_or_size_rejected(self):
  good={'database':m.DB,'role':'migration_admin','bytes':1000,'roles':['app_rw'],'ledger':{'old.sql':'a'*64}}
  d=Mock();d.run.side_effect=lambda args,**kwargs:json.dumps(good).encode() if args[0]=='run' else b'';self.assertEqual(m.read_source(d),good)
  for patch in ({'database':'wrong'},{'role':'app_rw'},{'bytes':True},{'bytes':128*1024*1024},{'roles':[]}):
   d.run.side_effect=lambda args,**kwargs:json.dumps({**good,**patch}).encode() if args[0]=='run' else b''
   with self.assertRaises(ValueError):m.read_source(d)
if __name__=='__main__':unittest.main()

class CleanupBoundary(unittest.TestCase):
 def test_timeout_still_reconciles_owned_helper(self):
  from unittest.mock import patch
  d=Mock();d.run.side_effect=[TimeoutError(),b'a'*64+b'\n',b'',b'']
  d.json.return_value=[{'Id':'a'*64,'Name':'/wsx-cn-source-token','Image':m.TOOL,'HostConfig':{'NetworkMode':m.NETWORK},'Config':{'Labels':{'wsx.cn.source':'token'}}}]
  with patch.object(m.uuid,'uuid4',return_value=Mock(hex='token')):
   with self.assertRaises(TimeoutError):m.helper(d,'metadata',lambda args:d.run(args))
  self.assertTrue(any(call.args[0][0:2]==['rm','--force'] for call in d.run.call_args_list))
 def test_untrusted_closure_rejected_before_import(self):
  from unittest.mock import patch
  with patch.object(m,'trusted',side_effect=ValueError('UNTRUSTED')),patch.object(m,'load') as loader,patch.object(m.os,'geteuid',return_value=0):
   with self.assertRaises(ValueError):m.prepare('123-1')
   loader.assert_not_called()

class SignalBoundary(unittest.TestCase):
 def test_sigterm_unwinds_owned_helper_cleanup(self):
  import signal
  from unittest.mock import patch
  captured={}
  with patch.object(m.signal,'signal',side_effect=lambda sig,handler:captured.update({sig:handler})):
   m.install_signal_handler()
  d=Mock();d.run.return_value=b''
  with self.assertRaises(RuntimeError):
   m.helper(d,'metadata',lambda args:captured[signal.SIGTERM](signal.SIGTERM,None))
  self.assertEqual(d.run.call_count,2)
  self.assertTrue(all(call.args[0][0]=='ps' for call in d.run.call_args_list))

class HostIdentity(unittest.TestCase):
 def test_l_is_not_numeric_one(self):
  self.assertEqual(m.HOST,'pgm-uf6rg214cp381l49.rwlb.rds.aliyuncs.com')
  self.assertNotEqual(m.HOST,'pgm-uf6rg214cp381149.rwlb.rds.aliyuncs.com')

class ToolIdentity(unittest.TestCase):
 def test_actual_full_image_pin_and_truncated_pin(self):
  correct='sha256:af6e55371441513bbe1093a588ff4b2b5c9dbcb3c96e2b8e432f4ee1a283973c'
  self.assertEqual(m.tool_identity(correct),correct)
  for bad in (correct[:-1],correct+'a','sha256:'+'0'*64,'sha256:af6e55371441513bbe1093a588ff4b2b5c9dbc3c96e2b8e432f4ee1a283973c'):
   with self.assertRaisesRegex(ValueError,'CN_TOOL_PIN_INVALID'):m.tool_identity(bad)
