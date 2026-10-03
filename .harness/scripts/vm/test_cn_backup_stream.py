import os,sys,tempfile,unittest,pathlib,hashlib,time
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

 def test_nonzero_encryption_and_producer_reject(self):
  for producer,consumer in [('import sys,time;time.sleep(.05);sys.stdout.write("x");sys.exit(1)',
                            'import sys;sys.stdout.write(sys.stdin.read())'),
                           ('import time;time.sleep(.05);print("x")','import sys;sys.exit(1)')]:
   with self.subTest(producer=producer),self.assertRaises(RuntimeError):self.run_case(producer,consumer)

 def test_missing_backend_proof_rejects_even_successful_pipeline(self):
  with self.assertRaisesRegex(RuntimeError,'PIPELINE_UNPROVEN'):
   self.run_case('import time;time.sleep(.05);print("x")','import sys;print(sys.stdin.read())',observe=lambda pid:None)

 def test_timeout_and_oversize_join_children(self):
  started=time.monotonic()
  with self.assertRaisesRegex(RuntimeError,'TIMEOUT'):
   self.run_case('import time;time.sleep(20)','import sys;print(sys.stdin.read())',timeout_seconds=.1)
  self.assertLess(time.monotonic()-started,3)
  with self.assertRaises(RuntimeError):
   self.run_case('import time;time.sleep(.05);print("too-large")','import sys;print(sys.stdin.read())',max_bytes=2)

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
