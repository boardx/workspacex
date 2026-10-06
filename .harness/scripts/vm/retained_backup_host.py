"""Source-owned retained BackupLease host. No import/constructor opens SQL sessions."""
import hashlib,json,os,pathlib,re,secrets,subprocess,threading,time,uuid
import cn_backup_host as original
from cn_backup_host import BackupHost,atomic_metadata,verify_custody,canary,verify_cached_clients
from cn_backup_package import DATABASES,ROLE,IMAGE,compile_role_sql,dump_command,encrypt_command,validate,require,digest
from cn_backup_sql import protected_authorization,dispatch,capture,permission_gaps
from retained_epoch_acquisition import RetainedBackupChannel
from retained_backend_observer import RetainedBackendObserver,SourceOwnedParentObservation
from cn_backup_stream import stream_ciphertext
from host_transport import SAFE_ENV

class SerializedRetainedChannel:
 """One host-wide mutex held over each complete fixed transaction."""
 def __init__(self,host,channel):self.host_owner=host;self.base=channel;self.database=channel.database;self.host=channel.host;self.binding=channel.pinned;self.pinned=channel.pinned;self.channel=channel.channel;self.transaction=False
 def cursor(self):
  from cn_backup_channel import Cursor
  return Cursor(self)
 def request(self,message,deadline_seconds=10):
  h=self.host_owner;begin=message.get('queryId')=='begin-readonly' or message.get('action')=='begin';end=message.get('queryId')=='rollback-readonly' or message.get('action') in ('commit','rollback')
  if begin:
   require(not self.transaction,'RETAINED_HOST_TRANSACTION_ALREADY_OPEN');require(h.mutex.acquire(timeout=min(10,deadline_seconds)),'RETAINED_HOST_TRANSACTION_BUSY');self.transaction=True
  acquired=False
  try:
   require(h.mutex.acquire(timeout=min(10,deadline_seconds)),'RETAINED_HOST_REQUEST_BUSY');acquired=True
   if h.closing:require(message.get('operation')=='query' or message.get('action') in ('close','revoke','begin','commit','rollback'),'RETAINED_HOST_CLOSING_STICKY')
   return self.base.request(message,deadline_seconds=deadline_seconds)
  except BaseException:
   if begin and self.transaction:self.transaction=False;h.mutex.release()
   raise
  finally:
   if acquired:h.mutex.release()
   if end and self.transaction:self.transaction=False;h.mutex.release()
 def verify_backup_transport(self,facts,deadline_seconds=10):
  lock=self.host_owner.mutex;require(lock.acquire(timeout=deadline_seconds),'RETAINED_HOST_TRANSPORT_BUSY')
  try:return self.base.verify_backup_transport(facts,deadline_seconds)
  finally:lock.release()

class RetainedBackupHostObserverAuthority:
 """Concrete source authority, not a callback registry. Actual fixed Docker/proc."""
 def __init__(self,host,database,container_name):self.host=host;self.db=database;self.name=container_name
 def docker(self,args,timeout_seconds):return self.host.fixed_docker(args,timeout_seconds)
 def docker_inventory(self,timeout_seconds=10):return self.host.owned_inventory(timeout_seconds)
 def locate_owned_backend(self,timeout_seconds=10):
  deadline=time.monotonic()+timeout_seconds
  rows=[r for r in self.docker_inventory(timeout_seconds) if r['Name']=='/'+self.name]
  if not rows:return None
  require(len(rows)==1,'RETAINED_HOST_CONTAINER_UNIQUE');row=rows[0]
  if not row['State']['Running']:return None
  left=deadline-time.monotonic();require(left>0,'RETAINED_HOST_LOCATE_DEADLINE')
  top=self.docker(['top',row['Id'],'-eo','pid,comm'],min(timeout_seconds,left)).decode().splitlines()
  pids=[int(line.split()[0]) for line in top[1:] if len(line.split())==2 and line.split()[1]=='pg_dump']
  if not pids:return None
  require(len(pids)==1,'RETAINED_HOST_PGDUMP_UNIQUE')
  reg=json.loads(self.host.read(str(self.host.registry)));require(reg['identity']==self.host.plan['identity'] and reg['owner']==self.host.owner,'RETAINED_HOST_REGISTRY')
  if row['Id'] not in reg['containers']:reg['containers'].append(row['Id']);atomic_metadata(self.host.registry,reg,True)
  return row['Id'],pids[0]
 def verify_backup_context(self,plan,db,cid,pid,app,timeout_seconds=10):
  require(plan==self.host.plan and db==self.db and app=='wsx-backup-'+plan['identity']['attemptId']+'-'+db,'RETAINED_HOST_BACKEND_CONTEXT')
  actual=self.locate_owned_backend(timeout_seconds);require(actual==(cid,pid),'RETAINED_HOST_BACKEND_OWNERSHIP')
 def verified_pg_dump16(self,timeout_seconds=10):return self.host.client_observation
 def verify_backup_peer(self,plan,peer,timeout_seconds=10):require(plan==self.host.plan and peer==self.host.host['databasePeers'][self.db]==self.host.channels[self.db].binding['peer'],'RETAINED_HOST_BACKEND_PEER')

class ParentOwnedDeadlineWatchdog:
 def __init__(self,host):self.host=host;self.stop=threading.Event();self.thread=None;self.failure=None
 def start(self):
  require(self.thread is None,'RETAINED_HOST_WATCHDOG_DUPLICATE')
  def run():
   while not self.stop.wait(min(1,max(.001,self.host.deadline-self.host.clock()))):
    if self.host.clock()>=self.host.deadline:
     self.host.closing=True
     try:self.host.retained_close_revoke()
     except BaseException:self.failure='RETAINED_HOST_WATCHDOG_CLEANUP_UNKNOWN'
     return
  self.thread=threading.Thread(target=run,name='retained-backup-deadline',daemon=True);self.thread.start()
 def finish(self):
  self.stop.set()
  if self.thread:self.thread.join(timeout=30);require(not self.thread.is_alive(),'RETAINED_HOST_WATCHDOG_NOT_JOINED')
  require(self.failure is None,'RETAINED_HOST_WATCHDOG_CLEANUP_UNKNOWN')

class RetainedBackupHost(BackupHost):
 def __init__(self,reference,retained_actor,read=original.private,clock=time.time):
  super().__init__(reference,read=read,channel=None,clock=clock,expected_identity=retained_actor.identity)
  self.actor=retained_actor;self.mutex=threading.RLock();self.closing=False;self.watchdog=None;self.relays=[];self.stream_attempts=0;self.joined_streams=0
  require(retained_actor.identity==self.plan['identity'],'RETAINED_HOST_ACTOR_IDENTITY')
  self.retained=retained_actor.transport.control_connections
  require(set(self.retained)==set(DATABASES),'RETAINED_HOST_CONTROL_CLOSURE')
 def open_channels(self):
  require(not self.channels,'RETAINED_HOST_CHANNELS_ALREADY_OPEN')
  for db in DATABASES:
   channel=self.retained[db];expected=self.actor.plan['controlSessions'][db]
   require(channel.binding==expected and channel.binding['peer']==self.host['databasePeers'][db],'RETAINED_HOST_EXISTING_SESSION')
   channel.bind_retained_backup(self.reference)
   self.channels[db]=SerializedRetainedChannel(self,RetainedBackupChannel(channel,db,self.host,expected,expected_identity=self.expected_identity))
 def close_channels(self):
  # Retained clients belong to maintenance actor; never close/end/reconnect them.
  require(all(not c.transaction for c in self.channels.values()),'RETAINED_HOST_TRANSACTION_NOT_RELEASED');self.channels={}
 def fixed_docker(self,args,timeout_seconds=10):
  require(type(timeout_seconds) in (int,float) and 0<timeout_seconds<=15,'RETAINED_HOST_COMMAND_BUDGET')
  return subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/nonexistent',*args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=timeout_seconds,check=True).stdout
 def owned_inventory(self,timeout_seconds=10):
  deadline=time.monotonic()+timeout_seconds
  ids=self.fixed_docker(['ps','-aq','--no-trunc','--filter','label=wsx.backup.owner='+self.owner],timeout_seconds).decode().split()
  require(len(ids)<=3 and len(set(ids))==len(ids) and all(re.fullmatch('[a-f0-9]{64}',v) for v in ids),'RETAINED_HOST_OWNED_IDS')
  if not ids:return []
  left=deadline-time.monotonic();require(left>0,'RETAINED_HOST_INVENTORY_DEADLINE')
  rows=json.loads(self.fixed_docker(['inspect',*ids],min(timeout_seconds,left)));require(len(rows)==len(ids),'RETAINED_HOST_OWNED_INSPECT')
  for row in rows:require(row['Id'] in ids and row['Config']['Labels'].get('wsx.backup.owner')==self.owner and row['Image']==IMAGE and row['HostConfig']['NetworkMode']=='host' and re.fullmatch('/wsx-backup-[a-f0-9]{32}',row['Name']),'RETAINED_HOST_CONTAINER_SCOPE')
  return rows
 def verify_inputs(self,plan):
  require(plan==self.plan and not self.closing,'RETAINED_HOST_PLAN')
  self.actor.hold();self.actor.assert_blocked(self.actor.observe())
  self.authorization=protected_authorization(plan,expected_identity=self.expected_identity);verify_custody(self);self.certificate_preflight();canary(self);self.client_observation=verify_cached_clients(self)
  self.owner=digest(self.reference)[:32];self.root=pathlib.Path(plan['outputRoot']);self.root.mkdir(mode=0o700,exist_ok=False);self.registry=self.root/'owned-containers.json'
  atomic_metadata(self.registry,{'identity':plan['identity'],'owner':self.owner,'containers':[]})
  self.open_channels();self.scope=self.capture_inputs();self.compiled_sql=compile_role_sql(plan,self.scope,expected_identity=self.expected_identity)
  ref=self.host['pgRestoreCanary'];raw=self.read(ref['path']);require(hashlib.sha256(raw).hexdigest()==ref['sha256'],'RETAINED_HOST_TOC_CANARY_HASH')
  name='wsx-backup-'+uuid.uuid4().hex
  try:
   args=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/nonexistent','run','--rm','--pull=never','--network=host','--name',name,'--label','wsx.backup.owner='+self.owner,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','-i','--entrypoint','pg_restore',IMAGE,'--list']
   toc=subprocess.run(args,input=raw,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=15,check=True).stdout
   require(toc and hashlib.sha256(toc).hexdigest()==ref['tocSha256'],'RETAINED_HOST_TOC_CANARY')
  finally:
   for row in self.owned_inventory():self.fixed_docker(['rm','-f',row['Id']])
  self.watchdog=ParentOwnedDeadlineWatchdog(self);return self.scope
 def create_role_and_grants(self,plan,sql):
  require(plan==self.plan and sql==self.compiled_sql and not self.closing,'RETAINED_HOST_MUTATION')
  self.watchdog.start();dispatch(self.channels[DATABASES[0]],plan,self.scope,self.authorization,'create')
  for db in DATABASES:dispatch(self.channels[db],plan,self.scope,self.authorization,'grant',database=db)
 def export_owned_ciphertext(self,plan,db):
  require(plan==self.plan and db in DATABASES and self.password is not None and not self.closing,'RETAINED_HOST_EXPORT_CONTEXT')
  self.recheck_inputs(plan);self.actor.hold();self.actor.assert_blocked(self.actor.observe())
  name='wsx-backup-'+uuid.uuid4().hex;app='wsx-backup-'+plan['identity']['attemptId']+'-'+db
  authority=RetainedBackupHostObserverAuthority(self,db,name);observer=RetainedBackendObserver(plan,self.channels,authority,expected_identity=self.expected_identity)
  helperhash=self.host.get('dockerClientSha256');require(type(helperhash) is str and re.fullmatch('[a-f0-9]{64}',helperhash),'RETAINED_HOST_DOCKER_CLIENT_PIN_REQUIRED')
  deadline=time.monotonic()+min(330,self.deadline-self.clock());relay=SourceOwnedParentObservation(observer,db,None,None,app,name,self.owner,helperhash,deadline,self.root/(db+'.backend'))
  self.stream_attempts+=1
  result=stream_ciphertext(dump_command(plan,db,name,self.owner,expected_identity=self.expected_identity),encrypt_command(plan,expected_identity=self.expected_identity),(db+'\n'+self.password+'\n'+app+'\n').encode(),str(self.root/(db+'.dump.cms')),relay,timeout_seconds=min(330,self.deadline-self.clock()))
  require(result.get('ownedProcessesJoined') is True,'RETAINED_HOST_STREAM_JOIN');self.joined_streams+=1
  require(relay.proof is not None and relay.receipts,'RETAINED_HOST_ACTUAL_BACKEND_PROOF');self.relays.append(relay)
  proof=relay.proof['backendProof'];return dict(result,database=db,role=ROLE,sourceAddress=proof['facts']['session']['clientAddr'],peerAddress=proof['facts']['peer']['serverAddr'],applicationName=app,recipientCertificateSha256=plan['recipientCertificate']['sha256'],readOnlyEvidence=proof['readOnlyEvidence'])
 def retained_close_revoke(self):
  self.closing=True
  require(self.mutex.acquire(timeout=10),'RETAINED_HOST_CLEANUP_TRANSACTION_BUSY')
  try:
   # Fixed compiled actions through existing channels. Failure cannot open admin.
   for db in DATABASES:
    c=self.channels[db].cursor()
    try:
     c.execute('BEGIN')
     actions=('close','revoke') if db==DATABASES[0] else ('revoke',)
     for action in actions:
      for sql in self.host['statements'][db][action]:c.execute(sql)
     c.execute('COMMIT')
    except BaseException:
     c.execute('ROLLBACK');raise
    finally:c.close()
   self.password=None
  finally:self.mutex.release()
 def cleanup_and_revoke(self,plan,sql):
  require(plan==self.plan and sql==self.compiled_sql,'RETAINED_HOST_CLEANUP_PLAN')
  self.retained_close_revoke()
  for row in self.owned_inventory():self.fixed_docker(['rm','-f',row['Id']])
  require(not self.owned_inventory(),'RETAINED_HOST_OWNED_CONTAINERS_REMAIN')
  for db in DATABASES:
   facts=capture(self.channels[db],db);require(not facts['sessions'] and not permission_gaps(facts,self.scope,phase='closed',allowed_public_temp=self.authorization.allowed_public_temp),'RETAINED_HOST_CLEANUP_READBACK')
  require(self.stream_attempts==self.joined_streams,'RETAINED_HOST_STREAM_JOIN_UNKNOWN')
  key=plan['recipientKey'];require(hashlib.sha256(self.read(key['path'])).hexdigest()==key['sha256'],'RETAINED_HOST_RECIPIENT_KEY_DRIFT')
  if self.watchdog:self.watchdog.finish()
  self.close_channels()
  return dict(ownedProcessesJoined=True,ownedContainersAbsent=True,roleSessionsAbsent=True,noLogin=True,passwordNull=True,noBypassRls=True,exactGrantsRevoked=True,ownedCredentialsAbsent=self.password is None,recipientKeyRetained=True)
