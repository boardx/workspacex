"""Persistent protected-transport control helper protocol; import has no side effects.
Helper must retain one PostgreSQL client until close and report connection identity.
"""
import json,hashlib,subprocess,selectors,time
from writer_fence import require
def verify_bound_transport(plan,db,mode,binding):
 """Check a source-plan-bound helper result; only the pinned Node helper proves provider/config/socket authority."""
 auth=plan.get('connectionTransportAuthorizations',{}).get(db,{}).get(mode)
 if auth is None:
  require(binding.get('tls',{}).get('ssl') is True,'BOUND_SESSION_TLS');return True
 source=auth.get('source',{});socket=binding.get('socket',{});now=time.time()
 require(auth.get('identity')==plan['identity'] and auth.get('toolRevision')==plan['toolRevision'] and auth.get('kind')=='existing-production-maintenance-transport' and source.get('database')==db and source.get('user')==binding.get('role') and source.get('sslMode')=='disable' and type(auth.get('notBefore')) in (int,float) and type(auth.get('expiresAt')) in (int,float) and auth['notBefore']<=now<auth['expiresAt'] and auth['expiresAt']-auth['notBefore']<=3600,'BOUND_SESSION_AUTHORITY')
 require(binding.get('tls',{}).get('ssl') is False and binding.get('transport')=={'sslMode':'disable','configurationSha256':source.get('configurationSha256'),'providerEvidenceSha256':source.get('providerEvidenceSha256')} and socket.get('encrypted') is False and socket.get('authorized') is False and socket.get('localAddress')=='192.168.100.40' and hashlib.sha256(socket.get('remoteAddress','').encode()).hexdigest()==source.get('clientPeerAddressSha256') and socket.get('remotePort')==source.get('clientPeerPort'),'BOUND_SESSION_OBSERVED_PROOF')
 return False
class PersistentControlConnection:
 def __init__(self,plan,db,spawn=None,read_private=None,runtime_inventory=None,mode="control",bootstrap=False):
  from host_transport import private,SAFE_ENV
  read_private=read_private or private
  spec=plan['persistentControlHelper'];raw=read_private(spec['path'],0o700)
  require(hashlib.sha256(raw).hexdigest()==spec['sha256'],'CONTROL_HELPER_PIN')
  require(db in plan['databasePeers'],'CONTROL_DATABASE')
  require(mode in ('control','diagnostic'),'CONNECTION_MODE');self.mode=mode;probe=plan['controlProbe' if mode=='control' else 'databaseProbe']
  auth=plan.get('connectionTransportAuthorizations',{}).get(db,{}).get(mode)
  if plan.get('connectionTransportAuthorizations') is not None:
   require(set(plan['connectionTransportAuthorizations'])==set(plan['databasePeers']) and all(set(v)=={'control','diagnostic'} for v in plan['connectionTransportAuthorizations'].values()),'CONTROL_TRANSPORT_DATABASE_MODE_CLOSURE')
   require(auth and auth.get('identity')==plan['identity'] and auth.get('toolRevision')==plan.get('toolRevision') and auth.get('source',{}).get('database')==db and auth.get('source',{}).get('sslMode')=='disable','CONTROL_TRANSPORT_PLAN_BINDING')
  read_private(probe['serviceFile'])
  if auth is None:read_private(probe['caFile'],0o644)
  else:
   require(auth.get('configurationPath')=='/etc/workspacex-cn/maintenance-host/'+plan['identity']['sourceRevision']+'/'+plan['identity']['attemptId']+'/approved-baseline-deployment.json','CONTROL_TRANSPORT_CONFIG_PATH')
   require(hashlib.sha256(read_private(auth['configurationPath'])).hexdigest()==auth.get('configurationSha256')==auth['source'].get('configurationSha256'),'CONTROL_TRANSPORT_CONFIG_PIN')
   require(hashlib.sha256(read_private('/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs',0o700)).hexdigest()==auth.get('librarySha256'),'CONTROL_TRANSPORT_LIBRARY_PIN')
  self.plan=plan;self.db=db;self.sequence=0;self.binding=None;self.read_private=read_private
  runtime=plan['controlRuntime'];node=read_private(runtime['nodePath'],0o755)
  require(hashlib.sha256(node).hexdigest()==runtime['nodeSha256'],'CONTROL_NODE_PIN')
  require(runtime['files'] and runtime['pgModulePath'] in runtime['files'],'CONTROL_PG_CLOSURE')
  import pathlib,os
  root=pathlib.Path(runtime['rootPath']);require(root.is_absolute(),'CONTROL_RUNTIME_ROOT')
  actual=set()
  if runtime_inventory is not None:actual=set(runtime_inventory(root))
  else:
   require(root.is_dir() and not root.is_symlink(),'CONTROL_RUNTIME_ROOT')
   for directory,dirs,files in os.walk(root,followlinks=False):
    for name in dirs:require(not (pathlib.Path(directory)/name).is_symlink(),'CONTROL_RUNTIME_SYMLINK')
    for name in files:actual.add(str(pathlib.Path(directory)/name))
  require(actual==set(runtime['files']),'CONTROL_RUNTIME_CLOSURE')
  for path,expected in runtime['files'].items():require(hashlib.sha256(read_private(path,0o644)).hexdigest()==expected,'CONTROL_RUNTIME_FILE_PIN')
  env=dict(SAFE_ENV,WSX_TRUSTED_PG_MODULE=runtime['pgModulePath'])
  recovery_descriptors=()
  if plan.get('recoveryAuthorization'):
   recovery=runtime.get('recoveryModulePath');require(type(recovery) is str and recovery.endswith('/retained_session_recovery.cjs') and recovery in runtime['files'] and runtime['files'][recovery]==plan['recoveryAuthorization']['librarySha256'],'RECOVERY_RUNTIME_CLOSURE')
   env['WSX_TRUSTED_RECOVERY_MODULE']=recovery
   os.fstat(9);recovery_descriptors=(9,)
  self.process=(spawn or subprocess.Popen)([runtime['nodePath'],spec['path'],'--persistent-control-json'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,pass_fds=recovery_descriptors)
  try:
   hello=self.request({'operation':'connect','toolRevision':plan.get('toolRevision'),'migrationAuthorization':plan.get('migrationAuthorization'),'backupHostReference':plan.get('backupHostReference'),'recoveryAuthorization':plan.get('recoveryAuthorization'),'diagnosticRole':plan['diagnosticRole'],'roleTargets':plan['databaseWriterRoles'][db],'database':db,'mode':mode,'serviceFile':probe['serviceFile'],'caFile':probe['caFile'],'sslMode':'disable' if auth else 'verify-full',**({'connectionTransport':auth} if auth else {}),'applicationName':'wsx-maintenance-'+mode+'-'+plan['identity']['attemptId'],'identity':plan['identity']},bind=False)
   binding=hello['connection'];expected=plan['controlSessions' if mode=='control' else 'diagnosticSessions'][db] if not bootstrap else binding
   require(binding==expected and binding['peer']==plan['databasePeers'][db] and binding['tls']['ssl'] is (auth is None) and (binding['role'] in plan['databaseWriterRoles'][db] if mode=='control' else binding['role']==plan['diagnosticRole']) and type(binding['pid']) is int and binding['pid']>1,'CONTROL_CONNECTION_IDENTITY')
   if auth:
    source=auth['source'];socket=binding.get('socket',{})
    require(binding.get('transport')=={'sslMode':'disable','configurationSha256':source['configurationSha256'],'providerEvidenceSha256':source['providerEvidenceSha256']} and socket.get('encrypted') is False and socket.get('authorized') is False and socket.get('localAddress')=='192.168.100.40' and hashlib.sha256(socket.get('remoteAddress','').encode()).hexdigest()==source['clientPeerAddressSha256'] and socket.get('remotePort')==source['clientPeerPort'],'CONTROL_TRANSPORT_OBSERVED_BINDING')
   verify_bound_transport(plan,db,mode,binding)
   if mode=='control':require(hello.get('capabilities')=={'catalogLockAuthority':True,'alterRoleAuthority':True},'CONTROL_ROLE_CAS_CAPABILITY')
   self.binding=binding
  except BaseException:self.close();raise
 def request(self,payload,bind=True,deadline_seconds=10):
  require(self.process.poll() is None,'CONTROL_CONNECTION_LOST');self.sequence+=1
  message=dict(payload,sequence=self.sequence)
  self.process.stdin.write((json.dumps(message,separators=(',',':'))+'\n').encode());self.process.stdin.flush()
  selector=selectors.DefaultSelector()
  try:
   selector.register(self.process.stdout,selectors.EVENT_READ)
   require(selector.select(deadline_seconds),'CONTROL_RESPONSE_DEADLINE')
   # Helper protocol caps each complete newline-delimited response; no unbounded readline.
   output=bytearray();deadline=time.monotonic()+deadline_seconds
   import os
   while b'\n' not in output:
    require(len(output)<1024*1024 and time.monotonic()<deadline,'CONTROL_RESPONSE_LIMIT')
    require(selector.select(max(0,deadline-time.monotonic())),'CONTROL_RESPONSE_DEADLINE')
    chunk=os.read(self.process.stdout.fileno(),1);require(chunk,'CONTROL_CONNECTION_LOST');output.extend(chunk)
   value=json.loads(output);require(value['sequence']==self.sequence and value.get('ok') is True,'CONTROL_RESPONSE_PROTOCOL')
   if bind:require(value['connection']==self.binding,'CONTROL_CONNECTION_CHANGED')
   return value
  finally:selector.close()
 def bind_retained_backup(self,host_reference):
  require(self.mode=='control' and self.plan.get('backupHostReference')==host_reference,'RETAINED_BACKUP_REVIEWED_REFERENCE')
  import re
  require(type(host_reference) is dict and set(host_reference)=={'path','sha256'} and host_reference['path']=='/etc/workspacex-cn/maintenance-backup/'+self.plan['identity']['sourceRevision']+'/'+self.plan['identity']['attemptId']+'/host-plan.json' and re.fullmatch('[a-f0-9]{64}',host_reference['sha256']),'RETAINED_BACKUP_PRIVATE_REFERENCE')
  runtime=self.plan['controlRuntime'];library='/usr/local/lib/workspacex-cn/retained_backup_helper.cjs'
  extensions=runtime.get('sourceExtensions',{})
  require(set(extensions)=={library,'/usr/local/lib/workspacex-cn/backup_connection.cjs'},'RETAINED_BACKUP_RUNTIME_MISSING')
  for path,expected in runtime['files'].items():require(hashlib.sha256(self.read_private(path,0o644)).hexdigest()==expected,'RETAINED_BACKUP_RUNTIME_DRIFT')
  for path,expected in extensions.items():require(hashlib.sha256(self.read_private(path,0o700)).hexdigest()==expected,'RETAINED_BACKUP_EXTENSION_DRIFT')
  value=self.request({'operation':'bind-retained-backup','hostReference':host_reference})['value']
  require(type(value) is dict and set(value)=={'protocol'},'RETAINED_BACKUP_NEGOTIATION')
  self.retained_backup_protocol=value['protocol'];return self.retained_backup_protocol
 def verify_live_transport(self,provider):
  require(self.mode=='diagnostic' and type(provider) is dict and set(provider)=={'attribute','ssl','allowlist','network'},'LIVE_TRANSPORT_AUTHORITY')
  return self.request({'operation':'verify-live-transport','provider':provider})['value']
 def query(self,query_id,params=None):
  require(self.mode=='diagnostic' and query_id in ('roles','sessions','migration-ledger','run-drain','candidate-sessions','owned-release-runs','held-candidate-schema','held-candidate-permissions','held-candidate-seed'),'DIAGNOSTIC_QUERY_AUTHORITY')
  message={'operation':'query','queryId':query_id}
  if query_id=='owned-release-runs':
   import re
   require(type(params) is dict and set(params)=={'runIds'} and type(params['runIds']) is list and 1<=len(params['runIds'])<=128 and len(set(params['runIds']))==len(params['runIds']) and all(type(v) is str and re.fullmatch('[A-Za-z0-9_-]{1,128}',v) for v in params['runIds']),'OWNED_RUN_ID_SCOPE')
   message['params']=params
  elif query_id.startswith('held-candidate-'):
   import re
   require(type(params) is dict and set(params)=={'expectedReadbackSha256'} and type(params['expectedReadbackSha256']) is str and re.fullmatch('[a-f0-9]{64}',params['expectedReadbackSha256']),'HELD_READBACK_HASH_SCOPE');message['params']=params
  else:require(params is None,'DIAGNOSTIC_QUERY_PARAMS_FORBIDDEN')
  return self.request(message)['value']
 def migrate_exact_plan(self,identity):
  require(self.mode=='control' and identity==self.plan['identity'],'MIGRATION_EXISTING_SESSION_IDENTITY')
  auth=self.plan.get('migrationAuthorization');require(auth and auth.get('identity')==identity and type(auth.get('operationTimeoutMs')) is int and 10000<=auth['operationTimeoutMs']<=1800000,'MIGRATION_EXPLICIT_AUTHORIZATION')
  return self.request({'operation':'migrate-exact-plan','identity':identity},deadline_seconds=auth['operationTimeoutMs']/1000)['value']
 def execute(self,sql):return self.request({'operation':'execute','sql':sql})
 def recover_existing_session(self,identity):
  require(self.mode=='control' and identity==self.plan['identity'],'RECOVERY_EXISTING_SESSION_IDENTITY')
  auth=self.plan.get('recoveryAuthorization');require(auth and auth.get('identity')==identity and type(auth.get('operationTimeoutMs')) is int and 10000<=auth['operationTimeoutMs']<=1800000,'RECOVERY_EXPLICIT_AUTHORIZATION')
  # Recovery loads additional modules lazily: recheck the whole source/runtime
  # closure immediately before that load, not only at initial Client connect.
  runtime=self.plan['controlRuntime'];require(runtime['files'][runtime['recoveryModulePath']]==auth['librarySha256'],'RECOVERY_RUNTIME_CLOSURE')
  for path,expected in runtime['files'].items():require(hashlib.sha256(self.read_private(path,0o644)).hexdigest()==expected,'RECOVERY_RUNTIME_FILE_DRIFT')
  return self.request({'operation':'recover-existing-session','identity':identity},deadline_seconds=auth['operationTimeoutMs']/1000+15)['value']
 def close(self):
  if getattr(self,'process',None):
   if self.process.stdin:self.process.stdin.close()
   try:self.process.wait(timeout=2)
   except subprocess.TimeoutExpired:self.process.terminate();self.process.wait(timeout=2)
   if self.process.stdout:self.process.stdout.close()
