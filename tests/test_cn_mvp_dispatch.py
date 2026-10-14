import datetime,importlib.util,tempfile,unittest
from pathlib import Path
s=importlib.util.spec_from_file_location('dispatch',Path(__file__).parents[1]/'scripts/cn-release-mvp-dispatch.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Dispatch(unittest.TestCase):
 def request(self):return dict(stage='build',controlRevision='a'*40,releaseId='test-1',requestedAt='2026-10-14T02:00:00Z',deadlineAt='2026-10-14T02:30:00Z',inputs={'candidate_plan':'{}'})
 def test_exact_run_with_uncertain_post_is_not_retried(self):
  calls=[];r=self.request();now=m.instant('2026-10-14T02:01:00Z')
  def provider(path,payload=None):
   calls.append(payload)
   if payload is not None:raise ValueError('DISPATCH_UNKNOWN')
   return {'workflow_runs':[dict(id=123,display_title='cn-mvp-test-1-build',created_at='2026-10-14T02:01:00Z',head_sha='a'*40,run_attempt=1,event='workflow_dispatch',head_branch='main',status='completed',conclusion='success')]}
  with tempfile.TemporaryDirectory()as folder:
   state=Path(folder)/'intent.json';self.assertEqual(m.coordinate(r,state,provider,lambda:now)['runId'],123)
   self.assertEqual(m.coordinate(r,state,provider,lambda:now)['runId'],123)
  self.assertEqual(sum(x is not None for x in calls),1)
 def test_wrong_control_rejected(self):
  def provider(path,payload=None):return None if payload is not None else {'workflow_runs':[dict(display_title='cn-mvp-test-1-build',created_at='2026-10-14T02:01:00Z',head_sha='b'*40,run_attempt=1)]}
  with tempfile.TemporaryDirectory()as folder,self.assertRaisesRegex(ValueError,'RUN_IDENTITY'):m.coordinate(self.request(),Path(folder)/'intent',provider,lambda:m.instant('2026-10-14T02:01:00Z'))
 def test_deadline_not_reset(self):
  with tempfile.TemporaryDirectory()as folder,self.assertRaisesRegex(ValueError,'DEADLINE'):m.coordinate(self.request(),Path(folder)/'intent',lambda *_:self.fail('provider called'),lambda:m.instant('2026-10-14T02:31:00Z'))
 def test_bounded_build_timeout_is_known_failure_without_redispatch(self):
  posts=[]
  def provider(path,payload=None):
   if payload is not None:posts.append(payload);return None
   return {'workflow_runs':[dict(id=123,display_title='cn-mvp-test-1-build',created_at='2026-10-14T02:01:00Z',head_sha='a'*40,run_attempt=1,event='workflow_dispatch',head_branch='main',status='completed',conclusion='timed_out')]}
  with tempfile.TemporaryDirectory()as folder:
   state=Path(folder)/'intent'
   for attempt in range(2):
    with self.assertRaisesRegex(ValueError,'CHILD_FAILED'):
     m.coordinate(self.request(),state,provider,lambda:m.instant('2026-10-14T02:21:00Z'))
  self.assertEqual(len(posts),1)
if __name__=='__main__':unittest.main()
