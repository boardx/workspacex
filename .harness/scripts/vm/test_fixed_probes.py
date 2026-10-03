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
