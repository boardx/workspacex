# Explicit local integration test: provision an owned fixture DB on 127.0.0.1:55489 first.
import sys,pathlib,copy,unittest,hashlib
from unittest.mock import patch
BASE=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(BASE))
from clone_quiescence_test import Tests
import clone_quiescence as q,clone_quiescence_engine as engine
import psycopg
CONNECT=psycopg.connect
class ActualCommit(Tests):
 def setUp(self):
  super().setUp()
  with CONNECT(host='127.0.0.1',port=55489,user='postgres',dbname='workspacex',connect_timeout=5) as c:self.peer=c.execute('SELECT host(inet_server_addr())').fetchone()[0]
  self.b['peer']=self.peer;self.b['peerSha256']=hashlib.sha256(self.peer.encode()).hexdigest();self.p=self.payload('check');self.gate=q.Admission(self.b,self.root)
  self.p['secret']=dict(self.b,user='migration_admin',password='local-trust-only',port=5432)
 def real(self,p):
  # Only map the local Docker published transport; SQL/identity/constraints/commit are real.
  def local_connect(**kwargs):
   kwargs=dict(kwargs,hostaddr='127.0.0.1',port=55489);return CONNECT(**kwargs)
  with patch.object(engine.psycopg,'connect',local_connect):return engine.run(p)
 def test_actual_01_rollback(self):
  result=q.run(self.p,self.gate,self.real);self.assertTrue(result['rolledBack']);self.assertGreater(sum(result['beforeCounts']),0);self.assertEqual(result['afterCounts'],[0]*11)
  with CONNECT(host='127.0.0.1',port=55489,user='postgres',dbname='workspacex') as c:self.assertGreater(c.execute("SELECT count(*) FROM agent_runs WHERE status='running'").fetchone()[0],0)
 def test_actual_02_wrong_host_no_connect(self):
  self.p['secret']['host']='production.invalid'
  with self.assertRaisesRegex(ValueError,'SECRET_BINDING'):q.run(self.p,self.gate,self.real)
 def test_actual_03_expired_before_commit_rolls_back(self):
  secret=self.p['secret'];self.p=self.payload('commit');self.p['secret']=secret
  with patch.object(engine,'remaining',side_effect=[30,30,ValueError('ADMISSION_EXPIRED')]):
   with self.assertRaisesRegex(ValueError,'ADMISSION_EXPIRED'):q.run(self.p,self.gate,self.real)
  with CONNECT(host='127.0.0.1',port=55489,user='postgres',dbname='workspacex') as c:self.assertGreater(c.execute("SELECT count(*) FROM agent_runs WHERE status='running'").fetchone()[0],0)
  with self.assertRaises(FileExistsError):q.run(self.p,self.gate,self.real)
 def test_actual_04_commit_repeat(self):
  secret=self.p['secret'];self.p=self.payload('commit');self.p['secret']=secret
  result=q.run(self.p,self.gate,self.real);self.assertTrue(result['committed']);self.assertEqual(result['afterCounts'],[0]*11)
  with CONNECT(host='127.0.0.1',port=55489,user='postgres',dbname='workspacex') as c:self.assertEqual(c.execute("SELECT count(*) FROM agent_runs WHERE status NOT IN ('failed','succeeded','cancelled')").fetchone()[0],0)
  with self.assertRaises(FileExistsError):q.run(self.p,self.gate,self.real)
# Run only the four real DB cases (base class is fixture reuse, not duplicated assertions).
if __name__=='__main__':
 suite=unittest.TestSuite(ActualCommit(n) for n in sorted(x for x in dir(ActualCommit) if x.startswith('test_actual_')));r=unittest.TextTestRunner(verbosity=2).run(suite);sys.exit(not r.wasSuccessful())
