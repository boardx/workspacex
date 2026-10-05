"""Fixed maintenance probes. No caller-selected executables or privileged actions on import."""
import os,json,time,pathlib,hashlib,re,urllib.request
from writer_fence import require,digest,DATABASES,Journal,validate_admission_plan
from control_connection import verify_bound_transport
HOLD_HELPER='/usr/local/lib/workspacex-cn/cn_maintenance_hold.py'
HOLD_DIRECTORY='/var/lib/workspacex-cn/runtime'
PROFILE='/etc/workspacex-cn/trusted-tool-binding.json'
ROLE_SQL="""BEGIN TRANSACTION READ ONLY; SELECT json_build_object('peer',json_build_object('database',current_database(),'serverAddr',inet_server_addr()::text,'serverPort',inet_server_port(),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())), 'currentRole',current_user,'selfPid',pg_backend_pid(),'tls',(SELECT json_build_object('ssl',ssl,'version',version,'cipher',cipher) FROM pg_stat_ssl WHERE pid=pg_backend_pid()),'roles',(SELECT json_agg(json_build_object('name',rolname,'login',rolcanlogin,'superuser',rolsuper,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls)) FROM pg_roles),'diagnosticPrivileges',json_build_object('databaseWrite',has_database_privilege(current_user,current_database(),'CREATE,TEMP'),'schemaWrite',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(current_user,oid,'CREATE')),'tableWrite',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE c.relkind IN ('r','p','v','f','m') AND n.nspname NOT IN ('pg_catalog','information_schema') AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),'sequenceWrite',EXISTS(SELECT 1 FROM pg_class c WHERE c.relkind='S' AND has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE')),'definerExecute',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege(current_user,p.oid,'EXECUTE')),'privilegedMembership',EXISTS(SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR r.rolname IN ('pg_write_server_files','pg_execute_server_program','pg_signal_backend')) AND pg_has_role(current_user,r.oid,'MEMBER')))); ROLLBACK;"""
def classify_processes(plan,processes,self_pid):
 expected={b['binding']['pid']:b['binding'] for b in plan['writers'] if b['binding']['kind']=='process'}
 reviewed={p['pid']:p for p in [*plan['reviewedNonWriterProcesses'],*plan.get('runtimeHelperProcesses',[])]};containers={b['binding']['containerId'] for b in plan['writers'] if b['binding']['kind']=='container'}
 unknown=[]
 for p in processes:
  if p['pid']==self_pid:
   require(p['uid']==0,'CONTROLLER_PROCESS_OWNER');continue
  if p['exe'] is None and p['uid']==0 and p.get('flags',0)&0x00200000:continue
  segments=re.split(r'[/\s:.]+',p['cgroup'])
  cid=next((c for c in containers if c in segments or ('docker-'+c) in segments),None)
  if cid is not None:continue
  target=expected.get(p['pid']) or reviewed.get(p['pid'])
  keys=('pid','startTicks','uid','exe','exeSha256','cgroup','processGroup')
  if target is None or any(target.get(k)!=p.get(k) for k in keys):unknown.append({k:p.get(k) for k in keys})
 return unknown

def validate_roles(plan,db,observation):
 validate_admission_plan(plan)
 expected_tls=True
 if plan.get('connectionTransportAuthorizations') is not None:
  bound=plan['diagnosticSessions'][db];expected_tls=verify_bound_transport(plan,db,'diagnostic',bound)
  require(observation['selfPid']==bound['pid'] and observation['currentRole']==bound['role'],'ROLE_EXISTING_SESSION_BINDING')
 require(observation['peer']==plan['databasePeers'][db] and observation['tls']['ssl'] is expected_tls,'ROLE_PEER_TLS')
 require(observation['currentRole']==plan['diagnosticRole'] and all(v is False for v in observation['diagnosticPrivileges'].values()) and set(observation['diagnosticPrivileges'])=={'databaseWrite','schemaWrite','tableWrite','sequenceWrite','definerExecute','privilegedMembership'},'DIAGNOSTIC_EFFECTIVE_WRITE_PRIVILEGE')
 roles=observation['roles'];require(len({r['name'] for r in roles})==len(roles),'ROLE_INVENTORY_DUPLICATE')
 writers=set(plan['databaseWriterRoles'][db]);allnames={r['name'] for r in roles};require(writers<=allnames and plan['diagnosticRole'] not in writers,'ROLE_TARGET_CLOSURE')
 unfenced=[r['name'] for r in roles if r['login'] is True and r['name']!=plan['diagnosticRole'] and r['name'] not in writers]
 require(not unfenced,'UNFENCED_ADMIN_MANUAL_LOGIN_ROLES:'+','.join(sorted(unfenced)))
 require(all(type(r['login']) is bool for r in roles),'ROLE_LOGIN_TYPE')
 return {r['name']:r['login'] for r in roles if r['name'] in writers}

def classify_sessions(plan,observation,role_observation):
 db=observation['database'];validate_roles(plan,db,role_observation)
 require(observation['peer']==role_observation['peer'],'SESSION_PEER_BINDING');sessions=[]
 for s in observation['sessions']:
  value=dict(s);role=s['role']
  if plan.get('connectionTransportAuthorizations') is None:require(s.get('ssl') is True,'SESSION_TLS_UNPROVEN')
  else:
   mode='control' if s['pid']==plan['controlSessions'][db]['pid'] else 'diagnostic'
   bound=plan[mode+'Sessions'][db];expected_tls=verify_bound_transport(plan,db,mode,bound)
   require(s.get('ssl') is expected_tls and (expected_tls or s['clientAddr']==bound['socket']['localAddress']),'SESSION_TRANSPORT_UNPROVEN')
  if role==plan['diagnosticRole']:
   bound=plan['diagnosticSessions'][db]
   require(s['pid']==bound['pid'] and s['backendStart']==bound['backendStart'] and s['pid']==role_observation['selfPid'],'DIAGNOSTIC_SESSION_EXACT_BINDING')
   require(s['applicationName']=='wsx-maintenance-diagnostic-'+plan['identity']['attemptId'] and s['clientAddr']==plan['diagnosticClientAddress'] and s['backendType']=='client backend','DIAGNOSTIC_SESSION_IDENTITY')
   value['clientIdentity']=plan['diagnosticClientIdentity'];value['transactionMode']='read-only'
  elif s['pid']==plan.get('controlSessions',{}).get(db,{}).get('pid'):
   bound=plan['controlSessions'][db]
   require(s['backendStart']==bound['backendStart'] and role==bound['role'] and s['clientAddr']==bound['clientAddr'] and s['applicationName']=='wsx-maintenance-control-'+plan['identity']['attemptId'] and s['backendType']=='client backend' and s['state']=='idle' and s.get('xactStart') is None,'CONTROL_SESSION_EXACT_BINDING')
   value['clientIdentity']='maintenance-control';value['transactionMode']='idle-controlled'
  else:
   require(role in plan['databaseWriterRoles'][db],'UNCLASSIFIED_DB_SESSION_ROLE');value['clientIdentity']='writer:'+role;value['transactionMode']='write-capable'
  sessions.append(value)
 return sessions

def sql_literal(value):return "'"+str(value).replace("'","''")+"'"
def login_cas_sql(peer,before,after):
 require(set(before)==set(after) and before and all(type(v) is bool for v in [*before.values(),*after.values()]),'LOGIN_CAS_TARGETS')
 require(all(re.fullmatch('[a-zA-Z0-9_-]+',r) for r in before),'LOGIN_ROLE_NAME')
 require(type(peer['serverPort']) is int and re.fullmatch('[0-9]+',peer['systemIdentifier']),'LOGIN_PEER_FORMAT')
 checks=["IF current_database() IS DISTINCT FROM %s OR inet_server_addr()::text IS DISTINCT FROM %s OR inet_server_port() IS DISTINCT FROM %d OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM %s THEN RAISE EXCEPTION 'LOGIN_PEER_CAS'; END IF;"%(sql_literal(peer['database']),sql_literal(peer['serverAddr']),peer['serverPort'],sql_literal(peer['systemIdentifier']))]
 for role,enabled in before.items():checks.append("IF (SELECT rolcanlogin FROM pg_authid WHERE rolname=%s) IS DISTINCT FROM %s THEN RAISE EXCEPTION 'LOGIN_STATE_CAS'; END IF;"%(sql_literal(role),'true' if enabled else 'false'))
 changes=['ALTER ROLE "%s" %s;'%(role,'LOGIN' if enabled else 'NOLOGIN') for role,enabled in after.items()]
 # Catalog lock prevents concurrent role state changes between check and ALTER.
 return 'BEGIN; LOCK TABLE pg_authid IN SHARE ROW EXCLUSIVE MODE; DO $login_cas$ BEGIN '+''.join(checks)+' END $login_cas$; '+''.join(changes)+' COMMIT;'

class FixedProbes:
 def __init__(self,transport):self.transport=transport;self.plan=transport.plan
 def hold(self):
  from host_transport import private
  private(HOLD_DIRECTORY+'/hold.lock');raw=private(HOLD_HELPER,0o700);profile=json.loads(private(PROFILE))
  require(profile['toolRevision']==self.plan['toolRevision'] and hashlib.sha256(raw).hexdigest()==profile['filesSha256']['.harness/scripts/vm/cn_maintenance_hold.py'],'HOLD_HELPER_EXACT_BINDING')
  return json.loads(self.transport.run(['/usr/bin/python3',HOLD_HELPER,'read',HOLD_DIRECTORY]))
 def instance(self):
  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}));base='http://100.100.100.200/latest/'
  request=urllib.request.Request(base+'api/token',method='PUT',headers={'X-aliyun-ecs-metadata-token-ttl-seconds':'300'})
  with opener.open(request,timeout=2) as response:token=response.read(4096).decode()
  require(token and '\n' not in token and '\r' not in token,'IMDS_TOKEN_PROTOCOL')
  request=urllib.request.Request(base+'meta-data/instance-id',headers={'X-aliyun-ecs-metadata-token':token})
  with opener.open(request,timeout=2) as response:instance=response.read(128).decode().strip()
  require(instance==self.plan['host']['instanceId'],'IMDS_INSTANCE_IDENTITY');return {'instanceId':instance,'identity':self.plan['identity']}
 def role_observation(self,db):return self.transport.database_json(db,ROLE_SQL)
 def admission(self):
  login={};observations={}
  for db in DATABASES:
   value=self.role_observation(db);login[db]=validate_roles(self.plan,db,value);observations[db]=value
  return {'kind':'role-login-v1','login':login},observations
 def acceptance(self):
  from host_transport import private
  spec=self.plan['acceptanceEvidence'];raw=private(spec['path']);require(hashlib.sha256(raw).hexdigest()==spec['sha256'],'ACCEPTANCE_RECEIPT_PIN');value=json.loads(raw)
  require(value['identity']==self.plan['identity'],'ACCEPTANCE_IDENTITY');return value
 def mutate_admission(self,action):
  t=self.transport;p=self.plan;validate_admission_plan(p);t.require_lock();h=self.hold();require(h['state']=='held' and h['identity']==p['identity'] and h['generation']==p['holdGeneration'],'LOGIN_HELD_IDENTITY')
  actual,observations=self.admission();require(actual==action['before'],'LOGIN_ADMISSION_CAS')
  require(action['after'] in (p['closedAdmission'],p['originalAdmission']),'LOGIN_AFTER_AUTHORITY')
  journal=Journal(p['journalDirectory'],p['identity'])
  try:
   require(journal.value.get('planSha256')==digest(p),'LOGIN_JOURNAL_PLAN')
   if 'loginPrior' not in journal.value:
    require(action['kind']=='close-database-admission' and actual==p['originalAdmission'],'LOGIN_PRIOR_REQUIRED');journal.value['loginPrior']=actual;journal.save()
   else:require(journal.value['loginPrior']==p['originalAdmission'],'LOGIN_PRIOR_DRIFT')
   if action['kind']=='restore-database-admission':require(action['after']==journal.value['loginPrior'],'LOGIN_RESTORE_ORIGINAL_ONLY')
   groups={}
   for db in DATABASES:
    peer=observations[db]['peer'];groups.setdefault(peer['systemIdentifier'],[]).append(db)
   for system,dbs in groups.items():
    first=dbs[0];before=actual['login'][first];after=action['after']['login'][first]
    require(all(actual['login'][db]==before and action['after']['login'][db]==after for db in dbs),'CLUSTER_ROLE_MAP_DRIFT')
    intent={'kind':action['kind'],'peer':observations[first]['peer'],'before':before,'after':after,'databases':dbs};journal.record('login-cas-intent',action=intent,holdGeneration=h['generation'])
    try:t.database_execute(first,login_cas_sql(observations[first]['peer'],before,after),control=True)
    except BaseException:
     journal.record('write-state-unknown',pendingAction=intent,holdDisposition='retain');raise
    journal.record('login-cas-response',action=intent)
   readback,_=self.admission();require(readback==action['after'],'LOGIN_CAS_READBACK');journal.record('login-cas-readback',admission=readback)
  finally:journal.close()
