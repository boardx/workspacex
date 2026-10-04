"""Fixed backup catalog/permission transport. No CLI or arbitrary SQL input.
Only source-owned dispatch may mutate, after root-private approval validation.
"""
import datetime,hashlib,json,math,os,pathlib,re,stat,time
from cn_backup_package import ROLE,FUNCTIONS,RDS,ECS,validate,compile_role_sql,identifier
DATABASES=('workspacex','workspacex_agent','workspacex_memory')
def need(ok,code):
 if not ok:raise RuntimeError(code)
QUERIES={
 'identity':("SELECT current_database() database,current_setting('transaction_read_only') readonly,current_setting('transaction_isolation') isolation",()),
 'schemas':("SELECT n.nspname name,pg_get_userbyid(n.nspowner) owner,n.nspacl::text acl FROM pg_namespace n WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_' ORDER BY n.nspname",()),
 'relations':("SELECT n.nspname schema,c.relname name,c.relkind kind,pg_get_userbyid(c.relowner) owner,c.relacl::text acl,c.relrowsecurity rls,c.relforcerowsecurity force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_' AND c.relkind IN ('r','p','v','m','S','f') ORDER BY n.nspname,c.relname",()),
 'largeObjects':("SELECT oid,pg_get_userbyid(lomowner) owner,lomacl::text acl FROM pg_largeobject_metadata ORDER BY oid",()),
 'functions':("SELECT p.oid::regprocedure::text signature,n.nspname schema,p.proname name,p.prokind kind,p.prosecdef security_definer,pg_get_userbyid(p.proowner) owner,p.provolatile volatility,l.lanname language,l.lanpltrusted language_trusted,p.proconfig,p.prosrc body,pg_get_function_identity_arguments(p.oid) arguments,COALESCE(p.proacl,acldefault('f',p.proowner))::text acl,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.is_grantable) public_grantable,COALESCE((SELECT json_agg(json_build_object('grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantor,a.privilege_type) FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0),'[]'::json) public_acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_' ORDER BY p.oid::regprocedure::text",()),
 'role':("SELECT oid,rolname name,rolsuper superuser,rolinherit inherit,rolcreaterole create_role,rolcreatedb create_db,rolcanlogin login,rolreplication replication,rolbypassrls bypass_rls,rolconnlimit connection_limit,rolvaliduntil::text valid_until,rolconfig FROM pg_roles WHERE rolname=%s",(ROLE,)),
 'password':("SELECT rolname name,rolpassword IS NULL password_null FROM pg_authid WHERE rolname=%s",(ROLE,)),
 'memberships':("SELECT roleid role_oid,member member_oid,grantor grantor_oid,pg_get_userbyid(roleid) role,pg_get_userbyid(member) member,pg_get_userbyid(grantor) grantor,admin_option,to_jsonb(m)->>'inherit_option' inherit_option,to_jsonb(m)->>'set_option' set_option FROM pg_auth_members m WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname=%s) OR member=(SELECT oid FROM pg_roles WHERE rolname=%s)",(ROLE,ROLE)),
 'databases':("SELECT d.datname name,pg_get_userbyid(d.datdba) owner,d.datallowconn allow_connections,CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) THEN has_database_privilege(%s,d.oid,'CONNECT') END connect,CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) THEN has_database_privilege(%s,d.oid,'TEMP') END temp,CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) THEN has_database_privilege(%s,d.oid,'CREATE') END create,EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='TEMPORARY') public_temp,EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=0 AND a.privilege_type='CONNECT') public_connect FROM pg_database d ORDER BY d.datname",(ROLE,)*6),
 'sessions':("SELECT pid,backend_start::text backend_start,application_name,state FROM pg_stat_activity WHERE usename=%s ORDER BY pid",(ROLE,)),
 'effectiveSchemas':("SELECT n.nspname name,pg_get_userbyid(n.nspowner) owner,has_schema_privilege(%s,n.oid,'USAGE') usage,has_schema_privilege(%s,n.oid,'CREATE') create FROM pg_namespace n WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) ORDER BY n.nspname",(ROLE,)*3),
 'effectiveRelations':("SELECT n.nspname schema,c.relname name,c.relkind kind,pg_get_userbyid(c.relowner) owner,has_table_privilege(%s,c.oid,'SELECT') readable,(has_table_privilege(%s,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(%s,c.oid,'INSERT,UPDATE,REFERENCES')) writable,has_table_privilege(%s,c.oid,'SELECT WITH GRANT OPTION') grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) ORDER BY n.nspname,c.relname",(ROLE,)*5),
 'effectiveSequences':("SELECT n.nspname schema,c.relname name,pg_get_userbyid(c.relowner) owner,has_sequence_privilege(%s,c.oid,'SELECT') readable,has_sequence_privilege(%s,c.oid,'USAGE,UPDATE') writable,has_sequence_privilege(%s,c.oid,'SELECT WITH GRANT OPTION') grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) ORDER BY n.nspname,c.relname",(ROLE,)*4),
 'effectiveFunctions':("SELECT p.oid::regprocedure::text signature,n.nspname schema,p.proname name,p.prosecdef security_definer,p.provolatile volatility,l.lanname language,l.lanpltrusted language_trusted,has_function_privilege(%s,p.oid,'EXECUTE') executable,has_function_privilege(%s,p.oid,'EXECUTE WITH GRANT OPTION') grantable,pg_get_userbyid(p.proowner) owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE (n.nspname<>'information_schema' AND n.nspname !~ '^pg_' OR p.prosecdef OR p.proname IN ('lo_create','lo_creat','lo_import','lo_unlink','lo_put','lowrite')) AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) ORDER BY p.oid::regprocedure::text",(ROLE,)*3),
 'explicitGrants':("SELECT 'database' kind,'' schema,d.datname name,a.privilege_type privilege,a.is_grantable grantable,pg_get_userbyid(a.grantor) grantor FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=%s) UNION ALL SELECT 'schema','',n.nspname,a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor) FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=%s) UNION ALL SELECT CASE WHEN c.relkind='S' THEN 'sequence' ELSE 'table' END,n.nspname,c.relname,a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END,c.relowner))) a WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=%s) UNION ALL SELECT 'function',n.nspname,p.oid::regprocedure::text,a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=%s)",(ROLE,)*4),
}
# Fresh connected actor observations; capability is observed, never inferred from RDS account names.
QUERIES.update({
 'actor':("SELECT r.oid oid,current_user name,session_user session_user,r.rolsuper superuser,r.rolcreaterole create_role,r.rolbypassrls bypass_rls,r.rolinherit inherit,r.rolcreatedb create_db FROM pg_roles r WHERE r.rolname=current_user",()),
 'bootstrapRole':("SELECT oid,rolname name,rolsuper superuser FROM pg_roles WHERE oid=10",()),
 'actorMemberships':("SELECT pg_get_userbyid(m.roleid) role,pg_get_userbyid(m.member) member,m.admin_option,to_jsonb(m)->>'inherit_option' inherit_option,to_jsonb(m)->>'set_option' set_option FROM pg_auth_members m WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user) ORDER BY m.roleid",()),
 'actorDatabases':("SELECT d.datname name,pg_get_userbyid(d.datdba) owner,has_database_privilege(current_user,d.oid,'CONNECT') connect,has_database_privilege(current_user,d.oid,'CONNECT WITH GRANT OPTION') connect_grantable FROM pg_database d ORDER BY d.datname",()),
 'actorSchemas':("SELECT n.nspname name,pg_get_userbyid(n.nspowner) owner,has_schema_privilege(current_user,n.oid,'USAGE') usage,has_schema_privilege(current_user,n.oid,'USAGE WITH GRANT OPTION') usage_grantable FROM pg_namespace n WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_' ORDER BY n.nspname",()),
 'actorRelations':("SELECT n.nspname schema,c.relname name,pg_get_userbyid(c.relowner) owner,has_table_privilege(current_user,c.oid,'SELECT') readable,has_table_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION') select_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_' ORDER BY n.nspname,c.relname",()),
 'actorSequences':("SELECT n.nspname schema,c.relname name,pg_get_userbyid(c.relowner) owner,has_sequence_privilege(current_user,c.oid,'SELECT') readable,has_sequence_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION') select_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_' ORDER BY n.nspname,c.relname",()),
 'effectiveColumns':("SELECT n.nspname schema,c.relname name,a.attname column,has_column_privilege(%s,c.oid,a.attnum,'SELECT') readable,has_column_privilege(%s,c.oid,a.attnum,'INSERT,UPDATE,REFERENCES') writable,has_column_privilege(%s,c.oid,a.attnum,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') grantable FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f') AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_' AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s) ORDER BY n.nspname,c.relname,a.attnum",(ROLE,)*4),
 'columnACLs':("SELECT n.nspname schema,c.relname name,a.attname column,a.attacl::text acl,pg_get_userbyid(x.grantee) grantee,x.grantee=0 public,x.privilege_type privilege,x.is_grantable grantable,pg_get_userbyid(x.grantor) grantor FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_' ORDER BY n.nspname,c.relname,a.attnum,x.grantee,x.privilege_type",()),
})
_column_sql=" UNION ALL SELECT 'column',n.nspname,c.relname||'.'||a.attname,x.privilege_type,x.is_grantable,pg_get_userbyid(x.grantor) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attnum>0 AND NOT a.attisdropped AND x.grantee=(SELECT oid FROM pg_roles WHERE rolname=%s)"
QUERIES['explicitGrants']=(QUERIES['explicitGrants'][0]+_column_sql,QUERIES['explicitGrants'][1]+(ROLE,))

def rows(cursor):
 names=[d[0] for d in cursor.description];return [dict(zip(names,row)) for row in cursor.fetchall()]
def capture(connection,database):
 need(database in DATABASES,'BACKUP_SQL_DATABASE_SCOPE');c=connection.cursor();facts={}
 try:
  c.execute('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  for name,(sql,params) in QUERIES.items():
   c.execute(sql,params);facts[name]=rows(c)
  need(facts['identity']==[{'database':database,'readonly':'on','isolation':'repeatable read'}],'BACKUP_SQL_READONLY_IDENTITY')
  facts['database']=database
 except BaseException:raise RuntimeError('BACKUP_SQL_CAPTURE_FAILED') from None
 finally:
  try:c.execute('ROLLBACK')
  except BaseException:raise RuntimeError('BACKUP_SQL_ROLLBACK_UNPROVEN') from None
  finally:c.close()
 return facts

def capture_scope(catalogs):
 need(set(catalogs)==set(DATABASES),'BACKUP_SQL_DATABASE_CLOSURE');result={}
 for db,facts in catalogs.items():
  need(facts['database']==db,'BACKUP_SQL_CATALOG_DATABASE')
  result[db]={'schemas':[v['name'] for v in facts['schemas']],'tables':[{'schema':v['schema'],'name':v['name']} for v in facts['relations'] if v['kind'] in ('r','p','v','m','f')],'sequences':[{'schema':v['schema'],'name':v['name']} for v in facts['relations'] if v['kind']=='S'],'largeObjects':facts['largeObjects']}
 return result

def public_capability_gaps(facts,authorization=None):
 """Pre-create review, independent of whether the temporary role exists."""
 allowed=()
 if authorization is not None:
  need(type(authorization) is ProtectedAuthorization and authorization._seal is _AUTH_SEAL and time.time()<authorization.expires_at,'BACKUP_SQL_PROTECTED_AUTHORIZATION_REQUIRED')
  allowed=authorization.allowed_public_temp
 gaps=set()
 for d in facts['databases']:
  if d['public_temp'] is True and d['name'] not in allowed:gaps.add('UNAPPROVED_PUBLIC_DATABASE_TEMP')
  if d['name'] not in DATABASES and d['public_connect'] is True:gaps.add('OTHER_DATABASE_PUBLIC_CONNECT_UNPROVEN')
 names={}
 for f in facts['functions']:
  if f['public_execute'] is not True:continue
  if f.get('public_grantable') is True:gaps.add('PUBLIC_FUNCTION_GRANT_OPTION')
  if f['security_definer'] is True:
   names[f['name']]=names.get(f['name'],0)+1
   if f['name'] not in FUNCTIONS or hashlib.sha256(f['body'].encode()).hexdigest()!=FUNCTIONS[f['name']]:gaps.add('UNAPPROVED_PUBLIC_DEFINER')
   if f.get('language') not in ('sql','plpgsql') or f.get('language_trusted') is not True:gaps.add('PUBLIC_DEFINER_LANGUAGE_UNPROVEN')
 if any(n>1 for n in names.values()):gaps.add('PUBLIC_DEFINER_OVERLOAD_SCOPE_UNPROVEN')
 return sorted(gaps)
def creator_admin_edge_only(facts):
 """PG16 bootstrap grant is management authority, not outward role inheritance.
 This does not assert the creator cannot grant itself SET/INHERIT later.
 No mutation removes or widens this automatically generated edge.
 """
 edges=facts['memberships']
 if not edges:return True
 actors=facts['actor'];bootstrap=facts['bootstrapRole'];roles=facts['role']
 if len(edges)!=1 or len(actors)!=1 or len(bootstrap)!=1 or len(roles)!=1:return False
 a=actors[0];b=bootstrap[0];e=edges[0]
 return (a.get('name')=='migration_admin' and a.get('session_user')==a['name']
         and a.get('create_role') is True and a.get('superuser') is False
         and type(a.get('oid')) is int and a['oid']!=10
         and b.get('oid')==10 and b.get('superuser') is True
         and e.get('role')==ROLE and e.get('member')==a['name']
         and e.get('member_oid')==a['oid'] and e.get('grantor_oid')==10
         and e.get('grantor')==b.get('name') and type(b.get('name')) is str
         and e.get('role_oid')==roles[0].get('oid') and type(e.get('role_oid')) is int
         and e.get('admin_option') is True
         and e.get('set_option')=='false' and e.get('inherit_option')=='false')

def expected_grants(scope):
 out={('database','',db,'CONNECT') for db in DATABASES}
 # Database ACLs are cluster-wide and therefore captured from each DB connection.
 for db,item in scope.items():
  for schema in item['schemas']:out.add(('schema','',schema,'USAGE'))
  for key,kind in (('tables','table'),('sequences','sequence')):
   for v in item[key]:out.add((kind,v['schema'],v['name'],'SELECT'))
 return out

def permission_gaps(facts,scope,phase='open',allowed_public_temp=()):
 """No permissive capability flag. Raw effective permissions determine gaps."""
 need(phase in ('open','closed'),'BACKUP_SQL_PHASE');gaps=set();db=facts['database'];item=scope[db]
 expected={('database','',d,'CONNECT') for d in DATABASES}|{('schema','',s,'USAGE') for s in item['schemas']}|{('table',v['schema'],v['name'],'SELECT') for v in item['tables']}|{('sequence',v['schema'],v['name'],'SELECT') for v in item['sequences']}
 role=facts['role'];password=facts['password']
 if len(role)!=1 or len(password)!=1 or role[0]['name']!=ROLE or password[0]['name']!=ROLE:gaps.add('ROLE_OR_PASSWORD_UNOBSERVABLE');return sorted(gaps)
 r=role[0]
 if any(r[k] is not False for k in ('superuser','inherit','create_role','create_db','replication')):gaps.add('ROLE_PRIVILEGED_ATTRIBUTE')
 if r['bypass_rls'] is not (phase=='open'):gaps.add('ROLE_BYPASS_STATE')
 if not creator_admin_edge_only(facts):gaps.add('ROLE_MEMBERSHIP_OR_SET_ROLE_PATH')
 if phase=='closed' and (r['login'] is not False or password[0]['password_null'] is not True or r['connection_limit']!=0 or facts['sessions']):gaps.add('ROLE_CLEANUP_STATE')
 if phase=='open' and r['connection_limit']!=1:gaps.add('ROLE_CONNECTION_BOUND')
 if r['rolconfig'] not in (None,[]):gaps.add('ROLE_CONFIG_DRIFT')
 for d in facts['databases']:
  if d['owner']==ROLE or d['create'] is True:gaps.add('DATABASE_OWNER_OR_CREATE')
  if d['temp'] is True and d['name'] not in allowed_public_temp:gaps.add('UNAPPROVED_EFFECTIVE_DATABASE_TEMP')
  if d['name'] not in DATABASES and (d['connect'] is True or d['temp'] is True or d['create'] is True):gaps.add('OTHER_DATABASE_ACCESS_UNPROVEN')
  if phase=='open' and d['name'] in DATABASES and d['connect'] is not True:gaps.add('DATABASE_CONNECT_MISSING')
 for group in ('effectiveSchemas','effectiveRelations','effectiveSequences','effectiveFunctions'):
  for v in facts[group]:
   if v['owner']==ROLE or v.get('create') is True or v.get('writable') is True or v.get('grantable') is True:gaps.add('EFFECTIVE_WRITE_OWNER_OR_GRANT_OPTION')
   if group=='effectiveFunctions' and v['executable'] is True:
    if v['schema']=='pg_catalog' and v['name'] in ('lo_create','lo_creat','lo_import','lo_unlink','lo_put','lowrite'):gaps.add('EFFECTIVE_BUILTIN_OBJECT_WRITE')
    elif v['security_definer'] is True:
     f=[f for f in facts['functions'] if f['signature']==v['signature']]
     if len(f)!=1 or f[0]['name'] not in FUNCTIONS or hashlib.sha256(f[0]['body'].encode()).hexdigest()!=FUNCTIONS[f[0]['name']]:gaps.add('UNAPPROVED_DEFINER_FUNCTION_EXECUTE')
    elif v.get('language_trusted') is not True or v.get('language') not in ('sql','plpgsql'):gaps.add('INVOKER_LANGUAGE_CAPABILITY_UNPROVEN')
   if phase=='open':
    if group=='effectiveSchemas' and v['usage'] is not True and v['name'] in item['schemas']:gaps.add('EXACT_SCHEMA_USAGE_MISSING')
    if group in ('effectiveRelations','effectiveSequences'):
     category='sequences' if group=='effectiveSequences' else 'tables';wanted={(x['schema'],x['name']) for x in item[category]};key=(v['schema'],v['name'])
     if v['readable'] is not True and key in wanted:gaps.add('EXACT_OBJECT_READ_MISSING')
     if v['readable'] is True and key not in wanted:gaps.add('OTHER_EFFECTIVE_OBJECT_READ')
 for v in facts['effectiveColumns']:
  if v['writable'] is True or v['grantable'] is True:gaps.add('EFFECTIVE_COLUMN_WRITE_OR_GRANT_OPTION')
  if phase=='open' and v['readable'] is True and (v['schema'],v['name']) not in {(x['schema'],x['name']) for x in item['tables']}:gaps.add('OTHER_EFFECTIVE_COLUMN_READ')
 explicit={(v['kind'],v['schema'],v['name'],v['privilege']) for v in facts['explicitGrants']}
 if any(v['grantable'] is not False for v in facts['explicitGrants']):gaps.add('EXPLICIT_GRANT_OPTION')
 if phase=='open' and explicit!=expected:gaps.add('EXACT_GRANT_SCOPE_MISMATCH')
 if phase=='closed' and explicit:gaps.add('EXPLICIT_GRANTS_REMAIN')
 return sorted(gaps)

class ProtectedAuthorization:
 __slots__=('plan_sha256','expires_at','allowed_public_temp','_seal','_permissions')
 def __init__(self,plan_sha256,expires_at,allowed_public_temp,seal):
  need(seal is _AUTH_SEAL,'BACKUP_SQL_AUTHORIZATION_ISSUER');self.plan_sha256=plan_sha256;self.expires_at=expires_at;self.allowed_public_temp=tuple(allowed_public_temp);self._seal=seal;self._permissions=None
_AUTH_SEAL=object()
def plan_digest(plan):return hashlib.sha256(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def protected_json(path,expected):
 p=pathlib.Path(path)
 for parent in p.parents:
  st=parent.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and st.st_gid==0 and not st.st_mode&0o022,'BACKUP_APPROVAL_PARENT')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  st=os.fstat(f.fileno());need(stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600 and st.st_size<=65536,'BACKUP_APPROVAL_FILE');raw=f.read(65537)
 need(hashlib.sha256(raw).hexdigest()==expected,'BACKUP_APPROVAL_HASH');return json.loads(raw)
def protected_authorization(plan):
 validate(plan);a=plan['authorization'];base=pathlib.Path('/etc/workspacex-cn/backup-approvals')/plan['identity']['attemptId']
 allowed=()
 for kind,key in (('role','roleApprovalSha256'),('public-capability','publicCapabilityApprovalSha256')):
  value=protected_json(base/(kind+'.json'),a[key]);required={'schemaVersion','identity','action','rdsInstanceId','ecsInstanceId','role','notBefore','expiresAt','functions','allowedPublicTemp'}
  need(type(value) is dict and set(value)==required and value['schemaVersion']==1 and value['identity']==plan['identity'] and value['action']=='bounded-three-db-backup-read' and value['rdsInstanceId']==RDS and value['ecsInstanceId']==ECS and value['role']==ROLE,'BACKUP_APPROVAL_SCOPE')
  need(value['notBefore']==a['notBefore'] and value['expiresAt']==a['expiresAt'] and value['functions']==FUNCTIONS,'BACKUP_APPROVAL_CAPABILITY')
  delta=value['allowedPublicTemp']
  need(type(delta) is list and (delta==[] or (kind=='public-capability' and delta==list(DATABASES))),'BACKUP_PUBLIC_TEMP_APPROVAL_SCOPE')
  if kind=='public-capability':allowed=tuple(delta)
 return ProtectedAuthorization(plan_digest(plan),a['expiresAt'],allowed,_AUTH_SEAL)
def authorization_check(auth,plan,cleanup=False):
 need(type(auth) is ProtectedAuthorization and auth._seal is _AUTH_SEAL and auth.plan_sha256==plan_digest(plan),'BACKUP_SQL_PROTECTED_AUTHORIZATION_REQUIRED')
 if not cleanup:need(time.time()<auth.expires_at,'BACKUP_SQL_AUTHORIZATION_EXPIRED');validate(plan)

def verify_fresh_permissions(auth,plan,scope,connections):
 authorization_check(auth,plan)
 need(set(connections)==set(DATABASES),'BACKUP_SQL_THREE_CONNECTIONS')
 observed={}
 for db in DATABASES:
  facts=capture(connections[db],db)
  need(not permission_gaps(facts,scope,allowed_public_temp=auth.allowed_public_temp),'BACKUP_SQL_EFFECTIVE_PERMISSION_GAP')
  need(len(facts['role'])==1 and facts['role'][0]['login'] is False and facts['password'][0]['password_null'] is True and facts['sessions']==[],'BACKUP_SQL_NOLOGIN_PREFLIGHT')
  try:lease=datetime.datetime.fromisoformat(facts['role'][0]['valid_until'].replace(' ','T')).timestamp()
  except (ValueError,TypeError):raise RuntimeError('BACKUP_ROLE_VALID_UNTIL_UNOBSERVABLE') from None
  need(abs(lease-auth.expires_at)<1,'BACKUP_ROLE_LEASE_DRIFT')
  observed[db]=facts
 auth._permissions=(plan_digest(plan),plan_digest(scope),time.monotonic())
 return observed
def query(cursor,key):
 sql,params=QUERIES[key];cursor.execute(sql,params);return rows(cursor)
def no_login_state(cursor,closed=False,expires_at=None):
 role=query(cursor,'role');password=query(cursor,'password');memberships=query(cursor,'memberships')
 need(len(role)==1 and len(password)==1 and role[0]['name']==ROLE and password[0]['name']==ROLE,'BACKUP_ROLE_READBACK_REQUIRED')
 need(creator_admin_edge_only({'memberships':memberships,'actor':query(cursor,'actor'),'bootstrapRole':query(cursor,'bootstrapRole'),'role':role}),'BACKUP_ROLE_MEMBERSHIP_OR_SET_ROLE_PATH')
 r=role[0];need(all(r[k] is False for k in ('superuser','inherit','create_role','create_db','replication','login')) and password[0]['password_null'] is True and r['bypass_rls'] is (not closed) and r['connection_limit']==(0 if closed else 1),'BACKUP_ROLE_NOLOGIN_ATTRIBUTES')
 # No unreviewed role settings/search_path may survive reconciliation.
 need(r['rolconfig'] is None or r['rolconfig']==[],'BACKUP_ROLE_CONFIG_DRIFT')
 if expires_at is not None:
  try:actual=datetime.datetime.fromisoformat(r['valid_until'].replace(' ', 'T')).timestamp()
  except (ValueError,TypeError):raise RuntimeError('BACKUP_ROLE_VALID_UNTIL_UNOBSERVABLE') from None
  need(abs(actual-expires_at)<1,'BACKUP_ROLE_LEASE_DRIFT')
 return r

def grant_statements(scope,database,revoke=False):
 need(database in DATABASES and set(scope)==set(DATABASES),'BACKUP_SQL_SCOPE');item=scope[database];role=identifier(ROLE);verb='REVOKE' if revoke else 'GRANT';direction='FROM' if revoke else 'TO';out=[]
 out.append(f'{verb} CONNECT ON DATABASE {identifier(database)} {direction} {role}')
 need(set(item)=={'schemas','tables','sequences','largeObjects'} and item['largeObjects']==[],'BACKUP_SQL_OBJECT_SCOPE')
 seen=set()
 for schema in item['schemas']:
  need(schema not in seen,'BACKUP_SQL_DUPLICATE_SCHEMA');seen.add(schema);out.append(f'{verb} USAGE ON SCHEMA {identifier(schema)} {direction} {role}')
 for key,kind in (('tables','TABLE'),('sequences','SEQUENCE')):
  seen=set()
  for value in item[key]:
   need(set(value)=={'schema','name'} and value['schema'] in item['schemas'],'BACKUP_SQL_OBJECT');target=identifier(value['schema'])+'.'+identifier(value['name']);need(target not in seen,'BACKUP_SQL_DUPLICATE_OBJECT');seen.add(target);out.append(f'{verb} SELECT ON {kind} {target} {direction} {role}')
 return out

def dispatch(connection,plan,scope,auth,action,database=None,password=None):
 """DB-API utility DDL parameter adaptation must be supported by host driver.
 No SQL text/role/name/privilege can be supplied as an operation argument.
 Secret password parameters are never returned, logged or copied into errors.
 """
 need(action in ('create','grant','login','close','revoke'),'BACKUP_SQL_ACTION')
 cleanup=action in ('close','revoke');authorization_check(auth,plan,cleanup)
 need(hashlib.sha256(json.dumps(scope,sort_keys=True,separators=(',',':')).encode()).hexdigest()==plan['objectScopeSha256'],'BACKUP_SQL_SCOPE_HASH')
 need((action in ('grant','revoke'))==(database is not None),'BACKUP_SQL_DATABASE_ARGUMENT')
 need(action=='login' or password is None,'BACKUP_SQL_PASSWORD_ARGUMENT')
 c=connection.cursor()
 try:
  c.execute('BEGIN')
  actual=query(c,'identity')
  need(len(actual)==1 and actual[0]['database'] in DATABASES and (database is None or actual[0]['database']==database),'BACKUP_SQL_MUTATION_DATABASE_IDENTITY')
  if action=='create':
   actor=query(c,'actor')
   need(len(actor)==1 and actor[0].get('name')=='migration_admin' and actor[0].get('session_user')=='migration_admin' and actor[0].get('create_role') is True and actor[0].get('superuser') is False,'BACKUP_SQL_CREATOR_PERMISSION_UNPROVEN')
   need(query(c,'role')==[],'BACKUP_ROLE_ALREADY_EXISTS');expires=datetime.datetime.fromtimestamp(auth.expires_at,datetime.timezone.utc).isoformat()
   c.execute('CREATE ROLE '+identifier(ROLE)+' NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT BYPASSRLS CONNECTION LIMIT 1 VALID UNTIL %s',(expires,));no_login_state(c,expires_at=auth.expires_at)
  elif action=='grant':
   no_login_state(c,expires_at=auth.expires_at)
   for sql in grant_statements(scope,database):c.execute(sql)
   explicit=query(c,'explicitGrants');actual={(v['kind'],v['schema'],v['name'],v['privilege']) for v in explicit}
   item=scope[database];wanted={('database','',database,'CONNECT')}|{('schema','',v,'USAGE') for v in item['schemas']}|{('table',v['schema'],v['name'],'SELECT') for v in item['tables']}|{('sequence',v['schema'],v['name'],'SELECT') for v in item['sequences']}
   need(wanted<=actual and all(v['grantable'] is False for v in explicit),'BACKUP_SQL_GRANT_READBACK')
  elif action=='login':
   before=no_login_state(c,expires_at=auth.expires_at);need(type(password) is str and re.fullmatch('[A-Za-z0-9_-]{48,128}',password),'BACKUP_PRIVATE_PASSWORD_FORMAT')
   proof=auth._permissions
   need(proof is not None and proof[:2]==(plan_digest(plan),plan_digest(scope)) and 0<=time.monotonic()-proof[2]<=5,'BACKUP_SQL_FRESH_PERMISSION_PROOF_REQUIRED')
   auth._permissions=None # Consume once; no reuse after any LOGIN attempt.
   c.execute('ALTER ROLE '+identifier(ROLE)+' PASSWORD %s LOGIN',(password,))
   r=query(c,'role');p=query(c,'password');need(len(r)==1 and r[0]==dict(before,login=True) and len(p)==1 and p[0]['name']==ROLE and p[0]['password_null'] is False,'BACKUP_ROLE_LOGIN_READBACK')
  elif action=='close':
   c.execute('ALTER ROLE '+identifier(ROLE)+' NOLOGIN PASSWORD NULL NOBYPASSRLS CONNECTION LIMIT 0');no_login_state(c,closed=True)
  else:
   no_login_state(c,closed=True)
   for sql in grant_statements(scope,database,True):c.execute(sql)
   explicit=query(c,'explicitGrants');need(not any(v['kind']!='database' or v['name']==database for v in explicit),'BACKUP_SQL_REVOKE_READBACK')
  c.execute('COMMIT')
 except BaseException:
  try:c.execute('ROLLBACK')
  except BaseException:raise RuntimeError('BACKUP_SQL_MUTATION_ROLLBACK_UNPROVEN') from None
  raise RuntimeError('BACKUP_SQL_MUTATION_REJECTED') from None
 finally:c.close()
 return {'action':action,'database':database,'readAfterVerified':True}
