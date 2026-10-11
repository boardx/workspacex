import datetime as dt
import importlib.util
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('commands',ROOT/'scripts/cn-release-generated-commands.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)

class CommandsTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);base=Path(self.tmp.name);self.approvals=base/'approvals';self.approvals.mkdir()
  self.now=dt.datetime.now(dt.timezone.utc)
  a={'identity':{'deadlineAt':(self.now+dt.timedelta(minutes=2)).isoformat()},'codeFiles':{'scripts/cn-release-generated-commands.py':g.e.digest(Path(g.__file__).read_bytes())}}
  raw=g.e.encode(a);self.release=g.e.digest(raw);(self.approvals/(self.release+'.json')).write_bytes(raw)
  self.base=base/'generated';self.folder=self.base/self.release/'acquire/publication';self.folder.mkdir(parents=True);self.stage=self.base/self.release/'stages/publication-stage';self.stage.mkdir(parents=True)
  (self.stage/'intent.json').write_bytes(g.e.encode({'releaseSha256':self.release,'stage':'publication-stage'}));actions=[]
  for i,op in enumerate(('stage-chunk-000','stage-chunk-001','stage-assemble')):
   command='printf stage'+str(i)+'\\n';params=g.e.encode({'CommandContent':command,'RegionId':'cn-shanghai','InstanceId.1':'i-uf6ga92ewloganobbln6','Username':'root','RepeatMode':'Once','WorkingDir':'/'})
   name=op+'.json';(self.folder/name).write_bytes(params);actions.append({'operation':op,'parameters':name,'parametersSha256':g.e.digest(params),'commandSha256':g.e.digest(command.encode()),'timeoutSeconds':30})
  self.delegation={'releaseSha256':self.release,'phase':'publication','actions':actions}
  self.save()
  self.calls=[]
  for p in (patch.object(g,'BASE',self.base),patch.object(g,'APPROVALS',self.approvals),patch.object(g.e,'read',lambda p,*a:Path(p).read_bytes()),patch.object(g.e,'now',lambda:self.now),patch.object(g.e,'directory',lambda p: None)):
   p.start();self.addCleanup(p.stop)
 def save(self):(self.folder/'delegation.json').write_bytes(g.e.encode(self.delegation))
 def executor(self,*args,**kw):
  i=len(self.calls);self.calls.append(kw['input']);self.assertTrue((self.stage/('command-%03d.intent.json'%i)).exists());return SimpleNamespace(returncode=0,stdout=('receipt%d\n'%i).encode())
 def test_ordered_once_returns_only_final_raw(self):
  self.assertEqual(g.run(self.release,executor=self.executor),b'receipt2\n');self.assertEqual(len(self.calls),3)
  with self.assertRaises(FileExistsError):g.run(self.release,executor=self.executor)
  self.assertEqual(len(self.calls),3)
 def test_failed_middle_stops_and_never_retries(self):
  def execute(*args,**kw):
   result=self.executor(*args,**kw)
   if len(self.calls)==2:result.returncode=1
   return result
  with self.assertRaisesRegex(g.e.Rejected,'COMMAND_UNKNOWN'):g.run(self.release,executor=execute)
  self.assertEqual(len(self.calls),2);self.assertFalse((self.stage/'command-002.intent.json').exists())
  with self.assertRaises(FileExistsError):g.run(self.release,executor=self.executor)
  self.assertEqual(len(self.calls),2)
 def test_response_lost_keeps_intent_no_retry(self):
  def lost(*args,**kw):self.executor(*args,**kw);raise subprocess.TimeoutExpired('fixture',1)
  with self.assertRaises(subprocess.TimeoutExpired):g.run(self.release,executor=lost)
  with self.assertRaises(FileExistsError):g.run(self.release,executor=self.executor)
  self.assertEqual(len(self.calls),1)
 def test_corrupt_parameter_before_execution(self):
  (self.folder/self.delegation['actions'][1]['parameters']).write_bytes(b'{}')
  with self.assertRaisesRegex(g.e.Rejected,'PARAMETER_HASH'):g.run(self.release,executor=self.executor)
  self.assertEqual(self.calls,[])
 def test_deadline_blocks_without_intent(self):
  with patch.object(g.e,'now',lambda:self.now+dt.timedelta(minutes=3)):
   with self.assertRaisesRegex(g.e.Rejected,'RELEASE_DEADLINE'):g.run(self.release,executor=self.executor)
  self.assertEqual(self.calls,[]);self.assertFalse((self.stage/'command-000.intent.json').exists())
 def test_assemble_must_be_last(self):
  self.delegation['actions'].reverse();self.save()
  with self.assertRaisesRegex(g.e.Rejected,'STAGE_ORDER'):g.run(self.release,executor=self.executor)
  self.assertEqual(self.calls,[])

if __name__=='__main__':unittest.main()
