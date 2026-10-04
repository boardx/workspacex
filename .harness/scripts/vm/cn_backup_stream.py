"""Owned subprocess-only plaintext pipe to bounded ciphertext; never logs streams.

Caller must use cn_backup_package fixed argv and authenticate the actual Docker
container/backend. Killing the Docker client does not prove its container stopped;
BackupLease cleanup must separately reconcile exact owned container/session IDs.
"""
import os,signal,subprocess,threading,time,hashlib,stat,multiprocessing
from cn_backup_package import require
from host_transport import SAFE_ENV


def bounded_observe(callback, pid, timeout):
 # An unresponsive source collector cannot extend the backup wall deadline.
 context=multiprocessing.get_context('fork')
 reader,writer=context.Pipe(duplex=False)
 def collect():
  os.setsid();reader.close()
  sink=os.open(os.devnull,os.O_WRONLY)
  os.dup2(sink,1);os.dup2(sink,2);os.close(sink)
  try:writer.send(callback(pid))
  except BaseException:writer.send(False)
  finally:writer.close()
 child=context.Process(target=collect)
 child.start();writer.close()
 try:
  require(reader.poll(timeout),'BACKUP_OBSERVER_TIMEOUT')
  result=reader.recv();child.join(timeout=min(timeout,1))
  require(not child.is_alive() and child.exitcode==0,'BACKUP_OBSERVER_UNPROVEN')
  return result
 finally:
  # This process/group was created here, not supplied by a caller.
  try:os.killpg(child.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  if child.is_alive():child.kill()
  child.join(timeout=2);reader.close()
  require(not child.is_alive(),'BACKUP_OBSERVER_CLEANUP_UNPROVEN')


def observe_owned_backend(callback, pid, timeout):
 # Retained SQL clients are owned by this parent and cannot cross a fork.
 # Only this compiled collector has bounded authority calls and proof writes;
 # arbitrary callbacks retain the isolated process/deadline contract.
 from retained_backend_observer import SourceOwnedParentObservation
 if type(callback) is SourceOwnedParentObservation:
  started=time.monotonic()
  require(callback.pid==os.getpid(),'BACKUP_PARENT_OBSERVER_OWNER')
  result=callback(pid)
  require(time.monotonic()-started<=timeout,'BACKUP_PARENT_OBSERVER_TIMEOUT')
  require(result is None or (result is True and callback.proof is not None and callback.receipts),'BACKUP_PARENT_OBSERVER_PROOF')
  return result
 return bounded_observe(callback,pid,timeout)


def stream_ciphertext(producer_args,encrypt_args,credential_input,output_path,observe,
                      timeout_seconds=330,max_bytes=16*1024**3):
 require(type(credential_input) is bytes and len(credential_input)<=65536,
         'BACKUP_STDIN_BOUND')
 require(type(timeout_seconds) in (int,float) and 0<timeout_seconds<=330 and
         type(max_bytes) is int and 0<max_bytes<=16*1024**3,'BACKUP_STREAM_BOUND')
 children=[];threads=[];errors=[];counts={'dump':0,'cipher':0};h=hashlib.sha256()
 deadline=time.monotonic()+timeout_seconds;observed=False;output=None
 try:
  fd=os.open(output_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  output=os.fdopen(fd,'wb')
  require(stat.S_ISREG(os.fstat(fd).st_mode),'BACKUP_CIPHERTEXT_FILE')
  producer=subprocess.Popen(producer_args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL,start_new_session=True,env=SAFE_ENV)
  children.append(producer)
  encrypt=subprocess.Popen(encrypt_args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL,start_new_session=True,env=SAFE_ENV)
  children.append(encrypt)
  def feed():
   try:producer.stdin.write(credential_input);producer.stdin.close()
   except BaseException:errors.append('BACKUP_CREDENTIAL_PIPE')
  def pump():
   try:
    for raw in iter(lambda:producer.stdout.read(65536),b''):
     counts['dump']+=len(raw);require(counts['dump']<=max_bytes,'BACKUP_PLAINTEXT_BOUND')
     encrypt.stdin.write(raw)
    encrypt.stdin.close()
   except BaseException:errors.append('BACKUP_ENCRYPT_PIPE')
  def save():
   try:
    for raw in iter(lambda:encrypt.stdout.read(65536),b''):
     counts['cipher']+=len(raw);require(counts['cipher']<=max_bytes,'BACKUP_CIPHERTEXT_BOUND')
     h.update(raw);output.write(raw)
   except BaseException:errors.append('BACKUP_CIPHERTEXT_PIPE')
  for fn in (feed,pump,save):
   t=threading.Thread(target=fn,daemon=True);threads.append(t);t.start()
  while producer.poll() is None or encrypt.poll() is None or any(t.is_alive() for t in threads):
   require(time.monotonic()<deadline,'BACKUP_STREAM_TIMEOUT')
   require(not errors,'BACKUP_STREAM_FAILED')
   if producer.poll() is None:
    # A host proof collector returns True only for actual live pg_dump backend,
    # source/peer/read-only and exact owned container/PID/start, never precheck.
    fact=observe_owned_backend(observe,producer.pid,min(30,max(.001,deadline-time.monotonic())))
    require(fact is None or fact is True,'BACKUP_BACKEND_OBSERVATION')
    observed=observed or fact is True
   time.sleep(0.01)
  require(observed and not errors and producer.returncode==0 and encrypt.returncode==0 and
          counts['dump']>0 and counts['cipher']>0,'BACKUP_PIPELINE_UNPROVEN')
  for t in threads:t.join(timeout=1)
  require(not any(t.is_alive() for t in threads),'BACKUP_PIPELINE_NOT_JOINED')
  output.flush();os.fsync(output.fileno())
  return {'dumpExit':producer.returncode,'encryptionExit':encrypt.returncode,
          'dumpBytes':counts['dump'],'ciphertextBytes':counts['cipher'],
          'ciphertextSha256':h.hexdigest(),'backendObserved':True,'ownedProcessesJoined':True}
 finally:
  # Private child process groups created by this function only. No foreign PID.
  for child in children:
   # Leader exit does not mean descendants stopped or released inherited pipes.
   try:os.killpg(child.pid,signal.SIGTERM)
   except ProcessLookupError:pass
  for child in children:
   try:child.wait(timeout=1)
   except subprocess.TimeoutExpired:pass
  # Give TERM a bounded chance to release descendant-held pipes before KILL.
  # A group containing only reparented zombies can reject a redundant signal.
  for t in threads:t.join(timeout=.2)
  if any(t.is_alive() for t in threads) or any(c.poll() is None for c in children):
   for child in children:
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
  for child in children:child.wait(timeout=5)
  for t in threads:t.join(timeout=2)
  # BufferedReader.close can block acquiring a live read thread's lock.
  require(not any(t.is_alive() for t in threads),'BACKUP_STREAM_CLEANUP_UNPROVEN')
  for child in children:
   for pipe in (child.stdin,child.stdout):
    if pipe:
     try:pipe.close()
     except BaseException:pass
  if output:output.close()
  require(not any(t.is_alive() for t in threads),'BACKUP_STREAM_CLEANUP_UNPROVEN')
