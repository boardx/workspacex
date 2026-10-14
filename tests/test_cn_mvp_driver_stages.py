import importlib.util
import datetime as dt
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('hooks',ROOT/'scripts/cn-release-mvp-driver-stages.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

class DriverStageTests(unittest.TestCase):
 def test_cli_cannot_accept_arbitrary_command_or_environment(self):
  p=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/cn-release-mvp-driver-stages.py'),'observe','../shell'],capture_output=True)
  self.assertNotEqual(p.returncode,0)
  self.assertIn(b'BLOCKED_OR_UNKNOWN',p.stderr)
 def test_legacy_does_not_invoke_new_inputs(self):
  with patch.object(m,'preflight',side_effect=AssertionError('legacy read')):
   self.assertIsNone(m.held_content({},'a'*64,None,'run'))
 def test_partial_intent_cannot_retry_or_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d)/'mvp-stages';folder.mkdir();(folder/'intent.json').write_text('{}')
   a={'mvp':{'acceptanceScope':'mvp-non-model'},'expiresAt':'2099-01-01T00:00:00Z'}
   with patch.object(m,'preflight',return_value=({}, {}, {})),patch.object(m,'prefix',return_value=folder),patch.object(m,'held'):
    with self.assertRaises(FileExistsError):m.held_content(a,'a'*64,'b'*64,'run')
   self.assertEqual((folder/'intent.json').read_text(),'{}')
 def test_receipt_requires_exact_switch_and_original_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d);original=b'{"realProcess":true}'
   (folder/'schema.json').write_bytes(original)
   value={'releaseSha256':'a'*64,'switchReceiptSha256':'b'*64,'originals':{'schema.json':m.e.digest(original)}}
   (folder/'held-content.json').write_text(json.dumps(value))
   a={'mvp':{'acceptanceScope':'mvp-non-model'}}
   with patch.object(m,'preflight',return_value=({}, {}, {})),patch.object(m,'prefix',return_value=folder),patch.object(m.e,'read',side_effect=lambda p,*args:Path(p).read_bytes()):
    self.assertEqual(m.held_content(a,'a'*64,'b'*64,'status'),value)
    (folder/'schema.json').write_bytes(b'{}')
    with self.assertRaisesRegex(m.e.Rejected,'MVP_HOOK_ORIGINAL'):m.held_content(a,'a'*64,'b'*64,'status')
 def test_readonly_unstarted_does_not_create_directory(self):
  with tempfile.TemporaryDirectory() as d:
   folder=Path(d)/'absent';a={'mvp':{'acceptanceScope':'mvp-non-model'}}
   with patch.object(m,'preflight',return_value=({}, {}, {})),patch.object(m,'prefix',return_value=folder):
    self.assertEqual(m.held_content(a,'a'*64,'b'*64,'status')['status'],'NOT_STARTED')
   self.assertFalse(folder.exists())
 def test_positive_hook_real_processes_and_retained_files_synthetic_business(self):
  # Real subprocess/file integration; synthetic DB/hold responses, NOT PG/cloud.
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);folder=root/'mvp-stages';state=root/'state';(state/'attempt').mkdir(parents=True)
   source='a'*40;request=json.dumps({'sourceRevision':source,'expectedDatabase':'workspacex_a1cb_20261006','beforeStateSha256':'c'*64}).encode();pin=m.e.digest(request)
   backup=json.dumps({'sourceRevision':source,'requestSha256':pin,'beforeStateSha256':'c'*64,'status':'Success','independentlyObserved':True}).encode()
   switch=b'{"stage":"switch"}';(state/'attempt'/'13-switch.receipt.json').write_bytes(switch)
   now=dt.datetime.now(dt.timezone.utc)
   a={'mvp':{'acceptanceScope':'mvp-non-model'},'identity':{'attemptId':'attempt','sourceRevision':source,'requestedAt':(now-dt.timedelta(seconds=10)).isoformat()},'expiresAt':(now+dt.timedelta(minutes=1)).isoformat()}
   identity={'sourceRevision':source};x={'schemaRequest':json.dumps({'identity':identity}).encode(),'contentRequest':request,'contentBackup':b'{}'}
   profile={'identity':identity,'sourceCheckout':str(root)};calls=[]
   def runner(argv):
    calls.append(argv)
    if argv[3].endswith('platform-schema-readback.ts'):
     value={'requestSha256':m.e.digest(Path(argv[4]).read_bytes()),'identity':identity,'productionRunId':99,'schemaReadbackPassed':True,'productionWrites':False,'observedAt':now.isoformat()}
    else:
     mode=argv[4];row={'expectedBeforeStateMatches':True,'sourceInputsVerified':True,'productionWrites':False} if mode=='preflight' else {'contentReadbackPassed':True,'acceptanceScope':'mvp-non-model','realModel':'SKIPPED','aiOutputQuality':'SKIPPED','skillVerificationPromotion':'NOT_PERFORMED','fullBusinessAcceptance':False,**{k:0 for k in ('skillVersions','roleVersions','workflows','pendingBindings')}}
     value={'kind':'cn-platform-content-release-receipt-v1','mode':mode,'sourceRevision':source,'requestSha256':pin,'observedAt':now.isoformat(),'receipt':row}
    return subprocess.run([sys.executable,'-I','-B','-c','import sys;sys.stdout.buffer.write('+repr(json.dumps(value).encode())+')'],capture_output=True)
   real_load=m.load
   class Collector:
    def materialize_content_backup(self,*args):return backup
   with patch.object(m,'preflight',return_value=(x,profile,{})),patch.object(m,'prefix',return_value=folder),patch.object(m,'held'),patch.object(m,'production_run',return_value=99),patch.object(m,'load',side_effect=lambda name:Collector() if name=='mvp-trusted-collector' else real_load(name)),patch.object(m.e,'STATE',state),patch.object(m.e,'directory'),patch.object(m.e,'read',side_effect=lambda p,*args:Path(p).read_bytes()):
    value=m.held_content(a,'d'*64,m.e.digest(switch),'run',runner=runner)
    self.assertTrue(value['schemaReadbackPassed']);self.assertTrue(value['contentReadbackPassed'])
    self.assertEqual(len(calls),4)
    self.assertTrue((folder/'content'/'apply-intent.json').exists())
    for name,h in value['originals'].items():self.assertEqual(m.e.digest((folder/name).read_bytes()),h)
    # Completed status reads original evidence; never repeats synthetic apply.
    self.assertEqual(m.held_content(a,'d'*64,m.e.digest(switch),'status'),value)
    self.assertEqual(len(calls),4)

if __name__=='__main__':unittest.main()
