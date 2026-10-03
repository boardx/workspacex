#!/usr/bin/env python3
"""Production recovery orchestration. No CLI path can resume writers or clear hold."""
import hashlib,json,os,pathlib,stat,subprocess,time
DBS=('workspacex','workspacex_agent','workspacex_memory')
PRODUCTION='pgm-uf6rg214cp381l49'
def require(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
class Protected:
 def __init__(self,uid=0):self.uid=uid;self.inputs={};self.large={}
 def read(self,path,expected=None,private=False):
  p=pathlib.Path(path)
  for parent in p.parents:
   s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==self.uid and not s.st_mode&0o022,'PRIVATE_PARENT')
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as f:
   s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==self.uid and s.st_gid==self.uid and s.st_nlink==1 and stat.S_IMODE(s.st_mode) in (0o600,0o700,0o644) and not s.st_mode&0o022,'PRIVATE_FILE')
   require(not private or stat.S_IMODE(s.st_mode)==0o600,'PRIVATE_SECRET_MODE')
   raw=f.read(256*1024*1024+1);require(len(raw)<=256*1024*1024,'INPUT_BOUND')
  identity=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_gid,s.st_nlink)
  require(expected is None or sha(raw)==expected,'ARTIFACT_HASH')
  if str(p) in self.inputs:require(self.inputs[str(p)]==(identity,raw),'INPUT_CHANGED')
  else:self.inputs[str(p)]=(identity,raw)
  return raw
 def bind_large(self,path,expected,size):
  p=pathlib.Path(path)
  for parent in p.parents:
   s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==self.uid and not s.st_mode&0o022,'PRIVATE_PARENT')
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as f:
   s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==self.uid and s.st_gid==self.uid and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size==size,'CIPHERTEXT_TRUST')
   h=hashlib.sha256()
   while True:
    b=f.read(1024*1024)
    if not b:break
    h.update(b)
   require(h.hexdigest()==expected,'CIPHERTEXT_HASH')
  signature=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_gid,s.st_nlink)
  if str(p) in self.large:require(self.large[str(p)]==(signature,expected,size),'INPUT_CHANGED')
  else:self.large[str(p)]=(signature,expected,size)
 def recheck(self):
  for p in tuple(self.inputs):self.read(p)
  for p,(_,h,size) in tuple(self.large.items()):self.bind_large(p,h,size)
class Journal:
 def __init__(self,path,identity):
  self.path=pathlib.Path(path);require(not self.path.exists(),'RECOVERY_REPLAY_REQUIRES_RECONCILIATION')
  s=self.path.parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700,'JOURNAL_PARENT')
  self.value={'schemaVersion':1,'identity':identity,'events':[],'writesHeld':None,'writeState':'fresh-observation-required','ready':False}
 def record(self,state,**facts):
  self.value['events'].append({'state':state,'at':time.time(),**facts})
  tmp=self.path.with_name('.recovery-'+os.urandom(16).hex())
  fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as f:f.write(json.dumps(self.value,sort_keys=True).encode());f.flush();os.fsync(f.fileno())
  os.replace(tmp,self.path);fd=os.open(self.path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
def validate_private_inputs(plan):
 """Validate the entire destructive transport contract before any invocation.
 Hashes bind artifacts, not a claim that backup consistency was established.
 """
 import re
 digest=lambda v:type(v) is str and re.fullmatch('[a-f0-9]{64}',v) is not None
 def reference(v,extra=()):
  require(type(v) is dict and set(v)=={'path','sha256',*extra},'PRIVATE_REFERENCE_SCHEMA')
  require(type(v['path']) is str and pathlib.PurePosixPath(v['path']).is_absolute() and '..' not in pathlib.PurePosixPath(v['path']).parts and '\x00' not in v['path'],'PRIVATE_REFERENCE_PATH')
  require(digest(v['sha256']),'PRIVATE_REFERENCE_DIGEST')
 expected={'schemaVersion','identity','toolRevision','production','authorization','databases','recipientCertificate','recipientKey','rolesSql','credential','fidelityRunner','catalogModule','fidelityModule','caCertificate','productionIdentityProbe','writerTransport','writerPlan','clientImage','clientImageLabels','clientPostgresMajor','networkId','sslmode','spoolBytes','holdGeneration','holdSha256','writerPlanCanonicalSha256'}
 require(type(plan) is dict and set(plan)==expected,'PRIVATE_PLAN_SCHEMA')
 require(type(plan['toolRevision']) is str and re.fullmatch('[a-f0-9]{40}',plan['toolRevision']),'TOOL_REVISION')
 for key in ('recipientCertificate','recipientKey','rolesSql','credential','fidelityRunner','catalogModule','fidelityModule','caCertificate','productionIdentityProbe','writerPlan'):reference(plan[key])
 reference(plan['writerTransport'],('sourcePath',))
 require(type(plan['writerTransport']['sourcePath']) is str and re.fullmatch(r'\.harness/scripts/vm/[A-Za-z0-9_.-]+',plan['writerTransport']['sourcePath']),'WRITER_SOURCE_PATH')
 require(type(plan['production']) is dict and set(plan['production'])=={'instanceId','hostname','regionId','providerBindingSha256','databasePeers','transportPeers'},'PRODUCTION_SCHEMA')
 require(all(type(plan['production'][k]) is str and plan['production'][k] and not any(c.isspace() for c in plan['production'][k]) for k in ('hostname','regionId')) and digest(plan['production']['providerBindingSha256']),'PROVIDER_BINDING')
 require(type(plan['authorization']) is dict and set(plan['authorization'])=={'identity','productionInstanceId','action','notBefore','expiresAt'},'AUTHORIZATION_SCHEMA')
 require(all(type(plan['authorization'][k]) in (int,float) and __import__('math').isfinite(plan['authorization'][k]) for k in ('notBefore','expiresAt')),'AUTHORIZATION_TIME')
 require(type(plan['clientPostgresMajor']) is int and 10<=plan['clientPostgresMajor']<=30,'CLIENT_VERSION_SCHEMA')
 require(type(plan['clientImageLabels']) is dict and all(type(k) is str and type(v) is str for k,v in plan['clientImageLabels'].items()),'CLIENT_LABEL_SCHEMA')
 require(digest(plan['networkId']) and digest(plan['holdSha256']) and digest(plan['writerPlanCanonicalSha256']) and type(plan['holdGeneration']) is str and re.fullmatch('[A-Za-z0-9-]{1,128}',plan['holdGeneration']),'LIVE_HOLD_SCHEMA')
 require(type(plan['databases']) is dict and set(plan['databases'])==set(DBS),'THREE_DATABASE_CLOSURE')
 require(all(type(plan['production'][key]) is dict and set(plan['production'][key])==set(DBS) for key in ('databasePeers','transportPeers')),'PEER_CLOSURE')
 for db,item in plan['databases'].items():
  expected={'database','sourceRdsInstanceId','baselineRevision','recipientCertificateSha256','dumpExitCode','encryptionExitCode','dumpBytes','ciphertext','sourceCatalog','sourceCatalogSha256','backupReceiptSha256','serverVersionNum','completeClusterRoleNames'}
  require(type(item) is dict and set(item)==expected,'DATABASE_PLAN_SCHEMA')
  reference(item['ciphertext'],('bytes',));reference(item['sourceCatalog'])
  require(type(item['ciphertext']['bytes']) is int and item['ciphertext']['bytes']>0,'CMS_CIPHERTEXT_SIZE')
  require(item['sourceCatalog']['sha256']==item['sourceCatalogSha256'] and digest(item['backupReceiptSha256']),'CATALOG_BACKUP_BINDING')
  require(type(item['serverVersionNum']) is int and 100000<=item['serverVersionNum']<310000,'SERVER_VERSION_SCHEMA')
  roles=item['completeClusterRoleNames'];require(type(roles) is list and roles and all(type(r) is str and r and '\x00' not in r for r in roles) and len(set(roles))==len(roles),'COMPLETE_ROLE_SCHEMA')
  require(type(item['dumpExitCode']) is int and type(item['encryptionExitCode']) is int,'BACKUP_EXIT_SCHEMA')
  sql=plan['production']['databasePeers'][db];peer=plan['production']['transportPeers'][db]
  require(type(sql) is dict and set(sql)=={'database','serverAddr','serverPort','systemIdentifier'} and sql['database']==db and type(sql['serverAddr']) is str and sql['serverAddr'] and type(sql['serverPort']) is int and sql['serverPort']==5432 and type(sql['systemIdentifier']) is str and re.fullmatch('[0-9]+',sql['systemIdentifier']),'SQL_PEER_SCHEMA')
  require(type(peer) is dict and set(peer)=={'peerAddressSha256','port'} and digest(peer['peerAddressSha256']) and type(peer['port']) is int and peer['port']==5432,'TRANSPORT_PEER_SCHEMA')
 role_sets={tuple(sorted(v['completeClusterRoleNames'])) for v in plan['databases'].values()}
 require(len(role_sets)==1,'CLUSTER_ROLE_CLOSURE')
def validate(plan,now=None):
 now=time.time() if now is None else now
 validate_private_inputs(plan)
 require(plan['schemaVersion']==1 and plan['production']['instanceId']==PRODUCTION,'PRODUCTION_IDENTITY')
 require(set(plan['databases'])==set(DBS),'THREE_DATABASE_CLOSURE')
 identity=plan['identity'];require(set(identity)=={'sourceRevision','baselineRevision','migrationPlanSha256','attemptId'},'IDENTITY_SCHEMA')
 require(all(isinstance(v,str) and v for v in identity.values()),'IDENTITY_VALUE')
 import re
 require(all(re.fullmatch('[a-f0-9]{40}',identity[k]) for k in ('sourceRevision','baselineRevision')) and re.fullmatch('[a-f0-9]{64}',identity['migrationPlanSha256']) and re.fullmatch('[a-f0-9]{32}',identity['attemptId']),'IDENTITY_FORMAT')
 auth=plan['authorization'];require(auth['identity']==identity and auth['productionInstanceId']==PRODUCTION and auth['action']=='replace-three-production-databases-with-exact-baseline' and auth['notBefore']<=now<auth['expiresAt'] and auth['expiresAt']-auth['notBefore']<=3600,'EXPLICIT_AUTHORIZATION')
 require(re.fullmatch('sha256:[a-f0-9]{64}',plan['clientImage']),'IMMUTABLE_CLIENT')
 require(plan['sslmode']=='verify-full','TLS_REQUIRED')
 require(type(plan['spoolBytes']) is int and 0<plan['spoolBytes']<=16*1024**3,'SPOOL_BOUND')
 require(set(plan['production']['transportPeers'])==set(DBS) and set(plan['production']['databasePeers'])==set(DBS),'PEER_CLOSURE')
 for db,item in plan['databases'].items():
  require(item['database']==db and item['sourceRdsInstanceId']==PRODUCTION and item['baselineRevision']==identity['baselineRevision'],'BACKUP_IDENTITY')
  require(item['recipientCertificateSha256']==plan['recipientCertificate']['sha256'],'RECIPIENT_BINDING')
  require(type(item['dumpBytes']) is int and 0<item['dumpBytes']<plan['spoolBytes'],'ARCHIVE_SIZE')
  require(item['dumpExitCode']==0 and item['encryptionExitCode']==0,'BACKUP_PROCESS_FAILURE')
 return identity
class Executor:
 def __init__(self,plan,protected,transport,journal):self.plan=plan;self.protected=protected;self.transport=transport;self.journal=journal
 def guard(self):
  self.protected.recheck();self.transport.require_lock()
  fact=self.transport.guard(self.plan)
  require(fact['kind']=='maintenance-writers-held' and fact['identity']==self.plan['identity'] and fact['holdGeneration']==self.plan['holdGeneration'] and fact['holdSha256']==self.plan['holdSha256'] and fact['planSha256']==self.plan['writerPlanCanonicalSha256'],'LIVE_GUARD_BINDING')
  require(0<=time.time()-fact['observedAt']<=30 and set(fact['databasePeers'])==set(DBS),'LIVE_GUARD_SCOPE')
  require(fact['databasePeers']==self.plan['production']['databasePeers'],'LIVE_DATABASE_PEERS')
  return fact
 def run(self):
  validate(self.plan);self.transport.capability(self.plan);self.guard()
  try:
   for kind,db in [('restore-roles',None)]+[('restore-database',d) for d in DBS]:
    g=self.guard();self.journal.record('action-intent',action=kind,database=db,guardObservationSha256=g['observationSha256'])
    self.transport.apply(kind,db,self.plan)
    self.protected.recheck();self.transport.require_lock();self.journal.record('action-response',action=kind,database=db)
   results={}
   for db in DBS:
    self.guard();self.journal.record('fidelity-intent',database=db)
    r=self.transport.fidelity(db,self.plan)
    require(r['database']==db and r['targetRdsInstanceId']==PRODUCTION and r['ciphertextSha256']==self.plan['databases'][db]['ciphertext']['sha256'] and r['catalogSha256']==self.plan['databases'][db]['sourceCatalogSha256'] and r['dataFidelityVerified'] is True and r['readOnly'] is True and r['rollbackComplete'] is True,'REAL_FIDELITY_REQUIRED')
    results[db]=r;self.journal.record('fidelity-readback',database=db,resultSha256=sha(json.dumps(r,sort_keys=True).encode()))
   self.guard();self.journal.record('recovery-verified',databases=list(DBS))
   return {'schemaVersion':1,'identity':self.plan['identity'],'productionInstanceId':PRODUCTION,'databases':results,'writesHeld':True,'ready':False}
  except BaseException:
   self.journal.record('recovery-outcome-unknown',holdDisposition='retain');raise
