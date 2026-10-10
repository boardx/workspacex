import sys,os,hashlib,unittest
from pathlib import Path
from unittest.mock import patch
# Explicit integration test: separately provision the owned disposable local DB first.
sys.path.insert(0,str(Path(__file__).resolve().parent))
import clone_fresh_memory as m,clone_fresh_memory_engine as engine,clone_fresh_memory_test as f
from deep_agent_service import memory_deployment as deployment
from langgraph.store.postgres import PostgresStore
import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict,make_conninfo
CONNECT=psycopg.connect
LOCAL='host=127.0.0.1 port=55489 dbname=workspacex_memory'
class Actual(f.Memory):
 @classmethod
 def setUpClass(cls):
  os.environ['MEMORY_STORE_DATABASE_URL']=LOCAL+' user=memory_rw';os.environ['MEMORY_STORE_MIGRATION_DATABASE_URL']=LOCAL+' user=memory_owner';os.environ['MEMORY_STORE_SCHEMA']='workspacex_memory'
  deployment.prepare_memory_store()
  with CONNECT(LOCAL+' user=memory_owner',autocommit=True) as c:
   c.execute('SET search_path TO workspacex_memory');PostgresStore(c).put(('synthetic','old'),'old',{'text':'local-history'})
 def setUp(self):
  super().setUp()
  with CONNECT(LOCAL+' user=memory_owner') as c:self.peer=c.execute('SELECT host(inet_server_addr())').fetchone()[0]
  self.b['peer']=self.peer;self.b['peerSha256']=hashlib.sha256(self.peer.encode()).hexdigest();self.p=self.memory_payload('check');self.gate=m.Admission(self.b,self.root)
  self.secret=dict(self.b,ownerPassword='local-only',runtimePassword='local-only');self.p['secret']=self.secret
 def real(self,p):
  def local_connect(*args,**kw):
   parsed=conninfo_to_dict(args[0]) if args else {};parsed.update(kw);parsed.update(hostaddr='127.0.0.1',port=55489)
   return CONNECT(**parsed)
  with patch.object(engine.psycopg,'connect',local_connect):return engine.execute(p,deployment)
 def test_actual_check_no_schema(self):
  r=m.run(self.p,self.gate,self.real);self.assertFalse(r['prepared']);self.assertEqual(r['originalRows'],1)
  with CONNECT(LOCAL+' user=memory_owner') as c:self.assertEqual(c.execute('SELECT count(*) FROM pg_namespace WHERE nspname=%s',(r['schema'],)).fetchone()[0],0)
 def test_actual_prepare_preserves_history_empty_new_and_no_repeat(self):
  self.p=self.memory_payload('prepare');self.p['secret']=self.secret;r=m.run(self.p,self.gate,self.real);self.assertTrue(r['prepared']);self.assertEqual(r['freshRows'],0);self.assertEqual(r['originalRows'],1)
  with self.assertRaises(FileExistsError):m.run(self.p,self.gate,self.real)
  with CONNECT(LOCAL+' user=memory_rw') as c:
   for stmt in [sql.SQL('CREATE TABLE {}.forbidden(id int)').format(sql.Identifier(r['schema'])),sql.SQL('TRUNCATE {}.store').format(sql.Identifier(r['schema']))]:
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):c.execute(stmt)
    c.rollback()
  with CONNECT(LOCAL+' user=memory_owner') as c:self.assertEqual(c.execute('SELECT count(*) FROM workspacex_memory.store').fetchone()[0],1)
 def test_actual_wrong_target_before_connect(self):
  self.p['secret']['host']='production.invalid'
  with self.assertRaisesRegex(ValueError,'SECRET_BINDING'):m.run(self.p,self.gate,self.real)
 def test_actual_preexisting_schema_rejected(self):
  schema='wsx_fixture_'+self.b['attemptId'].replace('-','')
  with CONNECT(LOCAL+' user=memory_owner',autocommit=True) as c:c.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
  self.p=self.memory_payload('prepare');self.p['secret']=self.secret
  with self.assertRaisesRegex(ValueError,'SCHEMA_ALREADY_EXISTS'):m.run(self.p,self.gate,self.real)
  with self.assertRaises(FileExistsError):m.run(self.p,self.gate,self.real)
if __name__=='__main__':
 suite=unittest.TestSuite(Actual(n) for n in sorted(x for x in dir(Actual) if x.startswith('test_actual_')));r=unittest.TextTestRunner(verbosity=2).run(suite);sys.exit(not r.wasSuccessful())
