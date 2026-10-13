"""Real Linux renameat2 in disposable test-owned directories, never production."""
import fcntl,importlib.util,os,sys,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('fixture',HERE/'test_swap.py' if (HERE/'test_swap.py').exists() else HERE/'test_cn_proof_refresh_swap.py');t=importlib.util.module_from_spec(s);s.loader.exec_module(t)
class Linux(t.Swap):
 def swap(self,exchange=None,admit=lambda *x:None):return super().swap(exchange=exchange or t.m.exchange,admit=admit)
 def test_real_exchange_then_response_loss_reconciliation(self):
  def lost(a,b):t.m.exchange(a,b);raise TimeoutError()
  with self.assertRaises(TimeoutError):self.swap(exchange=lost)
  self.assertEqual(t.m.inventory(self.root.with_name('attempt.history-new'),os.getuid()),self.c['oldTree'])
  self.assertNotEqual(t.m.inventory(self.root,os.getuid()),self.c['oldTree'])
  self.assertTrue(self.root.with_name('attempt.swap-new.json').exists())
  with self.assertRaises(ValueError):self.swap()
 def test_other_process_holding_canonical_lock_blocks(self):
  read,write=os.pipe();pid=os.fork()
  if pid==0:
   os.close(read)
   with self.lock.open('rb')as f:
    fcntl.flock(f,fcntl.LOCK_EX);os.write(write,b'1');os.close(write)
    import time;time.sleep(2)
   os._exit(0)
  os.close(write)
  try:
   self.assertEqual(os.read(read,1),b'1')
   with self.assertRaises(BlockingIOError):self.swap()
   self.assertEqual(t.m.inventory(self.root,os.getuid()),self.c['oldTree'])
  finally:os.close(read);os.waitpid(pid,0)
if __name__=='__main__':
 if sys.platform!='linux':print('LINUX_CAPABILITY_REQUIRED; not a passing skip');sys.exit(2)
 unittest.main()
