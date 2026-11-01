import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
s=importlib.util.spec_from_file_location('maintenance',Path(__file__).resolve().parents[1]/'scripts/tag-maintenance-release.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def rows(running=True):
 return [{'Id':s,'Image':'image-'+s,'Config':{'Labels':{'com.docker.compose.service':s,'com.docker.compose.project':'app'}},'State':{'Running':running}} for s in sorted(m.SERVICES)]
class Host:
 def __init__(self,failure=None):self.running=True;self.calls=[];self.failure=failure;self.applied=False
 def runtime(self):return rows(self.running)
 def adapter(self,name,mode):
  self.calls.append((name,mode))
  if (name,mode)==self.failure:raise RuntimeError('lost response')
  if name=='oldApplicationProbe':return {'status':'OLD_APPLICATION_VERIFIED'}
  if name=='backupCommand':return {'status':'BACKUP_RESTORE_VERIFIED','writersStopped':True}
  if mode=='apply':self.applied=True;return {'status':'COMMITTED','commitAcknowledged':True}
  return {'status':{'preflight':'BASELINE','drain':'DRAINED','reconcile':'COMPLETE' if self.applied else 'BASELINE'}[mode]}
 def verify_old(self):
  if self.failure=='old' and self.applied:raise RuntimeError('old failed')
  assert self.running
 def stop(self):self.running=False
 def start(self):self.running=True
 def nginx(self,a,b):self.calls.append(('nginx',b))
class Tests(unittest.TestCase):
 def test_host_adapter_inherits_same_lock_file_description(self):
  import json
  policy={'environment':'us','databaseCommand':{'executable':{'path':'/fixed'},'timeoutSeconds':30}}
  with tempfile.TemporaryDirectory() as directory, patch.object(m,'pinned',return_value=Path('/fixed')), patch.object(m.subprocess,'run') as run:
   run.return_value.returncode=0
   run.return_value.stdout=json.dumps({'source':m.SOURCE,'tag':m.TAG,'environment':'us','status':'BASELINE'}).encode()
   host=m.Host(policy,Path(directory),lock_fd=19)
   host.adapter('databaseCommand','preflight')
   self.assertEqual(run.call_args.kwargs['pass_fds'],(19,))
   self.assertEqual(run.call_args.kwargs['env']['WSX_RELEASE_LOCK_FD'],'19')
 def test_fixed_canonical_lock_for_both_environments(self):
  for environment,path in [('us','/run/workspacex-selfhost-deploy.lock'),('cn','/var/lib/workspacex-cn/runtime/release.lock')]:
   self.assertEqual(m.canonical_lock({'environment':environment,'lockFile':path}),path)
   with self.assertRaises(m.Rejected):m.canonical_lock({'environment':environment,'lockFile':'/tmp/own.lock'})
 def test_existing_deployment_pending_blocks_maintenance_and_marker_blocks_deploy(self):
  with tempfile.TemporaryDirectory() as directory:
   state=Path(directory);pending=m.reserve_pending(state,state/'attempt','a'*64)
   self.assertEqual(pending,state/'pending.json');self.assertTrue(pending.exists())
   with self.assertRaises(m.Rejected):m.reserve_pending(state,state/'another','b'*64)
   # The ordinary consumer checks this same canonical file before image pulls.
   consumer=(Path(__file__).resolve().parents[1]/'scripts/deploy-registry-images.py').read_text()
   self.assertIn("pending=state/'pending.json'",consumer)
   self.assertIn("not pending.exists(),'UNRESOLVED_DEPLOYMENT_REQUIRES_RECONCILIATION'",consumer)
 def test_nginx_only_exact_environment_host(self):
  raw=b'server { server_name appv1.boardx.us; location / { proxy_pass http://a; } }'
  self.assertIn(b'return 503',m.maintenance_bytes(raw,'us'))
  for invalid in [raw.replace(b'appv1.boardx.us',b'app.boardx.us'),raw+b' server { server_name other; }']:
   with self.assertRaises(m.Rejected):m.maintenance_bytes(invalid,'us')
 def test_nginx_validation_failure_restores_exact_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'nginx';p.write_bytes(b'old');calls=[]
   def run(args):
    calls.append(args)
    if len(calls)==1:raise RuntimeError('syntax')
   with self.assertRaises(RuntimeError):m.replace_nginx(p,b'old',b'bad',run)
   self.assertEqual(p.read_bytes(),b'old');self.assertEqual(len(calls),3)
 def test_runtime_duplicate_foreign_running_rejected(self):
  baseline={r['Id']:{'containerId':r['Id'],'imageId':r['Image']} for r in rows()}
  m.runtime_set(rows(False),'app',baseline,False)
  for bad in [rows(False)[:-1],rows(False)[:-1]+[rows(False)[0]],rows(True)]:
   with self.assertRaises(m.Rejected):m.runtime_set(bad,'app',baseline,False)
 def execute(self,failure=None):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'nginx';p.write_bytes(b'server { server_name appv1.boardx.us; }')
   policy={'environment':'us','nginx':{'path':str(p)},'configurationPins':[],'project':'app','baseline':{r['Id']:{'containerId':r['Id'],'imageId':r['Image']} for r in rows()}}
   h=Host(failure)
   with patch.object(m,'pinned',side_effect=lambda ref,**kw:Path(ref['path'])):
    try:r=m.run_attempt(policy,Path(d),h)
    except m.Rejected:r=None
   return h,r,(Path(d)/'state.json').read_text()
 def test_success_migrates_once_and_restores_old_application(self):
  h,r,_=self.execute();self.assertEqual(r['status'],'SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE');self.assertFalse(r['targetImagesActivated']);self.assertEqual(h.calls.count(('databaseCommand','apply')),1)
 def test_backup_failure_never_applies(self):
  h,r,_=self.execute(('backupCommand','prepare'));self.assertIsNone(r);self.assertNotIn(('databaseCommand','apply'),h.calls);self.assertTrue(h.running)
 def test_unknown_commit_never_replays(self):
  h,r,state=self.execute(('databaseCommand','apply'));self.assertIsNone(r);self.assertEqual(h.calls.count(('databaseCommand','apply')),1);self.assertIn(('databaseCommand','reconcile'),h.calls)
 def test_old_application_failure_keeps_maintenance(self):
  h,r,state=self.execute('old');self.assertIsNone(r);self.assertIn('OPERATOR_RECONCILIATION_REQUIRED',state);self.assertIn('"maintenanceHeld":true',state)
if __name__=='__main__':unittest.main()
