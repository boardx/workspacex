import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('six_session',ROOT/'scripts/cn-release-six-session.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class SixSession(unittest.TestCase):
 def test_global_warmup_projection_has_stats_and_hash_not_raw_error(self):
  with tempfile.TemporaryDirectory()as d:
   path=Path(d)/'report.json';path.write_text(json.dumps({'stats':{'expected':0,'unexpected':0,'duration':300000},'errors':[{'message':'[chat-route-warmup] secret password URL SELECT 300000ms'}]}))
   value=m.report_diagnostic(path);self.assertEqual(value['statistics']['expected'],0);self.assertEqual(value['globalErrorCount'],1);self.assertTrue(value['globalErrors'][0]['chatWarmup'])
   self.assertNotIn('password',json.dumps(value));self.assertNotIn('SELECT',json.dumps(value));self.assertNotIn('secret',json.dumps(value))
 def test_exact_six_report_rejects_skip_retry_duplicate_or_missing(self):
  titles=['journey-'+str(i)for i in range(6)]
  value=dict(stats=dict(expected=6,unexpected=0,flaky=0,skipped=0,duration=123),errors=[],suites=[dict(specs=[dict(title=t,ok=True,tests=[dict(projectName='cn-six-business',expectedStatus='passed',status='expected',results=[dict(status='passed',retry=0,errors=[])])])for t in titles])])
  with tempfile.TemporaryDirectory()as td:
   path=Path(td)/'report.json';path.write_text(json.dumps(value));result=m.validate_report(path,titles);self.assertEqual(result['aggregateCaseCount'],1);self.assertEqual(result['journeyCount'],6)
   for change in ('skip','retry','duplicate','missing','error'):
    v=copy.deepcopy(value)
    if change=='skip':v['stats']['skipped']=1
    if change=='retry':v['suites'][0]['specs'][0]['tests'][0]['results'][0]['retry']=1
    if change=='duplicate':v['suites'][0]['specs'][0]['title']=titles[1]
    if change=='missing':v['suites'][0]['specs'].pop()
    if change=='error':v['errors']=[{'message':'fixture-error'}]
    path.write_text(json.dumps(v))
    with self.assertRaises(RuntimeError):m.validate_report(path,titles)
 def test_partial_prepare_failure_closes_application_before_daemon_owner(self):
  order=[]
  class Domain:
   def close(self,p):order.append('app-domain-close');return dict(verified=True,populated=0)
  class Session:
   def __init__(self,*args):self.output=Path('/fixture')
   def prepare(self):order.append('partial-create');raise RuntimeError('lost-create-receipt')
   def finish(self,proof):
    selfproof=proof;order.append('daemon-close');return dict(verified=False,unacknowledgedCreate=True)
  with patch.object(m.domains,'Domain',Domain),patch.object(m,'Session',Session),patch.object(m.infra,'durable'):
   result=m.run_round(Path('/fixture'),'1','round-01','a'*40,{}, {}, [])
  self.assertEqual(order,['partial-create','app-domain-close','daemon-close']);self.assertFalse(result['verified'])
 def test_application_cleanup_unknown_never_removes_daemon_resources(self):
  with tempfile.TemporaryDirectory()as td:
   session=m.Session.__new__(m.Session);session.started=m.time.monotonic();session.output=Path(td);session.log=(Path(td)/'log').open('wb');session.lease_domain=None;session.lease_process=None
   removed=[];session.owner=types.SimpleNamespace(close=lambda:removed.append(True))
   with patch.object(m.infra,'durable'):value=session.finish({'verified':False})
   self.assertFalse(value['verified']);self.assertEqual(removed,[])
 def test_recovery_requires_outer_domain_empty_even_if_registry_missing(self):
  with tempfile.TemporaryDirectory()as td:
   for proof in ({},{'verified':True},{'verified':True,'populated':1,'removed':True}):
    with self.assertRaises(RuntimeError):m.infra.recover_all(Path(td)/'absent','1','a'*40,proof)
class ProductionRuntime(unittest.TestCase):
 def test_runtime_identity_heap_unit_and_manifest_are_actual_gates(self):
  identity={'pid':123,'startTicks':'42','cgroup':{'inode':9,'device':30,'pathSha256':'a'*64}}
  summary={'manifestSha256':'b'*64,'sourceCommit':'c'*40}
  launch={'kind':'cn-next-launch-v1','mode':'production-single','process':{'pid':123,'startTicks':'42'},'resources':{'observations':[{'inode':9,'device':30,'pathSha256':'a'*64,'available':True,'memory.max':str(6*1024**3)}]},**summary}
  values={'next-worker-runtime.json':{'kind':'cn-next-production-runtime-v1','process':identity,'heapSizeLimitBytes':2197815296},'next-launch-started.json':launch,'next-launch-exit.json':{**summary,'kind':'cn-next-launch-v1','mode':'production-single','exitCode':0,'signal':None,'started':True,'fatal':{'jsHeapOom':False,'otherFatal':False}},'next-build-summary.json':summary}
  with patch.object(m,'private_receipt',lambda p:values['next-build-summary.json'if p.name=='summary.json'else p.name]):self.assertTrue(m.validate_production_runtime(Path('/output'),'c'*40)['verified'])
  for field,value in [('heapSizeLimitBytes',3271557120),('process',{'pid':124,'startTicks':'42','cgroup':identity['cgroup']})]:
   broken=copy.deepcopy(values);broken['next-worker-runtime.json'][field]=value
   with patch.object(m,'private_receipt',lambda p:broken['next-build-summary.json'if p.name=='summary.json'else p.name]):
    with self.assertRaises(RuntimeError):m.validate_production_runtime(Path('/output'),'c'*40)
 def test_abnormal_exit_and_sealed_summary_mismatch_rejected(self):
  for code,signal in ((137,None),(None,'SIGKILL'),(None,'SIGABRT'),(1,None)):
   identity={'pid':123,'startTicks':'42','cgroup':{'inode':9,'device':30,'pathSha256':'a'*64}}
   summary={'sourceCommit':'c'*40,'manifestSha256':'b'*64}
   launch={**summary,'kind':'cn-next-launch-v1','mode':'production-single','process':{'pid':123,'startTicks':'42'},'resources':{'observations':[{**identity['cgroup'],'available':True,'memory.max':str(6*1024**3)}]}}
   values={'next-worker-runtime.json':{'kind':'cn-next-production-runtime-v1','process':identity,'heapSizeLimitBytes':2197815296},'next-launch-started.json':launch,'next-launch-exit.json':{**launch,'started':True,'exitCode':code,'signal':signal,'fatal':{'jsHeapOom':False,'otherFatal':False}},'next-build-summary.json':summary,'summary.json':summary}
   with patch.object(m,'private_receipt',lambda p:values[p.name]):
    with self.assertRaisesRegex(RuntimeError,'SIX_RUNTIME_ABNORMAL_EXIT'):m.validate_production_runtime(Path('/output'),'c'*40)
   values['summary.json']={**summary,'manifestSha256':'d'*64}
   with patch.object(m,'private_receipt',lambda p:values[p.name]):
    with self.assertRaisesRegex(RuntimeError,'SIX_RUNTIME_SEALED_MANIFEST'):m.validate_production_runtime(Path('/output'),'c'*40)
class ProductionCleanup(unittest.TestCase):
 def test_unknown_build_or_verify_never_drops_database(self):
  for proof in (None,{'verified':False},{'verified':True,'populated':1}):
   with tempfile.TemporaryDirectory()as td:
    session=m.Session.__new__(m.Session);session.started=m.time.monotonic();session.output=Path(td);session.log=(Path(td)/'log').open('wb');session.lease_domain=None;session.lease_process=None;session.production_cleanups=[proof]
    removed=[];session.owner=types.SimpleNamespace(close=lambda **kwargs:removed.append(True))
    with patch.object(m.infra,'durable'):value=session.finish({'verified':True,'populated':0})
    self.assertFalse(value['verified']);self.assertEqual(removed,[])
class ProductionStage(unittest.TestCase):
 def test_scratch_nonfollowing_actual_limit(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td)/'scratch';self.assertEqual(m.measured_tree_bytes(root),0);root.mkdir();(root/'data').write_bytes(b'abc');(root/'link').symlink_to('/not-followed')
   self.assertEqual(m.measured_tree_bytes(root),3+len('/not-followed'))
   with patch.object(m,'ARTIFACT_ZONE_BYTES',2):
    with self.assertRaisesRegex(RuntimeError,'SIX_SCRATCH_LIMIT'):m.measured_tree_bytes(root)
 def test_build_failure_closes_domain_and_never_verifies(self):
  events=[]
  class Domain:
   def spawn(self,*args,**kwargs):events.append('spawn');raise RuntimeError('fixture-failure')
   def close(self,p):events.append('close');return dict(verified=True,populated=0)
  with tempfile.TemporaryDirectory()as td:
   session=m.Session.__new__(m.Session);session.output=Path(td);session.production_cleanups=[];session.environment={'CN_SIX_WEB_MODE':'production-single','CN_API_STARTUP_NODE':'node'};session.verify_production=lambda:events.append('verify')
   with patch.object(m.domains,'Domain',Domain),patch.object(m.infra,'durable')as durable:
    with self.assertRaises(RuntimeError):session.production_build()
   self.assertEqual(events,['spawn','close']);self.assertEqual(durable.call_count,2)
 def test_dev_has_no_build_or_budget_extension(self):
  session=m.Session.__new__(m.Session);session.environment={}
  with patch.object(m.domains,'Domain')as domain:session.production_build();domain.assert_not_called()
  self.assertEqual(m.APPLICATION_BUDGET,1200);self.assertEqual(m.BUILD_BUDGET,900)
if __name__=='__main__':unittest.main()
