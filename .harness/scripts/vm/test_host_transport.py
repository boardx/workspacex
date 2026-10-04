import unittest
from unittest.mock import patch
import host_transport as h
from writer_fence import DATABASES
class Tests(unittest.TestCase):
 def fixture(self):
  obj=object.__new__(h.HostTransport);obj.plan={'identity':{'attemptId':'test'},'holdGeneration':1,'automationUnits':['deploy.timer'],'writers':[{'key':'api','binding':{'kind':'container','containerId':'a'*64,'imageId':'sha256:'+'b'*64}}],'databasePeers':{db:{'database':db,'serverAddr':'10.0.0.1','serverPort':5432,'systemIdentifier':'123'} for db in DATABASES},'databaseWriterRoles':{db:['application'] for db in DATABASES},'databaseProbe':{'serviceFile':'/reviewed/service','caFile':'/reviewed/ca'}};obj.plan.update({'diagnosticRole':'diag','closedAdmission':{'kind':'role-login-v1','login':{db:{'application':False} for db in DATABASES}},'originalAdmission':{'kind':'role-login-v1','login':{db:{'application':True} for db in DATABASES}}});obj.manifest_sha='c'*64;obj.require_lock=lambda:None;obj.read_hold=lambda:{'identity':obj.plan['identity'],'generation':1,'state':'held'};obj.docker_inventory=lambda:[{'Id':'a'*64,'Image':'sha256:'+'b'*64,'State':{'Paused':False,'Running':True}}];obj.calls=[]
  def run(args,env=None,input_raw=None):
   obj.calls.append((args,env))
   if '/usr/bin/psql' in args:
    import json
    return json.dumps({'peer':obj.plan['databasePeers'][DATABASES[0]],'sessions':[],'preparedTransactions':[]}).encode()
   return b''
  obj.run=run;obj.database_execute=lambda db,sql,control=False:obj.calls.append((['persistent-control',db,sql],{'control':control}));return obj
 def test_exact_command_shapes(self):
  obj=self.fixture();p=obj.plan;obj.apply({'kind':'pause-writer','key':'api','binding':p['writers'][0]['binding']},p);self.assertEqual(obj.calls[-1][0],['/usr/bin/docker','pause','a'*64]);obj.apply({'kind':'mask-unit','unit':'deploy.timer'},p);self.assertEqual(obj.calls[-1][0],['/usr/bin/systemctl','mask','--runtime','--now','deploy.timer'])
 def test_stopped_pause_is_noop_resume_rejected(self):
  obj=self.fixture();obj.docker_inventory=lambda:[{'Id':'a'*64,'Image':'sha256:'+'b'*64,'State':{'Running':False,'Paused':False}}];binding=obj.plan['writers'][0]['binding']
  obj.apply({'kind':'pause-writer','key':'api','binding':binding},obj.plan);self.assertEqual(obj.calls,[])
  with self.assertRaisesRegex(RuntimeError,'STOPPED'):obj.apply({'kind':'resume-writer','key':'api','binding':binding},obj.plan)
 def test_arbitrary_target_unit_role_and_command_rejected(self):
  for action in ({'kind':'shell','command':'anything'},{'kind':'mask-unit','unit':'foreign.service'},{'kind':'pause-writer','key':'foreign','binding':{'kind':'container','containerId':'d'*64}},{'kind':'terminate-writer-sessions','database':DATABASES[0],'peer':self.fixture().plan['databasePeers'][DATABASES[0]],'sessions':[{'role':"application'; DROP DATABASE anything;--",'pid':123,'backendStart':'2026-10-03T00:00:00Z'}]}):
   with self.subTest(action=action):
    obj=self.fixture()
    with self.assertRaises(RuntimeError):obj.apply(action,obj.plan)
    self.assertFalse(any('pg_terminate_backend' in str(args) for args,env in obj.calls))
 def test_terminate_is_exact_pid_backend_start_role_and_tls_bound(self):
  obj=self.fixture();db=DATABASES[0];obj.apply({'kind':'terminate-writer-sessions','database':db,'peer':obj.plan['databasePeers'][db],'sessions':[{'role':'application','pid':123,'backendStart':'2026-10-03T00:00:00Z'}]},obj.plan)
  args,env=obj.calls[-1];self.assertEqual(args[:2],['persistent-control',db]);self.assertIn("pid=123 AND usename='application' AND backend_start='2026-10-03T00:00:00Z'::timestamptz",args[-1]);self.assertTrue(env['control']);self.assertNotIn('password',str(args).lower())
if __name__=='__main__':unittest.main()

class HeldDrainTests(unittest.TestCase):
 def test_paused_permission_and_writeback_are_not_drained(self):
  self.assertEqual(h.aggregate_run_drain([{'status':'paused','count':'2'},{'status':'awaiting_tool_permission','count':'3'},{'status':'writeback_pending','count':'1'}]),{'queued':0,'running':5,'writebackPending':1})
 def test_unknown_duplicate_unsafe_counts_reject(self):
  for rows in ([{'status':'unknown','count':'0'}],[{'status':'running','count':'1'}]*2,[{'status':'running','count':'9007199254740992'}]):
   with self.subTest(rows=rows),self.assertRaises(RuntimeError):h.aggregate_run_drain(rows)
