"""Actual protected SQL host consumer; no production work at import.
Protected source consumers remain closed when live permission/recipient inputs fail.
"""
import hashlib,json,secrets,time,subprocess
from cn_backup_package import DATABASES,ROLE,require,validate,digest
from cn_backup_sql import protected_authorization,capture,capture_scope,public_capability_gaps,verify_fresh_permissions,dispatch,permission_gaps
from cn_backup_channel import BackupChannel
from host_transport import private,SAFE_ENV

def freshness_budget(host,now=None,*,expected_identity):
 now=time.time() if now is None else now;p=host['backup'];validate(p,now,expected_identity=expected_identity)
 ts=host['connection']['transport'];require(set(ts)==set(DATABASES),'BACKUP_HOST_TRANSPORT_CLOSURE')
 deadlines=[]
 for t in ts.values():
  require(type(t['notBefore']) in (int,float) and type(t['expiresAt']) in (int,float),'BACKUP_HOST_TRANSPORT_TIME')
  require(t['notBefore']<=now and t['expiresAt']>=p['authorization']['expiresAt']+120,'BACKUP_HOST_TRANSPORT_RESERVE')
  deadlines.append(t['notBefore']+300)
 deadline=min(*deadlines,p['authorization']['expiresAt'],p['authorization']['notBefore']+p['timeoutSeconds'])
 require(deadline-now>120,'BACKUP_HOST_FRESHNESS_RESERVE');return deadline-120

class BackupHost:
 def __init__(self,reference,read=private,channel=BackupChannel,clock=time.time,*,expected_identity=None):
  require(type(reference) is dict and set(reference)=={'path','sha256'},'BACKUP_HOST_REFERENCE')
  self.reference=reference;self.read=read;self.channel_factory=channel;self.clock=clock
  raw=read(reference['path']);require(hashlib.sha256(raw).hexdigest()==reference['sha256'],'BACKUP_HOST_PIN')
  self.host=json.loads(raw);self.plan=self.host['backup']
  expected='/etc/workspacex-cn/maintenance-backup/'+self.plan['identity']['sourceRevision']+'/'+self.plan['identity']['attemptId']+'/host-plan.json'
  require(reference['path']==expected,'BACKUP_HOST_FIXED_PATH')
  profile=json.loads(read('/etc/workspacex-cn/trusted-tool-binding.json'))
  require(profile['backupHostPlan']==reference and profile['toolRevision']==self.plan['toolRevision'],'BACKUP_HOST_PROFILE')
  self.expected_identity=dict(self.host['identity'])
  require(expected_identity is None or expected_identity==self.expected_identity,'BACKUP_HOST_EXPECTED_IDENTITY')
  validate(self.plan,expected_identity=self.expected_identity)
  self.deadline=freshness_budget(self.host,clock(),expected_identity=self.expected_identity);self.channels={};self.password=None;self.authorization=None;self.scope=None
 def require_lock(self,identity):
  require(identity==self.plan['identity'],'BACKUP_HOST_IDENTITY')
  from cn_maintenance_hold import require_canonical_lock
  require_canonical_lock()
 def open_channels(self):
  require(not self.channels,'BACKUP_HOST_CHANNELS_ALREADY_OPEN')
  try:
   for db in DATABASES:
    ch=self.channel_factory(self.reference,db,expected_identity=self.expected_identity);self.channels[db]=ch
    require(ch.binding['peer']==self.host['databasePeers'][db] and ch.binding['role']=='migration_admin','BACKUP_HOST_ACTUAL_PEER')
   require(self.clock()<self.deadline,'BACKUP_HOST_CHANNEL_START_BUDGET')
  except BaseException:self.close_channels();raise
 def certificate_preflight(self):
  for key in ('recipientCertificate','recipientKey'):
   s=self.plan[key];require(hashlib.sha256(self.read(s['path'])).hexdigest()==s['sha256'],'BACKUP_HOST_RECIPIENT_PIN')
  r=subprocess.run(['/usr/bin/openssl','x509','-in',self.plan['recipientCertificate']['path'],'-checkend',str(int(max(self.plan['timeoutSeconds']+120,self.custody['retentionExpiresAt']-self.clock()+1))),'-noout'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=10)
  require(r.returncode==0,'BACKUP_HOST_CERTIFICATE_EXPIRED')
 def capture_inputs(self):
  require(set(self.channels)==set(DATABASES),'BACKUP_HOST_CHANNEL_CLOSURE')
  facts={db:capture(self.channels[db],db) for db in DATABASES};scope=capture_scope(facts)
  require(digest(scope)==self.plan['objectScopeSha256'],'BACKUP_HOST_SCOPE_DRIFT')
  for f in facts.values():require(not public_capability_gaps(f,self.authorization),'BACKUP_HOST_PUBLIC_CAPABILITY_GAP')
  self.scope=scope;return scope
 def role_absent(self,role):
  require(role==ROLE and set(self.channels)==set(DATABASES),'BACKUP_HOST_ROLE_SCOPE')
  return all(not capture(self.channels[db],db)['role'] for db in DATABASES)
 def verify_effective_permissions(self,plan,scope):return verify_fresh_permissions(self.authorization,plan,scope,self.channels)
 def open_private_credential(self,plan):
  require(self.password is None and self.clock()<self.deadline,'BACKUP_HOST_CREDENTIAL_ADMISSION')
  self.password=secrets.token_urlsafe(48)
  dispatch(self.channels[DATABASES[0]],plan,self.scope,self.authorization,'login',password=self.password)
 def close_and_revoke_sql(self):
  require(self.authorization is not None and self.scope is not None and set(self.channels)==set(DATABASES),'BACKUP_HOST_CLEANUP_CONTEXT')
  dispatch(self.channels[DATABASES[0]],self.plan,self.scope,self.authorization,'close')
  require(all(not capture(self.channels[db],db)['sessions'] for db in DATABASES),'BACKUP_HOST_ROLE_SESSIONS_REMAIN')
  for db in DATABASES:dispatch(self.channels[db],self.plan,self.scope,self.authorization,'revoke',database=db)
  for db in DATABASES:require(not permission_gaps(capture(self.channels[db],db),self.scope,phase='closed',allowed_public_temp=self.authorization.allowed_public_temp),'BACKUP_HOST_REVOKE_READBACK')
  self.password=None
 def close_channels(self):
  failures=[]
  for ch in self.channels.values():
   try:ch.close()
   except BaseException:failures.append(True)
  self.channels={};require(not failures,'BACKUP_HOST_CHANNEL_CLOSE_FAILED')

# Files below contain ownership/evidence only; never credentials/plaintext.
import os,pathlib,stat,uuid,re,math
from cn_backup_package import IMAGE,compile_role_sql,dump_command,encrypt_command
from cn_backup_backend import BackupBackendCollector
from cn_backup_stream import stream_ciphertext

def atomic_metadata(path,value,replace=False):
 path=pathlib.Path(path);raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()
 require(len(raw)<=1048576,'BACKUP_HOST_METADATA_BOUND')
 s=path.parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o077,'BACKUP_HOST_METADATA_PARENT')
 tmp=path.parent/('.'+path.name+'.'+uuid.uuid4().hex)
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  if replace:os.replace(tmp,path)
  else:os.link(tmp,path);os.unlink(tmp)
  d=os.open(path.parent,os.O_DIRECTORY);os.fsync(d);os.close(d)
 finally:
  if tmp.exists():tmp.unlink()

def fixed_docker(self,args):
 return subprocess.run(['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/nonexistent',*args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=15,check=True).stdout

def docker_inventory(self):
 ids=fixed_docker(self,['ps','-aq','--no-trunc','--filter','label=wsx.backup.owner='+self.owner]).decode().split()
 require(len(ids)<=3 and len(set(ids))==len(ids) and all(re.fullmatch('[a-f0-9]{64}',x) for x in ids),'BACKUP_HOST_DOCKER_IDS')
 if not ids:return []
 rows=json.loads(fixed_docker(self,['inspect',*ids]));require(len(rows)==len(ids),'BACKUP_HOST_DOCKER_INSPECT')
 for r in rows:require(r['Id'] in ids and r['Config']['Labels']['wsx.backup.owner']==self.owner and r['Image']==IMAGE and r['HostConfig']['NetworkMode']=='host' and re.fullmatch('/wsx-backup-[a-f0-9]{32}',r['Name']),'BACKUP_HOST_DOCKER_OWNERSHIP')
 return rows

def canary(self):
 plain=b'WorkSpaceX protected backup CMS canary schemaVersion=1\n'
 cert=self.plan['recipientCertificate']['path'];key=self.plan['recipientKey']['path']
 enc=subprocess.run(encrypt_command(self.plan,expected_identity=self.expected_identity),input=plain,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=10,check=True).stdout
 dec=subprocess.run(['/usr/bin/openssl','cms','-decrypt','-binary','-inform','DER','-recip',cert,'-inkey',key],input=enc,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=10,check=True).stdout
 require(dec==plain and hashlib.sha256(dec).digest()==hashlib.sha256(plain).digest(),'BACKUP_HOST_CMS_CANARY')
 return {'plaintextSha256':hashlib.sha256(plain).hexdigest(),'ciphertextSha256':hashlib.sha256(enc).hexdigest()}

def verify_inputs(self,plan):
 require(plan==self.plan,'BACKUP_HOST_PLAN_DRIFT')
 self.authorization=protected_authorization(plan,expected_identity=self.expected_identity);verify_custody(self);self.certificate_preflight();canary(self)
 self.client_observation=verify_cached_clients(self)
 self.owner=hashlib.sha256(self.reference['sha256'].encode()).hexdigest()[:32];self.root=pathlib.Path(plan['outputRoot'])
 # No mkdir parents: installed root-private hierarchy is a required input.
 self.root.mkdir(mode=0o700,exist_ok=False)
 self.registry=self.root/'owned-containers.json'
 atomic_metadata(self.registry,{'identity':plan['identity'],'owner':self.owner,'containers':[]})
 require(all(t['configurationSha256']==plan['configurationSha256'] for t in self.host['connection']['transport'].values()),'BACKUP_HOST_CONFIGURATION_PIN')
 self.open_channels();self.scope=self.capture_inputs()
 require(all(callable(getattr(c,'verify_backup_transport',None)) for c in self.channels.values()),'BACKUP_HOST_BACKUP_ROLE_TRANSPORT_CONSUMER_REQUIRED')
 pinned=self.host.get('pgDump16')
 require(type(pinned) is dict and set(pinned)=={'imageId','versionMajor','sha256','exePath'} and pinned['imageId']==IMAGE and pinned['versionMajor']==16 and len(pinned['sha256'])==64,'BACKUP_HOST_PGDUMP_INPUT_REQUIRED')
 # Real archive/TOC capability remains distinct from CMS synthetic roundtrip.
 require('pgRestoreCanary' in self.host,'BACKUP_HOST_PGRESTORE_CANARY_INPUT_REQUIRED')
 ref=self.host['pgRestoreCanary'];archive=self.read(ref['path'])
 require(hashlib.sha256(archive).hexdigest()==ref['sha256'],'BACKUP_HOST_PGRESTORE_CANARY_PIN')
 args=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/nonexistent','run','--rm','--pull=never','--network=host','--name','wsx-backup-'+uuid.uuid4().hex,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--label','wsx.backup.owner='+self.owner,'-i','--entrypoint','pg_restore',IMAGE,'--list']
 try:
  toc=subprocess.run(args,input=archive,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,timeout=15,check=True).stdout
 finally:
  # Failed Docker client can leave its exact owned container alive.
  for row in docker_inventory(self):fixed_docker(self,['rm','-f',row['Id']])
 require(toc and hashlib.sha256(toc).hexdigest()==ref['tocSha256'],'BACKUP_HOST_PGRESTORE_CANARY_TOC')
 from cn_backup_watchdog import BackupWatchdog
 self.watchdog=BackupWatchdog(self.reference);self.compiled_sql=compile_role_sql(plan,self.scope,expected_identity=self.expected_identity);return self.scope

def recheck_inputs(self,plan,objects=None):
 require(plan==self.plan and self.clock()<self.deadline,'BACKUP_HOST_EXPORT_BUDGET')
 verify_custody(self);self.certificate_preflight();expected=self.scope
 require(objects is None or objects==expected,'BACKUP_HOST_SCOPE_INPUT_DRIFT')
 require(self.capture_inputs()==expected,'BACKUP_HOST_SCOPE_DRIFT')

def export_owned_ciphertext(self,plan,db):
 require(plan==self.plan and db in DATABASES and self.password is not None,'BACKUP_HOST_EXPORT_CONTEXT')
 recheck_inputs(self,plan);name='wsx-backup-'+uuid.uuid4().hex
 proofpath=self.root/(db+'.backend.json');app='wsx-backup-'+plan['identity']['attemptId']+'-'+db
 inherited=list(self.channels.values())
 def observe(_producer_pid):
  # Never issue requests or close subprocess objects inherited across fork.
  for ch in inherited:
   for pipe in (ch.process.stdin,ch.process.stdout):
    if pipe:
     try:os.close(pipe.fileno())
     except OSError:pass
  def spawn(*args,**kwargs):kwargs['start_new_session']=False;return subprocess.Popen(*args,**kwargs)
  ch=BackupChannel(self.reference,db,spawn=spawn)
  try:
   rows=docker_inventory(self);matches=[r for r in rows if r['Name']=='/'+name]
   if not matches:return None
   require(len(matches)==1,'BACKUP_HOST_CONTAINER_UNIQUE');cid=matches[0]['Id']
   # Publish exact ID even before pg_dump appears, so watchdog owns cleanup.
   old=json.loads(self.read(str(self.registry)));require(old['identity']==plan['identity'] and old['owner']==self.owner,'BACKUP_HOST_REGISTRY_IDENTITY')
   if cid not in old['containers']:old['containers'].append(cid);atomic_metadata(self.registry,old,True)
   top=fixed_docker(self,['top',cid,'-eo','pid,comm']).decode().splitlines()
   pids=[int(line.split()[0]) for line in top[1:] if len(line.split())==2 and line.split()[1]=='pg_dump']
   if not pids:return None
   require(len(pids)==1,'BACKUP_HOST_PGDUMP_PID_UNIQUE')
   source=ObserverSource(self,ch,db,name,cid)
   proof=BackupBackendCollector(source).collect(plan,db,cid,pids[0],app,expected_identity=self.expected_identity)
   atomic_metadata(proofpath,proof,replace=proofpath.exists());return True
  finally:ch.close()
 result=stream_ciphertext(dump_command(plan,db,name,self.owner,expected_identity=self.expected_identity),encrypt_command(plan,expected_identity=self.expected_identity),(db+'\n'+self.password+'\n'+app+'\n').encode(),str(self.root/(db+'.dump.cms')),observe,timeout_seconds=min(330,self.deadline-self.clock()))
 proof=json.loads(self.read(str(proofpath)))
 require(proof['identity']==plan['identity'] and proof['kind']=='live-owned-pgdump-backend' and digest(proof['facts'])==proof['evidenceSha256'] and proof['facts']['applicationName']==app,'BACKUP_HOST_BACKEND_RECEIPT')
 return dict(result,database=db,role=ROLE,sourceAddress=proof['facts']['session']['clientAddr'],peerAddress=proof['facts']['peer']['serverAddr'],applicationName=app,recipientCertificateSha256=plan['recipientCertificate']['sha256'],readOnlyEvidence=proof['readOnlyEvidence'])

class ObserverSource:
 def __init__(self,host,channel,db,name,cid):self.host=host;self.channel=channel;self.db=db;self.name=name;self.cid=cid
 def verify_backup_context(self,plan,db,cid,pid,app):
  require(plan==self.host.plan and db==self.db and cid==self.cid and app=='wsx-backup-'+plan['identity']['attemptId']+'-'+db,'BACKUP_HOST_OBSERVER_CONTEXT')
  rows=self.docker_inventory();require(any(r['Id']==cid and r['Name']=='/'+self.name for r in rows),'BACKUP_HOST_OBSERVER_OWNER')
 def verified_pg_dump16(self):return self.host.host['pgDump16']
 def docker_inventory(self):return docker_inventory(self.host)
 def read_backup_database_sessions(self,db):
  require(db==self.db,'BACKUP_HOST_OBSERVER_DATABASE');r=self.channel.request({'operation':'query','queryId':'backup-sessions'})
  require(len(r['rows'])==1 and len(r['fields'])==1,'BACKUP_HOST_OBSERVER_SQL_SHAPE')
  return r['rows'][0][r['fields'][0]]
 def verify_backup_peer(self,plan,peer):require(peer==self.channel.binding['peer']==self.host.host['databasePeers'][self.db],'BACKUP_HOST_OBSERVER_ACTUAL_PEER')
 def verify_existing_no_tls_exception(self,plan,facts):return self.channel.verify_backup_transport(facts) is True

def create_role_and_grants(self,plan,sql):
 require(plan==self.plan and sql==compile_role_sql(plan,self.scope,expected_identity=self.expected_identity) and self.clock()<self.deadline,'BACKUP_HOST_MUTATION_ADMISSION')
 atomic_metadata(self.root/'parent-admin-sessions.json',{'identity':plan['identity'],'owner':self.owner,'sessions':{db:self.channels[db].binding for db in DATABASES}})
 self.watchdog.start()
 require(self.clock()<self.deadline and self.watchdog.process.poll() is None,'BACKUP_HOST_WATCHDOG_BUDGET_EXHAUSTED')
 dispatch(self.channels[DATABASES[0]],plan,self.scope,self.authorization,'create')
 for db in DATABASES:dispatch(self.channels[db],plan,self.scope,self.authorization,'grant',database=db)

def cleanup_and_revoke(self,plan,sql):
 require(plan==self.plan and sql==self.compiled_sql,'BACKUP_HOST_CLEANUP_PLAN')
 dispatch(self.channels[DATABASES[0]],plan,self.scope,self.authorization,'close')
 reg=json.loads(self.read(str(self.registry)));require(reg['identity']==plan['identity'] and reg['owner']==self.owner,'BACKUP_HOST_CLEANUP_REGISTRY')
 # Reconcile generated owner label for a launch that died before ID publication.
 rows=docker_inventory(self)
 for row in rows:fixed_docker(self,['rm','-f',row['Id']])
 require(not docker_inventory(self),'BACKUP_HOST_CONTAINERS_REMAIN')
 self.close_and_revoke_sql()
 if getattr(self,'watchdog',None):self.watchdog.finish()
 key=plan['recipientKey'];require(hashlib.sha256(self.read(key['path'])).hexdigest()==key['sha256'],'BACKUP_HOST_RECIPIENT_KEY_DRIFT')
 self.close_channels()
 return dict(ownedProcessesJoined=True,ownedContainersAbsent=True,roleSessionsAbsent=True,noLogin=True,passwordNull=True,noBypassRls=True,exactGrantsRevoked=True,ownedCredentialsAbsent=self.password is None,recipientKeyRetained=True)

BackupHost.verify_inputs=verify_inputs
BackupHost.recheck_inputs=recheck_inputs
BackupHost.export_owned_ciphertext=export_owned_ciphertext
BackupHost.create_role_and_grants=create_role_and_grants
BackupHost.cleanup_and_revoke=cleanup_and_revoke

_verified_inputs=verify_inputs
def verify_inputs(self,plan):
 try:return _verified_inputs(self,plan)
 except BaseException:
  self.close_channels()
  raise
BackupHost.verify_inputs=verify_inputs


def verify_custody(self):
 base='/etc/workspacex-cn/backup-approvals/'+self.plan['identity']['attemptId']+'/'
 approval=self.host.get('custodyApproval')
 require(type(approval) is dict and set(approval)=={'path','sha256'} and approval['path']==base+'custody.json','BACKUP_HOST_CUSTODY_APPROVAL_REQUIRED')
 raw=self.read(approval['path']);require(hashlib.sha256(raw).hexdigest()==approval['sha256'],'BACKUP_HOST_CUSTODY_APPROVAL_PIN')
 value=json.loads(raw)
 keys={'schemaVersion','identity','action','recipientKeySha256','retentionExpiresAt','custodian','escrowReceiptSha256','recoveryProcedureSha256'}
 require(type(value) is dict and set(value)==keys and type(value['schemaVersion']) is int and value['schemaVersion']==1 and value['identity']==self.plan['identity'] and value['action']=='retain-backup-recipient-key','BACKUP_HOST_CUSTODY_APPROVAL_SCOPE')
 require(value['recipientKeySha256']==self.plan['recipientKey']['sha256'] and type(value['retentionExpiresAt']) in (int,float) and math.isfinite(value['retentionExpiresAt']) and self.clock()<value['retentionExpiresAt'] and value['retentionExpiresAt']>=self.plan['authorization']['expiresAt'] and type(value['custodian']) is str and 0<len(value['custodian'])<=256,'BACKUP_HOST_CUSTODY_KEY_RETENTION')
 artifacts={}
 for name,filename,hashkey in (('escrowReceipt','escrow-receipt.json','escrowReceiptSha256'),('recoveryProcedure','recovery-procedure.txt','recoveryProcedureSha256')):
  ref=self.host.get(name)
  require(type(ref) is dict and set(ref)=={'path','sha256'} and ref['path']==base+filename and re.fullmatch('[a-f0-9]{64}',ref['sha256']) and ref['sha256']==value[hashkey],'BACKUP_HOST_CUSTODY_ARTIFACT_REFERENCE')
  content=self.read(ref['path']);require(0<len(content)<=1048576 and hashlib.sha256(content).hexdigest()==ref['sha256'],'BACKUP_HOST_CUSTODY_ARTIFACT_PIN');artifacts[name]=content
 escrow=json.loads(artifacts['escrowReceipt'])
 require(type(escrow) is dict and set(escrow)=={'schemaVersion','kind','identity','recipientKeySha256','custodian','retentionExpiresAt','custodyReceiptId'} and type(escrow['schemaVersion']) is int and escrow['schemaVersion']==1 and escrow['kind']=='backup-key-escrow-receipt' and escrow['identity']==value['identity'] and escrow['recipientKeySha256']==value['recipientKeySha256'] and escrow['custodian']==value['custodian'] and escrow['retentionExpiresAt']==value['retentionExpiresAt'] and type(escrow['custodyReceiptId']) is str and 0<len(escrow['custodyReceiptId'])<=256,'BACKUP_HOST_ESCROW_RECEIPT_SCOPE')
 self.custody=value;return value


def verify_cached_clients(self):
 pinned=self.host.get('pgDump16')
 require(type(pinned) is dict and set(pinned)=={'imageId','versionMajor','sha256','exePath'} and pinned['imageId']==IMAGE and pinned['versionMajor']==16 and re.fullmatch('[a-f0-9]{64}',pinned['sha256']) and type(pinned['exePath']) is str and pinned['exePath'].startswith('/') and '..' not in pathlib.Path(pinned['exePath']).parts,'BACKUP_HOST_PGDUMP_INPUT_REQUIRED')
 # Only cached image, isolated network, constant program: no SQL/DB endpoint.
 nonce=uuid.uuid4().hex;name='wsx-backup-probe-'+nonce;label='wsx.backup.probe='+nonce
 script='set -eu; pg_dump --version; pg_restore --version; p=$(readlink -f "$(command -v pg_dump)"); printf "%s\\n" "$p"; sha256sum "$p"'
 args=['run','--rm','--pull=never','--network=none','--name',name,'--label',label,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=128m','--pids-limit=32','--entrypoint','/bin/sh',IMAGE,'-c',script]
 try:
  out=fixed_docker(self,args).decode('utf-8').splitlines()
  require(len(out)==4 and re.fullmatch(r'pg_dump \(PostgreSQL\) 16\.[0-9]+(?: .*)?',out[0]) and re.fullmatch(r'pg_restore \(PostgreSQL\) 16\.[0-9]+(?: .*)?',out[1]),'BACKUP_HOST_ACTUAL_PG16_VERSION')
  require(out[2]==pinned['exePath'] and out[3]==pinned['sha256']+'  '+pinned['exePath'],'BACKUP_HOST_ACTUAL_PGDUMP_HASH')
  return dict(pinned,pgDumpVersion=out[0],pgRestoreVersion=out[1])
 finally:
  # A timed out docker client can leave its own probe alive. Inspect exact
  # nonce-labelled ID before stop; no name-based or image-wide cleanup.
  ids=fixed_docker(self,['ps','-aq','--no-trunc','--filter','label='+label]).decode().split()
  require(len(ids)<=1 and all(re.fullmatch('[a-f0-9]{64}',cid) for cid in ids),'BACKUP_HOST_PROBE_IDS')
  for cid in ids:
   rows=json.loads(fixed_docker(self,['inspect',cid]));require(len(rows)==1,'BACKUP_HOST_PROBE_INSPECT')
   row=rows[0]
   require(row['Id']==cid and row['Image']==IMAGE and row['Name']=='/'+name and row['Config']['Labels'].get('wsx.backup.probe')==nonce and row['HostConfig']['NetworkMode']=='none','BACKUP_HOST_PROBE_OWNERSHIP')
   fixed_docker(self,['rm','-f',cid])
