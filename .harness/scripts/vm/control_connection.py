"""Persistent TLS control helper protocol; import has no side effects.
Helper must retain one PostgreSQL client until close and report connection identity.
"""
import json,hashlib,subprocess,selectors,time
from writer_fence import require
class PersistentControlConnection:
 def __init__(self,plan,db,spawn=None,read_private=None,runtime_inventory=None,mode="control",bootstrap=False):
  from host_transport import private,SAFE_ENV
  read_private=read_private or private
  spec=plan['persistentControlHelper'];raw=read_private(spec['path'],0o700)
  require(hashlib.sha256(raw).hexdigest()==spec['sha256'],'CONTROL_HELPER_PIN')
  require(db in plan['databasePeers'],'CONTROL_DATABASE')
  require(mode in ('control','diagnostic'),'CONNECTION_MODE');self.mode=mode;probe=plan['controlProbe' if mode=='control' else 'databaseProbe']
  read_private(probe['serviceFile']);read_private(probe['caFile'],0o644)
  self.plan=plan;self.db=db;self.sequence=0;self.binding=None
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
  self.process=(spawn or subprocess.Popen)([runtime['nodePath'],spec['path'],'--persistent-control-json'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
  try:
   hello=self.request({'operation':'connect','toolRevision':plan.get('toolRevision'),'migrationAuthorization':plan.get('migrationAuthorization'),'roleTargets':plan['databaseWriterRoles'][db],'database':db,'mode':mode,'serviceFile':probe['serviceFile'],'caFile':probe['caFile'],'sslMode':'verify-full','applicationName':'wsx-maintenance-'+mode+'-'+plan['identity']['attemptId'],'identity':plan['identity']},bind=False)
   binding=hello['connection'];expected=plan['controlSessions' if mode=='control' else 'diagnosticSessions'][db] if not bootstrap else binding
   require(binding==expected and binding['peer']==plan['databasePeers'][db] and binding['tls']['ssl'] is True and (binding['role'] in plan['databaseWriterRoles'][db] if mode=='control' else binding['role']==plan['diagnosticRole']) and type(binding['pid']) is int and binding['pid']>1,'CONTROL_CONNECTION_IDENTITY')
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
 def query(self,query_id):
  require(self.mode=='diagnostic' and query_id in ('roles','sessions','migration-ledger'),'DIAGNOSTIC_QUERY_AUTHORITY')
  return self.request({'operation':'query','queryId':query_id})['value']
 def migrate_exact_plan(self,identity):
  require(self.mode=='control' and identity==self.plan['identity'],'MIGRATION_EXISTING_SESSION_IDENTITY')
  auth=self.plan.get('migrationAuthorization');require(auth and auth.get('identity')==identity and type(auth.get('operationTimeoutMs')) is int and 10000<=auth['operationTimeoutMs']<=1800000,'MIGRATION_EXPLICIT_AUTHORIZATION')
  return self.request({'operation':'migrate-exact-plan','identity':identity},deadline_seconds=auth['operationTimeoutMs']/1000)['value']
 def execute(self,sql):return self.request({'operation':'execute','sql':sql})
 def close(self):
  if getattr(self,'process',None):
   if self.process.stdin:self.process.stdin.close()
   try:self.process.wait(timeout=2)
   except subprocess.TimeoutExpired:self.process.terminate();self.process.wait(timeout=2)
   if self.process.stdout:self.process.stdout.close()
