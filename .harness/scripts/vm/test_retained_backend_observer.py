import types,unittest
from pathlib import Path
from unittest.mock import patch
from test_cn_backup_package import fixture
from retained_backend_observer import RetainedObserverSource,RetainedBackendObserver
from cn_backup_package import DATABASES
class ObserverTests(unittest.TestCase):
 def setUp(self):
  self.plan,_=fixture();self.messages=[];self.binding={'peer':{'database':DATABASES[0]},'pid':123,'backendStart':'bound'}
  def request(message):
   self.messages.append(message)
   return {'fields':['value'],'rows':[{'value':{'peer':self.binding['peer'],'sessions':[],'preparedTransactions':[]}}]}
  self.channel=types.SimpleNamespace(pinned=self.binding,channel=types.SimpleNamespace(binding=self.binding),database=DATABASES[0],request=request,verify_backup_transport=lambda facts:True)
  self.authority=types.SimpleNamespace(verify_backup_context=lambda *args:True,verified_pg_dump16=lambda:{'verified':'fixed'},docker_inventory=lambda:[],verify_backup_peer=lambda *args:True)
 def test_existing_channel_fixed_sessions_and_rollback(self):
  source=RetainedObserverSource(self.plan,self.channel,self.authority);self.assertEqual(source.read_backup_database_sessions(DATABASES[0])['sessions'],[])
  self.assertEqual([m['queryId'] for m in self.messages],['begin-readonly','backup-sessions','rollback-readonly'])
 def test_fork_cannot_reuse_parent_channel(self):
  source=RetainedObserverSource(self.plan,self.channel,self.authority)
  with patch('retained_backend_observer.os.getpid',return_value=source.parent_pid+1):
   with self.assertRaisesRegex(RuntimeError,'FORK_FORBIDDEN'):source.read_backup_database_sessions(DATABASES[0])
  self.assertEqual(self.messages,[])
 def test_bad_rows_still_roll_back(self):
  def request(message):self.messages.append(message);return {'fields':[],'rows':[]}
  self.channel.request=request;source=RetainedObserverSource(self.plan,self.channel,self.authority)
  with self.assertRaisesRegex(RuntimeError,'SESSION_ROWS'):source.read_backup_database_sessions(DATABASES[0])
  self.assertEqual(self.messages[-1]['queryId'],'rollback-readonly')
 def test_actual_backend_collector_invoked_without_factory(self):
  channels={db:self.channel for db in DATABASES};observer=RetainedBackendObserver(self.plan,channels,self.authority,expected_identity=self.plan['identity'])
  with patch('retained_backend_observer.BackupBackendCollector') as cls:
   cls.return_value.collect.return_value={'kind':'local-mock'}
   self.assertEqual(observer.collect(DATABASES[0],'c'*64,123,'app'),{'kind':'local-mock'})
   cls.return_value.collect.assert_called_once_with(self.plan,DATABASES[0],'c'*64,123,'app',expected_identity=self.plan['identity'])
 def test_session_drift_rejected(self):
  source=RetainedObserverSource(self.plan,self.channel,self.authority);self.channel.channel.binding={'pid':999}
  with self.assertRaisesRegex(RuntimeError,'SESSION_DRIFT'):source.read_backup_database_sessions(DATABASES[0])


from retained_backend_observer import SourceOwnedParentObservation
from cn_backup_package import dump_command
from writer_fence import digest
import hashlib,time
class ParentRelayTests(unittest.TestCase):
 def setUp(self):
  self.plan,_=fixture();self.observer=RetainedBackendObserver(self.plan,{db:object() for db in DATABASES},object(),expected_identity=self.plan['identity'])
  self.db=DATABASES[0];self.owner='a'*32;self.name='wsx-backup-'+self.owner;self.binary=b'compiled-docker-fixture';self.app='wsx-backup-'+self.plan['identity']['attemptId']+'-'+self.db
  self.relay=SourceOwnedParentObservation(self.observer,self.db,'c'*64,456,self.app,self.name,self.owner,hashlib.sha256(self.binary).hexdigest(),time.monotonic()+60,'/private/proof')
  facts={'database':self.db,'containerId':'c'*64,'processPid':456,'applicationName':self.app}
  self.proof={'kind':'live-owned-pgdump-backend','identity':self.plan['identity'],'facts':facts,'evidenceSha256':digest(facts)}
  self.observer.collect=lambda *args:self.proof
 def execute(self):
  cmd=b'\0'.join(s.encode() for s in self.relay.command)+b'\0'
  def read(path):return cmd if path.name=='cmdline' else self.binary
  with patch('retained_backend_observer.process_snapshot',return_value={'processStart':'fixed'}),patch('retained_backend_observer.os.readlink',return_value='/usr/bin/docker'),patch.object(Path,'read_bytes',read),patch('retained_backend_observer.write_collection',side_effect=lambda path,proof:{'path':path,'sha256':digest(proof)}):
   return self.relay(123)
 def test_direct_parent_iteration_persists_actual_proof(self):
  self.assertTrue(self.execute());self.assertTrue(self.execute());self.assertEqual(len(self.relay.receipts),2)
  self.assertEqual(self.relay.proof['ownedHelperPid'],123);self.assertEqual(self.relay.proof['backendProof'],self.proof)
  self.assertEqual(self.relay.proof['backendProofSha256'],digest(self.proof))
 def test_foreign_observer_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'SOURCE_TYPE'):SourceOwnedParentObservation(types.SimpleNamespace(),self.db,'c'*64,456,self.app,self.name,self.owner,'d'*64,time.monotonic()+60,'/private/proof')
 def test_parent_pid_mismatch(self):
  self.relay.pid=-1
  with self.assertRaisesRegex(RuntimeError,'OWNER'):self.execute()
  self.assertEqual(self.relay.receipts,[])
 def test_late_proof_produces_no_success(self):
  def late(*args):self.relay.deadline=-1;return self.proof
  self.observer.collect=late
  with self.assertRaisesRegex(RuntimeError,'LATE_PROOF'):self.execute()
  self.assertEqual(self.relay.receipts,[]);self.assertIsNone(self.relay.proof)
 def test_boolean_proof_rejected(self):
  self.observer.collect=lambda *args:True
  with self.assertRaisesRegex(RuntimeError,'ACTUAL_PROOF'):self.execute()
 def test_source_deadline_is_forwarded_to_every_sql(self):
  messages=[];channel=types.SimpleNamespace(pinned={'peer':{'database':self.db}},channel=types.SimpleNamespace(binding={'peer':{'database':self.db}}),database=self.db)
  def request(message,deadline_seconds):messages.append(deadline_seconds);return {'fields':['value'],'rows':[{'value':{'sessions':[]}}]}
  channel.request=request
  source=RetainedObserverSource(self.plan,channel,object(),time.monotonic()+1)
  source.read_backup_database_sessions(self.db);self.assertEqual(len(messages),3);self.assertTrue(all(0<v<=1 for v in messages))
 def test_unbounded_authority_does_not_fall_back(self):
  source=RetainedObserverSource(self.plan,types.SimpleNamespace(pinned={},channel=types.SimpleNamespace(binding={})),types.SimpleNamespace(docker_inventory=lambda:[]),time.monotonic()+1)
  with self.assertRaises(TypeError):source.docker_inventory()



class DeferredParentRelayTests(unittest.TestCase):
 setUp=ParentRelayTests.setUp
 execute=ParentRelayTests.execute
 def test_deferred_source_only_no_backend_is_not_success(self):
  from retained_backup_host import RetainedBackupHostObserverAuthority
  host=types.SimpleNamespace(plan=self.plan,owned_inventory=lambda timeout:[])
  self.observer.authority=RetainedBackupHostObserverAuthority(host,self.db,self.name)
  self.relay=SourceOwnedParentObservation(self.observer,self.db,None,None,self.app,self.name,self.owner,hashlib.sha256(self.binary).hexdigest(),time.monotonic()+60,'/private/proof')
  self.assertIsNone(self.execute());self.assertEqual(self.relay.receipts,[]);self.assertIsNone(self.relay.proof)
 def test_arbitrary_deferred_callback_authority_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'DEFERRED_SOURCE'):SourceOwnedParentObservation(self.observer,self.db,None,None,self.app,self.name,self.owner,hashlib.sha256(self.binary).hexdigest(),time.monotonic()+60,'/private/proof')

if __name__=='__main__':unittest.main()
