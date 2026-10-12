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
