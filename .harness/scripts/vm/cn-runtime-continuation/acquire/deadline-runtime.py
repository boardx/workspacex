"""Original execution deadline guard; timeout is UNKNOWN, never rollback permission.

Outer reviewed entry/cgroup owns whole-operation containment. Killing this local
process group cannot revoke daemon or provider work already accepted. Independent
observer reconciliation remains mandatory, including after a zero exit code.
"""
import base64,datetime,hashlib,json,math,os,selectors,signal,subprocess,sys,time
CONFIG=__CONFIG__
def stamp(value):
 result=datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
 if result.tzinfo is None:raise ValueError('TIMEZONE_REQUIRED')
 return result

def execute(config):
 now=datetime.datetime.now(datetime.timezone.utc);start=stamp(config['requestedAt']);end=stamp(config['deadlineAt'])
 if not start<=now<end or not 0<(end-start).total_seconds()<=1800:raise ValueError('ORIGINAL_DEADLINE_EXPIRED')
 seconds=min(config['maxSeconds'],math.floor((end-now).total_seconds()))
 if type(config['maxSeconds']) is not int or not 1<=seconds<=1200:raise ValueError('EXECUTION_BUDGET_EXHAUSTED')
 raw=base64.b64decode(config['source'],validate=True)
 if hashlib.sha256(raw).hexdigest()!=config['sourceSha256']:raise ValueError('ACTION_SOURCE_HASH')
 # The exact launcher source is protected by the request/template hashes. No shell.
 child=subprocess.Popen([sys.executable,'-I','-S','-B','-c',raw.decode()],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
 limit=time.monotonic()+seconds;selector=selectors.DefaultSelector();data=bytearray();eof=False
 try:
  selector.register(child.stdout,selectors.EVENT_READ)
  while not (eof and child.poll() is not None):
   if time.monotonic()>=limit or datetime.datetime.now(datetime.timezone.utc)>=end:raise TimeoutError('DEADLINE')
   for key,_ in selector.select(0.05):
    block=os.read(key.fileobj.fileno(),4096)
    if block:data.extend(block)
    else:selector.unregister(key.fileobj);eof=True
    if len(data)>65536:raise ValueError('ACTION_OUTPUT_LIMIT')
  if child.returncode!=0:raise ValueError('ACTION_NONZERO')
  if datetime.datetime.now(datetime.timezone.utc)>=end:raise TimeoutError('LATE_ACK')
  # Preserve original receipt bytes; they are not an independent observer verdict.
  sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
  return {'processExited':True,'independentObserverRequired':True,'externalWritesStopped':False,'retryAllowed':False}
 except BaseException:
  try:os.killpg(child.pid,signal.SIGKILL)
  except OSError:pass
  try:child.wait(timeout=2)
  except (subprocess.TimeoutExpired,OSError):pass
  raise RuntimeError('UNKNOWN_RECONCILE_NO_RETRY') from None
 finally:
  selector.close();child.stdout.close()

if __name__=='__main__':
 try:execute(CONFIG)
 except BaseException:
  print(json.dumps({'status':'UNKNOWN_RECONCILE_NO_RETRY','retryAllowed':False,'externalWritesStopped':False,'independentObserverRequired':True}));raise SystemExit(75)
