"""Actual private Node/pg fixed-operation channel with a closed DB-API adapter.
Only cn_backup_sql constants and its exact bound mutation compiler are accepted.
"""
import datetime,hashlib,json,os,pathlib,selectors,subprocess,time
from cn_backup_package import require,validate,compile_role_sql,ROLE
from cn_backup_sql import QUERIES,grant_statements
from host_transport import private,SAFE_ENV


def query_table():
 out={}
 for key,(sql,params) in QUERIES.items():
  index=[0]
  def parameter(_):index[0]+=1;return '$'+str(index[0])
  import re
  out[key]={'sql':re.sub('%s',parameter,sql),'params':list(params)}
 out['begin-readonly']={'sql':'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY','params':[]}
 out['rollback-readonly']={'sql':'ROLLBACK','params':[]}
 from cn_backup_backend import BACKUP_SESSION_SQL
 out['backup-sessions']={'sql':BACKUP_SESSION_SQL,'params':[]}
 return out


def mutation_table(plan,scope,cleanup_only=False,*,expected_identity):
 frozen=compile_role_sql(plan,scope,now=plan['authorization']['notBefore'] if cleanup_only else None,expected_identity=expected_identity);out={}
 for db in scope:
  out[db]={'create':[frozen['create'].rstrip(';')],'grant':grant_statements(scope,db),
   'close':[frozen['close'].rstrip(';')],'revoke':grant_statements(scope,db,True),
   'begin':['BEGIN'],'commit':['COMMIT'],'rollback':['ROLLBACK']}
 return out


class BackupChannel:
 def __init__(self,host_reference,db,read=private,spawn=subprocess.Popen,cleanup_only=False,*,expected_identity):
  raw=read(host_reference['path']);require(hashlib.sha256(raw).hexdigest()==host_reference['sha256'],'BACKUP_CHANNEL_HOST_PIN')
  require(type(cleanup_only) is bool,'BACKUP_CLEANUP_MODE');self.cleanup_only=cleanup_only
  self.host=json.loads(raw);validate(self.host['backup'],now=self.host['backup']['authorization']['notBefore'] if cleanup_only else None,expected_identity=expected_identity);self.database=db
  profile=json.loads(read('/etc/workspacex-cn/trusted-tool-binding.json'));runtime=self.host['connection']['runtime']
  require(profile['toolRevision']==self.host['backup']['toolRevision'] and profile['backupHostPlan']==host_reference and
          runtime==profile['backupRuntime'],'BACKUP_CHANNEL_PROFILE')
  spec=self.host['connection']['helper'];require(spec['path']=='/usr/local/lib/workspacex-cn/backup_connection.cjs' and
     hashlib.sha256(read(spec['path'],0o700)).hexdigest()==spec['sha256']==profile['installedFilesSha256'][spec['path']],'BACKUP_CHANNEL_HELPER')
  require(hashlib.sha256(read(runtime['nodePath'],0o755)).hexdigest()==runtime['nodeSha256'],'BACKUP_CHANNEL_NODE')
  require(runtime['pgModulePath'] in runtime['files'],'BACKUP_CHANNEL_PG')
  for name,expected in runtime['files'].items():require(hashlib.sha256(read(name,0o644)).hexdigest()==expected,'BACKUP_CHANNEL_RUNTIME')
  table=self.host['queryTable'];require(json.loads(read(table['path'],0o700))==query_table(),'BACKUP_CHANNEL_FIXED_QUERIES')
  require(self.host['statements']==mutation_table(self.host['backup'],self.host['objectScope'],cleanup_only,expected_identity=expected_identity),'BACKUP_CHANNEL_FIXED_MUTATIONS')
  self.process=spawn([runtime['nodePath'],spec['path'],'--backup-json',host_reference['path'],host_reference['sha256'],db]+(['--cleanup-only'] if cleanup_only else []),
       stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=SAFE_ENV,start_new_session=True)
  self.sequence=0
  try:
   hello=self.receive(10);require(hello['sequence']==0 and hello.get('ok') is True,'BACKUP_CHANNEL_HELLO');self.binding=hello['connection']
   require(self.binding['role']=='migration_admin' and self.binding['peer']['database']==db,'BACKUP_CHANNEL_ADMIN_IDENTITY')
  except BaseException:self.close();raise

 def receive(self,seconds):
  selector=selectors.DefaultSelector();data=bytearray();deadline=time.monotonic()+seconds
  try:
   selector.register(self.process.stdout,selectors.EVENT_READ)
   while b'\n' not in data:
    require(len(data)<1048576 and time.monotonic()<deadline,'BACKUP_CHANNEL_RESPONSE_BOUND')
    require(selector.select(max(0,deadline-time.monotonic())),'BACKUP_CHANNEL_RESPONSE_TIMEOUT')
    b=os.read(self.process.stdout.fileno(),1);require(b,'BACKUP_CHANNEL_CLOSED');data.extend(b)
   return json.loads(data)
  finally:selector.close()

 def request(self,message):
  require(not getattr(self,'cleanup_only',False) or message.get('operation')=='query' or message.get('action') in ('close','revoke','begin','commit','rollback') or message.get('operation')=='quiesce-owned-admin','BACKUP_CLEANUP_ONLY_OPERATION')
  require(self.process.poll() is None,'BACKUP_CHANNEL_PROCESS_EXITED');self.sequence+=1
  payload=dict(message,sequence=self.sequence)
  raw=(json.dumps(payload,separators=(',',':'))+'\n').encode();require(len(raw)<=65536,'BACKUP_CHANNEL_REQUEST_BOUND')
  self.process.stdin.write(raw);self.process.stdin.flush();reply=self.receive(15)
  require(reply.get('sequence')==self.sequence and reply.get('ok') is True and reply.get('connection')==self.binding,'BACKUP_CHANNEL_RESPONSE_IDENTITY')
  return reply

 def quiesce_owned_admin(self,target):
  require(getattr(self,'cleanup_only',False),'BACKUP_QUIESCE_CLEANUP_ONLY')
  reply=self.request({'operation':'quiesce-owned-admin','target':target})
  require(reply['rows']==[{'joined':True}],'BACKUP_QUIESCE_UNPROVEN');return True

 def verify_backup_transport(self,facts):
  require(not getattr(self,'cleanup_only',False),'BACKUP_CLEANUP_ONLY_OPERATION')
  reply=self.request({'operation':'verify-backup-transport','facts':facts})
  require(reply['rows']==[{'verified':True}],'BACKUP_CANONICAL_ROLE_TRANSPORT_REJECTED');return True

 def cursor(self):return Cursor(self)
 def close(self):
  if not getattr(self,'process',None):return
  if self.process.stdin:
   try:self.process.stdin.close()
   except BrokenPipeError:pass
  try:self.process.wait(timeout=2)
  except subprocess.TimeoutExpired:
   self.process.terminate()
   try:self.process.wait(timeout=2)
   except subprocess.TimeoutExpired:self.process.kill();self.process.wait(timeout=2)
  if self.process.stdout:self.process.stdout.close()


class Cursor:
 def __init__(self,channel):self.channel=channel;self.description=[];self.data=[]
 def execute(self,sql,params=()):
  db=self.channel.database;p=self.channel.host['backup'];frozen=self.channel.host['statements'][db]
  message=None
  for key,(expected,bound) in QUERIES.items():
   if sql==expected and tuple(params)==bound:message={'operation':'query','queryId':key};break
  if sql=='BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' and not params:
   message={'operation':'query','queryId':'begin-readonly'}
  if message is None:
   if sql=='ALTER ROLE "'+ROLE+'" PASSWORD %s LOGIN' and len(params)==1:
    message={'operation':'mutation','action':'login','password':params[0]}
   elif sql.startswith('CREATE ROLE "'+ROLE+'" ') and sql.endswith(' VALID UNTIL %s') and len(params)==1:
    expected=frozen['create'][0];expires=datetime.datetime.fromtimestamp(p['authorization']['expiresAt'],datetime.timezone.utc).isoformat()
    require(params[0]==expires and sql.replace('%s',"'"+expires+"'")==expected,'BACKUP_CHANNEL_CREATE_BINDING')
    message={'operation':'mutation','action':'create','statement':0}
   else:
    require(not params,'BACKUP_CHANNEL_PARAMETER_OVERRIDE')
    for action,statements in frozen.items():
     if sql in statements:message={'operation':'mutation','action':action,'statement':statements.index(sql)};break
  require(message is not None,'BACKUP_CHANNEL_ARBITRARY_SQL_REJECTED')
  reply=self.channel.request(message);names=reply['fields'];self.description=[(name,) for name in names]
  self.data=[tuple(row.get(name) for name in names) for row in reply['rows']]
 def fetchall(self):return self.data
 def close(self):self.data=[]
