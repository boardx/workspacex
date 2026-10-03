"""Independent preopened cleanup process; no production action on import.
Only a separately installed/pinned helper can be started by BackupWatchdog.
"""
import hashlib,json,os,pathlib,re,select,stat,subprocess,sys,time
if __name__=='__main__':
 sys.stderr.write('BACKUP_WATCHDOG_REQUIRES_PROTECTED_RUNNER\n');sys.exit(1)
from cn_backup_package import IMAGE,ROLE,validate
from cn_backup_channel import BackupChannel
from cn_backup_sql import protected_authorization,capture,dispatch,permission_gaps
from host_transport import private,SAFE_ENV
from writer_fence import DATABASES,require


def owner_for(reference):return hashlib.sha256(reference['sha256'].encode()).hexdigest()[:32]


def docker(arguments,run=subprocess.run):
 r=run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/nonexistent']+arguments,
  stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=15)
 require(r.returncode==0 and len(r.stdout)<=1048576,'BACKUP_WATCHDOG_DOCKER_UNKNOWN')
 return r.stdout


def owned_inventory(owner):
 require(re.fullmatch('[a-f0-9]{32}',owner),'BACKUP_WATCHDOG_OWNER')
 ids=docker(['ps','-aq','--no-trunc','--filter','label=wsx.backup.owner='+owner]).decode().splitlines()
 require(len(ids)<=3 and all(re.fullmatch('[a-f0-9]{64}',x) for x in ids),'BACKUP_WATCHDOG_CONTAINER_IDS')
 result=[]
 for identifier in ids:
  rows=json.loads(docker(['inspect',identifier]));require(len(rows)==1,'BACKUP_WATCHDOG_CONTAINER_INSPECT')
  c=rows[0]
  require(c['Id']==identifier and c['Image']==IMAGE and c['Config']['Labels'].get('wsx.backup.owner')==owner and
   c['HostConfig']['NetworkMode']=='host' and re.fullmatch('/wsx-backup-[a-f0-9]{32}',c['Name']), 'BACKUP_WATCHDOG_FOREIGN_CONTAINER')
  result.append(c)
 return result


def cleanup(plan,scope,authorization,channels,owner):
 facts={db:capture(channels[db],db) for db in DATABASES}
 roles=[bool(f['role']) for f in facts.values()]
 require(all(roles) or not any(roles),'BACKUP_WATCHDOG_ROLE_STATE_UNKNOWN')
 if any(roles):dispatch(channels[DATABASES[0]],plan,scope,authorization,'close')
 # NOLOGIN prevents new sessions while exactly owned containers are stopped.
 for container in owned_inventory(owner):
  identifier=container['Id']
  # Reinspect the ID and authority immediately before daemon stop.
  require(any(c['Id']==identifier for c in owned_inventory(owner)),'BACKUP_WATCHDOG_CONTAINER_CHANGED')
  docker(['rm','--force',identifier])
 require(owned_inventory(owner)==[],'BACKUP_WATCHDOG_CONTAINERS_REMAIN')
 facts={db:capture(channels[db],db) for db in DATABASES}
 require(all(f['sessions']==[] for f in facts.values()),'BACKUP_WATCHDOG_ROLE_SESSIONS_REMAIN')
 if any(roles):
  for db in DATABASES:dispatch(channels[db],plan,scope,authorization,'revoke',database=db)
  facts={db:capture(channels[db],db) for db in DATABASES}
  require(all(not permission_gaps(f,scope,phase='closed',allowed_public_temp=authorization.allowed_public_temp) for f in facts.values()),'BACKUP_WATCHDOG_REVOKE_UNPROVEN')
 return {'kind':'owned-backup-cleanup-verified','roleAbsent':not any(roles),'ownedContainersAbsent':True,'roleSessionsAbsent':True,'exactRevocationVerified':True}


def quiesce_parent_admin(plan,reference,channels):
 path=pathlib.Path(plan['outputRoot'])/'parent-admin-sessions.json'
 proof=json.loads(private(path))
 require(set(proof)=={'identity','owner','sessions'} and proof['identity']==plan['identity'] and proof['owner']==owner_for(reference) and set(proof['sessions'])==set(DATABASES),'BACKUP_WATCHDOG_PARENT_BINDING')
 for db in DATABASES:
  target=proof['sessions'][db]
  require(target['role']=='migration_admin' and target['peer']['database']==db and type(target['pid']) is int and type(target['backendStart']) is str,'BACKUP_WATCHDOG_PARENT_SESSION')
  require(channels[db].quiesce_owned_admin(target) is True,'BACKUP_WATCHDOG_PARENT_SESSION_NOT_JOINED')


def journal_event(plan,event):
 path=pathlib.Path(plan['outputRoot'])/'watchdog-journal.jsonl'
 for parent in path.parents:
  st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and st.st_gid==0 and not st.st_mode&0o022,'BACKUP_WATCHDOG_JOURNAL_PARENT')
 fd=os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  st=os.fstat(fd);require(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600,'BACKUP_WATCHDOG_JOURNAL_FILE')
  row=(json.dumps({'identity':plan['identity'],'event':event,'at':time.time()},sort_keys=True)+'\n').encode()
  require(os.write(fd,row)==len(row),'BACKUP_WATCHDOG_JOURNAL_SHORT_WRITE');os.fsync(fd)
 finally:os.close(fd)


def serve(reference):
 raw=private(reference['path']);require(hashlib.sha256(raw).hexdigest()==reference['sha256'],'BACKUP_WATCHDOG_PLAN_PIN')
 host=json.loads(raw);plan=host['backup'];validate(plan);authorization=protected_authorization(plan);channels={}
 try:
  for db in DATABASES:channels[db]=BackupChannel(reference,db,cleanup_only=True)
  require(all(capture(channels[db],db)['role']==[] for db in DATABASES),'BACKUP_WATCHDOG_PREEXISTING_ROLE')
  # This process owns these new channels; none is inherited from the parent.
  journal_event(plan,'cleanup-owner-preopened')
  sys.stdout.write('{"kind":"backup-watchdog-ready"}\n');sys.stdout.flush()
  deadline=min(plan['authorization']['expiresAt'],plan['authorization']['notBefore']+plan['timeoutSeconds'],min(a['notBefore']+300 for a in host['connection']['transport'].values()))-120
  require(time.time()<deadline,'BACKUP_WATCHDOG_START_BUDGET_EXHAUSTED')
  message=bytearray();protocol_failure=False
  try:
   while time.time()<deadline:
    ready,_,_=select.select([sys.stdin.buffer],[],[],min(1,max(0,deadline-time.time())))
    if not ready:continue
    chunk=os.read(sys.stdin.buffer.fileno(),256)
    if not chunk:break
    message.extend(chunk)
    if len(message)>256:protocol_failure=True;break
    if b'\n' in message:
     protocol_failure=bytes(message)!=b'finish\n';break
  except BaseException:protocol_failure=True
  journal_failure=False
  try:journal_event(plan,'cleanup-intent')
  except BaseException:journal_failure=True
  # Join exact producer admin backends before final role scan: an in-flight
  # COMMIT cannot materialize a role after this cleanup has reported success.
  quiesce_parent_admin(plan,reference,channels)
  receipt=cleanup(plan,host['objectScope'],authorization,channels,owner_for(reference))
  journal_event(plan,'cleanup-verified')
  require(not journal_failure,'BACKUP_WATCHDOG_AUDIT_FAILURE')
  require(not protocol_failure,'BACKUP_WATCHDOG_PROTOCOL_FAILURE_AFTER_CLEANUP')
  sys.stdout.write(json.dumps(receipt)+'\n');sys.stdout.flush()
 finally:
  failures=[]
  for ch in channels.values():
   try:ch.close()
   except BaseException:failures.append(True)
  require(not failures,'BACKUP_WATCHDOG_CHANNEL_JOIN_UNKNOWN')


class BackupWatchdog:
 def __init__(self,reference):self.reference=reference;self.process=None
 def start(self):
  require(self.process is None,'BACKUP_WATCHDOG_DUPLICATE')
  raw=private(self.reference['path']);require(hashlib.sha256(raw).hexdigest()==self.reference['sha256'],'BACKUP_WATCHDOG_PLAN_PIN')
  host=json.loads(raw);profile=json.loads(private('/etc/workspacex-cn/trusted-tool-binding.json'))
  runtime=host['pythonRuntime'];executable=runtime['path'];helper='/usr/local/lib/workspacex-cn/cn_backup_watchdog.py'
  require(re.fullmatch(r'/usr/bin/python3\.[0-9]+',executable) and hashlib.sha256(private(executable,0o755)).hexdigest()==runtime['sha256'] and profile['backupPythonRuntime']==runtime,'BACKUP_WATCHDOG_RUNTIME_PIN')
  require(profile['backupHostPlan']==self.reference and hashlib.sha256(private(helper,0o700)).hexdigest()==profile['installedFilesSha256'][helper],'BACKUP_WATCHDOG_HELPER_PIN')
  runner='/usr/local/lib/workspacex-cn/cn_backup_run.py'
  require(hashlib.sha256(private(runner,0o700)).hexdigest()==profile['installedFilesSha256'][runner],'BACKUP_WATCHDOG_RUNNER_PIN')
  self.process=subprocess.Popen([executable,'-B',runner,'--backup-watchdog',self.reference['path'],self.reference['sha256']],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,start_new_session=True)
  try:require(self.receive(30)=={'kind':'backup-watchdog-ready'},'BACKUP_WATCHDOG_START_UNKNOWN')
  except BaseException:
   # EOF requests cleanup; never terminate a possibly responsible watchdog.
   self.process.stdin.close();raise
 def receive(self,seconds):
  end=time.monotonic()+seconds;raw=bytearray()
  while b'\n' not in raw:
   require(len(raw)<65536 and time.monotonic()<end,'BACKUP_WATCHDOG_RESPONSE_BOUND')
   ready,_,_=select.select([self.process.stdout],[],[],max(0,end-time.monotonic()));require(ready,'BACKUP_WATCHDOG_RESPONSE_TIMEOUT')
   chunk=os.read(self.process.stdout.fileno(),1);require(chunk,'BACKUP_WATCHDOG_RESPONSE_CLOSED');raw.extend(chunk)
  return json.loads(raw)
 def finish(self):
  require(self.process is not None,'BACKUP_WATCHDOG_NOT_STARTED')
  self.process.stdin.write(b'finish\n');self.process.stdin.flush();self.process.stdin.close()
  receipt=self.receive(90);self.process.wait(timeout=5);require(self.process.returncode==0,'BACKUP_WATCHDOG_EXIT_UNKNOWN')
  self.process.stdout.close();return receipt

if __name__=='__main__':
 try:
  require(os.geteuid()==0 and sys.platform=='linux' and len(sys.argv)==4 and sys.argv[1]=='--backup-watchdog','BACKUP_WATCHDOG_ENTRY')
  serve({'path':sys.argv[2],'sha256':sys.argv[3]})
 except BaseException:sys.stderr.write('BACKUP_WATCHDOG_UNKNOWN\n');sys.exit(1)
