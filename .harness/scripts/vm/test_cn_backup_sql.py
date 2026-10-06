import copy,datetime,time,unittest
from unittest.mock import patch
import cn_backup_sql as m
from test_cn_backup_package import fixture

def facts(db='workspacex',closed=False):
 p,scope=fixture();r={'oid':4001,'name':m.ROLE,'superuser':False,'inherit':False,'create_role':False,'create_db':False,'login':False,'replication':False,'bypass_rls':not closed,'connection_limit':0 if closed else 1,'valid_until':datetime.datetime.fromtimestamp(p['authorization']['expiresAt'],datetime.timezone.utc).isoformat(),'rolconfig':None}
 f={k:[] for k in m.QUERIES};f.update(database=db,identity=[{'database':db,'readonly':'on','isolation':'repeatable read'}],role=[r],password=[{'name':m.ROLE,'password_null':True}],databases=[{'name':d,'owner':'admin','allow_connections':True,'connect':True,'temp':False,'create':False,'public_temp':False,'public_connect':True} for d in m.DATABASES],effectiveSchemas=[{'name':'public','owner':'admin','usage':True,'create':False}],effectiveRelations=[{'schema':'public','name':'items','kind':'r','owner':'admin','readable':True,'writable':False,'grantable':False}],effectiveSequences=[{'schema':'public','name':'items_id_seq','owner':'admin','readable':True,'writable':False,'grantable':False}])
 if not closed:
  f['explicitGrants']=[{'kind':kind,'schema':schema,'name':name,'privilege':priv,'grantable':False,'grantor':'admin'} for kind,schema,name,priv in m.expected_grants(scope)]
 return f,p,scope
class Cursor:
 def __init__(self,f,fail=None):self.f=f;self.calls=[];self.description=[];self.data=[];self.fail=fail
 def execute(self,sql,params=()):
  self.calls.append((sql,params))
  for key,(statement,expected) in m.QUERIES.items():
   if sql==statement:
    if key==self.fail:raise RuntimeError('secret-password-sensitive-provider-text')
    self.data=self.f[key];self.description=[(k,) for k in self.data[0]] if self.data else [];return
  self.data=[];self.description=[]
 def fetchall(self):return [tuple(row[k[0]] for k in self.description) for row in self.data]
 def close(self):pass
class Connection:
 def __init__(self,c):self.c=c
 def cursor(self):return self.c
class Tests(unittest.TestCase):
 def test_fixed_capture_readonly_and_all_keys(self):
  f,p,o=facts();c=Cursor(f);out=m.capture(Connection(c),'workspacex');self.assertEqual(out,f);self.assertEqual(c.calls[0][0],'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');self.assertEqual(c.calls[-1][0],'ROLLBACK')
 def test_password_permission_failure_never_becomes_null_proof(self):
  f,p,o=facts();c=Cursor(f,'password')
  with self.assertRaisesRegex(RuntimeError,'BACKUP_SQL_CAPTURE_FAILED'):m.capture(Connection(c),'workspacex')
  self.assertEqual(c.calls[-1][0],'ROLLBACK')
 def test_exact_positive_permission_fixture(self):
  f,p,o=facts();self.assertEqual(m.permission_gaps(f,o),[])
 def test_public_temp_not_silently_excepted(self):
  f,p,o=facts();f['databases'][0]['temp']=True;self.assertIn('UNAPPROVED_EFFECTIVE_DATABASE_TEMP',m.permission_gaps(f,o))
 def test_other_database_connect_is_real_gap(self):
  f,p,o=facts();f['databases'].append(dict(f['databases'][0],name='postgres'));self.assertIn('OTHER_DATABASE_ACCESS_UNPROVEN',m.permission_gaps(f,o))
 def test_inherited_set_role_and_write_grant_option_and_owner_paths(self):
  for edit in (lambda f:f['memberships'].append({'member':m.ROLE}),lambda f:f['effectiveRelations'][0].update(writable=True),lambda f:f['effectiveSequences'][0].update(grantable=True),lambda f:f['effectiveSchemas'][0].update(owner=m.ROLE)):
   f,p,o=facts();edit(f);self.assertTrue(m.permission_gaps(f,o))
 def test_exact_read_coverage_missing_or_extra_rejects(self):
  f,p,o=facts();f['effectiveRelations'][0]['readable']=False;self.assertIn('EXACT_OBJECT_READ_MISSING',m.permission_gaps(f,o))
  f,p,o=facts();f['effectiveRelations'].append(dict(f['effectiveRelations'][0],name='unexpected'));self.assertIn('OTHER_EFFECTIVE_OBJECT_READ',m.permission_gaps(f,o))
 def test_trusted_invoker_not_treated_as_new_definer_exception(self):
  f,p,o=facts();f['effectiveFunctions']=[{'schema':'public','name':'safe_invoker','signature':'safe_invoker()','owner':'admin','security_definer':False,'language':'sql','language_trusted':True,'executable':True,'grantable':False}];self.assertEqual(m.permission_gaps(f,o),[])
 def test_untrusted_language_or_builtin_write_still_gap(self):
  f,p,o=facts();f['effectiveFunctions']=[{'schema':'public','name':'external','signature':'external()','owner':'admin','security_definer':False,'language':'plpythonu','language_trusted':False,'executable':True,'grantable':False}];self.assertIn('INVOKER_LANGUAGE_CAPABILITY_UNPROVEN',m.permission_gaps(f,o));f['effectiveFunctions'][0].update(schema='pg_catalog',name='lo_create');self.assertIn('EFFECTIVE_BUILTIN_OBJECT_WRITE',m.permission_gaps(f,o))
 def test_closed_cannot_fake_password_null_or_session_cleanup(self):
  for edit in (lambda f:f['password'][0].update(password_null=False),lambda f:f['sessions'].append({'pid':123}),lambda f:f['role'][0].update(login=True),lambda f:f['role'][0].update(bypass_rls=True)):
   f,p,o=facts(closed=True);edit(f);self.assertTrue(m.permission_gaps(f,o,'closed'))
 def test_no_arbitrary_sql_or_plain_boolean_auth(self):
  f,p,o=facts();c=Cursor(f)
  for action in ('DROP DATABASE workspacex','login'):
   with self.assertRaises(RuntimeError):m.dispatch(Connection(c),p,o,True,action,password='x'*64 if action=='login' else None)
  self.assertEqual(c.calls,[])
 def test_no_public_acl_mutation_ever_compiled(self):
  f,p,o=facts();sql=' '.join(m.grant_statements(o,'workspacex')+m.grant_statements(o,'workspacex',True));self.assertNotIn(' PUBLIC',sql);self.assertNotIn('CASCADE',sql);self.assertNotIn('ALL ',sql)
 def test_login_requires_actual_fresh_three_db_permissions(self):
  f,p,o=facts();f['role'][0]['valid_until']=datetime.datetime.fromtimestamp(p['authorization']['expiresAt'],datetime.timezone.utc).isoformat();auth=m.ProtectedAuthorization(m.plan_digest(p),p['authorization']['expiresAt'],(),m._AUTH_SEAL,p['identity']);c=Cursor(f)
  with self.assertRaisesRegex(RuntimeError,'MUTATION_REJECTED'):m.dispatch(Connection(c),p,o,auth,'login',password='s'*64)
  self.assertFalse(any('PASSWORD %s LOGIN' in sql for sql,_ in c.calls))
 def test_cleanup_close_runs_after_expiry_and_no_secret_output(self):
  f,p,o=facts(closed=True);p['authorization']['expiresAt']=time.time()-10;auth=m.ProtectedAuthorization(m.plan_digest(p),p['authorization']['expiresAt'],(),m._AUTH_SEAL,p['identity']);c=Cursor(f);result=m.dispatch(Connection(c),p,o,auth,'close');self.assertEqual(result,{'action':'close','database':None,'readAfterVerified':True});self.assertIn(('COMMIT',()),c.calls)
 def test_existing_password_or_wrong_validuntil_blocks_login(self):
  f,p,o=facts();c=Cursor(f);f['password'][0]['password_null']=False
  with self.assertRaisesRegex(RuntimeError,'NOLOGIN_ATTRIBUTES'):m.no_login_state(c)
  f['password'][0]['password_null']=True
  with self.assertRaisesRegex(RuntimeError,'LEASE_DRIFT'):m.no_login_state(c,expires_at=time.time()-100)
 def test_public_capability_probe_works_before_role_exists(self):
  f,p,o=facts();f['role']=[];f['password']=[];f['databases'][0]['public_temp']=True
  self.assertIn('UNAPPROVED_PUBLIC_DATABASE_TEMP',m.public_capability_gaps(f))
 def test_full_scope_uses_actual_catalog_relkind_without_guessing_tables(self):
  catalogs={}
  for db in m.DATABASES:
   f,p,o=facts(db);f['schemas']=[{'name':'public'}];f['relations']=[{'schema':'public','name':'items','kind':'r'},{'schema':'public','name':'seq','kind':'S'}];catalogs[db]=f
  scope=m.capture_scope(catalogs);self.assertEqual(scope['workspacex']['tables'],[{'schema':'public','name':'items'}]);self.assertEqual(scope['workspacex']['sequences'],[{'schema':'public','name':'seq'}])
 def approval_records(self,p,delta):
  a=p['authorization'];base={'schemaVersion':1,'identity':p['identity'],'action':'bounded-three-db-backup-read','rdsInstanceId':m.RDS,'ecsInstanceId':m.ECS,'role':m.ROLE,'notBefore':a['notBefore'],'expiresAt':a['expiresAt'],'functions':m.FUNCTIONS,'allowedPublicTemp':[]}
  return [base,dict(base,allowedPublicTemp=delta)]
 def test_independent_exact_public_delta_issued_and_consumed(self):
  f,p,o=facts()
  with patch.object(m,'protected_json',side_effect=self.approval_records(p,list(m.DATABASES))):auth=m.protected_authorization(p,expected_identity=p['identity'])
  self.assertEqual(auth.allowed_public_temp,m.DATABASES)
  for d in f['databases']:d['public_temp']=True
  self.assertEqual(m.public_capability_gaps(f,auth),[])
  f['databases'].append(dict(f['databases'][0],name='postgres'))
  self.assertIn('UNAPPROVED_PUBLIC_DATABASE_TEMP',m.public_capability_gaps(f,auth));self.assertIn('OTHER_DATABASE_PUBLIC_CONNECT_UNPROVEN',m.public_capability_gaps(f,auth))
 def test_public_approval_wrong_scope_partial_duplicate_and_role_delta_reject(self):
  f,p,o=facts()
  for delta in ([m.DATABASES[0]],list(m.DATABASES)+['postgres'],list(m.DATABASES)+[m.DATABASES[0]],True):
   with patch.object(m,'protected_json',side_effect=self.approval_records(p,delta)):
    with self.assertRaisesRegex(RuntimeError,'PUBLIC_TEMP_APPROVAL_SCOPE'):m.protected_authorization(p,expected_identity=p['identity'])
  records=self.approval_records(p,list(m.DATABASES));records[0]['allowedPublicTemp']=list(m.DATABASES)
  with patch.object(m,'protected_json',side_effect=records):
   with self.assertRaisesRegex(RuntimeError,'PUBLIC_TEMP_APPROVAL_SCOPE'):m.protected_authorization(p,expected_identity=p['identity'])
 def test_public_approval_identity_functions_expiry_bound(self):
  f,p,o=facts()
  for key,value in (('identity',{}),('functions',{}),('expiresAt',p['authorization']['expiresAt']+1)):
   records=self.approval_records(p,list(m.DATABASES));records[1][key]=value
   with patch.object(m,'protected_json',side_effect=records):
    with self.assertRaises(RuntimeError):m.protected_authorization(p,expected_identity=p['identity'])
 def test_public_auth_raw_bool_tuple_and_forged_seal_rejected(self):
  f,p,o=facts()
  forged=object.__new__(m.ProtectedAuthorization);forged._seal=object()
  for auth in (True,m.DATABASES,forged):
   with self.assertRaisesRegex(RuntimeError,'PROTECTED_AUTHORIZATION_REQUIRED'):m.public_capability_gaps(f,auth)
 def test_column_effective_read_and_write_grant_paths(self):
  f,p,o=facts();column={'schema':'public','name':'items','column':'title','readable':True,'writable':False,'grantable':False};f['effectiveColumns']=[column];self.assertEqual(m.permission_gaps(f,o),[])
  for edit,code in (({'name':'other'},'OTHER_EFFECTIVE_COLUMN_READ'),({'grantable':True},'EFFECTIVE_COLUMN_WRITE_OR_GRANT_OPTION'),({'writable':True},'EFFECTIVE_COLUMN_WRITE_OR_GRANT_OPTION')):
   f['effectiveColumns']=[dict(column,**edit)];self.assertIn(code,m.permission_gaps(f,o))
 def test_direct_column_grants_remain_unknown_and_no_wider_revoke(self):
  f,p,o=facts();f['explicitGrants'].append({'kind':'column','schema':'public','name':'items.title','privilege':'SELECT','grantable':False,'grantor':'other'})
  self.assertIn('EXACT_GRANT_SCOPE_MISMATCH',m.permission_gaps(f,o));self.assertTrue(all('COLUMN' not in q for q in m.grant_statements(o,'workspacex',True)))
 def test_actor_and_column_queries_are_fixed_fresh_capture(self):
  f,p,o=facts();f['actor']=[{'name':'actual_admin','session_user':'actual_admin','superuser':False,'create_role':True,'bypass_rls':False,'inherit':True,'create_db':False}]
  out=m.capture(Connection(Cursor(f)),'workspacex');self.assertEqual(out['actor'],f['actor'])
  for key in ('actorDatabases','actorSchemas','actorRelations','actorSequences'):self.assertIn('WITH GRANT OPTION',m.QUERIES[key][0]);self.assertEqual(m.QUERIES[key][1],())
  self.assertIn('attacl',m.QUERIES['explicitGrants'][0]);self.assertIn('attacl',m.QUERIES['columnACLs'][0])
 def auto_edge(self,f):
  f['actor']=[{'oid':2001,'name':'migration_admin','session_user':'migration_admin','superuser':False,'create_role':True,'bypass_rls':False}]
  f['bootstrapRole']=[{'oid':10,'name':'actual_bootstrap_name','superuser':True}]
  f['memberships']=[{'role_oid':4001,'member_oid':2001,'grantor_oid':10,'role':m.ROLE,'member':'migration_admin','grantor':'actual_bootstrap_name','admin_option':True,'set_option':'false','inherit_option':'false'}]
 def test_auto_creator_edge_allowed_open_and_closed_readback(self):
  for closed in (False,True):
   f,p,o=facts(closed=closed);self.auto_edge(f)
   self.assertTrue(m.creator_admin_edge_only(f));self.assertEqual(m.permission_gaps(f,o,'closed' if closed else 'open'),[])
   self.assertEqual(m.no_login_state(Cursor(f),closed=closed),f['role'][0])
 def test_auto_edge_outward_memberships_set_inherit_extra_and_wrong_grantor_reject(self):
  for edit in ({'member':m.ROLE},{'role':'other'},{'set_option':'true'},{'inherit_option':'true'},{'admin_option':False},{'grantor_oid':20},{'grantor':'postgres'},{'role_oid':999},{'member_oid':999}):
   f,p,o=facts();self.auto_edge(f);f['memberships'][0].update(edit)
   self.assertFalse(m.creator_admin_edge_only(f));self.assertIn('ROLE_MEMBERSHIP_OR_SET_ROLE_PATH',m.permission_gaps(f,o))
  f,p,o=facts();self.auto_edge(f);f['memberships']*=2;self.assertFalse(m.creator_admin_edge_only(f))
 def test_auto_edge_actor_false_permission_or_unobserved_bootstrap_rejects(self):
  for key,value in (('create_role',False),('superuser',True),('name','other_admin'),('session_user','other_admin')):
   f,p,o=facts();self.auto_edge(f);f['actor'][0][key]=value;self.assertFalse(m.creator_admin_edge_only(f))
  f,p,o=facts();self.auto_edge(f);f['bootstrapRole']=[]
  with self.assertRaisesRegex(RuntimeError,'MEMBERSHIP_OR_SET_ROLE_PATH'):m.no_login_state(Cursor(f))
 def test_no_automatic_edge_revoke_or_superuser_mutation(self):
  f,p,o=facts();self.assertTrue(m.creator_admin_edge_only(f));self.assertNotIn('REVOKE '+m.ROLE,' '.join(m.grant_statements(o,'workspacex',True)))
  self.assertIn('grantor grantor_oid',m.QUERIES['memberships'][0]);self.assertIn('oid=10',m.QUERIES['bootstrapRole'][0])
 def test_create_actor_false_rejects_before_ddl(self):
  f,p,o=facts();f['role']=[];f['password']=[];f['actor']=[{'name':'migration_admin','session_user':'migration_admin','create_role':False,'superuser':False}]
  auth=m.ProtectedAuthorization(m.plan_digest(p),p['authorization']['expiresAt'],(),m._AUTH_SEAL,p['identity']);c=Cursor(f)
  with self.assertRaisesRegex(RuntimeError,'MUTATION_REJECTED'):m.dispatch(Connection(c),p,o,auth,'create')
  self.assertFalse(any(sql.startswith('CREATE ROLE') for sql,_ in c.calls))
if __name__=='__main__':unittest.main()
