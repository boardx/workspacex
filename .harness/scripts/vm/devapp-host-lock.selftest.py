"""Disposable Linux root fixture; does not deploy or establish live Devapp readiness."""
import os,pathlib,signal,subprocess,tempfile,time,unittest
class HostLock(unittest.TestCase):
 def test_child_keeps_actual_installed_lock_after_coordinator_exit(self):
  source=pathlib.Path(__file__).with_name('deploy.sh').read_text()
  start=source.index('acquire_devapp_lock(){');end=source.index('\n}\n',start)+2
  function=source[start:end]
  with tempfile.TemporaryDirectory(prefix='devapp-lock-fixture-') as tmp:
   root=pathlib.Path(tmp);child=root/'child.sh';ready=root/'ready';done=root/'done';second=root/'second'
   child.write_text('set -eu\n'+function+'\nacquire_devapp_lock\nprintf ready > "$READY"\nsleep 1\nprintf done > "$DONE"\n')
   env={**os.environ,'READY':str(ready),'DONE':str(done),'SECOND':str(second)}
   first=subprocess.Popen(['bash','-c','set -eu\n'+function+'\nacquire_devapp_lock\nbash "$1" &\nwait','fixture',str(child)],env=env,start_new_session=True)
   contender=None
   try:
    deadline=time.monotonic()+5
    while not ready.exists() and time.monotonic()<deadline:time.sleep(.01)
    self.assertTrue(ready.exists(),'real child must have acquired the shared inherited lock')
    contender=subprocess.Popen(['bash','-c','set -eu\n'+function+'\nacquire_devapp_lock\nprintf second > "$SECOND"'],env=env,start_new_session=True)
    first.terminate();first.wait(timeout=2)
    # The owned child retains the same open description; parent cancellation
    # must not let a competing normal writer enter its mutation interval.
    time.sleep(.1);self.assertFalse(second.exists());self.assertFalse(done.exists())
    contender.wait(timeout=5);self.assertEqual(contender.returncode,0)
    self.assertTrue(done.exists());self.assertTrue(second.exists())
    s=pathlib.Path('/run/workspacex-devapp-deploy.lock').stat();self.assertEqual((s.st_uid,s.st_gid,s.st_mode&0o777,s.st_nlink),(0,0,0o600,1))
   finally:
    for process in (first,contender):
     if process:
      try:os.killpg(process.pid,signal.SIGKILL)
      except ProcessLookupError:pass
      process.wait(timeout=5)
if __name__=='__main__':unittest.main()
