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
 def capture_startup(self,rows):self.calls.append(('capture',None))
 def wait_readiness(self):self.calls.append(('ready',self.running))
 def database_proof_ref(self,mode,status):return {'fixture':True,'mode':mode,'status':status}
 def runtime(self):return rows(self.running)
 def adapter(self,name,mode):
  self.calls.append((name,mode))
  if (name,mode)==self.failure:raise RuntimeError('lost response')
  if name=='bootstrapProbe':return {'status':'CANDIDATE_BOOTSTRAP_COMPATIBLE'}
  if name=='oldApplicationProbe':return {'status':'OLD_APPLICATION_VERIFIED'}
  if name=='backupCommand':return {'status':'BACKUP_RESTORE_VERIFIED','writersStopped':True}
  if mode=='apply':self.applied=True;return {'status':'COMMITTED','commitAcknowledged':True}
  return {'status':{'preflight':'BASELINE','drain':'DRAINED','reconcile':'COMPLETE' if self.applied else 'BASELINE'}[mode]}
 def verify_old(self):
  if self.failure=='old' and self.applied:raise RuntimeError('old failed')
  assert self.running
 def stop(self):self.running=False
 def start(self):self.calls.append(('start',None));self.running=True
 def nginx(self,a,b):self.calls.append(('nginx',b))
class Tests(unittest.TestCase):
 def test_realistic_drain_is_not_called_after_verified_commit_old_restart(self):
  class Strict(Host):
   def adapter(self,name,mode):
    if mode=='drain' and self.running:raise ValueError('BUSINESS_WRITER_NOT_STOPPED')
    return super().adapter(name,mode)
   def verify_old(self):
    self.calls.append(('business',self.applied))
    if self.applied:raise RuntimeError('unknown business outcome')
  with patch.dict(self.execute.__func__.__globals__,{'Host':Strict}):h,r,state=self.execute()
  self.assertIn('COMMIT_VERIFIED_COMPLETE',state);self.assertEqual(h.calls.count(('business',True)),1)
  self.assertNotIn('UNKNOWN_WRITER_STILL_ACTIVE',state)
 def test_frozen_startup_marker_must_exist_and_match_api_web(self):
  import copy
  values=rows();marker='01234567-89ab-cdef-0123-456789abcdef'
  for x in values:x['Config']['Env']=['WORKSPACEX_DEPLOYMENT_MARKER='+marker]
  self.assertEqual(m.startup_marker(values),marker)
  bad=copy.deepcopy(values);next(x for x in bad if x['Id']=='web')['Config']['Env']=[]
  with self.assertRaises(m.Rejected):m.startup_marker(bad)
 def test_readiness_uses_only_fixed_loopback_tls_gets(self):
  from unittest.mock import Mock
  marker='01234567-89ab-cdef-0123-456789abcdef';run=Mock(side_effect=[b'{"trustworthy":true,"deploymentMarker":"'+marker.encode()+b'"}\n200',b'{"deploymentMarker":"'+marker.encode()+b'"}\n200'])
  m.readiness_pair('us',marker,run,3)
  self.assertEqual(run.call_count,2)
  for args,kw in run.call_args_list:
   command=args[0];self.assertEqual(command[:2],['/usr/bin/curl','--disable']);self.assertIn('appv1.boardx.us:443:127.0.0.1',command);self.assertIn('GET',command);self.assertNotIn('--insecure',command);self.assertNotIn('POST',command)

 def test_readiness_rejects_bad_health_marker_and_tls_failure(self):
  from unittest.mock import Mock
  marker='01234567-89ab-cdef-0123-456789abcdef'
  for raw in [b'{"trustworthy":true}\n200',b'{"trustworthy":false,"deploymentMarker":"'+marker.encode()+b'"}\n200',b'{}\n503',b'{}\n301']:
   with self.assertRaises(m.Rejected):m.readiness_pair('us',marker,Mock(return_value=raw),3)
  with self.assertRaises(RuntimeError):m.readiness_pair('us',marker,Mock(side_effect=RuntimeError('TLS verification failed')),3)
 def test_original_ack_and_reconcile_proof_are_frozen_and_hashed(self):
  import json
  with tempfile.TemporaryDirectory() as directory:
   attempt=Path(directory);path=attempt/'databaseCommand-apply.json';raw=json.dumps({'status':'COMMITTED','commitAcknowledged':True,'source':m.SOURCE,'tag':m.TAG,'environment':'us'}).encode();path.write_bytes(raw)
   host=m.Host({'environment':'us'},attempt,3)
   with patch.object(m,'trusted',side_effect=lambda p,**kw:Path(p)):ref=host.database_proof_ref('apply','COMMITTED')
   self.assertEqual(ref['original']['path'],str(path));self.assertEqual(ref['sha256'],m.digest(raw));self.assertEqual(Path(ref['path']).read_bytes(),raw)
   path.write_text('{}');self.assertEqual(Path(ref['path']).read_bytes(),raw)
 def test_start_readiness_precedes_first_post_start_business_probe(self):
  class Ordered(Host):
   def verify_old(self):self.calls.append(('business',self.applied));super().verify_old()
  with patch.dict(self.execute.__func__.__globals__,{'Host':Ordered}):h,r,state=self.execute()
  start=h.calls.index(('start',None));ready=h.calls.index(('ready',True),start);business=h.calls.index(('business',True));self.assertLess(start,ready);self.assertLess(ready,business);self.assertEqual(h.calls.count(('business',True)),1)
 def test_host_adapter_inherits_same_lock_file_description(self):
  import json
  policy={'environment':'us','databaseCommand':{'executable':{'path':'/fixed'},'timeoutSeconds':30}}
  with tempfile.TemporaryDirectory() as directory, patch.object(m,'pinned',return_value=Path('/fixed')), patch.object(m.subprocess,'Popen') as run:
   run.return_value.returncode=0
   raw=json.dumps({'source':m.SOURCE,'tag':m.TAG,'environment':'us','status':'BASELINE'}).encode()
   run.return_value.communicate.return_value=(raw,None)
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
 def test_termination_and_hangup_raise_recovery_exception(self):
  import signal
  for sig in (signal.SIGTERM,signal.SIGHUP,signal.SIGINT):
   old=signal.getsignal(sig)
   try:
    m.install_signal_handlers()
    with self.assertRaisesRegex(m.MaintenanceInterrupted,'MAINTENANCE_INTERRUPTED'):signal.getsignal(sig)(sig,None)
   finally:signal.signal(sig,old)
 def test_real_supervisor_signal_allows_child_finally(self):
  import subprocess,sys,time,signal
  module_path=Path(m.__file__)
  for sig in (signal.SIGTERM,signal.SIGHUP):
   with self.subTest(signal=sig),tempfile.TemporaryDirectory() as directory:
    ready=Path(directory)/'ready';clean=Path(directory)/'clean'
    worker="import signal,time,pathlib;signal.signal(signal.SIGTERM,lambda *_:exit(3));pathlib.Path(%r).write_text('ready');\ntry: time.sleep(30)\nfinally: pathlib.Path(%r).write_text('clean')"%(str(ready),str(clean))
    code="import importlib.util,os,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('maintenance',%r);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.install_signal_handlers();fd=os.open('/dev/null',os.O_RDONLY);h=m.Host({},Path(%r),fd);\ntry:h.run([sys.executable,'-c',%r])\nexcept m.MaintenanceInterrupted:sys.exit(3)"%(str(module_path),directory,worker)
    parent=subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
     deadline=time.time()+5
     while not ready.exists() and time.time()<deadline:time.sleep(.01)
     self.assertTrue(ready.exists());parent.send_signal(sig);self.assertEqual(parent.wait(timeout=5),3);self.assertTrue(clean.exists())
    finally:
     if parent.poll() is None:parent.kill();parent.wait()
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
   policy={'bootstrapProbe':{'executable':{'path':'/fixture/bootstrap'},'inputs':[{'path':'/fixture/input'}],'binding':{'fixture':True},'timeoutSeconds':10},'environment':'us','nginx':{'path':str(p)},'configurationPins':[],'project':'app','baseline':{r['Id']:{'containerId':r['Id'],'imageId':r['Image']} for r in rows()}}
   h=Host(failure)
   with patch.object(m,'pinned',side_effect=lambda ref,**kw:Path(ref['path'])):
    try:r=m.run_attempt(policy,Path(d),h)
    except m.Rejected:r=None
   return h,r,(Path(d)/'state.json').read_text()
 def test_missing_bootstrap_gate_rejects_before_maintenance(self):
  from unittest.mock import Mock
  with tempfile.TemporaryDirectory() as directory,self.assertRaisesRegex(m.Rejected,'BOOTSTRAP_PROBE_REQUIRED'):
   m.run_attempt({},Path(directory),Mock())
 def test_failed_bootstrap_restores_old_application_without_requiring_candidate_gate(self):
  h,r,state=self.execute(('bootstrapProbe','preactivate'));self.assertIsNone(r);self.assertTrue(h.running);self.assertIn('FAILED_OLD_APPLICATION_VERIFIED',state);self.assertEqual(h.calls.count(('bootstrapProbe','preactivate')),1)
 def test_success_migrates_once_and_restores_old_application(self):
  h,r,_=self.execute();self.assertEqual(r['status'],'SCHEMA_COMPLETE_OLD_APPLICATION_AVAILABLE');self.assertFalse(r['targetImagesActivated']);self.assertEqual(h.calls.count(('databaseCommand','apply')),1);self.assertLess(h.calls.index(('databaseCommand','reconcile')),h.calls.index(('bootstrapProbe','preactivate')));self.assertLess(h.calls.index(('bootstrapProbe','preactivate')),h.calls.index(('start',None)))
 def test_backup_failure_never_applies(self):
  h,r,_=self.execute(('backupCommand','prepare'));self.assertIsNone(r);self.assertNotIn(('databaseCommand','apply'),h.calls);self.assertTrue(h.running)
 def test_unknown_commit_never_replays(self):
  h,r,state=self.execute(('databaseCommand','apply'));self.assertIsNone(r);self.assertEqual(h.calls.count(('databaseCommand','apply')),1);self.assertIn(('databaseCommand','reconcile'),h.calls);self.assertLess(max(i for i,v in enumerate(h.calls) if v==('databaseCommand','drain')),h.calls.index(('databaseCommand','reconcile')))
 def test_old_application_failure_keeps_maintenance(self):
  h,r,state=self.execute('old');self.assertIsNone(r);self.assertIn('OPERATOR_RECONCILIATION_REQUIRED',state);self.assertIn('"maintenanceHeld":true',state)
if __name__=='__main__':unittest.main()
