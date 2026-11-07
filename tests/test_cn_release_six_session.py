import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import ast
import sys
import types
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('six_session',ROOT/'scripts/cn-release-six-session.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class SixSession(unittest.TestCase):
 def test_round_commit_overrides_inherited_build_source(self):
  tree=ast.parse((ROOT/'scripts/cn-release-six-session.py').read_text())
  assignment=next(n for n in ast.walk(tree)if isinstance(n,ast.Assign)and any(isinstance(v,ast.Attribute)and v.attr=='environment'for v in n.targets))
  owner=types.SimpleNamespace(env={'CN_SIX_SOURCE_COMMIT':'untrusted'},owner=types.SimpleNamespace(environment={}),run_id='1',commit='a'*40,output=Path('/fixture'))
  value=eval(compile(ast.Expression(assignment.value),'<actual-round-environment>','eval'),{'str':str},{'self':owner,'isolated':{}})
  self.assertEqual(value['CN_SIX_SOURCE_COMMIT'],'a'*40)
 def test_build_failure_or_exhausted_shared_budget_never_starts_services(self):
  for case in ('failed','deadline'):
   with self.subTest(case=case),tempfile.TemporaryDirectory()as td:
    events=[];clock=[0.0]
    class Domain:
     def __init__(self):events.append('domain')
     def close(self,*args):events.append('compiler-empty');return dict(verified=True,populated=0)
    class Session:
     def __init__(self,*args):self.output=Path(td)
     def prepare(self):return {}
     def finish(self,proof):events.append('owner-cleanup');return dict(verified=True)
    def phase(*args):
     events.append('build')
     if case=='failed':raise RuntimeError('SIX_BUILD_FAILED')
     clock[0]=m.APPLICATION_BUDGET
    with patch.object(m.domains,'Domain',Domain),patch.object(m,'Session',Session),patch.object(m,'run_phase',side_effect=phase),patch.object(m,'build_command',return_value=['fixed-build']),patch.object(m,'playwright_command')as services,patch.object(m,'cleanup_build',return_value={'verified':True}),patch.object(m.infra,'durable'),patch.object(m.time,'monotonic',side_effect=lambda:clock[0]):
     result=m.run_round(Path(td),'1','round-01','a'*40,{}, {},[])
    services.assert_not_called();self.assertFalse(result['verified']);self.assertEqual(events,['domain','build','compiler-empty','owner-cleanup'])
    self.assertEqual(result['diagnostic']['reason'],'SIX_BUILD_FAILED'if case=='failed'else'SIX_APPLICATION_TIMEOUT')
 def test_real_failed_build_process_has_no_runtime_success(self):
  import subprocess
  class Domain:
   def spawn(self,command,**kwargs):return subprocess.Popen(command,**kwargs)
  with tempfile.TemporaryDirectory()as td:
   with self.assertRaisesRegex(RuntimeError,'SIX_BUILD_FAILED'):
    m.run_phase(Domain(),[sys.executable,'-c','print("build failed");raise SystemExit(7)'],{},Path(td)/'build.log',m.time.monotonic()+5,'BUILD')
   self.assertIn('build failed',(Path(td)/'build.log').read_text())
 def test_build_cleanup_preserves_foreign_identity_and_requires_empty_domain(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);dist=root/'apps/web/.next-chat-read-e2e';dist.mkdir(parents=True);(dist/'owned').write_text('fixture');out=root/'evidence';out.mkdir();info=dist.stat()
   owner=dict(sourceCommit='a'*40,distDevice=info.st_dev,distInode=info.st_ino);(out/'next-build-intent.json').write_text(json.dumps(owner))
   with patch.object(m,'ROOT',root):
    with self.assertRaisesRegex(RuntimeError,'CLEANUP_UNPROVEN'):m.cleanup_build(out,'a'*40,{'verified':False})
    self.assertTrue(dist.exists())
    with self.assertRaisesRegex(RuntimeError,'SOURCE_CHANGED'):m.cleanup_build(out,'b'*40,{'verified':True,'populated':0})
    owner['distInode']+=1;(out/'next-build-intent.json').write_text(json.dumps(owner))
    with self.assertRaisesRegex(RuntimeError,'OWNER_CHANGED'):m.cleanup_build(out,'a'*40,{'verified':True,'populated':0})
    self.assertTrue(dist.exists());owner['distInode']=info.st_ino;(out/'next-build-intent.json').write_text(json.dumps(owner))
    self.assertTrue(m.cleanup_build(out,'a'*40,{'verified':True,'populated':0})['removed']);self.assertFalse(dist.exists())
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
if __name__=='__main__':unittest.main()
