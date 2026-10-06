"""Source-only root captures and canonical verifier are mocked; no host/SQL."""
import copy,hashlib,json,types,unittest,pathlib,io,runpy,stat
from contextlib import redirect_stdout
from unittest.mock import patch
import cn_backup_profile_host as m
from test_cn_backup_profile import inputs,FixtureAuthority

class Tests(unittest.TestCase):
 def fixture(self):
  profile,ref,files=inputs();host=json.loads(files[ref['path']]['bytes'])
  def file(path,value,mode):
   raw=value if isinstance(value,bytes) else json.dumps(value,sort_keys=True).encode()
   files[path]=dict(bytes=raw,uid=0,gid=0,mode=mode,links=1,regular=True,symlink=False,parentsProtected=True)
   return dict(path=path,sha256=hashlib.sha256(raw).hexdigest())
  python=file('/usr/bin/python3.11',b'fixture python','0755');host['pythonRuntime']=python
  ref=file(ref['path'],host,'0600')
  watchdog=file('/usr/local/lib/workspacex-cn/cn_backup_watchdog.py',b'fixture watchdog','0700');profile['installedFilesSha256'][watchdog['path']]=watchdog['sha256']
  code=file(m.INSTALLED,pathlib.Path(m.__file__).read_bytes(),'0700');profile['installedFilesSha256'][m.INSTALLED]=code['sha256'];profile['filesSha256']={m.SOURCE:code['sha256']}
  original=dict(schemaVersion=1,mode='maintenance-all-writer-fence',productionActionsAuthorized=True,identity=copy.deepcopy(host['identity']),toolRevision=profile['toolRevision'])
  original_ref=file('/etc/workspacex-cn/reviewed-original-plan.json',original,'0600')
  transport=types.SimpleNamespace(plan=copy.deepcopy(original),manifest_sha=original_ref['sha256'],reviewed_plan_ref=original_ref)
  profile['backupProfileBootstrap']=dict(schemaVersion=1,sourcePath=m.SOURCE,sha256=code['sha256'],originalHostPlan=copy.deepcopy(original_ref),backupHostPlan=copy.deepcopy(ref),allowedProfileKeys=list(m.BINDING_KEYS))
  def reader(path,mode=0o600):return json.dumps(profile,sort_keys=True).encode() if path==m.PROFILE else files[path]['bytes']
  return profile,ref,files,transport,reader
 def prepare(self,ref,files,transport,reader,binder=None):
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'uname',return_value=types.SimpleNamespace(sysname='Linux')),patch.object(m,'private',side_effect=reader),patch.object(m,'capture_file',side_effect=lambda path,mode:copy.deepcopy(files[path])),patch.object(m,'ProtectedCanonicalAuthority',side_effect=lambda *_:FixtureAuthority()):
   if binder:
    with patch.object(m,'bind_backup_profile',side_effect=binder):return m.prepare_backup_profile(ref,original_transport=transport)
   return m.prepare_backup_profile(ref,original_transport=transport)
 def test_authorized_first_binding_executes_real_pure_binder_preserving_all_other_keys(self):
  profile,ref,files,t,reader=self.fixture();before=copy.deepcopy(profile)
  result=self.prepare(ref,files,t,reader)
  self.assertEqual(profile,before);self.assertEqual(result['backupHostPlan'],ref)
  for key,value in before.items():self.assertEqual(result[key],value)
  self.assertEqual(set(result)-set(before),set(m.BINDING_KEYS));self.assertEqual(result['backupPythonRuntime']['path'],'/usr/bin/python3.11')
 def test_current_artifact_profile_missing_capability_refuses_first_binding(self):
  p,r,f,t,read=self.fixture();p.pop('backupProfileBootstrap')
  with self.assertRaisesRegex(RuntimeError,'BOOTSTRAP_CAPABILITY'):self.prepare(r,f,t,read)
 def test_wrong_original_raw_hash_and_tool_and_cross_identity_reject(self):
  for variant in ('manifest','bytes','tool','cross-identity','unapproved'):
   p,r,f,t,read=self.fixture()
   if variant=='manifest':t.manifest_sha='0'*64
   elif variant=='bytes':f[t.reviewed_plan_ref['path']]['bytes']+=b' '
   elif variant=='tool':p['toolRevision']='0'*40
   elif variant=='cross-identity':t.plan['identity']['attemptId']='other'
   else:
    original=json.loads(f[t.reviewed_plan_ref['path']]['bytes']);original['productionActionsAuthorized']=False;raw=json.dumps(original).encode();f[t.reviewed_plan_ref['path']]['bytes']=raw;t.manifest_sha=t.reviewed_plan_ref['sha256']=hashlib.sha256(raw).hexdigest();p['backupProfileBootstrap']['originalHostPlan']=copy.deepcopy(t.reviewed_plan_ref)
   with self.assertRaises(RuntimeError):self.prepare(r,f,t,read)
 def test_unapproved_scope_reference_and_source_pins_reject(self):
  for variant in ('keys','backup-ref','original-ref','source','installed-source','cap-source'):
   p,r,f,t,read=self.fixture();c=p['backupProfileBootstrap']
   if variant=='keys':c['allowedProfileKeys'].append('toolRevision')
   elif variant=='backup-ref':c['backupHostPlan']['sha256']='0'*64
   elif variant=='original-ref':c['originalHostPlan']['sha256']='0'*64
   elif variant=='source':p['filesSha256'][m.SOURCE]='0'*64
   elif variant=='installed-source':f[m.INSTALLED]['bytes']+=b' '
   else:c['sha256']='0'*64
   with self.assertRaises(RuntimeError):self.prepare(r,f,t,read)
 def test_existing_binding_same_ref_reuses_authority_but_rebind_refuses(self):
  p,r,f,t,read=self.fixture();p['backupHostPlan']=copy.deepcopy(r);p.pop('backupProfileBootstrap')
  self.assertEqual(self.prepare(r,f,t,read)['backupHostPlan'],r)
  p['backupHostPlan']['sha256']='0'*64
  with self.assertRaisesRegex(RuntimeError,'EXISTING_AUTHORITY'):self.prepare(r,f,t,read)
 def test_binder_cannot_change_nonallowed_keys_or_capability_or_existing_binding(self):
  for variant in ('tool','capability','extra','delete','existing-key'):
   p,r,f,t,read=self.fixture();p['backupRuntime']={'preserved':True} if variant=='existing-key' else None
   if variant!='existing-key':p.pop('backupRuntime')
   def corrupt(existing,*args,**kwargs):
    result=copy.deepcopy(existing)
    if variant=='tool':result['toolRevision']='0'*40
    elif variant=='capability':result['backupProfileBootstrap']['allowedProfileKeys']=[]
    elif variant=='extra':result['unapprovedKey']=True
    elif variant=='delete':result.pop('filesSha256')
    else:result['backupRuntime']={'changed':True}
    return result
   with self.assertRaises(RuntimeError):self.prepare(r,f,t,read,corrupt)
 def test_authority_change_during_capture_rejects_output(self):
  for variant in ('profile','original'):
   p,r,f,t,reader=self.fixture();counts={}
   def changing(path,mode=0o600):
    counts[path]=counts.get(path,0)+1;raw=reader(path,mode)
    if variant=='profile' and path==m.PROFILE and counts[path]>1:return raw+b' '
    if variant=='original' and path==t.reviewed_plan_ref['path'] and counts[path]>2:return raw+b' '
    return raw
   with self.assertRaisesRegex(RuntimeError,'AUTHORITY_CHANGED'):self.prepare(r,f,t,changing)
 def test_role_approval_still_validated_by_existing_binder(self):
  p,r,f,t,read=self.fixture();host=json.loads(f[r['path']]['bytes']);f[host['roleApproval']['path']]['bytes']+=b' '
  with self.assertRaisesRegex(RuntimeError,'FILE_TRUST'):self.prepare(r,f,t,read)

class CliTests(unittest.TestCase):
 fixture=Tests.fixture
 def invoke_cli(self,ref,files,t,reader,argv=None):
  args=argv or ['--prepare-backup-profile',ref['path'],ref['sha256'],t.reviewed_plan_ref['path'],t.reviewed_plan_ref['sha256']]
  output=io.StringIO()
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'uname',return_value=types.SimpleNamespace(sysname='Linux')),patch.object(m,'private',side_effect=reader),patch.object(m,'capture_file',side_effect=lambda path,mode:copy.deepcopy(files[path])),patch.object(m,'ProtectedCanonicalAuthority',side_effect=lambda *_:FixtureAuthority()),patch.object(m.sys,'argv',['cn_backup_profile_host.py',*args]),redirect_stdout(output):
   code=m.main()
  return code,json.loads(output.getvalue())
 def test_actual_cli_dispatch_outputs_real_binder_result_without_profile_write(self):
  p,r,f,t,read=self.fixture();before=copy.deepcopy(p);code,out=self.invoke_cli(r,f,t,read)
  self.assertEqual(code,0);self.assertEqual(out['backupHostPlan'],r);self.assertEqual(p,before)
 def test_actual_program_main_guard_executes_and_outputs_only_bound_profile(self):
  p,r,f,t,read=self.fixture();helper='/usr/local/lib/workspacex-cn/backup_profile_transport.cjs';raw=b'fixture canonical verifier'
  f[helper]=dict(bytes=raw,uid=0,gid=0,mode='0700',links=1,regular=True,symlink=False,parentsProtected=True);p['installedFilesSha256'][helper]=hashlib.sha256(raw).hexdigest()
  evidence=FixtureAuthority().verify(json.loads(f[r['path']]['bytes']),b'fixture config');out=io.StringIO()
  def metadata(path):
   item=f[str(path)];return types.SimpleNamespace(st_uid=0,st_gid=0,st_nlink=1,st_mode=stat.S_IFREG|int(item['mode'],8))
  argv=['cn_backup_profile_host.py','--prepare-backup-profile',r['path'],r['sha256'],t.reviewed_plan_ref['path'],t.reviewed_plan_ref['sha256']]
  with patch('host_transport.private',side_effect=read),patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'uname',return_value=types.SimpleNamespace(sysname='Linux')),patch.object(m.os,'lstat',side_effect=metadata),patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout=json.dumps(evidence).encode())) as provider,patch.object(m.sys,'argv',argv),redirect_stdout(out):
   with self.assertRaises(SystemExit) as end:runpy.run_path(m.__file__,run_name='__main__')
  self.assertEqual(end.exception.code,0);self.assertEqual(json.loads(out.getvalue())['backupHostPlan'],r);self.assertEqual(provider.call_count,1)
  self.assertEqual(provider.call_args.args[0][:3],['/usr/bin/node',helper,'--protected-backup-profile'])
 def test_cli_selection_never_grants_missing_or_wrong_authority(self):
  for variant in ('missing','original-ref','backup-ref','raw','tool','runtime-plan','unapproved'):
   p,r,f,t,read=self.fixture();args=None
   if variant=='missing':p.pop('backupProfileBootstrap')
   elif variant=='original-ref':args=['--prepare-backup-profile',r['path'],r['sha256'],t.reviewed_plan_ref['path'],'0'*64]
   elif variant=='backup-ref':args=['--prepare-backup-profile',r['path'],'0'*64,t.reviewed_plan_ref['path'],t.reviewed_plan_ref['sha256']]
   elif variant=='raw':f[t.reviewed_plan_ref['path']]['bytes']+=b' '
   elif variant=='tool':p['toolRevision']='0'*40
   else:
    original=json.loads(f[t.reviewed_plan_ref['path']]['bytes'])
    if variant=='runtime-plan':original['runtimeSourcePlanSha256']='0'*64
    else:original['productionActionsAuthorized']=False
    raw=json.dumps(original).encode();f[t.reviewed_plan_ref['path']]['bytes']=raw;t.manifest_sha=t.reviewed_plan_ref['sha256']=hashlib.sha256(raw).hexdigest();p['backupProfileBootstrap']['originalHostPlan']=copy.deepcopy(t.reviewed_plan_ref)
   with self.assertRaises(RuntimeError):self.invoke_cli(r,f,t,read,args)

if __name__=='__main__':unittest.main()
