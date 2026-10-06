import copy,types,unittest
from pathlib import Path
from unittest.mock import patch
from test_cn_backup_package import fixture
from cn_backup_channel import mutation_table,query_table
from writer_fence import digest
import retained_epoch_acquisition as m

class RetainedTests(unittest.TestCase):
 def setUp(self):
  backup,scope=fixture();self.backup=backup
  self.b={'identity':backup['identity'],'toolRevision':backup['toolRevision'],'host':{'instanceId':'i-uf6ga92ewloganobbln6','bootId':'12345678-1234-1234-1234-123456789012'},'epoch':'c'*64,'holdGeneration':'d'*32}
  self.host={'backup':backup,'objectScope':scope,'statements':mutation_table(backup,scope,expected_identity=backup['identity'])}
  self.sessions={mode:{db:{'pid':10+n+(100 if mode=='diagnostic' else 0),'backendStart':'start','peer':{'database':db},'role':'retained'} for n,db in enumerate(m.DATABASES)} for mode in ('control','diagnostic')}
  self.created=[];self.requests=[]
  self.transport=types.SimpleNamespace(**{mode+'_connections':{db:types.SimpleNamespace(binding=b,mode=mode,request=lambda payload:self.requests.append(payload)) for db,b in group.items()} for mode,group in self.sessions.items()})
  self.actor=types.SimpleNamespace(identity=backup['identity'],plan={'holdGeneration':self.b['holdGeneration']},transport=self.transport,hold=lambda:{'state':'held'},observe=lambda:{'host':self.b['host'],'state':'all-blocked'},assert_blocked=lambda observed:self.assertEqual(observed['state'],'all-blocked'))
 def adapter(self):return m.RetainedEpochAcquisition(self.backup,self.host,self.actor,self.b,self.sessions)
 def test_existing_protocol_missing_fails_without_spawn(self):
  channel=self.transport.control_connections[m.DATABASES[0]]
  with patch('cn_backup_channel.subprocess.Popen',side_effect=AssertionError('new-admin-forbidden')):
   with self.assertRaisesRegex(RuntimeError,'PROTOCOL_NOT_INSTALLED'):m.RetainedBackupChannel(channel,m.DATABASES[0],self.host,channel.binding,expected_identity=self.actor.identity)
  self.assertEqual(self.requests,[])
 def test_acquisition_blocked_before_any_backup(self):
  adapter=self.adapter()
  with patch('cn_backup_package.BackupLease.run',side_effect=AssertionError('no-production')):
   with self.assertRaisesRegex(RuntimeError,'ACQUISITION_PROTOCOL_REQUIRED'):adapter.acquire()
  self.assertEqual(self.requests,[])
 def test_fixed_recipe_reuses_compiler_and_no_admin_factory(self):
  recipe=self.adapter().fixed_recipe();self.assertFalse(recipe['ready']);self.assertEqual(recipe['fixedQueries'],query_table())
  for command in recipe['dumpCommands'].values():self.assertIn('--pull=never',command);self.assertIn('default_transaction_read_only=on',command[-1])
 def test_six_existing_channels_required(self):
  self.transport.control_connections.pop(m.DATABASES[-1])
  with self.assertRaisesRegex(RuntimeError,'CHANNELS_REQUIRED'):self.adapter()
 def test_session_drift_rejects(self):
  adapter=self.adapter();self.transport.control_connections[m.DATABASES[0]].binding={'pid':999}
  with self.assertRaisesRegex(RuntimeError,'SESSION_DRIFT'):adapter.acquire()
 def test_blocked_observations_are_from_existing_actor(self):
  writes=[]
  def writer(path,proof):writes.append(proof);return {'path':path,'sha256':digest(proof)}
  with patch.object(m,'write_collection',writer):refs=self.adapter().blocked_observation('before',Path('/private'))
  self.assertEqual(set(refs),{'held','drained'});self.assertEqual(len(writes),2);self.assertTrue(writes[1]['facts']['allWritersDrained']);self.assertEqual(self.requests,[])
 def test_fixed_cursor_rejects_arbitrary_sql(self):
  db=m.DATABASES[0];ch=self.transport.control_connections[db]
  ch.retained_backup_protocol={'kind':m.PROTOCOL,'identity':self.backup['identity'],'toolRevision':self.backup['toolRevision'],'database':db,'queriesSha256':digest(query_table()),'mutationsSha256':digest(mutation_table(self.backup,self.host['objectScope'],expected_identity=self.actor.identity))}
  adapter=m.RetainedBackupChannel(ch,db,self.host,ch.binding,expected_identity=self.actor.identity)
  with self.assertRaisesRegex(RuntimeError,'ARBITRARY_SQL'):adapter.cursor().execute('SELECT user_content FROM private')
  self.assertEqual(self.requests,[])
if __name__=='__main__':unittest.main()
