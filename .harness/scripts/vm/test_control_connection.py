import unittest,hashlib
from control_connection import PersistentControlConnection
class Dummy:
 stdin=None;stdout=None
 def wait(self,timeout):pass
class Fixture(PersistentControlConnection):
 def __init__(self,plan,*args,**kwargs):
  import json,copy
  original=copy.deepcopy(plan);original.pop('controlSessions',None);original.pop('diagnosticSessions',None);original.update(schemaVersion=1,mode='maintenance-all-writer-fence',productionActionsAuthorized=True,runtimeSessionBootstrapAuthorized=True)
  raw=json.dumps(original).encode();ref={'path':'/etc/workspacex-cn/test-original.json','sha256':hashlib.sha256(raw).hexdigest()};read=kwargs.get('read_private',lambda *a:b'fixture')
  kwargs['original_plan_ref']=ref
  kwargs['read_private']=lambda path,*a:json.dumps({'originalWriterPlan':ref}).encode() if path=='/etc/workspacex-cn/trusted-tool-binding.json' else raw if path==ref['path'] else read(path,*a)
  super().__init__(plan,*args,**kwargs)

 def request(self,payload,bind=True):
  self.requests=getattr(self,'requests',[])+[payload]
  return {'connection':self.plan['controlSessions' if self.mode=='control' else 'diagnosticSessions'][self.db],'value':{'fixed':True},'capabilities':{'catalogLockAuthority':True,'alterRoleAuthority':True}}
class Tests(unittest.TestCase):
 def plan(self):
  peer={'database':'db','systemIdentifier':'123'};binding={'peer':peer,'tls':{'ssl':True},'role':'admin','pid':10,'backendStart':'now','clientAddr':'local'}
  return {'diagnosticRole':'diag','controlRuntime':{'rootPath':'/trusted/pg','nodePath':'/trusted/node','nodeSha256':hashlib.sha256(b'fixture').hexdigest(),'pgModulePath':'/trusted/pg/index.js','files':{'/trusted/pg/index.js':hashlib.sha256(b'fixture').hexdigest()}},'identity':{'attemptId':'test'},'persistentControlHelper':{'path':'/trusted/helper','sha256':hashlib.sha256(b'fixture').hexdigest()},'controlProbe':{'serviceFile':'/trusted/service','caFile':'/trusted/ca'},'databasePeers':{'db':peer},'databaseWriterRoles':{'db':['admin']},'controlSessions':{'db':binding}}
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
  self.assertEqual(connection.query('roles'),{'fixed':True});self.assertEqual(connection.query('run-drain'),{'fixed':True});self.assertEqual(connection.requests[-1]['queryId'],'run-drain')
  with self.assertRaisesRegex(RuntimeError,'QUERY_AUTHORITY'):connection.query('arbitrary')
  connection.close()
 def test_control_role_must_be_classified_writer(self):
  plan=self.plan();plan['databaseWriterRoles']['db']=[]
  with self.assertRaisesRegex(RuntimeError,'IDENTITY'):Fixture(plan,'db',spawn=lambda *a,**k:Dummy(),read_private=lambda *a:b'fixture',runtime_inventory=lambda root:['/trusted/pg/index.js'])
 def transport_plan(self):
  import copy,time
  plan=self.plan();identity={'sourceRevision':'9b25bfa65662b96c0826fe67506b562ea46aa6d0','baselineRevision':'ba6343199f3c834d6a198f83d0c771614292c82b','migrationPlanSha256':'a'*64,'attemptId':'test'};plan['identity']=identity;plan['toolRevision']='b'*40
  source={'user':'admin','database':'db','sslMode':'disable','configurationSha256':hashlib.sha256(b'fixture').hexdigest(),'providerEvidenceSha256':'c'*64,'clientPeerAddressSha256':hashlib.sha256(b'192.168.100.44').hexdigest(),'clientPeerPort':5432}
  auth={'kind':'existing-production-maintenance-transport','notBefore':time.time()-10,'expiresAt':time.time()+600,'identity':identity,'toolRevision':plan['toolRevision'],'source':source,'configurationPath':'/etc/workspacex-cn/maintenance-host/'+identity['sourceRevision']+'/test/approved-baseline-deployment.json','configurationSha256':source['configurationSha256'],'librarySha256':hashlib.sha256(b'fixture').hexdigest()}
  plan['connectionTransportAuthorizations']={'db':{'control':auth,'diagnostic':copy.deepcopy(auth)}}
  binding=plan['controlSessions']['db'];binding.update(tls={'ssl':False},socket={'encrypted':False,'authorized':False,'localAddress':'192.168.100.40','remoteAddress':'192.168.100.44','remotePort':5432},transport={'sslMode':'disable','configurationSha256':source['configurationSha256'],'providerEvidenceSha256':source['providerEvidenceSha256']})
  return plan
 def test_bound_plaintext_helper_passes_owned_auth_only_not_environment_toggle(self):
  plan=self.transport_plan();c=Fixture(plan,'db',spawn=lambda *a,**k:Dummy(),read_private=lambda *a:b'fixture',runtime_inventory=lambda root:['/trusted/pg/index.js'])
  self.assertEqual(c.requests[0]['connectionTransport'],plan['connectionTransportAuthorizations']['db']['control']);self.assertEqual(c.requests[0]['sslMode'],'disable');c.close()
 def test_plaintext_without_full_authority_or_actual_socket_proof_rejects(self):
  for edit in (lambda p:p.pop('connectionTransportAuthorizations'),lambda p:p['connectionTransportAuthorizations']['db'].pop('diagnostic'),lambda p:p['controlSessions']['db']['socket'].update(localAddress='192.168.100.41'),lambda p:p['controlSessions']['db']['transport'].update(providerEvidenceSha256='0'*64)):
   plan=self.transport_plan();edit(plan)
   with self.assertRaises(RuntimeError):Fixture(plan,'db',spawn=lambda *a,**k:Dummy(),read_private=lambda *a:b'fixture',runtime_inventory=lambda root:['/trusted/pg/index.js'])
if __name__=='__main__':unittest.main()
