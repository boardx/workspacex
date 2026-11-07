#!/usr/bin/env python3
"""Actual local Docker preparation operations. No production role/secret mutation.
The root policy fixes source credentials, pinned images and local resource limits.
Only encrypted dumps are persisted. Payloads, credentials and SQL results never
appear on stdout; the sole output is a source/attempt-bound evidence envelope.
"""
import datetime,hashlib,json,os,pathlib,re,secrets,signal,subprocess,sys,time,uuid,threading
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from cn_auto_prepare import private,require,NotReady,require_lock
DBS=('workspacex','workspacex_agent','workspacex_memory')
ROOT=pathlib.Path('/var/lib/workspacex-cn/auto-preparation')
STREAM_COUNTER=r"""import sys,os,json
n=0
while True:
 b=sys.stdin.buffer.read(1048576)
 if not b:break
 s=os.statvfs(os.path.dirname(sys.argv[1]))
 if s.f_bavail*s.f_frsize<10*1024**3:raise RuntimeError('DISK_RESERVE')
 sys.stdout.buffer.write(b);n+=len(b)
sys.stdout.buffer.flush()
fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as f:json.dump({'bytes':n},f);f.flush();os.fsync(f.fileno())
"""
DOCKER=['/usr/bin/docker','--host','unix:///var/run/docker.sock','--config','/nonexistent']
def sha(raw):return hashlib.sha256(raw).hexdigest()
def utc():return datetime.datetime.now(datetime.timezone.utc)
def available_memory():
 host=int(re.search(r'^MemAvailable:\s+(\d+) kB$',pathlib.Path('/proc/meminfo').read_text(),re.M)[1])*1024
 for line in pathlib.Path('/proc/self/cgroup').read_text().splitlines():
  _,controllers,path=line.split(':',2)
  if controllers=='':root=pathlib.Path('/sys/fs/cgroup');limit,current='memory.max','memory.current'
  elif 'memory' in controllers.split(','):root=pathlib.Path('/sys/fs/cgroup/memory');limit,current='memory.limit_in_bytes','memory.usage_in_bytes'
  else:continue
  require(path.startswith('/') and '..' not in pathlib.Path(path).parts,'MEMORY_CGROUP_PATH');directory=root/path.lstrip('/')
  while True:
   if (directory/limit).exists():
    raw=(directory/limit).read_text().strip()
    if raw!='max':host=min(host,max(0,int(raw)-int((directory/current).read_text())))
   if directory==root:break
   directory=directory.parent
 return host
def require_capacity(path,database_bytes=0):
 require(available_memory()>=9*1024**3,'MEMORY_HEADROOM_REQUIRED')
 s=os.statvfs(path);require(s.f_bavail*s.f_frsize>=10*1024**3+3*database_bytes,'DISK_HEADROOM_REQUIRED')
def save(path,value):
 raw=json.dumps(value,sort_keys=True,separators=(',',':')).encode()+b'\n';fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 return {'path':str(path),'sha256':sha(raw)}
def command(args,data=None,timeout=120):
 # Caller never logs raw stderr. Every job has a Docker name for explicit cleanup.
 p=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 try:out=p.communicate(data,timeout=timeout)[0]
 except subprocess.TimeoutExpired:p.kill();p.communicate();raise NotReady('LOCAL_COMMAND_TIMEOUT')
 require(p.returncode==0 and len(out)<=16*1024*1024,'LOCAL_COMMAND_FAILED');return out
class Provider:
 def __init__(self,payload,run=command,root=ROOT):
  self.r=payload['request'];self.policy=payload['policy'];self.e=self.policy['environment'];self.run=run
  self.key=sha(json.dumps(self.r['identity'],sort_keys=True).encode())[:20];self.name='wsx-autop-'+self.key
  self.dir=pathlib.Path(root)/self.r['identity']['sourceRevision']/self.r['identity']['attemptId'];self.state=self.dir/'provider-state.json'
  require(set(self.e)>={'sourceDatabase','postgresImage','redisImage','recipientCertificate','recipientKey'},'ENVIRONMENT_CONFIGURATION')
  for key in ('postgresImage','redisImage'):require(re.fullmatch(r'(?:[^\s]+@)?sha256:[a-f0-9]{64}',self.e[key]),'IMMUTABLE_LOCAL_IMAGE')
 def verify_ordinary_plan(self):
  i=self.r['identity'];plan=json.loads(private('/etc/workspacex-cn/migration-plans/'+i['sourceRevision']+'/'+i['attemptId']+'/plan.json'))
  require(plan.get('targetSha')==i['sourceRevision'] and plan.get('baselineSha')==i['baselineSourceRevision'] and plan.get('planSha256')==self.r['migrationPlanSha256'] and plan.get('ready') is True and all(plan.get(k)==[] for k in ('drift','blockers')) and isinstance(plan.get('pending'),list) and all(v.get('risk')=='additive' for v in plan['pending']),'ORDINARY_MIGRATION_PLAN_REQUIRED')
  body={k:v for k,v in plan.items() if k!='planSha256'};require(sha(json.dumps(body,separators=(',',':')).encode())==plan['planSha256'],'MIGRATION_PLAN_HASH');return plan
 def d(self,*args,data=None,timeout=120):
  args=list(args)
  if args and args[0]=='run' and not any(v.startswith('--memory') for v in args):args[1:1]=['--memory=256m','--cpus=.2','--pids-limit=128']
  return self.run(DOCKER+args,data,timeout)
 def read_state(self):return json.loads(private(str(self.state)))
 def inspect(self,name):return json.loads(self.d('inspect',name))[0]
 def owned(self,name):
  value=self.inspect(name);require(value['Config']['Labels'].get('wsx.auto.owner')==self.key,'CONTAINER_OWNER');return value
 def ensure_image(self,image):
  v=json.loads(self.d('image','inspect',image))[0];require(image==v.get('Id') or image in v.get('RepoDigests',[]),'LOCAL_IMAGE_DIGEST');return v
 def target(self):return {'targetId':self.name,'endpointSha256':sha((self.name+'-pg').encode()),'databases':list(DBS)}
 def wait_pg(self):
  deadline=time.monotonic()+60
  while time.monotonic()<deadline:
   try:self.d('exec',self.name+'-pg','pg_isready','-h','127.0.0.1','-U','postgres',timeout=5);return
   except NotReady:time.sleep(.25)
  raise NotReady('LOCAL_POSTGRES_NOT_READY')
 def pipeline(self,commands,output=None,input_file=None):
  jobs=[];previous=input_file;done=threading.Event();violated=[]
  def monitor():
   while not done.wait(.1):
    s=os.statvfs(self.dir)
    if s.f_bavail*s.f_frsize<10*1024**3:
     violated.append(True)
     for p in jobs:
      if p.poll() is None:p.kill()
     return
  watcher=threading.Thread(target=monitor,daemon=True);watcher.start()
  try:
   for index,args in enumerate(commands):
    last=index==len(commands)-1
    p=subprocess.Popen(args,stdin=previous,stdout=output if last and output else subprocess.PIPE,stderr=subprocess.DEVNULL)
    if previous is not input_file and previous is not None:previous.close()
    jobs.append(p);previous=p.stdout
   final=jobs[-1].communicate(timeout=600)[0]
   for p in jobs[:-1]:p.wait(timeout=30)
   require(not violated,'DISK_RESERVE_STREAM_ABORT');require(all(p.returncode==0 for p in jobs),'STREAM_PIPELINE_FAILED')
   return final
  finally:
   done.set();watcher.join()
   for p in jobs:
    if p.poll() is None:p.kill()
   for p in jobs:p.wait()
 def backup(self):
  require(not self.state.exists(),'EXISTING_PROVIDER_RECONCILIATION_REQUIRED')
  source=json.loads(private(self.e['sourceDatabase']));source.setdefault('databases',list(DBS));source.setdefault('sslmode',self.e.get('sourceTls',{}).get('sslmode'));require(set(source)>={'host','port','user','password','sslmode','databases'} and source['databases']==list(DBS) and source['sslmode'] in ('verify-full','disable'),'SOURCE_DATABASE')
  for value in source.values():
   if isinstance(value,str):require(not any(c in value for c in ('\r','\n','\0')),'SOURCE_ENV_SERIALIZATION')
  self.verify_source_binding(source)
  require_capacity(self.dir)
  self.ensure_image(self.e['postgresImage']);self.ensure_image(self.e['redisImage'])
  private(self.e['recipientCertificate']);private(self.e['recipientKey'])
  version=self.d('run','--rm','--pull=never','--network=none','--name',self.name+'-version','--label','wsx.auto.owner='+self.key,'--entrypoint','pg_dump',self.e['postgresImage'],'--version').decode();require(re.fullmatch(r'pg_dump \(PostgreSQL\) 16\.[^\n]+\n?',version),'PGDUMP16_REQUIRED')
  keypub=self.run(['/usr/bin/openssl','pkey','-in',self.e['recipientKey'],'-pubout'])
  certpub=self.run(['/usr/bin/openssl','x509','-in',self.e['recipientCertificate'],'-pubkey','-noout']);require(keypub==certpub,'RECIPIENT_PAIR')
  state={'name':self.name,'owner':self.key,'password':secrets.token_hex(32),'marker':str(uuid.uuid4()),'oldMarker':str(uuid.uuid4()),'nonce':uuid.uuid4().hex,'probePassword':secrets.token_hex(32),'redisPassword':secrets.token_hex(32),'rolePasswords':{k:secrets.token_hex(32) for k in ('app_rw','app_diag_ro','migration_owner','agent_server','memory_owner','memory_rw','graph_owner')},'identity':self.r['identity'],'dumps':{}}
  # Record owned names before the first child/container can appear.
  save(self.state,state)
  env=self.dir/'backup.env';body='\n'.join(['PGHOST='+source['host'],'PGPORT='+str(source['port']),'PGUSER='+source['user'],'PGPASSWORD='+source['password'],'PGSSLMODE='+source['sslmode'],'PGCONNECT_TIMEOUT=5','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=300000 -c lock_timeout=5000'])+'\n'
  fd=os.open(env,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as f:f.write(body)
  receipts={};refs=[]
  try:
   size_env=[]
   if source['sslmode']=='verify-full':size_env=['--mount','type=bind,src='+source['caFile']+',dst=/run/ca.pem,readonly','-e','PGSSLROOTCERT=/run/ca.pem']
   sizes={}
   for db in DBS:
    size_raw=self.d('run','--rm','--pull=never','--name',self.name+'-rolecheck','--label','wsx.auto.owner='+self.key,'--network='+self.e.get('sourceNetwork','host'),'--env-file',str(env),*size_env,'--entrypoint','psql',self.e['postgresImage'],'-XAt','--no-password','--dbname',db,'--command','SELECT pg_database_size(current_database());')
    require(re.fullmatch(rb'[1-9][0-9]*\s*',size_raw),'SOURCE_DATABASE_SIZE');sizes[db]=int(size_raw)
   require_capacity(self.dir,sum(sizes.values()));refs.append(save(self.dir/'capacity-proof.json',{'databaseBytes':sizes,'shadowMemoryBudgetBytes':6*1024**3,'productionMemoryHeadroomBytes':3*1024**3,'diskReserveBytes':10*1024**3,'availableMemoryBytes':available_memory()}))
   for db in DBS:
    name=self.name+'-dump-'+db.replace('_','-');dump=self.dir/(db+'.dump.cms')
    ca=[]
    if source['sslmode']=='verify-full':
     private(source['caFile']);ca=['--mount','type=bind,src='+source['caFile']+',dst=/run/ca.pem,readonly','-e','PGSSLROOTCERT=/run/ca.pem']
    count=self.dir/(db+'.dump-count.json')
    counter=['/usr/bin/python3','-I','-S','-c',STREAM_COUNTER,str(count)]
    # Reuse the existing authorized account without changing its grants. The
    # fixed client is forced read-only; account-level DML ability is not a claim
    # of this backup receipt and never authorizes arbitrary caller SQL.
    readonly_sql="SELECT current_setting('transaction_read_only')='on'"
    check=self.d('run','--rm','--pull=never','--name',self.name+'-rolecheck','--label','wsx.auto.owner='+self.key,'--network='+self.e.get('sourceNetwork','host'),'--env-file',str(env),*ca,'--entrypoint','psql',self.e['postgresImage'],'-XAt','--no-password','--dbname',db,'--command',readonly_sql)
    require(check.strip()==b't','SOURCE_BACKUP_TRANSACTION_NOT_READONLY')
    if db==DBS[0]:
     catalog="SELECT json_build_object('roles',(SELECT json_agg(rolname ORDER BY rolname) FROM pg_roles WHERE rolname !~ '^pg_'),'memberships',(SELECT COALESCE(json_agg(json_build_object('role',r.rolname,'member',m.rolname)), '[]'::json) FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member WHERE m.rolname !~ '^pg_'))"
     roles=json.loads(self.d('run','--rm','--pull=never','--name',self.name+'-rolecheck','--label','wsx.auto.owner='+self.key,'--network='+self.e.get('sourceNetwork','host'),'--env-file',str(env),*ca,'--entrypoint','psql',self.e['postgresImage'],'-XAt','--no-password','--dbname',db,'--command',catalog))
     refs.append(save(self.dir/'source-roles.json',roles))
    pg=DOCKER+['run','--memory=256m','--cpus=.2','--pids-limit=128','--rm','--pull=never','--network='+self.e.get('sourceNetwork','host'),'--name',name,'--label','wsx.auto.owner='+self.key,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--env-file',str(env),*ca,'--entrypoint','pg_dump',self.e['postgresImage'],'--format=custom','--serializable-deferrable','--lock-wait-timeout=5000','--no-password','--dbname',db]
    fd=os.open(dump,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
     with os.fdopen(fd,'wb') as out:self.pipeline([pg,counter,['/usr/bin/openssl','cms','-encrypt','-binary','-aes256','-stream','-outform','DER',self.e['recipientCertificate']]],output=out);out.flush();os.fsync(out.fileno())
    finally:
     # Killing the client alone cannot prove the Docker job stopped.
     existing=json.loads(self.d('ps','-a','--format','{{json .}}','--filter','name=^/'+name+'$') or b'null')
     if existing:self.owned(name);self.d('rm','-f',name)
    digest=hashlib.sha256()
    with dump.open('rb') as f:
     for block in iter(lambda:f.read(1024*1024),b''):digest.update(block)
    size=dump.stat().st_size;require(size>0,'EMPTY_ENCRYPTED_DUMP')
    refs.append({'path':str(dump),'sha256':digest.hexdigest()})
    receipts[db]={'dumpExit':0,'encryptionExit':0,'ownedProcessesJoined':True,'ciphertextSha256':digest.hexdigest(),'ciphertextBytes':size,'dumpBytes':json.loads(private(str(count)))['bytes']}
  finally:env.unlink(missing_ok=True)
  return {'childAttemptId':self.r['identity']['attemptId'],'implementation':'pinned-pgdump16-read-only-cms','pgDumpVersion':version.strip(),'clientImage':self.e['postgresImage'],'ciphertextsVerified':True,'receipt':{'identity':{'sourceRevision':self.r['identity']['sourceRevision'],'baselineRevision':self.r['identity']['baselineSourceRevision'],'migrationPlanSha256':self.r['migrationPlanSha256'],'attemptId':self.r['identity']['attemptId']},'databases':receipts,'cleanupVerified':True,'consistencyScope':'three-independent-database-snapshots','currentEpochVerified':False,'productionReleaseReady':False}},refs
 def verify_source_binding(self,source):
  i=self.r['identity'];plan=self.verify_ordinary_plan();prefix='/etc/workspacex-cn/migration-plans/'+i['sourceRevision']+'/'+i['attemptId']
  config_raw=private('/etc/workspacex-cn/candidate-configs/'+i['sourceRevision']+'/'+i['attemptId']+'/deployment.json');environment=json.loads(config_raw)['environment']
  def secret(ref):
   require(isinstance(ref,str) and ref.startswith('file:/'),'SOURCE_SECRET_REFERENCE');return private(ref[5:])
  db_raw=secret(environment['databaseSecretRef']);db=json.loads(db_raw);migration=json.loads(secret(environment['migrationSecretRef']))
  require(environment.get('profile')=='production' and db.get('database')=='workspacex' and all(source.get(k)==db.get(k)==migration.get(k) for k in ('host','port','database')) and source.get('databases')==list(DBS),'SOURCE_CANONICAL_ENDPOINT')
  binding_raw=private(prefix+'/source-binding.json');require(sha(binding_raw)==plan['snapshotEvidence']['sourceBindingSha256'],'SOURCE_BINDING_RAW_HASH');binding=json.loads(binding_raw)
  require(binding.get('schemaVersion')==3 and all(binding.get(k)==i[k] for k in ('sourceRevision','baselineSourceRevision','attemptId')),'SOURCE_BINDING_IDENTITY')
  configuration=binding['sourceEvidence']['configuration'];origin=binding['source'];mode='disable' if environment.get('rdsTlsException') else 'verify-full'
  configuration_hash=sha(json.dumps({'deploymentSha256':sha(config_raw),'databaseSecretSha256':sha(db_raw)},separators=(',',':')).encode());endpoint_hash=sha((source['host']+':'+str(source['port'])).encode())
  require(all(configuration.get(k)==db[k] for k in ('host','port','database')) and configuration.get('regionId')==environment['regionId'] and configuration.get('rdsInstanceId')==environment['rdsInstanceId'] and configuration.get('sha256')==configuration_hash and origin.get('configurationSha256')==configuration_hash and configuration.get('endpointSha256')==origin.get('endpointSha256')==endpoint_hash,'SOURCE_SNAPSHOT_ENDPOINT')
  require(source['sslmode']==configuration.get('sslMode')==origin.get('sslMode')==mode,'SOURCE_TLS_MODE')
  if mode=='disable':
   exception=environment['rdsTlsException'];require(exception.get('kind')=='aliyun-postgresql-serverless-no-tls' and configuration.get('rdsTlsException')==exception and self.e.get('sourceTls',{}).get('exceptionKind')==exception['kind'] and not origin.get('clientEncrypted') and not origin.get('clientTlsAuthorized'),'SOURCE_TLS_EXCEPTION')
  else:
   require(origin.get('clientEncrypted') is True and origin.get('clientTlsAuthorized') is True and source.get('caFile') and db.get('caFile') and sha(private(source['caFile']))==sha(private(db['caFile'])),'SOURCE_TLS_CA')
 def psql(self,db,sql):return self.d('exec','-i',self.name+'-pg','psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d',db,data=sql.encode())
 def data_fingerprint(self,db,local=False):
  if local:
   first=DOCKER+['exec',self.name+'-pg','pg_dump','-U','postgres','--format=custom','--dbname',db]
   source=None
  else:
   first=['/usr/bin/openssl','cms','-decrypt','-binary','-inform','DER','-inkey',self.e['recipientKey']]
   source=open(self.dir/(db+'.dump.cms'),'rb')
  restore=DOCKER+['run','--memory=256m','--cpus=.2','--pids-limit=128','--rm','--pull=never','--network=none','--name',self.name+'-fingerprint','--label','wsx.auto.owner='+self.key,'-i','--read-only','--cap-drop=ALL','--entrypoint','pg_restore',self.e['postgresImage'],'--data-only','--file=-']
  try:
   result=json.loads(self.pipeline([first,restore,['/usr/bin/python3','-I','-S','-c',STREAM_FIDELITY]],input_file=source));require(isinstance(result,dict) and bool(result),'EMPTY_FIDELITY_EVIDENCE');return result
  finally:
   if source:source.close()
 def restore_databases(self):
  state=self.read_state();self.ensure_image(self.e['postgresImage']);self.ensure_image(self.e['redisImage'])
  self.d('network','create','--internal','--label','wsx.auto.owner='+self.key,self.name+'-net')
  pg_env=self.dir/'postgres.env';fd=os.open(pg_env,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as f:f.write('POSTGRES_PASSWORD='+state['password']+'\n')
  self.d('run','-d','--pull=never','--name',self.name+'-pg','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--network-alias','postgres','--env-file',str(pg_env),'--memory=768m','--cpus=.4','--pids-limit=256',self.e['postgresImage'])
  self.wait_pg();pg_env.unlink()
  for role,password in state['rolePasswords'].items():self.psql('postgres','CREATE ROLE "'+role+'" LOGIN PASSWORD \''+password+'\';')
  role_catalog=json.loads(private(str(self.dir/'source-roles.json')))
  for role in role_catalog['roles']+self.e.get('restoreRoles',[]):
   require(isinstance(role,str) and 0<len(role.encode())<=63 and not any(c in role for c in ('\0','\r','\n')) and not role.startswith('pg_'),'RESTORE_ROLE_NAME')
   role=role.replace(chr(34),chr(34)*2)
   if role not in state['rolePasswords'] and role!='postgres':self.psql('postgres','CREATE ROLE "'+role+'" NOLOGIN;')
  for membership in role_catalog['memberships']:
   role,member=membership['role'],membership['member'];require(all(isinstance(v,str) and not any(c in v for c in ('\0','\r','\n')) for v in (role,member)),'ROLE_MEMBERSHIP')
   if member=='postgres':continue
   self.psql('postgres','GRANT '+quote_ident(role)+' TO '+quote_ident(member)+';')
  proofs={}
  for db in DBS:
   self.psql('postgres','CREATE DATABASE "'+db+'";')
   with open(self.dir/(db+'.dump.cms'),'rb') as encrypted:
    self.pipeline([['/usr/bin/openssl','cms','-decrypt','-binary','-inform','DER','-inkey',self.e['recipientKey']],DOCKER+['exec','-i',self.name+'-pg','pg_restore','--exit-on-error','--single-transaction','-U','postgres','--dbname',db]],input_file=encrypted)
   expected=self.data_fingerprint(db);actual=self.data_fingerprint(db,True);require(expected==actual,'RESTORED_DATA_FIDELITY')
   proofs[db]={'sourceDataSha256':sha(json.dumps(expected,sort_keys=True).encode()),'restoredDataSha256':sha(json.dumps(actual,sort_keys=True).encode())}
  redis=self.dir/'redis.conf';redis.write_text('bind 0.0.0.0\nprotected-mode yes\nrequirepass '+state['redisPassword']+'\n');redis.chmod(0o644)
  self.d('run','-d','--pull=never','--name',self.name+'-redis','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--network-alias','redis','--memory=128m','--cpus=.1','--pids-limit=128','--mount','type=bind,src='+str(redis)+',dst=/usr/local/etc/redis.conf,readonly',self.e['redisImage'],'redis-server','/usr/local/etc/redis.conf')
  proof=save(self.dir/'restore-proof.json',{'identity':self.r['identity'],'databases':proofs,'isolatedTarget':self.target()})
  return {'productionTargetUsed':False,'isolatedTarget':self.target(),'restoredBackupSha256':self.r['dependencies']['backup'],'dataFidelityVerified':True,'pendingMigrationCount':0},[proof]
 def restore(self):
  facts,refs=self.restore_databases()
  manifest=self.effective_manifest()
  for service in ('api','web','agent','sandbox'):
   image=self.ensure_image(manifest['images'][service]['image']);require(image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==self.r['identity']['sourceRevision'],'CANDIDATE_IMAGE_SOURCE')
  runtime=self.runtime();plan=self.verify_ordinary_plan()
  if plan['pending']:refs.append(self.prepare_old_api_and_migrate(plan))
  bootstrap=json.loads(self.api_job('scripts/provision-admin.ts'));require(bootstrap.get('ok') is True,'ISOLATED_BOOTSTRAP')
  bootstrap_ref=save(self.dir/'bootstrap-proof.json',{'identity':self.r['identity'],'ok':True})
  self.compose('up','-d','--pull','never','--no-build')
  if plan['pending']:
   proof,proof_ref=self.prove_migration_compatibility(plan);facts['migrationCompatibility']=proof;refs.append(proof_ref)
  pg=self.owned(self.name+'-pg');network=json.loads(self.d('network','inspect',self.name+'-net'))[0]
  binding={'schemaVersion':1,'kind':'cn-auto-isolated-target','identity':self.r['identity'],'migrationPlanSha256':self.r['migrationPlanSha256'],'ownerLabel':self.key,'networkId':network['Id'],'networkName':self.name+'-net','postgresContainerId':pg['Id'],'postgresImageId':pg['Image'],'candidateApiImage':manifest['images']['api']['image'],'database':'workspacex','isolationScope':'attempt-local-docker','bootstrapEnvironment':{'path':str(runtime/'bootstrap.env'),'sha256':sha(private(str(runtime/'bootstrap.env')))}}
  binding_ref=save(self.dir/'isolated-target.json',binding)
  return facts,refs+[bootstrap_ref,binding_ref]
 def node_job(self,code,environment='migration.env',payload=None):
  image=self.effective_manifest()['images']['api']['image']
  return self.d('run','--rm','--pull=never','-i','--name',self.name+'-job','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--env-file',str(self.dir/'runtime'/environment),'--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--cpus=.3','--pids-limit=256','--entrypoint','node',image,'--import','tsx','--input-type=module','-e',code,data=None if payload is None else json.dumps(payload).encode(),timeout=300)
 def prepare_old_api_and_migrate(self,plan):
  state=self.read_state();runtime=self.dir/'runtime'
  baseline=json.loads(private(str(self.dir/'preparation-baseline.json')))
  require(baseline.get('schemaVersion')==2 and baseline.get('sourceRevision')==self.r['identity']['baselineSourceRevision'] and re.fullmatch('sha256:[a-f0-9]{64}',baseline.get('images',{}).get('api','')),'BASELINE_SNAPSHOT_SOURCE')
  old={'Image':baseline['images']['api']};old_image=self.ensure_image(old['Image'])
  require(old_image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==self.r['identity']['baselineSourceRevision'],'BASELINE_IMAGE_SOURCE')
  env=parse_env(private(str(runtime/'api.env')).decode());env['WORKSPACEX_DEPLOYMENT_MARKER']=state['oldMarker']
  oldenv=runtime/'old-api.env';fd=os.open(oldenv,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+v+'\n' for k,v in sorted(env.items())))
  self.d('run','-d','--pull=never','--name',self.name+'-old-api','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--network-alias','old-api','--env-file',str(oldenv),'--memory=512m','--cpus=.4','--pids-limit=256','--cap-drop=ALL','--security-opt=no-new-privileges',old['Image'])
  # Actor credentials are generated for this nonce in the clone only. No conflict
  # update can accidentally alter a restored user or organization.
  nonce=state['nonce'];org='cn-probe-'+nonce;user='cn-probe-user-'+nonce;email='cn-probe-'+nonce+'@example.invalid'
  code="import bcrypt from 'bcryptjs';let raw='';for await(const c of process.stdin)raw+=c;const v=JSON.parse(raw);console.log(JSON.stringify({hash:await bcrypt.hash(v.password,12)}));"
  password_hash=json.loads(self.node_job(code,payload={'password':state['probePassword']}))['hash'];require(re.fullmatch(r'\$2[aby]\$12\$[./A-Za-z0-9]{53}',password_hash),'PROBE_BCRYPT12')
  def literal(v):return chr(39)+v.replace(chr(39),chr(39)*2)+chr(39)
  self.psql('workspacex',"BEGIN; INSERT INTO organizations(id,name,kind,model_policy,status) VALUES ("+literal(org)+",'CN isolated runtime probe','organization','any','active'); INSERT INTO credentials(user_id,email,display_name,password_hash,email_verified_at) VALUES ("+literal(user)+','+literal(email)+",'CN isolated runtime probe',"+literal(password_hash)+",now()); INSERT INTO org_memberships(user_id,org_id,org_role,team_id) VALUES ("+literal(user)+','+literal(org)+",'lead',NULL); COMMIT;")
  actor=self.psql('workspacex',"SELECT count(*) FROM credentials c JOIN org_memberships m ON m.user_id=c.user_id JOIN organizations o ON o.id=m.org_id WHERE c.user_id="+literal(user)+" AND c.email="+literal(email)+" AND c.password_hash="+literal(password_hash)+" AND c.email_verified_at IS NOT NULL AND o.id="+literal(org)+" AND o.status='active' AND m.org_role='lead' AND m.team_id IS NULL AND (SELECT count(*) FROM org_memberships WHERE user_id=c.user_id)=1;")
  require(actor.strip()==b'1','CLONE_PROBE_ACTOR_READBACK')
  migration_code="import {migrate} from './src/infrastructure/db/migrator.ts';import {migrationConfig} from './src/infrastructure/db/pg-config.ts';console.log(JSON.stringify(await migrate(migrationConfig())));"
  applied=json.loads(self.node_job(migration_code));require(applied.get('applied')==[v['name'] for v in plan['pending']] and applied.get('skipped')==[v['name'] for v in plan['ledger']],'ACTUAL_MIGRATION_SET')
  ledger=json.loads(self.psql('workspacex',"SELECT json_agg(json_build_object('name',name,'checksum',checksum) ORDER BY name) FROM _kernel_migrations;"))
  expected=sorted([{k:v[k] for k in ('name','checksum')} for v in plan['ledger']+plan['pending']],key=lambda v:v['name'])
  require(ledger==expected,'MIGRATED_LEDGER_READBACK')
  return save(self.dir/'migration-execution.json',{'identity':self.r['identity'],'planSha256':plan['planSha256'],'pendingSha256':plan['pendingSha256'],'applied':applied['applied'],'skipped':applied['skipped'],'ledgerSha256':sha(json.dumps(ledger,separators=(',',':')).encode()),'baselineImageId':old['Image']})
 def prove_migration_compatibility(self,plan):
  state=self.read_state();runtime=self.dir/'runtime';bindings={}
  for role,name,marker in [('old',self.name+'-old-api',state['oldMarker']),('candidate',self.compose('ps','-q','api').decode().strip(),state['marker'])]:
   container=self.owned(name);image=json.loads(self.d('image','inspect',container['Image']))[0]
   expected=self.r['identity']['baselineSourceRevision' if role=='old' else 'sourceRevision']
   require(container['State']['Running'] and image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==expected and ObjectNone(container['HostConfig'].get('PortBindings')) and set(container['NetworkSettings']['Networks'])=={self.name+'-net'},'COMPAT_RUNTIME_BINDING')
   actualenv=parse_env('\n'.join(container['Config'].get('Env',[])));require(actualenv.get('PGHOST')=='postgres' and actualenv.get('PGDATABASE')=='workspacex' and actualenv.get('WORKSPACEX_DEPLOYMENT_MARKER')==marker,'COMPAT_RUNTIME_ENVIRONMENT')
   bindings[role]={'origin':'http://old-api:3200' if role=='old' else 'http://api:3200','deploymentMarker':marker,'containerId':container['Id'],'imageId':container['Image']}
  nonce=state['nonce'];probe={'schemaVersion':1,'nonce':nonce,'baselineSourceRevision':self.r['identity']['baselineSourceRevision'],'sourceRevision':self.r['identity']['sourceRevision'],'migrationPlanSha256':plan['planSha256'],'pendingSha256':plan['pendingSha256'],'orgId':'cn-probe-'+nonce,'userId':'cn-probe-user-'+nonce,'email':'cn-probe-'+nonce+'@example.invalid','password':state['probePassword'],**bindings}
  tool=self.e['toolCheckout'];self.ensure_image(self.e['browserImage'])
  # Readiness polling performs only GETs. The mutating compatibility probe runs
  # exactly once after both actual runtimes expose their distinct markers.
  readiness="let raw='';for await(const c of process.stdin)raw+=c;const v=JSON.parse(raw);for(const k of ['old','candidate']){let ok=false;const end=Date.now()+90000;while(Date.now()<end){try{const r=await fetch(v[k].origin+'/healthz',{redirect:'error',signal:AbortSignal.timeout(3000)});const h=await r.json();if(r.status===200&&h.trustworthy===true&&h.deploymentMarker===v[k].deploymentMarker){ok=true;break}}catch{}await new Promise(r=>setTimeout(r,1000))}if(!ok)throw new Error('PRIVATE_RUNTIME_NOT_READY')}console.log('PRIVATE_RUNTIMES_READY');"
  require(self.node_job(readiness,payload=bindings)==b'PRIVATE_RUNTIMES_READY\n','COMPAT_RUNTIME_READINESS')
  output=self.d('run','--rm','--pull=never','-i','--name',self.name+'-probe','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--memory=512m','--cpus=.3','--pids-limit=128','--mount','type=bind,src='+tool+',dst='+tool+',readonly','--entrypoint','node',self.e['browserImage'],tool+'/.harness/scripts/vm/cn-migration-runtime-probe.mjs',data=json.dumps(probe).encode(),timeout=180)
  result=json.loads(output);require(result.get('cleanupPassed') is True and 'reasonCode' not in result and all(result.get(k)==probe[k] for k in ('nonce','baselineSourceRevision','sourceRevision','migrationPlanSha256','pendingSha256')),'COMPATIBILITY_RESULT')
  transcript=result.get('httpEvidence');require(isinstance(transcript,list) and sha(json.dumps(transcript,separators=(',',':')).encode())==result.get('evidenceSha256'),'HTTP_EVIDENCE_HASH')
  for name in ('oldRead','oldWrite','candidateRead','candidateWrite'):
   check=result.get(name,{});length=check.get('evidenceLength');require(check.get('status')=='passed' and type(length) is int and 0<length<=len(transcript) and sha(json.dumps(transcript[:length],separators=(',',':')).encode())==check.get('evidenceSha256'),'HTTP_PHASE_EVIDENCE')
  ids=result.get('probeProjectIds',{});require(set(ids)=={'old','candidate'} and ids['old']!=ids['candidate'] and all(re.fullmatch('[A-Za-z0-9_-]{1,128}',v) for v in ids.values()),'OWNED_PROJECT_IDS')
  rows=self.psql('workspacex',"SELECT count(*) FROM projects WHERE org_id='cn-probe-"+nonce+"' AND status='archived' AND ((id='"+ids['old']+"' AND name='cn-drill-"+nonce+"-old') OR (id='"+ids['candidate']+"' AND name='cn-drill-"+nonce+"-candidate'));");require(rows.strip()==b'2','OWNED_PROJECT_SQL_READBACK')
  proof_ref=save(self.dir/'migration-runtime-proof.json',result)
  proof={'baselineSourceRevision':self.r['identity']['baselineSourceRevision'],'sourceRevision':self.r['identity']['sourceRevision'],'baselineSha256':self.r['identity']['baselineSha256'],'planSha256':plan['planSha256'],'pendingSha256':plan['pendingSha256'],'scope':'restored-baseline-runtime','sqlExecuted':True,'cleanupPassed':True}
  for name in ('oldRead','oldWrite','candidateRead','candidateWrite'):proof[name]={k:result[name][k] for k in ('status','evidenceSha256')}
  return proof,proof_ref
 def runtime(self):
  tool=self.verify_tool()
  require(self.run(['/usr/bin/git','-C',str(tool),'rev-parse','HEAD']).decode().strip()==self.policy['toolRevision'],'TOOL_SOURCE')
  require(not self.run(['/usr/bin/git','-C',str(tool),'status','--porcelain']).strip(),'DIRTY_TOOL_CHECKOUT')
  payload={'request':self.r,'policy':self.policy,'state':self.read_state()}
  self.run(['/usr/bin/node','--import','tsx',str(tool/'packages/cloud-deploy/src/cn-auto-preparation-cli.ts'),'--render-isolated'],json.dumps(payload).encode(),120)
  return self.dir/'runtime'
 def verify_tool(self):
  import stat
  tool=pathlib.Path(self.e['toolCheckout']);require(tool==pathlib.Path('/var/lib/workspacex-cn/auto-preparation-tools')/self.policy['toolRevision'],'TOOL_PATH')
  for path in (tool,*tool.parents):
   value=path.lstat();require(stat.S_ISDIR(value.st_mode) and not stat.S_ISLNK(value.st_mode) and value.st_uid==0 and not value.st_mode&0o022,'TOOL_PARENT_TRUST')
  return tool
 def compose(self,*args):return self.d('compose','-p',self.name,'-f',str(self.dir/'runtime'/'compose.json'),*args)
 def api_job(self,script,env_file='bootstrap.env'):
  image=self.effective_manifest()['images']['api']['image'];runtime=self.dir/'runtime'
  return self.d('run','--rm','--pull=never','--name',self.name+'-job','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--env-file',str(runtime/env_file),'--cap-drop=ALL','--security-opt=no-new-privileges','--memory=512m','--cpus=.3','--pids-limit=256','-e','PROVISION_TIMEOUT_MS=120000','--entrypoint','node',image,'--import','tsx',script,timeout=120)
 def effective_manifest(self):
  raw=private(str(self.dir/'input-manifest.json'));require(sha(raw)==self.r['dependencies'].get('manifest'),'MANIFEST_RAW_HASH');value=json.loads(raw)
  require(value['sourceRevision']==self.r['identity']['sourceRevision'],'MANIFEST_SOURCE')
  for key,digest in self.r['images'].items():require(value['images'][key]['image'].endswith('@'+digest),'MANIFEST_IMAGE')
  return value
 def readiness(self):
  manifest=self.effective_manifest()
  for key in ('api','web','agent','sandbox'):
   image=self.ensure_image(manifest['images'][key]['image']);require(image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==self.r['identity']['sourceRevision'],'CANDIDATE_IMAGE_SOURCE')
  runtime=self.dir/'runtime';bootstrap=json.loads(private(str(self.dir/'bootstrap-proof.json')));require(bootstrap.get('ok') is True,'ISOLATED_BOOTSTRAP')
  deadline=time.monotonic()+120
  while True:
   try:
    data_output=self.api_job('scripts/data-readiness.ts','api.env');service_output=self.api_job('scripts/cloud-service-readiness.ts','api.env')
    data=json.loads(data_output);services=json.loads(service_output)
    require(data=={'ok':True,'database':True,'migrations':True,'redis':True,'cloudVerified':False} and services=={'ok':True,'web':True,'api':True,'agentGraphs':True,'businessVerified':False},'READINESS_PRODUCER_OUTPUT');break
   except NotReady:
    require(time.monotonic()<deadline,'CANDIDATE_READINESS');time.sleep(1)
  versions={};digests={}
  for key in ('api','web','agent','sandbox'):
   cid=self.compose('ps','-q',key).decode().strip();require(bool(cid),'CANDIDATE_CONTAINER_MISSING');container=self.owned(cid)
   require(container['State']['Running'] is True,'CANDIDATE_NOT_RUNNING')
   image=json.loads(self.d('image','inspect',container['Image']))[0]
   require(image['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==self.r['identity']['sourceRevision'] and manifest['images'][key]['image'] in image.get('RepoDigests',[]),'RUNNING_IMAGE_SOURCE')
   versions[key]=image['Config']['Labels']['org.opencontainers.image.revision'];digests[key]=self.r['images'][key]
  env=parse_env(private(str(runtime/'api.env')).decode())
  # CopilotKit's durable timeout contract belongs to canonical ingress, not
  # ConfiguredModelProvider's unrelated request timeout.
  ingress=private(str(runtime/'shadow-nginx.conf')).decode()
  def route_timeout(route):
   found=re.search(r'location '+re.escape(route)+r' \{([^}]+)\}',ingress);require(found is not None,'CANONICAL_COPILOT_ROUTE')
   value=re.search(r'proxy_read_timeout ([0-9]+)s;',found.group(1));require(value is not None,'CANONICAL_COPILOT_TIMEOUT');return int(value.group(1))
  durable={'asrProfile':bool(env.get('KERNEL_ASR_API_KEY')),'platformSuperuserEmails':bool(env.get('PLATFORM_SUPERUSER_EMAILS')),'githubIssueProfile':bool(env.get('GITHUB_ISSUE_TOKEN')),'copilotkitExactTimeoutSeconds':route_timeout('= /api/copilotkit'),'copilotkitPrefixTimeoutSeconds':route_timeout('^~ /api/copilotkit/')}
  proof=save(self.dir/'readiness-proof.json',{'runtimeSourceShas':versions,'runtimeImages':digests,'durableConfig':durable,'bootstrap':{'ok':bootstrap['ok']},'dataProbe':{'result':data,'rawSha256':sha(data_output)},'serviceProbe':{'result':services,'rawSha256':sha(service_output)},'storageScope':'attempt-local-fs-not-production-oss'})
  return {'productionTargetUsed':False,'isolatedTarget':self.target(),'runtimeSourceShas':versions,'runtimeImages':digests,'allServicesReady':True,'durableConfig':durable},[proof]
 def business(self):
  for key in ('nginxImage','browserImage'):self.ensure_image(self.e[key])
  runtime=self.dir/'runtime';config=json.loads(private('/etc/workspacex-cn/candidate-configs/'+self.r['identity']['sourceRevision']+'/'+self.r['identity']['attemptId']+'/deployment.json'))
  from urllib.parse import urlparse
  origin=urlparse(config['environment']['publicUrl']);require(origin.scheme=='https' and origin.port in (None,443) and re.fullmatch('[A-Za-z0-9.-]+',origin.hostname),'ISOLATED_ORIGIN')
  certificate=str(runtime/'tls-fullchain.pem');key=str(runtime/'tls-private-key.pem');private(certificate);private(key)
  nginx=runtime/'shadow-nginx.conf';private(str(nginx))
  self.d('run','-d','--pull=never','--name',self.name+'-nginx','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--network-alias',origin.hostname,'--memory=64m','--cpus=.1','--pids-limit=128','--mount','type=bind,src='+str(nginx)+',dst=/etc/nginx/nginx.conf,readonly','--mount','type=bind,src='+certificate+',dst=/run/tls/cert.pem,readonly','--mount','type=bind,src='+key+',dst=/run/tls/key.pem,readonly',self.e['nginxImage'])
  tool=self.e['toolCheckout'];private_tool=pathlib.Path(tool);require(private_tool.is_absolute() and '..' not in private_tool.parts,'BROWSER_TOOL_PATH')
  output=self.d('run','--rm','--pull=never','--name',self.name+'-browser','--label','wsx.auto.owner='+self.key,'--network',self.name+'-net','--memory=512m','--cpus=.3','--pids-limit=512','--shm-size=256m','--mount','type=bind,src='+tool+',dst='+tool+',readonly','--mount','type=bind,src='+str(runtime/'bootstrap.env')+',dst=/run/bootstrap.env,readonly','-e','CN_BROWSER_EXECUTABLE_PATH='+self.e['browserExecutable'],'--entrypoint','node',self.e['browserImage'],tool+'/.harness/scripts/vm/cn-release-browser-smoke.mjs',config['environment']['publicUrl'],'/run/bootstrap.env',timeout=180)
  require(output==b'CN_BROWSER_SMOKE_PASSED\n','REAL_BROWSER_ACCEPTANCE')
  # Re-read running source identity after the real browser journey.
  for key in ('api','web'):
   cid=self.compose('ps','-q',key).decode().strip();require(self.owned(cid)['State']['Running'],'POST_BROWSER_RUNTIME')
  proof=save(self.dir/'browser-proof.json',{'identity':self.r['identity'],'probeSha256':sha(private_tool.joinpath('.harness/scripts/vm/cn-release-browser-smoke.mjs').read_bytes()),'rawProbeOutputSha256':sha(output),'scope':'isolated-login-and-authenticated-notifications','storageScope':'attempt-local-fs-not-production-oss'})
  return {'productionTargetUsed':False,'isolatedTarget':self.target(),'browser':{'loginPassed':True,'authenticatedNotificationsPassed':True,'sourceRuntimeVerified':True}},[proof]
 def cleanup(self):
  # Cleanup only containers carrying this cryptographic attempt owner. Never use
  # global docker prune, production names, shared volumes or role/password writes.
  ids=self.d('ps','-aq','--filter','label=wsx.auto.owner='+self.key).decode().split()
  for cid in ids:self.owned(cid);self.d('rm','-f','-v',cid)
  require(not self.d('ps','-aq','--filter','label=wsx.auto.owner='+self.key).strip(),'OWNED_CONTAINER_REMAINS')
  networks=self.d('network','ls','-q','--filter','label=wsx.auto.owner='+self.key).decode().split()
  for network in networks:
   v=json.loads(self.d('network','inspect',network))[0];require(v.get('Labels',{}).get('wsx.auto.owner')==self.key and not v.get('Containers'),'NETWORK_OWNER_OR_LIVE_ENDPOINT');self.d('network','rm',network)
  require(not self.d('network','ls','-q','--filter','label=wsx.auto.owner='+self.key).strip(),'OWNED_NETWORK_REMAINS')
  import shutil
  runtime=self.dir/'runtime'
  if runtime.exists():require(runtime.is_dir() and not runtime.is_symlink(),'RUNTIME_CLEANUP_PATH');shutil.rmtree(runtime)
  for path in (self.state,self.dir/'postgres.env',self.dir/'backup.env',self.dir/'redis.conf'):
   if path.exists():require(path.is_file() and not path.is_symlink(),'CREDENTIAL_CLEANUP_PATH');path.unlink()
  proof=save(self.dir/'cleanup-proof.json',{'identity':self.r['identity'],'ownedContainerCount':0,'ownedNetworkCount':0,'plaintextCredentialsAbsent':True})
  return {'isolatedTarget':self.target(),'ownedProcessesJoined':True,'ownedContainersAbsent':True,'ownedDatabasesAbsent':True,'ownedCredentialsAbsent':True,'productionResourcesChanged':False},[proof]
 def execute(self,stage):
  if stage!='cleanupIsolated':self.verify_ordinary_plan()
  method={'backup':self.backup,'restoreIsolated':self.restore,'shadowReadiness':self.readiness,'shadowBusiness':self.business,'cleanupIsolated':self.cleanup}[stage]
  facts,refs=method();now=utc()
  return {'schemaVersion':1,'kind':'cn-auto-preparation-stage','stage':stage,**self.r,'issuedAt':now.isoformat().replace('+00:00','Z'),'expiresAt':(now+datetime.timedelta(minutes=30)).isoformat().replace('+00:00','Z'),'facts':facts,'refs':refs}
def quote_ident(value):return chr(34)+value.replace(chr(34),chr(34)*2)+chr(34)
def ObjectNone(value):return not value or not any(value.values())
def parse_env(raw):
 result={}
 for line in raw.splitlines():
  if not line:continue
  key,sep,value=line.partition('=');require(sep and re.fullmatch('[A-Z][A-Z0-9_]*',key),'ENV_PARSE');result[key]=value
 return result
STREAM_FIDELITY=r'''import sys,hashlib,json
result={};current=None
for line in sys.stdin.buffer:
 if current is not None:
  if line==b'\.\n':current=None;continue
  result[current]['rows']+=1;result[current]['sum']=(result[current]['sum']+int.from_bytes(hashlib.sha256(line).digest(),'big'))%(1<<256)
 elif line.startswith(b'COPY ') and line.endswith(b' FROM stdin;\n'):
  current=line.decode().strip();result[current]={'rows':0,'sum':0}
 elif line.startswith(b'SELECT pg_catalog.setval('):result[line.decode().strip()]={'rows':0,'sum':0}
print(json.dumps(result,sort_keys=True))
'''
def main():
 require(os.geteuid()==0 and sys.platform=='linux','PROVIDER_ROOT_LINUX');require_lock()
 require(len(sys.argv)==3 and sys.argv[1]=='--stage','PROVIDER_USAGE')
 payload=json.loads(sys.stdin.buffer.read(65537));provider=Provider(payload)
 # Every outcome, including backup failure or a killed provider, is followed by
 # the outer CLI's independently dispatched cleanup stage. Do not consume its
 # create-once proof here and accidentally make the mandatory stage unreplayable.
 result=provider.execute(sys.argv[2])
 print(json.dumps(result,separators=(',',':')))
if __name__=='__main__':
 try:main()
 except BaseException as error:
  code=str(error) if isinstance(error,NotReady) and re.fullmatch('[A-Z_]{1,128}',str(error)) else 'EXECUTION_REJECTED'
  print('CN_AUTO_PREPARATION_PROVIDER_NOT_READY:'+code,file=sys.stderr);sys.exit(3)
