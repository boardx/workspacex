import copy,fcntl,hashlib,importlib.util,json,os,pathlib,subprocess,tempfile,unittest
import cn_maintenance_admission as a
import cn_maintenance_hold as h
D=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('tool',D/'cn-build-tool-identity.py');tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)
IDENTITY={'sourceRevision':'9'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'c'*64,'attemptId':'fixture'}
VERIFIER_FIXTURE='''import os,sys,json,hashlib
os.fstat(9)
e=json.load(open(sys.argv[1]));raw=open(sys.argv[1],'rb').read()
h=lambda b:hashlib.sha256(b).hexdigest()
receipts={db:h(json.dumps(value,sort_keys=True,separators=(',',':')).encode()) for db,value in e['fidelityReceipts'].items()}
print(json.dumps({'schemaVersion':1,'mode':'maintenance-recovery-evidence-replayed','identity':e['identity'],'toolRevision':e['toolRevision'],'recoveryEvidenceSha256':h(raw),'fidelityReceiptSha256':receipts,'productionRecoveryAdapterSha256':e['productionRecoveryAdapterSha256'],'objectRecoveryEvidenceSha256':e['objectRecoveryEvidenceSha256']}))
'''
class MaintenanceAdmissionTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(dir=str(pathlib.Path(tempfile.gettempdir()).resolve()));self.root=pathlib.Path(self.temp.name);self.root.chmod(0o700)
  self.store=h.HoldStore(self.root,os.getuid(),os.getgid());hold=self.store.create(IDENTITY)
  self.fd=os.open(self.root/'release.lock',os.O_CREAT|os.O_RDWR,0o600);fcntl.flock(self.fd,fcntl.LOCK_EX)
  try:self.saved9=os.dup(9)
  except OSError:self.saved9=None
  os.dup2(self.fd,9)
  self.verifier=self.root/'verifier.py';self.verifier.write_text(VERIFIER_FIXTURE);self.verifier.chmod(0o700)
  receipts={}
  for db in a.DATABASES:
   receipts[db]={'schemaVersion':1,'database':db,'backupReceiptSha256':'1'*64,'ciphertextSha256':'2'*64,'targetRdsInstanceId':'pgm-isolatedfixture','targetPeerAddressSha256':'3'*64,'tables':[],'sequences':[],'readOnly':True,'rollbackComplete':True,'dataFidelityVerified':True}
  self.evidence={'schemaVersion':1,'identity':IDENTITY,'toolRevision':'a'*40,'fidelityReceipts':receipts,'productionRecoveryAdapterSha256':'4'*64,'objectRecoveryEvidenceSha256':'5'*64}
  self.binding_path=self.root/'binding.json'
  self.profile_path=self.root/'profile.json'
  self.evidence_path=self.root/'recovery.json'
  self.value={'schemaVersion':1,'mode':'maintenance-operational-preactivate','applicationRevision':IDENTITY['sourceRevision'],'baselineRevision':IDENTITY['baselineRevision'],'migrationPlanSha256':IDENTITY['migrationPlanSha256'],'attemptId':'fixture','toolRevision':'a'*40,'toolRoot':'/opt/workspacex-cn/release-tools/'+'a'*40,'release':'2026.10.3-cn.1','filesSha256':{k:'d'*64 for k in tool.FILES},'applicationSource':{'path':'/var/lib/workspacex-cn/build-sources/'+'9'*40+'.git','ref':'refs/heads/candidate','treeSha':'e'*40,'inventorySha256':'f'*64},'maintenanceOptIn':a.OPT_IN,'holdGeneration':hold['generation'],'holdSha256':hold['sha256']}
  self.value.update({key:'6'*64 for key in ('sealSha256','manifestSha256','prebuildSha256')})
  self.profile={'toolRevision':self.value['toolRevision'],'filesSha256':self.value['filesSha256'],'maintenanceRecoveryVerifier':{'sourcePath':a.VERIFIER_SOURCE,'installedPath':a.VERIFIER,'sha256':a.digest(VERIFIER_FIXTURE.encode())}}
  self.sync()
 def sync(self):
  self.profile_path.write_text(json.dumps(self.profile))
  self.evidence_path.write_text(json.dumps(self.evidence));self.value['recoveryEvidenceSha256']=a.digest(self.evidence_path.read_bytes())
  self.binding_path.write_text(json.dumps(self.value))
 def tearDown(self):
  if self.saved9 is None:os.close(9)
  else:os.dup2(self.saved9,9);os.close(self.saved9)
  os.close(self.fd);self.temp.cleanup()
 def read(self,path,mode=None):
  if path=='/etc/workspacex-cn/maintenance-bindings/'+'9'*40+'/fixture/preactivate.json':return self.binding_path.read_bytes()
  if path==a.PROFILE:return self.profile_path.read_bytes()
  if path==a.VERIFIER:return self.verifier.read_bytes()
  if path=='/etc/workspacex-cn/maintenance-evidence/'+'9'*40+'/fixture/recovery.json':return self.evidence_path.read_bytes()
  raise AssertionError('unexpected protected path')
 def file_identity(self,path):
  actual=self.profile_path if path==a.PROFILE else self.verifier if path==a.VERIFIER else self.binding_path if '/maintenance-bindings/' in path else self.evidence_path
  st=actual.lstat()
  return (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns,st.st_uid,st.st_gid,st.st_mode,st.st_nlink)
 def lock(self):h.require_canonical_lock(str(self.root/'release.lock'),os.getuid(),os.getgid())
 def replay(self,command,fds):
  self.assertEqual(command,['python3',a.VERIFIER,'--maintenance-evidence-replay','/etc/workspacex-cn/maintenance-evidence/'+'9'*40+'/fixture/recovery.json'])
  self.assertEqual(fds,(9,))
  return subprocess.check_output(['python3',str(self.verifier),str(self.evidence_path)],pass_fds=fds,stderr=subprocess.DEVNULL)
 def admit(self,replay=None):return a.admit(self.value,private_read=self.read,source_read=lambda _:VERIFIER_FIXTURE.encode(),store=self.store,lock_check=self.lock,replay=self.replay if replay is None else replay,file_identity=self.file_identity)
 def test_held_maintenance_dynamic_precheck_admits_and_never_clears(self):
  before=self.store.read();r=self.admit();self.assertTrue(r['dynamicPreactivateAdmitted']);self.assertFalse(r['ready']);self.assertFalse(r['productionMutationAuthorized']);self.assertEqual(self.store.read(),before)
  with self.assertRaisesRegex(h.HoldRejected,'MAINTENANCE_HOLD_BLOCKS_RELEASE'):self.store.admit_ordinary_release()
 def test_explicit_mode_and_optin_no_default(self):
  for mode in ['operational-preactivate','build-only','activate']:
   self.value['mode']=mode
   with self.assertRaisesRegex(ValueError,'MAINTENANCE_MODE_REQUIRED'):self.admit()
  self.value['mode']='maintenance-operational-preactivate';self.value.pop('maintenanceOptIn')
  with self.assertRaisesRegex(ValueError,'MAINTENANCE_OPT_IN_REQUIRED'):self.admit()
 def test_all_identity_hold_and_recovery_hash_drift_fail(self):
  for field in ['applicationRevision','baselineRevision','migrationPlanSha256','attemptId','toolRevision','holdGeneration','holdSha256','recoveryEvidenceSha256']:
   saved=self.value[field];self.value[field]='0'*len(saved)
   with self.subTest(field=field),self.assertRaises(ValueError):self.admit()
   self.value[field]=saved
 def test_missing_or_truthy_recovery_not_proof(self):
  for proof in [True,{'accepted':True},{'ready':True}, {'independentThreeDbFidelityReceiptVerification':True}]:
   with self.subTest(proof=proof),self.assertRaises(ValueError):self.admit(replay=lambda *_:json.dumps(proof).encode())
  self.evidence['fidelityReceipts'].pop('workspacex_memory');self.sync()
  with self.assertRaisesRegex(ValueError,'RECOVERY_DATABASE_CLOSURE'):self.admit()
 def test_same_root_profile_required_and_verifier_drift_rejected(self):
  self.profile['toolRevision']='0'*40;self.sync()
  with self.assertRaisesRegex(ValueError,'MAINTENANCE_PROFILE_IDENTITY'):self.admit()
  self.profile['toolRevision']='a'*40;self.sync();self.verifier.write_text('drift')
  with self.assertRaisesRegex(ValueError,'RECOVERY_VERIFIER_SOURCE_BINDING'):self.admit()
 def test_cas_change_during_actual_replay_rejected(self):
  def replay(*args):
   out=self.replay(*args);self.store.clear(self.store.read());return out
  with self.assertRaisesRegex(ValueError,'MAINTENANCE_HOLD_CHANGED_DURING_REPLAY'):self.admit(replay=replay)
 def test_actual_subprocess_changes_each_protected_input_rejected(self):
  for target in (self.evidence_path,self.profile_path,self.verifier,self.binding_path):
   for same_bytes in (False,True):
    with self.subTest(target=target.name,same_bytes=same_bytes):
     originals={p:p.read_bytes() for p in (self.evidence_path,self.profile_path,self.verifier,self.binding_path)}
     def replay(command,fds):
      output=self.replay(command,fds)
      # A second real child replaces the input after the replay child has read
      # it. Same bytes/new inode must also invalidate the admission snapshot.
      code="from pathlib import Path; import os,sys; p=Path(sys.argv[1]); q=p.with_name(p.name+'.replace'); q.write_bytes(p.read_bytes() if sys.argv[2]=='same' else b'changed'); q.chmod(p.stat().st_mode & 0o777); os.replace(q,p)"
      subprocess.run(['python3','-c',code,str(target),'same' if same_bytes else 'changed'],check=True,stderr=subprocess.DEVNULL)
      return output
     with self.assertRaisesRegex(ValueError,'MAINTENANCE_PROTECTED_INPUT_CHANGED'):self.admit(replay=replay)
     for path,raw in originals.items():path.write_bytes(raw)
 def test_source_binding_replayed_readback_required(self):
  calls=[]
  def source(name):
   calls.append(name);return VERIFIER_FIXTURE.encode() if len(calls)==1 else b'changed-source'
  with self.assertRaisesRegex(ValueError,'RECOVERY_VERIFIER_SOURCE_CHANGED'):
   a.admit(self.value,private_read=self.read,source_read=source,store=self.store,lock_check=self.lock,replay=self.replay,file_identity=self.file_identity)
 def test_unheld_foreign_or_missing_fd9_rejected(self):
  os.close(9)
  with self.assertRaises((OSError,h.HoldRejected)):self.admit()
  os.dup2(self.fd,9);fcntl.flock(self.fd,fcntl.LOCK_UN)
  with self.assertRaisesRegex(h.HoldRejected,'CANONICAL_LOCK_NOT_HELD'):self.admit()
 def test_modes_and_phases_do_not_cross(self):
  v=self.value;self.assertEqual(tool.validate_maintenance_identity(v,'9'*40,v['release'],'fixture','preactivate'),v['toolRoot'])
  for phase in ['prebuild','prepare','activate','migrate','promotion']:
   with self.subTest(phase=phase),self.assertRaises(ValueError):tool.validate_maintenance_identity(v,'9'*40,v['release'],'fixture',phase)
  with self.assertRaises(ValueError):tool.validate_operational_identity(v,'9'*40,v['release'],'fixture','preactivate')
 def test_actual_shell_flag_dispatch_and_dynamic_probe_unchanged(self):
  for name in ['collect-cn-release-preflight.sh','verify-cn-release-preflight.sh']:
   text=(D/name).read_text();prefix=text[:text.index('[[ $#')]
   for flags,want in [([],['0','--operational','--operational-source','operational-bindings']),(['--operational'],['1','--operational','--operational-source','operational-bindings']),(['--maintenance'],['1','--maintenance','--maintenance-source','maintenance-bindings'])]:
    command=prefix+'\nprintf "%s\\n" "$operational" "$admission_flag" "$source_admission_flag" "$binding_family"\n'
    result=subprocess.run(['bash','-c',command,'fixture',*flags],capture_output=True,check=True)
    self.assertEqual(result.stdout.decode().splitlines(),want)
  baseline=(D/'fixtures/collect-cn-release-preflight.original.sh').read_text()
  current=(D/'collect-cn-release-preflight.sh').read_text()
  start='bootstrap_out="$work/bootstrap.out"';end='output_dir="$INPUT_ROOT/$revision/$attempt_id"'
  self.assertEqual(baseline[baseline.index(start):baseline.index(end)],current[current.index(start):current.index(end)])
 def test_collector_verifier_only_dispatch_new_explicit_flag(self):
  for name in ['collect-cn-release-preflight.sh','verify-cn-release-preflight.sh']:
   text=(D/name).read_text();self.assertIn('${1:-} == --maintenance',text);self.assertIn('binding_family=maintenance-bindings',text);self.assertNotIn('clearMaintenanceHold',text)
  source=(D/'cn-build-tool-identity.py').read_text();self.assertIn("'admit','/var/lib/workspacex-cn/runtime'",source)
  self.assertNotIn('--maintenance',(D/'deploy-cn-production.sh').read_text())
if __name__=='__main__':unittest.main()
