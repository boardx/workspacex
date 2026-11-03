"""Bounded subprocess execution for the release runner and its Docker CLI plugins."""
import os,signal,subprocess

def run(args,timeout,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=None):
 p=subprocess.Popen(args,stdout=stdout,stderr=stderr,env=env,start_new_session=True)
 try:
  out,err=p.communicate(timeout=timeout)
  return subprocess.CompletedProcess(args,p.returncode,out,err)
 except BaseException:
  try:os.killpg(p.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   p.wait(timeout=5)
  # A cooperative parent may have exited while a plugin/grandchild ignored TERM.
  # Kill the remaining group even when wait() returned promptly for the leader.
  try:os.killpg(p.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  raise

def cleanup_container(docker,name):
 # Names are unguessable per-invocation IDs, never a user-provided container name.
 env={'PATH':'/usr/bin:/bin:/usr/local/bin'}
 run([docker,'rm','--force',name],timeout=15,env=env)
 checked=run([docker,'container','ls','--all','--quiet','--filter','name=^/'+name+'$'],timeout=15,env=env)
 if checked.returncode or checked.stdout.strip():raise RuntimeError('DATABASE_WORKER_CLEANUP_FAILED')
