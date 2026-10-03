#!/usr/bin/env python3
"""Real host command transport; no command runs at import. Explicit reviewed entry only."""
import os,json,stat,pathlib,hashlib,subprocess,signal,time,re
from writer_fence import require,DATABASES,digest,validate_admission_plan
SAFE_ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/nonexistent','LC_ALL':'C'}
DB_SQL="""BEGIN TRANSACTION READ ONLY; SELECT json_build_object('peer',json_build_object('database',current_database(),'serverAddr',inet_server_addr()::text,'serverPort',inet_server_port(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())), 'sessions',coalesce((SELECT json_agg(json_build_object('role',usename,'clientAddr',client_addr::text,'pid',pid,'backendStart',backend_start,'xactStart',xact_start,'backendType',backend_type,'applicationName',application_name,'state',state,'ssl',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_stat_activity.pid))) FROM pg_stat_activity WHERE datname=current_database()),'[]'::json), 'preparedTransactions',coalesce((SELECT json_agg(json_build_object('gid',gid,'owner',owner,'database',database)) FROM pg_prepared_xacts WHERE database=current_database()),'[]'::json)); ROLLBACK;"""
def private(path,mode=0o600):
 p=pathlib.Path(path);require(p.is_absolute() and '..' not in p.parts,'TRUSTED_PATH')
 for d in p.parents:
  s=d.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'TRUSTED_PARENT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==mode,'TRUSTED_FILE');return f.read()
def proc_binding(pid):
 require(type(pid) is int and pid>1,'PROCESS_PID')
 p=pathlib.Path('/proc')/str(pid);raw=(p/'stat').read_text();tail=raw[raw.rfind(')')+2:].split();exe=os.readlink(p/'exe');require(exe.startswith('/') and not exe.endswith(' (deleted)'),'PROCESS_EXE')
 return {'kind':'process','uid':p.stat().st_uid,'pid':pid,'startTicks':int(tail[19]),'processGroup':int(tail[2]),'exe':exe,'exeSha256':hashlib.sha256(pathlib.Path(exe).read_bytes()).hexdigest(),'cgroup':(p/'cgroup').read_text().strip(),'state':tail[0]}
def aggregate_run_drain(rows):
 require(type(rows) is list,'DRAIN_ROWS');counts={'queued':0,'running':0,'writebackPending':0};seen=set()
 terminal={'succeeded','failed','cancelled'};states=terminal|{'queued','running','writeback_pending','paused','awaiting_tool_permission'}
 for row in rows:
  require(type(row) is dict and set(row)=={'status','count'} and row['status'] in states and row['status'] not in seen and type(row['count']) is str and re.fullmatch('[0-9]+',row['count']),'DRAIN_STATUS')
  seen.add(row['status']);n=int(row['count']);require(n<=9007199254740991,'DRAIN_COUNT')
  if row['status'] in terminal:continue
  key='queued' if row['status']=='queued' else 'writebackPending' if row['status']=='writeback_pending' else 'running';counts[key]+=n;require(counts[key]<=9007199254740991,'DRAIN_COUNT')
 return counts

class HostTransport:
 def __init__(self,plan,manifest_sha,authorization):
  require(os.geteuid()==0 and authorization=='apply-reviewed-all-writer-fence','EXPLICIT_PRODUCTION_ACTION_REQUIRED')
  validate_admission_plan(plan)
  self.plan=plan;self.manifest_sha=manifest_sha
 def database_json(self,db,sql):
  from fixed_probes import ROLE_SQL
  require(db in DATABASES and db in getattr(self,'diagnostic_connections',{}),'PERSISTENT_DIAGNOSTIC_CONNECTION_REQUIRED')
  require(sql in (ROLE_SQL,DB_SQL),'DIAGNOSTIC_FIXED_QUERY_REQUIRED')
  return self.diagnostic_connections[db].query('roles' if sql==ROLE_SQL else 'sessions')
 def openBoth(self):
  from control_connection import PersistentControlConnection
  require(self.plan.get('runtimeSessionBootstrapAuthorized') is True,'RUNTIME_SESSION_BOOTSTRAP_NOT_AUTHORIZED');self.require_lock()
  require(not getattr(self,'control_connections',{}) and not getattr(self,'diagnostic_connections',{}),'CONNECTIONS_ALREADY_OPEN')
  self.control_connections={};self.diagnostic_connections={};base=digest(self.plan)
  try:
   for db in DATABASES:
    self.control_connections[db]=PersistentControlConnection(self.plan,db,bootstrap=True)
    self.diagnostic_connections[db]=PersistentControlConnection(self.plan,db,mode='diagnostic',bootstrap=True)
   return {'sourcePlanSha256':base,'identity':self.plan['identity'],'controlSessions':{db:c.binding for db,c in self.control_connections.items()},'diagnosticSessions':{db:c.binding for db,c in self.diagnostic_connections.items()},'ready':False}
  except BaseException:self.close_control_connections();raise
 def bindRuntimeSessions(self,proof):
  require(proof['sourcePlanSha256']==digest(self.plan) and proof['identity']==self.plan['identity'],'RUNTIME_SOURCE_PLAN_BINDING')
  require(proof['controlSessions']=={db:c.binding for db,c in self.control_connections.items()} and proof['diagnosticSessions']=={db:c.binding for db,c in self.diagnostic_connections.items()},'RUNTIME_ACTUAL_SESSION_BINDING')
  import copy
  bound=copy.deepcopy(self.plan);bound['runtimeSourcePlanSha256']=proof['sourcePlanSha256'];bound['controlSessions']=proof['controlSessions'];bound['diagnosticSessions']=proof['diagnosticSessions']
  addresses={b['clientAddr'] for b in proof['diagnosticSessions'].values()};require(len(addresses)==1,'DIAGNOSTIC_CLIENT_ADDRESS_CLOSURE');bound['diagnosticClientAddress']=next(iter(addresses))
  helpers=[]
  for connection in [*self.control_connections.values(),*self.diagnostic_connections.values()]:
   value=proc_binding(connection.process.pid);value.pop('state');value['parentPid']=os.getpid();require(value['uid']==0 and value['exeSha256']==bound['controlRuntime']['nodeSha256'],'RUNTIME_HELPER_PROCESS_IDENTITY');helpers.append(value)
  bound['runtimeHelperProcesses']=helpers
  if bound.get('holdGenerationPolicy')=='bind-held-at-runtime':
   held=self.read_hold();require(not hasattr(self,'startup_hold') or held==self.startup_hold,'RUNTIME_HOLD_GENERATION_DRIFT');require(held['state']=='held' and held['identity']==bound['identity'] and isinstance(held['generation'],str) and re.fullmatch('[a-f0-9]{32}',held['generation']),'RUNTIME_HELD_IDENTITY');bound['holdGeneration']=held['generation']
  self.plan=bound;return copy.deepcopy(bound)
 def database_execute(self,db,sql,control=False):
  require(control is True,'DATABASE_WRITE_CONTROL_REQUIRED');self.require_lock()
  require(db in getattr(self,'control_connections',{}),'PERSISTENT_CONTROL_CONNECTION_REQUIRED')
  return self.control_connections[db].execute(sql)
 def open_control_connections(self):
  from control_connection import PersistentControlConnection
  require(not getattr(self,'control_connections',{}),'CONTROL_ALREADY_OPEN');self.control_connections={}
  try:
   for db in DATABASES:self.control_connections[db]=PersistentControlConnection(self.plan,db)
  except BaseException:self.close_control_connections();raise
 def close_control_connections(self):
  for connection in [*getattr(self,'control_connections',{}).values(),*getattr(self,'diagnostic_connections',{}).values()]:connection.close()
  self.control_connections={};self.diagnostic_connections={}
 def run(self,args,env=None,input_raw=None):
  result=subprocess.run(args,env=env or SAFE_ENV,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,check=True,input=input_raw,pass_fds=(9,));return result.stdout
 def require_lock(self):
  lock='/var/lib/workspacex-cn/runtime/release.lock'
  for parent in pathlib.Path(lock).parents:
   st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'LOCK_PARENT_TRUST')
  fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
  try:
   import fcntl
   s=os.fstat(9);n=os.fstat(fd);require((s.st_dev,s.st_ino)==(n.st_dev,n.st_ino) and n.st_uid==0 and n.st_gid==0 and stat.S_ISREG(n.st_mode) and not n.st_mode&0o022,'CANONICAL_LOCK')
   try:fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:raise RuntimeError('FOREIGN_LOCK_OWNER')
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:pass
   else:raise RuntimeError('LOCK_NOT_HELD')
  finally:os.close(fd)
 def read_hold(self):
  from fixed_probes import FixedProbes
  return FixedProbes(self).hold()
 def read_acceptance(self,identity):
  from fixed_probes import FixedProbes
  require(identity==self.plan['identity'],'ACCEPTANCE_REQUEST_IDENTITY');return FixedProbes(self).acceptance()
 def bound_probe(self,key,observation=None):
  probe=self.plan[key];raw=private(probe['path'],0o700);require(hashlib.sha256(raw).hexdigest()==probe['sha256'],'PROBE_HASH')
  # Only reviewed root-private executables; no shell, arbitrary arguments or commands.
  args=[probe['path'],'--read-only',self.plan['identity']['attemptId']]
  if observation is not None:args += ['--observation-sha256',digest(observation)]
  value=json.loads(self.run(args,input_raw=None if observation is None else json.dumps(observation,sort_keys=True).encode()))
  if observation is not None:require(value['observationSha256']==digest(observation),'PROBE_OBSERVATION_BINDING')
  require(value['identity']==self.plan['identity'],'PROBE_IDENTITY');return value
 def docker_inventory(self):
  ids=self.run(['/usr/bin/docker','ps','--all','--no-trunc','--quiet']).decode().split()
  require(all(re.fullmatch('[a-f0-9]{64}',i) for i in ids),'DOCKER_IDS')
  return json.loads(self.run(['/usr/bin/docker','inspect',*ids])) if ids else []
 def observe(self,plan):
  require(plan==self.plan,'HOST_PLAN_DRIFT');self.require_lock()
  # These immutable exact-host records must be collected by the approved probe, not supplied as flags.
  from fixed_probes import FixedProbes,classify_processes,classify_sessions
  fixed=FixedProbes(self)
  host={'instanceId':fixed.instance()['instanceId'],'bootId':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()};require(host==plan['host'],'HOST_IDENTITY')
  containers=self.docker_inventory();byid={x['Id']:x for x in containers};known={b['binding']['containerId'] for b in plan['writers'] if b['binding']['kind']=='container'}
  reviewed={x['containerId']:x for x in plan.get('reviewedNonWriterContainers',[])}
  require(len(reviewed)==len(plan.get('reviewedNonWriterContainers',[])),'REVIEWED_CONTAINER_DUPLICATE')
  unknown=[]
  for container in containers:
   if container['Id'] in known:continue
   binding=reviewed.get(container['Id'])
   if binding is None or binding['imageId']!=container['Image'] or binding['configSha256']!=digest(container['Config']):unknown.append(container['Id'])
  writers={};expectedpids=set()
  for writer in plan['writers']:
   b=writer['binding']
   if b['kind']=='container':
    c=byid.get(b['containerId']);require(c is not None and c['Image']==b['imageId'] and c['Config']['Labels'].get('com.docker.compose.service')==b['service'] and c['Config']['Labels'].get('com.docker.compose.project.config_files')==b['composePath'],'CONTAINER_IDENTITY')
    require(hashlib.sha256(private(b['composePath'])).hexdigest()==b['composeSha256'],'COMPOSE_HASH')
    state='paused' if c['State']['Paused'] else 'running' if c['State']['Running'] else 'stopped'
   elif b['kind']=='process':
    pb=proc_binding(b['pid']);require({k:v for k,v in pb.items() if k!='state'}==b,'HOST_WRITER_IDENTITY');expectedpids.add(b['pid']);state='paused' if pb['state'] in ('T','t') else 'running'
   else:raise RuntimeError('WRITER_KIND_UNSUPPORTED')
   writers[writer['key']]={'binding':b,'state':state}
  # Exhaustive privileged/external process classification requires the reviewed probe.
  processes=[]
  for path in pathlib.Path('/proc').iterdir():
   if not path.name.isdigit():continue
   try:
    raw=(path/'stat').read_text();tail=raw[raw.rfind(')')+2:].split();meta=path.stat();exe=os.readlink(path/'exe') if (path/'exe').exists() else None
   except (FileNotFoundError,ProcessLookupError):continue
   processes.append({'pid':int(path.name),'parentPid':int(tail[1]),'startTicks':int(tail[19]),'processGroup':int(tail[2]),'uid':meta.st_uid,'exe':exe,'exeSha256':hashlib.sha256(pathlib.Path(exe).read_bytes()).hexdigest() if exe else None,'flags':int(tail[6]),'state':tail[0],'cgroup':(path/'cgroup').read_text().strip()})
  processes.sort(key=lambda p:p['pid'])
  classification={'unclassifiedProcesses':classify_processes(plan,processes,os.getpid())}
  units={};unit_details={}
  for unit in plan['automationUnits']:
   require(re.fullmatch(r'[a-zA-Z0-9_-]+\.(?:service|timer)',unit),'UNIT_NAME')
   text=self.run(['/usr/bin/systemctl','show',unit,'--property=LoadState,ActiveState,UnitFileState','--no-pager']).decode();values=dict(line.split('=',1) for line in text.splitlines() if '=' in line);require(set(values)=={'LoadState','ActiveState','UnitFileState'},'UNIT_OBSERVATION');unit_details[unit]=values;units[unit]='masked' if values['UnitFileState'] in ('masked','masked-runtime') and values['ActiveState'] in ('inactive','failed') else 'masked-but-active' if values['UnitFileState'] in ('masked','masked-runtime') else values['ActiveState']
  admission,role_observations=fixed.admission();dbs={}
  servicefile=plan['databaseProbe']['serviceFile'];private(servicefile);cafile=plan['databaseProbe']['caFile'];private(cafile,0o644)
  for db in DATABASES:
   require(plan['databaseProbe']['services'][db]==db,'DB_SERVICE_BINDING')
   value=self.database_json(db,DB_SQL)
   # A dedicated reviewed read-only verifier must bind DB client roles and SSL/network identity.
   value['sessions']=classify_sessions(plan,{'database':db,'peer':value['peer'],'sessions':value['sessions']},role_observations[db]);dbs[db]=value
  return {'host':host,'observedAt':time.time(),'scopes':['host-proc','all-docker-containers','systemd-writer-units','three-db-sessions','database-admission'],'writers':writers,'unclassifiedProcesses':classification['unclassifiedProcesses'],'unclassifiedContainers':unknown,'automationUnits':units,'automationUnitDetails':unit_details,'databases':dbs,'admission':admission}
 def verify_capabilities(self,plan):
  require(plan==self.plan,'HOST_PLAN_DRIFT')
  import fixed_probes
  require(pathlib.Path(fixed_probes.__file__).resolve()==pathlib.Path(plan['fixedProbeSource']['path']),'FIXED_PROBE_IMPORT_BINDING')
  require(hashlib.sha256(private(plan['fixedProbeSource']['path'],0o700)).hexdigest()==plan['fixedProbeSource']['sha256'],'FIXED_PROBE_SOURCE_PIN')
  evidence=plan['sourceEvidence'];raw=private(evidence['path']);require(hashlib.sha256(raw).hexdigest()==plan['sourceEvidenceSha256']==evidence['sha256'] and json.loads(raw)['revision']==plan['identity']['sourceRevision'],'FROZEN_WRITER_EVIDENCE')
  private(plan['databaseProbe']['serviceFile']);private(plan['databaseProbe']['caFile'],0o644)
  validate_admission_plan(plan)
 def apply(self,action,plan):
  validate_admission_plan(plan)
  require(plan==self.plan,'HOST_PLAN_DRIFT');self.require_lock();held=self.read_hold();require(held['identity']==plan['identity'] and held['generation']==plan['holdGeneration'] and held['state']=='held','ACTION_HOLD_NOT_PROVEN')
  kind=action['kind']
  if kind in ('close-database-admission','restore-database-admission'):
   from fixed_probes import FixedProbes
   FixedProbes(self).mutate_admission(action);return
  if kind=='terminate-writer-sessions':
   db=action['database'];require(db in DATABASES and action['peer']==plan['databasePeers'][db],'DB_TERMINATE_PEER')
   clauses=[]
   for session in action['sessions']:
    role=session['role'];pid=session['pid'];started=session['backendStart']
    require(role in plan['databaseWriterRoles'][db] and re.fullmatch('[a-zA-Z0-9_-]+',role) and type(pid) is int and pid>1 and isinstance(started,str) and re.fullmatch('[0-9T: .+Z-]+',started),'DB_SESSION_AUTHORITY')
    clauses.append("(pid=%d AND usename='%s' AND backend_start='%s'::timestamptz)"%(pid,role,started))
   require(clauses,'DB_TERMINATE_EMPTY')
   sql="SELECT pid,pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND ("+' OR '.join(clauses)+");"
   self.database_execute(db,sql,control=True);return

  if kind in ('mask-unit','restore-unit'):
   unit=action['unit'];require(unit in plan['automationUnits'] and re.fullmatch(r'[a-zA-Z0-9_-]+\.(?:service|timer)',unit),'UNIT_AUTHORITY')
   if kind=='mask-unit':self.run(['/usr/bin/systemctl','mask','--runtime','--now',unit])
   else:
    require(action['state'] in ('active','inactive','masked'),'UNIT_PRIOR_UNSUPPORTED')
    if action['state']!='masked':self.run(['/usr/bin/systemctl','unmask','--runtime',unit])
    if action['state']=='active':self.run(['/usr/bin/systemctl','start',unit])
   return
  require(kind in ('pause-writer','resume-writer'),'HOST_ACTION_UNSUPPORTED')
  b=action['binding'];require(any(w['key']==action['key'] and w['binding']==b for w in plan['writers']),'WRITER_AUTHORITY')
  if b['kind']=='container':
   current={x['Id']:x for x in self.docker_inventory()}[b['containerId']];require(current['Image']==b['imageId'],'CONTAINER_CHANGED')
   require(type(current['State'].get('Running')) is bool and type(current['State'].get('Paused')) is bool,'CONTAINER_STATE_UNPROVEN')
   if not current['State']['Running']:
    require(kind=='pause-writer','STOPPED_WRITER_CANNOT_RESUME');return
   if current['State']['Paused']==(kind=='pause-writer'):return
   self.run(['/usr/bin/docker','pause' if kind=='pause-writer' else 'unpause',b['containerId']])
  else:
   current=proc_binding(b['pid']);require({k:v for k,v in current.items() if k!='state'}==b,'PID_REUSED')
   require(b['processGroup']!=os.getpgrp() and b['processGroup']>1,'CONTROL_PROCESS_GROUP')
   members=[]
   for p in pathlib.Path('/proc').iterdir():
    if p.name.isdigit() and int(p.name)>1:
     try:v=proc_binding(int(p.name))
     except (FileNotFoundError,ProcessLookupError):continue
     if v['processGroup']==b['processGroup']:members.append({k:x for k,x in v.items() if k!='state'})
   require(all(any(w['binding']==member for w in plan['writers']) for member in members),'UNCLASSIFIED_PROCESS_GROUP_MEMBER')
   os.killpg(b['processGroup'],signal.SIGSTOP if kind=='pause-writer' else signal.SIGCONT)

def seal_runtime_plan(transport,source_path,source_sha,read_private=private,uid=0,boundary=None):
 from writer_fence import digest
 require(source_sha==transport.manifest_sha,'RUNTIME_SOURCE_RAW_PIN')
 source=json.loads(read_private(source_path));require(source==transport.plan,'RUNTIME_SOURCE_CONTENT')
 if source.get('holdGenerationPolicy')=='bind-held-at-runtime':
  held=transport.read_hold();require(held['state']=='held' and held['identity']==source['identity'] and isinstance(held['generation'],str) and re.fullmatch('[a-f0-9]{32}',held['generation']),'RUNTIME_HELD_IDENTITY');transport.startup_hold=held
 proof=transport.openBoth();bound=transport.bindRuntimeSessions(proof)
 path=pathlib.Path(bound['runtimeSealPath']);expected='/var/lib/workspacex-cn/runtime/'+bound['identity']['attemptId']+'/sealed-writer-runtime.json'
 require(str(path)==expected,'RUNTIME_SEAL_PATH')
 for parent in path.parents:
  st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==uid and not st.st_mode&0o022,'RUNTIME_SEAL_PARENT')
  if boundary and parent==pathlib.Path(boundary):break
 require(stat.S_IMODE(path.parent.stat().st_mode)==0o700,'RUNTIME_SEAL_PRIVATE_PARENT')
 value={'schemaVersion':1,'kind':'sealed-maintenance-writer-runtime','identity':bound['identity'],'toolRevision':bound['toolRevision'],'sourcePlanPath':source_path,'sourcePlanSha256':source_sha,'sourcePlanCanonicalSha256':digest(source),'runtimePlanSha256':digest(bound),'runtimePlan':bound,'sessionsSha256':digest({'control':proof['controlSessions'],'diagnostic':proof['diagnosticSessions']}),'processIdentity':proc_binding(os.getpid()),'ready':False,'productionAvailabilityProven':False}
 raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 name='.sealed-runtime-'+os.urandom(16).hex()
 try:
  fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
  with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
  # No replacement of an old attempt/seal: an ambiguous previous process is operator-owned.
  os.link(name,path.name,src_dir_fd=directory,dst_dir_fd=directory,follow_symlinks=False);os.unlink(name,dir_fd=directory);os.fsync(directory)
 finally:
  try:os.unlink(name,dir_fd=directory)
  except FileNotFoundError:pass
  os.close(directory)
 return value,{'sealedPlanPath':str(path),'sealedPlanSha256':hashlib.sha256(raw).hexdigest(),'runtimePlanSha256':digest(bound)}

def recover_retained_databases(transport,adapter,journal,identity,reference,read_private=private):
 """One existing actor and three existing clients. No external recovery CLI.
 Every response is read back against the sealed source data and held barrier.
 """
 auth=transport.plan.get('recoveryAuthorization');require(type(auth) is dict and auth.get('identity')==identity,'RETAINED_RECOVERY_AUTHORITY')
 expected={'path':auth['planPath'],'sha256':auth['planSha256']};require(reference==expected,'RETAINED_RECOVERY_PLAN_BINDING')
 require(reference['path']=='/etc/workspacex-cn/maintenance-recovery/'+identity['sourceRevision']+'/'+identity['attemptId']+'/recovery-plan.json','RETAINED_RECOVERY_PATH')
 require(identity['sourceRevision']=='9b25bfa65662b96c0826fe67506b562ea46aa6d0' and identity['baselineRevision']=='ba6343199f3c834d6a198f83d0c771614292c82b','RETAINED_RECOVERY_FROZEN_SOURCE')
 raw=read_private(reference['path']);require(hashlib.sha256(raw).hexdigest()==reference['sha256'],'RETAINED_RECOVERY_PIN');p=json.loads(raw)
 require(p['identity']==identity and p['toolRevision']==transport.plan['toolRevision'] and p['production']['instanceId']=='pgm-uf6rg214cp381l49' and p['production']['databasePeers']==transport.plan['databasePeers'] and set(p['databases'])==set(DATABASES),'RETAINED_RECOVERY_DATA_SCOPE')
 a=p['authorization'];require(a['identity']==identity and a['productionInstanceId']==p['production']['instanceId'] and a['action']=='replace-three-production-databases-with-exact-baseline' and a['notBefore']<=time.time()<a['expiresAt'] and a['expiresAt']-a['notBefore']<=3600,'RETAINED_RECOVERY_DATA_AUTHORIZATION')
 require(not journal.value.get('retainedRecoveryStarted'),'RETAINED_RECOVERY_REPLAY_REQUIRES_RECONCILIATION')
 out=pathlib.Path(reference['path']).parent/'production-recovery-result.json';require(not out.exists() and not out.is_symlink(),'RETAINED_RECOVERY_RECEIPT_EXISTS')
 parent=out.parent.lstat();require(stat.S_ISDIR(parent.st_mode) and parent.st_uid==0 and parent.st_gid==0 and stat.S_IMODE(parent.st_mode)==0o700,'RETAINED_RECOVERY_RECEIPT_PARENT')
 adapter.verifyWritesBlocked(identity);journal.value['retainedRecoveryStarted']=True;journal.record('retained-recovery-intent',planSha256=reference['sha256'])
 results={}
 try:
  for db in DATABASES:
   adapter.verifyWritesBlocked(identity);require(hashlib.sha256(read_private(reference['path'])).hexdigest()==reference['sha256'],'RETAINED_RECOVERY_PLAN_DRIFT')
   journal.record('retained-recovery-database-intent',database=db);r=transport.control_connections[db].recover_existing_session(identity);item=p['databases'][db]
   require(r.get('database')==db and r.get('targetRdsInstanceId')=='pgm-uf6rg214cp381l49' and r.get('ciphertextSha256')==item['ciphertext']['sha256'] and r.get('backupReceiptSha256')==item['backupReceiptSha256'] and r.get('catalogSha256')==item['sourceCatalogSha256'] and all(r.get(k) is True for k in ('dataFidelityVerified','existingSession','precommitFidelityVerified','restoreCommitted','decoderJoined')) and r.get('ready') is False,'RETAINED_RECOVERY_ACTUAL_RESULT')
   adapter.verifyWritesBlocked(identity);results[db]=r;journal.record('retained-recovery-database-response',database=db,resultSha256=digest(r))
  value={'schemaVersion':1,'kind':'retained-session-production-recovery','identity':identity,'productionInstanceId':'pgm-uf6rg214cp381l49','databases':results,'writesHeld':True,'ready':False};receipt=json.dumps(value,sort_keys=True).encode();receipt_sha=hashlib.sha256(receipt).hexdigest()
  journal.record('retained-recovery-receipt-intent',receiptSha256=receipt_sha)
  fd=os.open(out,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as stream:stream.write(receipt);stream.flush();os.fsync(stream.fileno())
  directory=os.open(out.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(directory)
  finally:os.close(directory)
  require(hashlib.sha256(read_private(str(out))).hexdigest()==receipt_sha,'RETAINED_RECOVERY_RECEIPT_READBACK');adapter.verifyWritesBlocked(identity);journal.record('retained-recovery-receipt-durable',receiptSha256=receipt_sha)
  return {'schemaVersion':1,'kind':'production-recovery-completed','identity':identity,'receiptSha256':receipt_sha,'writesHeld':True,'ready':False}
 except BaseException:journal.record('retained-recovery-outcome-unknown',holdDisposition='retain');raise

def serve_reviewed_fence(source_path,source_sha):
 import sys
 from writer_fence import WriterFenceAdapter,Journal
 raw=private(source_path);require(hashlib.sha256(raw).hexdigest()==source_sha,'REVIEWED_PLAN_PIN');plan=json.loads(raw)
 require(plan.get('schemaVersion')==1 and plan.get('mode')=='maintenance-all-writer-fence' and plan.get('productionActionsAuthorized') is True,'ACTION_PLAN_NOT_AUTHORIZED')
 require(re.fullmatch('[a-zA-Z0-9-]{1,128}',plan['identity']['attemptId']),'ATTEMPT_IDENTITY')
 transport=HostTransport(plan,source_sha,'apply-reviewed-all-writer-fence');transport.require_lock();transport.verify_capabilities(plan);unknown=False;mutated=False;migration_completed=False;journal=None
 try:
  sealed,receipt=seal_runtime_plan(transport,source_path,source_sha)
  journal=Journal(transport.plan['journalDirectory'],plan['identity']);adapter=WriterFenceAdapter(plan['identity'],transport.plan,transport,journal)
  print(json.dumps(dict(sequence=0,ok=True,kind='persistent-writer-runtime-started',identity=plan['identity'],toolRevision=plan['toolRevision'],processIdentity=sealed['processIdentity'],**receipt)),flush=True)
  sequence=0
  while True:
   line=sys.stdin.buffer.readline(1048577)
   if not line:
    if unknown or (mutated and journal.value['state']!='writes-resumed'):
     while True:time.sleep(60) # retain inherited FD9 and persistent helpers on unknown disconnect
    break
   try:
    require(len(line)<=1048576 and line.endswith(b'\n'),'FENCE_REQUEST_LIMIT')
    request=json.loads(line);require(request['sequence']==sequence+1 and request['identity']==plan['identity'],'FENCE_REQUEST_BINDING');sequence=request['sequence']
    if request['operation']=='close-accepted':
     require(not unknown and journal.value['state']=='writes-resumed','FENCE_CLOSE_NOT_ACCEPTED');print(json.dumps({'sequence':sequence,'ok':True,'closed':True}),flush=True);break
    if request['operation']=='migrate-exact-plan':
     require(not unknown,'FENCE_UNKNOWN_STATE_RETAINED');adapter.verifyWritesBlocked(plan['identity']);mutated=True
     value=transport.control_connections['workspacex'].migrate_exact_plan(plan['identity']);adapter.verifyWritesBlocked(plan['identity']);migration_completed=True
     print(json.dumps({'sequence':sequence,'ok':True,'value':value}),flush=True);continue
    if request['operation']=='recover-retained-baseline':
     require(not unknown and set(request)=={'sequence','identity','operation','recoveryPlan'},'FENCE_RECOVERY_REQUEST_BINDING');mutated=True
     value=recover_retained_databases(transport,adapter,journal,plan['identity'],request['recoveryPlan'])
     print(json.dumps({'sequence':sequence,'ok':True,'value':value}),flush=True);continue
    if request['operation']=='record-migration-completion':
     require(not unknown and migration_completed,'MIGRATION_COMPLETION_BEFORE_EXACT_MIGRATION');adapter.verifyWritesBlocked(plan['identity'])
     stage=request['stage'];receipt=request['receipt'];expected='/etc/workspacex-cn/migration-completion-inputs/'+plan['identity']['sourceRevision']+'/'+plan['identity']['attemptId']+'.completed.json'
     require(stage in ('intent','durable') and set(receipt)=={'path','sha256'} and receipt['path']==expected and isinstance(receipt['sha256'],str) and re.fullmatch('[a-f0-9]{64}',receipt['sha256']),'MIGRATION_COMPLETION_RECEIPT_BINDING')
     if stage=='intent':
      require(journal.value.get('migrationCompletionIntent') in (None,receipt),'MIGRATION_COMPLETION_INTENT_DRIFT');journal.value['migrationCompletionIntent']=receipt
     else:
      require(journal.value.get('migrationCompletionIntent')==receipt,'MIGRATION_COMPLETION_INTENT_REQUIRED');require(hashlib.sha256(private(receipt['path'])).hexdigest()==receipt['sha256'],'MIGRATION_COMPLETION_DURABLE_PIN');journal.value['migrationCompletionReceipt']=receipt
     journal.record('migration-completion-'+stage,receipt=receipt,holdGeneration=transport.plan['holdGeneration'],planSha256=digest(transport.plan))
     print(json.dumps({'sequence':sequence,'ok':True,'value':{'identity':plan['identity'],'stage':stage,'receipt':receipt,'ready':False}}),flush=True);continue
    if request['operation']=='read-run-drain':
     require(not unknown,'FENCE_UNKNOWN_STATE_RETAINED');adapter.verifyWritesBlocked(plan['identity'])
     connection=transport.diagnostic_connections['workspacex'];value=connection.query('run-drain')
     counts=aggregate_run_drain(value['rows']);adapter.verifyWritesBlocked(plan['identity'])
     print(json.dumps({'sequence':sequence,'ok':True,'value':dict(counts,connection=connection.binding,observedAt=time.time(),identity=plan['identity'],holdGeneration=transport.plan['holdGeneration'],writesHeld=True)}),flush=True);continue
    if request['operation']=='read-diagnostic-ledger':
     require(not unknown,'FENCE_UNKNOWN_STATE_RETAINED');adapter.verifyWritesBlocked(plan['identity'])
     connection=transport.diagnostic_connections['workspacex'];value=connection.query('migration-ledger');require(value['rowCount']==len(value['ledger']),'MIGRATION_LEDGER_COUNT')
     print(json.dumps({'sequence':sequence,'ok':True,'value':dict(value,connection=connection.binding,observedAt=time.time())}),flush=True);continue
    callback=request['callback'];require(request['operation']=='callback' and callback in adapter.callbacks(),'FENCE_CALLBACK_AUTHORITY')
    require(not unknown or callback=='recordWriteStateReconciliationRequired','FENCE_UNKNOWN_STATE_RETAINED')
    if callback in ('blockAllWrites','resumeWrites'):mutated=True
    result=adapter.callbacks()[callback](plan['identity']);value=result if result is not None else {'callback':callback,'identity':plan['identity'],'state':journal.value['state'],'ready':False,'productionAvailabilityProven':False}
    print(json.dumps({'sequence':sequence,'ok':True,'value':value}),flush=True)
   except BaseException:
    unknown=mutated;print(json.dumps({'sequence':sequence,'ok':False,'code':'PERSISTENT_FENCE_REJECTED','holdDisposition':'retain'}),flush=True)
 finally:
  if not unknown:
   transport.close_control_connections()
   if journal:journal.close()


def main():
 import sys
 from writer_fence import WriterFenceAdapter,Journal
 if len(sys.argv)==4 and sys.argv[1]=='--serve-reviewed-fence':
  serve_reviewed_fence(sys.argv[2],sys.argv[3]);return
 require(len(sys.argv)==5 and sys.argv[1]=='--apply-reviewed-fence','EXPLICIT_REVIEWED_PLAN_CALLBACK')
 raw=private(sys.argv[2]);require(hashlib.sha256(raw).hexdigest()==sys.argv[3],'REVIEWED_PLAN_PIN');plan=json.loads(raw)
 require(plan.get('schemaVersion')==1 and plan.get('mode')=='maintenance-all-writer-fence' and plan.get('productionActionsAuthorized') is True,'ACTION_PLAN_NOT_AUTHORIZED')
 require(re.fullmatch('[a-zA-Z0-9-]{1,128}',plan['identity']['attemptId']),'ATTEMPT_IDENTITY')
 transport=HostTransport(plan,sys.argv[3],'apply-reviewed-all-writer-fence');transport.require_lock()
 journal=Journal(plan['journalDirectory'],plan['identity'])
 try:
  adapter=WriterFenceAdapter(plan['identity'],plan,transport,journal);callbacks=adapter.callbacks();require(sys.argv[4] in callbacks,'CALLBACK_AUTHORITY')
  receipt=callbacks[sys.argv[4]](plan['identity']);print(json.dumps(receipt if receipt is not None else {'callback':sys.argv[4],'identity':plan['identity'],'state':journal.value['state'],'ready':False,'productionAvailabilityProven':False}))
 finally:journal.close()
if __name__=='__main__':
 try:main()
 except BaseException as e:
  import sys
  print('MAINTENANCE_WRITER_FENCE_REJECTED:'+(str(e) if isinstance(e,RuntimeError) else 'HOST_OBSERVATION_OR_ACTION_FAILED'),file=sys.stderr);sys.exit(1)
