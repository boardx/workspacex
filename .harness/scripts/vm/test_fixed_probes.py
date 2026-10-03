import unittest,tempfile,pathlib,os,json,copy
from unittest.mock import patch
from fixed_probes import classify_processes,login_cas_sql,classify_sessions
from writer_fence import Journal
class Tests(unittest.TestCase):
 def test_login_cas_has_peer_and_role_compare_before_alter(self):
  sql=login_cas_sql({'database':'workspacex','serverAddr':'10.0.0.1','serverPort':5432,'systemIdentifier':'123'},{'app':True},{'app':False})
  self.assertLess(sql.index('LOGIN_STATE_CAS'),sql.index('ALTER ROLE'));self.assertIn('LOCK TABLE pg_authid',sql);self.assertIn('LOGIN_PEER_CAS',sql)
 def test_injected_role_rejected(self):
  with self.assertRaises(RuntimeError):login_cas_sql({'serverPort':5432,'systemIdentifier':'123'},{'bad"role':True},{'bad"role':False})
 def test_container_substring_does_not_exempt_foreign_pid(self):
  cid='a'*64;p={'pid':123,'uid':1000,'exe':'/binary','cgroup':'/foreign'+cid+'suffix','startTicks':1,'exeSha256':'b'*64,'processGroup':123}
  plan={'writers':[{'binding':{'kind':'container','containerId':cid}}],'reviewedNonWriterProcesses':[]}
  self.assertEqual(len(classify_processes(plan,[p],999)),1)
 def test_reviewed_process_requires_exact_hash(self):
  p={'pid':123,'uid':1000,'exe':'/binary','cgroup':'/','startTicks':1,'exeSha256':'b'*64,'processGroup':123};plan={'writers':[],'reviewedNonWriterProcesses':[copy.deepcopy(p)]}
  self.assertEqual(classify_processes(plan,[p],999),[]);p['exeSha256']='c'*64;self.assertEqual(len(classify_processes(plan,[p],999)),1)
 def test_diagnostic_application_name_alone_is_rejected(self):
  plan={'diagnosticRole':'diag','diagnosticSessions':{'db':{'pid':10,'backendStart':'old'}},'identity':{'attemptId':'test'},'diagnosticClientAddress':'local','diagnosticClientIdentity':'diag-bound'}
  session={'role':'diag','pid':11,'backendStart':'old','ssl':True,'applicationName':'wsx-maintenance-diagnostic-test','clientAddr':'local','backendType':'client backend'}
  with patch('fixed_probes.validate_roles'),self.assertRaisesRegex(RuntimeError,'EXACT_BINDING'):classify_sessions(plan,{'database':'db','peer':{},'sessions':[session]},{'peer':{}})
 def test_two_journal_handles_preserve_events_and_prior_fields(self):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);a=Journal(root,{'attempt':'x'},os.getuid(),root);b=Journal(root,{'attempt':'x'},os.getuid(),root)
   try:
    a.value['prior']={'data':1};a.record('first');b.value['loginPrior']={'app':True};b.record('second');a.record('third')
    result=json.loads((root/'writer-fence.json').read_text());self.assertEqual([v['state'] for v in result['events']],['first','second','third']);self.assertIn('loginPrior',result);self.assertIn('prior',result)
   finally:a.close();b.close()
 def test_stale_journal_conflicting_authority_fails_closed(self):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);a=Journal(root,{},os.getuid(),root);b=Journal(root,{},os.getuid(),root)
   try:
    a.value['planSha256']='a';a.save();b.value['planSha256']='b'
    with self.assertRaisesRegex(RuntimeError,'CONFLICT'):b.save()
   finally:a.close();b.close()
if __name__=='__main__':unittest.main()

class AdmissionClosureTests(unittest.TestCase):
 def fixture(self):
  from writer_fence import DATABASES
  peer={db:{'database':db,'systemIdentifier':'123','serverAddr':'10.0.0.1','serverPort':5432} for db in DATABASES}
  plan={'databasePeers':peer,'diagnosticRole':'diag','databaseWriterRoles':{db:['app','admin'] for db in DATABASES},'closedAdmission':{'kind':'role-login-v1','login':{db:{'app':False,'admin':False} for db in DATABASES}},'originalAdmission':{'kind':'role-login-v1','login':{db:{'app':True,'admin':True} for db in DATABASES}}}
  observation={'peer':peer[DATABASES[0]],'tls':{'ssl':True},'currentRole':'diag','selfPid':10,'roles':[{'name':'app','login':True},{'name':'admin','login':True},{'name':'diag','login':True}],'diagnosticPrivileges':{k:False for k in ('databaseWrite','schemaWrite','tableWrite','sequenceWrite','definerExecute','privilegedMembership')}}
  return plan,observation,DATABASES[0]
 def test_actual_role_inventory_detects_omitted_manual_admin(self):
  from fixed_probes import validate_roles
  p,o,db=self.fixture()
  for current in p['databaseWriterRoles']:p['databaseWriterRoles'][current]=['app'];p['closedAdmission']['login'][current]={'app':False};p['originalAdmission']['login'][current]={'app':True}
  with self.assertRaisesRegex(RuntimeError,'UNFENCED_ADMIN_MANUAL'):validate_roles(p,db,o)
 def test_missing_observed_role_and_extra_plan_role_reject(self):
  from fixed_probes import validate_roles
  for mode in ('missing','extra'):
   p,o,db=self.fixture()
   if mode=='missing':o['roles']=[r for r in o['roles'] if r['name']!='admin']
   else:
    for current in p['databaseWriterRoles']:p['databaseWriterRoles'][current].append('invented');p['closedAdmission']['login'][current]['invented']=False;p['originalAdmission']['login'][current]['invented']=True
   with self.subTest(mode=mode),self.assertRaisesRegex(RuntimeError,'ROLE_TARGET_CLOSURE'):validate_roles(p,db,o)
 def test_open_login_in_closed_plan_rejects_before_sql(self):
  from fixed_probes import validate_roles
  p,o,db=self.fixture();p['closedAdmission']['login'][db]['admin']=True
  with self.assertRaisesRegex(RuntimeError,'CLOSED_WRITER_ROLE_LOGIN_ENABLED'):validate_roles(p,db,o)
 def test_role_map_and_cluster_closure_are_exact(self):
  from writer_fence import validate_admission_plan
  for mode in ('missing','extra','cluster'):
   p,o,db=self.fixture()
   if mode=='missing':del p['closedAdmission']['login'][db]['admin']
   elif mode=='extra':p['closedAdmission']['login'][db]['foreign']=False
   else:p['originalAdmission']['login'][db]['admin']=False
   with self.subTest(mode=mode),self.assertRaisesRegex(RuntimeError,'CLOSURE|DIVERGENCE'):validate_admission_plan(p)
 def test_idle_reopened_role_cannot_be_held_even_without_sessions(self):
  from fixed_probes import validate_roles
  from writer_fence import WriterFenceAdapter,DATABASES
  p,o,db=self.fixture()
  for role in o['roles']:
   if role['name']!='diag':role['login']=False
  login=validate_roles(p,db,o);self.assertEqual(login,{'app':False,'admin':False})
  o['roles'][1]['login']=True  # real role observation changed after the first held readback
  login=validate_roles(p,db,o)
  adapter=object.__new__(WriterFenceAdapter);adapter.plan=p
  snapshot={'admission':{'kind':'role-login-v1','login':{current:({'app':False,'admin':False} if current!=db else login) for current in DATABASES}},'writers':{},'databases':{current:{'sessions':[]} for current in DATABASES}}
  with self.assertRaisesRegex(RuntimeError,'LIVE_WRITER_ROLE_LOGIN_ENABLED'):adapter.assert_blocked(snapshot)
