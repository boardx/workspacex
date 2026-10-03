import unittest,hashlib
from control_connection import PersistentControlConnection
class Dummy:
 stdin=None;stdout=None
 def wait(self,timeout):pass
class Fixture(PersistentControlConnection):
 def request(self,payload,bind=True):
  self.requests=getattr(self,'requests',[])+[payload]
  return {'connection':self.plan['controlSessions' if self.mode=='control' else 'diagnosticSessions'][self.db],'value':{'fixed':True},'capabilities':{'catalogLockAuthority':True,'alterRoleAuthority':True}}
class Tests(unittest.TestCase):
 def plan(self):
  peer={'database':'db','systemIdentifier':'123'};binding={'peer':peer,'tls':{'ssl':True},'role':'admin','pid':10,'backendStart':'now','clientAddr':'local'}
  return {'controlRuntime':{'rootPath':'/trusted/pg','nodePath':'/trusted/node','nodeSha256':hashlib.sha256(b'fixture').hexdigest(),'pgModulePath':'/trusted/pg/index.js','files':{'/trusted/pg/index.js':hashlib.sha256(b'fixture').hexdigest()}},'identity':{'attemptId':'test'},'persistentControlHelper':{'path':'/trusted/helper','sha256':hashlib.sha256(b'fixture').hexdigest()},'controlProbe':{'serviceFile':'/trusted/service','caFile':'/trusted/ca'},'databasePeers':{'db':peer},'databaseWriterRoles':{'db':['admin']},'controlSessions':{'db':binding}}
 def test_one_connected_helper_reused_for_close_and_restore(self):
  calls=[];c=Fixture(self.plan(),'db',spawn=lambda *a,**k:(calls.append(a) or Dummy()),read_private=lambda *a:b'fixture',runtime_inventory=lambda root:['/trusted/pg/index.js'])
  c.execute('close-reviewed-cas');c.execute('restore-reviewed-cas');self.assertEqual(len(calls),1);self.assertEqual([x['operation'] for x in c.requests],['connect','execute','execute']);c.close()
 def test_untrusted_helper_rejected_before_spawn(self):
  calls=[]
  with self.assertRaisesRegex(RuntimeError,'PIN'):Fixture(self.plan(),'db',spawn=lambda *a,**k:calls.append(a),read_private=lambda *a:b'changed')
  self.assertEqual(calls,[])
 def test_persistent_diagnostic_only_fixed_query_interface(self):
  plan=self.plan();plan['diagnosticRole']='diag';plan['databaseProbe']=plan['controlProbe'];plan['diagnosticSessions']={'db':dict(plan['controlSessions']['db'],role='diag')}
  connection=Fixture(plan,'db',spawn=lambda *a,**k:Dummy(),read_private=lambda *a:b'fixture',runtime_inventory=lambda root:['/trusted/pg/index.js'],mode='diagnostic',bootstrap=True)
  self.assertEqual(connection.query('roles'),{'fixed':True})
  with self.assertRaisesRegex(RuntimeError,'QUERY_AUTHORITY'):connection.query('arbitrary')
  connection.close()
 def test_control_role_must_be_classified_writer(self):
  plan=self.plan();plan['databaseWriterRoles']['db']=[]
  with self.assertRaisesRegex(RuntimeError,'IDENTITY'):Fixture(plan,'db',spawn=lambda *a,**k:Dummy(),read_private=lambda *a:b'fixture',runtime_inventory=lambda root:['/trusted/pg/index.js'])
if __name__=='__main__':unittest.main()
