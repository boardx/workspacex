import os,sys,tempfile,unittest,pathlib,hashlib,time
import subprocess,threading,types,multiprocessing
from unittest.mock import patch
import cn_backup_stream as stream
from cn_backup_stream import stream_ciphertext


class Streams(unittest.TestCase):
 def run_case(self,producer,consumer,observe=lambda pid:True,**kw):
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)/'archive.cms'
   result=stream_ciphertext([sys.executable,'-c',producer],[sys.executable,'-c',consumer],
     b'fixture-private-input',str(out),observe,**kw)
   self.assertEqual(os.stat(out).st_mode&0o777,0o600)
   self.assertEqual(result['ciphertextSha256'],hashlib.sha256(out.read_bytes()).hexdigest())
   return result

 def test_bounded_stream_no_plaintext_file_and_join(self):
  r=self.run_case('import sys,time;sys.stdin.buffer.read();time.sleep(.1);sys.stdout.buffer.write(b"plain")',
                 'import sys;sys.stdout.buffer.write(b"encrypted:"+sys.stdin.buffer.read())')
  self.assertEqual(r['dumpBytes'],5);self.assertTrue(r['ownedProcessesJoined'])

 def test_environment_injection_does_not_reach_owned_children(self):
  from unittest.mock import patch
  with patch.dict(os.environ,{'OPENSSL_CONF':'untrusted-config','PGPASSWORD':'untrusted-secret'}):
   r=self.run_case('import os,sys,time;sys.stdin.buffer.read();time.sleep(.05);assert "OPENSSL_CONF" not in os.environ and "PGPASSWORD" not in os.environ;print("x")', 'import os,sys;assert "OPENSSL_CONF" not in os.environ and "PGPASSWORD" not in os.environ;print(sys.stdin.read())')
   self.assertTrue(r['ownedProcessesJoined'])

 def test_nonzero_encryption_and_producer_reject(self):
  for producer,consumer in [('import sys,time;time.sleep(.05);sys.stdout.write("x");sys.exit(1)',
                            'import sys;sys.stdout.write(sys.stdin.read())'),
                           ('import time;time.sleep(.05);print("x")','import sys;sys.exit(1)')]:
   with self.subTest(producer=producer),self.assertRaises(RuntimeError):self.run_case(producer,consumer)

 def test_missing_backend_proof_rejects_even_successful_pipeline(self):
  with self.assertRaisesRegex(RuntimeError,'PIPELINE_UNPROVEN'):
   self.run_case('import time;time.sleep(.05);print("x")','import sys;print(sys.stdin.read())',observe=lambda pid:None)

 def test_timeout_and_oversize_join_children(self):
  children=[];workers=[];observations=[];clock=[0.0]
  context=multiprocessing.get_context('fork');observer_ready=context.Event();observer_pid=context.Value('i',0)
  def launch(*args,**kwargs):
   child=subprocess.Popen(*args,**kwargs);children.append(child);return child
  def thread(*args,**kwargs):
   worker=threading.Thread(*args,**kwargs);workers.append(worker);return worker
  observe=stream.observe_owned_backend
  def backend_ready(pid):
   os.kill(pid,0);observer_pid.value=os.getpid();observer_ready.set();return True
  def ready_then_expire(callback,pid,timeout):
   # Keep the actual fork/Pipe/backend handshake AND observer process join.
   # Only after that proof exists may this case exercise the stream deadline.
   fact=observe(callback,pid,timeout)
   self.assertIs(fact,True);self.assertTrue(observer_ready.is_set())
   self.assertNotEqual(observer_pid.value,os.getpid())
   with self.assertRaises(ProcessLookupError):os.kill(observer_pid.value,0)
   observations.append(pid);clock[0]=3.0
   return fact
  processes=types.SimpleNamespace(Popen=launch,PIPE=subprocess.PIPE,DEVNULL=subprocess.DEVNULL,TimeoutExpired=subprocess.TimeoutExpired)
  def joined():
   self.assertEqual(len(children),2);self.assertEqual(len(workers),3)
   for child in children:
    self.assertIsNotNone(child.returncode)
    with self.assertRaises(ProcessLookupError):os.kill(child.pid,0)
   self.assertTrue(all(not worker.is_alive() for worker in workers))
  started=time.monotonic()
  with patch.object(stream,'subprocess',processes),patch.object(stream,'threading',types.SimpleNamespace(Thread=thread)):
   # A real 100ms startup race could fail in observer teardown before reaching
   # the intended timeout path (Python 3.14 CI). Use a separate real handshake
   # allowance; the stream deadline itself is crossed deterministically, without
   # sleeping for it or changing the production clock/observer implementation.
   with patch.object(stream,'time',types.SimpleNamespace(monotonic=lambda:clock[0],sleep=time.sleep)),patch.object(stream,'observe_owned_backend',ready_then_expire):
    with self.assertRaisesRegex(RuntimeError,'^BACKUP_STREAM_TIMEOUT$'):
     self.run_case('import time;time.sleep(20)','import sys;print(sys.stdin.read())',observe=backend_ready,timeout_seconds=2)
   self.assertEqual(len(observations),1);joined()
   self.assertLess(time.monotonic()-started,3)
   children.clear();workers.clear()
   with self.assertRaisesRegex(RuntimeError,'^BACKUP_(STREAM_FAILED|PIPELINE_UNPROVEN)$'):
    self.run_case('import time;time.sleep(.05);print("too-large")','import sys;print(sys.stdin.read())',max_bytes=2)
   joined()

 def test_existing_ciphertext_never_overwritten(self):
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp)/'archive.cms';out.write_bytes(b'keep')
   with self.assertRaises(FileExistsError):stream_ciphertext([],[],b'',str(out),lambda pid:True)
   self.assertEqual(out.read_bytes(),b'keep')

 def test_exited_parent_descendant_holding_pipe_is_bounded(self):
  start=time.monotonic()
  producer='import os,time;pid=os.fork();time.sleep(20) if pid==0 else None'
  with self.assertRaises(RuntimeError):
   self.run_case(producer,'import sys;print(sys.stdin.read())',timeout_seconds=.15)
  self.assertLess(time.monotonic()-start,4)

 def test_blocked_observer_cannot_extend_deadline(self):
  start=time.monotonic()
  def blocked(pid):time.sleep(20)
  with self.assertRaisesRegex(RuntimeError,'OBSERVER_TIMEOUT'):
   self.run_case('import time;time.sleep(20)','import sys;print(sys.stdin.read())',observe=blocked,timeout_seconds=.15)
  self.assertLess(time.monotonic()-start,4)

if __name__=='__main__':unittest.main()
