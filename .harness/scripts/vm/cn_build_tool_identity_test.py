import datetime,importlib.util,pathlib,unittest,copy,hashlib,sys,io,json,os,tempfile,subprocess
from unittest.mock import patch
D=pathlib.Path(__file__).parent
sys.path.insert(0,str(D.parents[2]/'.agents/skills/workspacex-cn-release/scripts'))
sp=importlib.util.spec_from_file_location('tool',D/'cn-build-tool-identity.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
APP='9'*40;TOOL='a'*40
class Identity(unittest.TestCase):
 def fixture(self):return {'schemaVersion':1,'mode':'build-only','applicationRevision':APP,'toolRevision':TOOL,'toolRoot':'/opt/workspacex-cn/release-tools/'+TOOL,'release':'2026.10.3-cn.1','attemptId':'fixture','filesSha256':{k:'b'*64 for k in m.FILES},'applicationSource':{'path':'/var/lib/workspacex-cn/build-sources/'+APP+'.git','ref':'refs/heads/candidate','treeSha':'c'*40,'inventorySha256':hashlib.sha256(b'fixturetree').hexdigest()}}
 def test_exact_pair(self):self.assertEqual(m.validate_identity(self.fixture(),APP,'2026.10.3-cn.1','fixture','prebuild'),'/opt/workspacex-cn/release-tools/'+TOOL)
 def test_reject_identity_changes(self):
  for key,value in [('applicationRevision',TOOL),('toolRevision','main'),('toolRoot','/tmp/tool'),('release','other'),('attemptId','other'),('mode','activate'),('schemaVersion',2)]:
   with self.subTest(key=key):
    v=self.fixture();v[key]=value
    with self.assertRaises(ValueError):m.validate_identity(v,APP,'2026.10.3-cn.1','fixture','prebuild')
 def test_never_authorizes_dynamic_or_mutation(self):
  for phase in ['preactivate','prepare','provision','migrate','activate','promotion']:
   with self.subTest(phase=phase),self.assertRaises(ValueError):m.validate_identity(self.fixture(),APP,'2026.10.3-cn.1','fixture',phase)
 def test_exact_closure(self):
  for change in ['missing','extra']:
   v=self.fixture()
   if change=='missing':v['filesSha256'].pop(next(iter(m.FILES)))
   else:v['filesSha256']['arbitrary']='b'*64
   with self.assertRaises(ValueError):m.validate_identity(v,APP,'2026.10.3-cn.1','fixture','prebuild')
 def test_actual_comparison_rejects_installed_or_object_drift(self):
  import json
  for drift in ['none','installed','object','head','dirty','hash']:
   with self.subTest(drift=drift):
    v=self.fixture();data={k:('file:'+k).encode() for k in m.FILES};v['filesSha256']={k:hashlib.sha256(b).hexdigest() for k,b in data.items()}
    if drift=='hash':v['filesSha256'][next(iter(data))]='0'*64
    def read(path,mode=None):
     if str(path)=='/manifest':return json.dumps(v).encode()
     for k,installed in m.FILES.items():
      if str(path)==v['toolRoot']+'/'+k:return data[k]
      if str(path)==installed:return b'drift' if drift=='installed' else data[k]
     raise AssertionError('unexpected read')
    def git(args,**kw):
     if args[args.index('-C')+1]==v['applicationSource']['path']:
      if args[-1]=='--is-bare-repository':return b'true'
      if args[-1]=='refs/heads/candidate^{commit}':return APP.encode()
      if args[-1]==APP+'^{tree}':return ('c'*40).encode()
      if 'ls-tree' in args:return b'fixturetree'
      if 'fsck' in args:return b''
      raise AssertionError(args)
     if args[-2:]==['rev-parse','HEAD']:return ((APP if drift=='head' else TOOL)+'\n').encode()
     if args[-2:]==['status','--porcelain']:return b'M file' if drift=='dirty' else b''
     if args[-2]=='show':return b'drift' if drift=='object' else data[args[-1].split(':',1)[1]]
     raise AssertionError(args)
    with patch.object(m,'trust_git_root'),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'private_read',side_effect=read),patch.object(m.subprocess,'check_output',side_effect=git),patch.object(m.subprocess,'run',return_value=type('Result',(),{'returncode':1,'stdout':b''})()),patch.object(m.pathlib.Path,'lstat',return_value=type('Stat',(),{'st_mode':0o40700,'st_uid':0})()),patch.object(m.pathlib.Path,'exists',return_value=False),patch.object(m.pathlib.Path,'glob',return_value=[]),patch.object(sys,'argv',['tool','/manifest',APP,'2026.10.3-cn.1','fixture','prebuild']),patch('sys.stdout',new_callable=io.StringIO):
     if drift=='none':m.main()
     else:
      with self.assertRaises(ValueError):m.main()
 def receipt_fixture(self):
  import json
  binding=self.fixture();manifest={'sourceRevision':APP,'release':binding['release'],'images':{k:{'image':'registry.example/wsx/'+k+'@sha256:'+'b'*64} for k in ('web','api','agent','sandbox','postgres','redis')}}
  raw=json.dumps(manifest).encode();seal={'schemaVersion':1,'status':'sealed','sourceRevision':APP,'manifestSha256':hashlib.sha256(raw).hexdigest()}
  sys.path.insert(0,str(D.parents[2]/'.agents/skills/workspacex-cn-release/scripts'))
  from test_validate_preflight import fixture
  prebuild=json.loads(json.dumps(fixture()).replace('a'*40,APP).replace('2026.9.15-cn.2',binding['release']).replace('attempt-1',binding['attemptId']))
  prebuild['issuedAt']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=1)).strftime('%Y-%m-%dT%H:%M:%SZ');prebuild['expiresAt']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ')

  return binding,manifest,seal,prebuild
 def test_sealed_receipt_actual_hashes_and_no_ready(self):
  import json
  binding,manifest,seal,prebuild=self.receipt_fixture();raw=[json.dumps(x).encode() for x in (manifest,seal,prebuild)]
  seen=[]
  def inspect(image):seen.append(image);return 'Digest: sha256:'+'b'*64+'\n'
  from validate_preflight import validate
  value=m.sealed_receipt(binding,*raw,inspect,lambda raw:validate(json.loads(raw)))
  self.assertEqual(len(seen),6);self.assertEqual(value['applicationRevision'],APP);self.assertEqual(value['toolRevision'],TOOL)
  for key in ('ready','prepared','productionActivated'):self.assertIs(value[key],False)
  self.assertEqual(value['sealSha256'],hashlib.sha256(raw[1]).hexdigest())
 def test_receipt_rejects_registry_and_services(self):
  import json
  for bad in ('registry','mutable','missing','tool-as-source','bad-seal','wrong-attempt','dynamic','expired'):
   with self.subTest(bad=bad):
    binding,manifest,seal,prebuild=self.receipt_fixture()
    if bad=='mutable':manifest['images']['api']['image']='registry.example/wsx/api:latest'
    if bad=='missing':manifest['images'].pop('api')
    if bad=='tool-as-source':manifest['sourceRevision']=TOOL
    if bad=='bad-seal':seal['manifestSha256']='0'*64
    if bad=='wrong-attempt':prebuild['attemptId']='other'
    if bad=='expired':prebuild['expiresAt']='2000-01-01T00:00:00Z'
    if bad=='dynamic':prebuild['checks']['bootstrap.compatibility']['metadata']['schemaContract']=True
    if bad in ('mutable','missing'):seal['manifestSha256']=hashlib.sha256(json.dumps(manifest).encode()).hexdigest()
    with self.assertRaises((ValueError,__import__('validate_preflight').ContractError)):m.sealed_receipt(binding,*[json.dumps(x).encode() for x in (manifest,seal,prebuild)],lambda _: 'Digest: sha256:'+('0' if bad=='registry' else 'b')*64+'\n',lambda raw: __import__('validate_preflight').validate(json.loads(raw)))
 def test_real_git_metadata_rejects_symlinks_gitfile_and_include(self):
  for bad in ('safe','gitfile','config-symlink','object-symlink','commondir','include','writable'):
   with self.subTest(bad=bad),tempfile.TemporaryDirectory() as temp:
    root=pathlib.Path(temp)/'tool';root.mkdir(mode=0o700)
    subprocess.run(['git','init','-q',str(root)],check=True)
    gd=root/'.git'
    if bad=='gitfile':
     import shutil
     shutil.rmtree(gd);gd.write_text('gitdir: /untrusted\n')
    if bad=='config-symlink':(gd/'config').unlink();(gd/'config').symlink_to('/etc/passwd')
    if bad=='object-symlink':(gd/'objects'/'external').symlink_to('/etc')
    if bad=='commondir':(gd/'commondir').write_text('/external')
    if bad=='include':
     with (gd/'config').open('a') as f:f.write('\n[include]\n path=/external\n')
    if bad=='writable':(gd/'config').chmod(0o666)
    if bad=='safe':m.trust_git_root(root,False,expected_uid=os.getuid(),boundary=temp)
    else:
     with self.assertRaises(ValueError):m.trust_git_root(root,False,expected_uid=os.getuid(),boundary=temp)
 def test_real_fsmonitor_command_cannot_execute(self):
  with tempfile.TemporaryDirectory(dir='/private/tmp') as temp:
   root=pathlib.Path(temp)/'tool';marker=pathlib.Path(temp)/'executed';root.mkdir(mode=0o700)
   subprocess.run(['git','init','-q',str(root)],check=True)
   command='touch '+str(marker)
   subprocess.run(['git','-C',str(root),'config','core.fsmonitor',command],check=True)
   m.trust_git_root(root,False,expected_uid=os.getuid(),boundary=temp)
   env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
   subprocess.run(['git',*m.GIT_OPTIONS,'-C',str(root),'status','--porcelain'],env=env,check=True,stdout=subprocess.PIPE)
   self.assertFalse(marker.exists())
 def test_atomic_receipt_failed_write_leaves_no_partial_final(self):
  with tempfile.TemporaryDirectory(dir='/private/tmp') as temp:
   output=pathlib.Path(temp)/'receipt.json'
   # Parent ownership guard is orthogonal; use real owned files/link/fsync on fixture.
   real_lstat=pathlib.Path.lstat
   def st(path):
    value=real_lstat(path)
    return type('S',(),{'st_mode':value.st_mode & ~0o022,'st_uid':0,'st_dev':value.st_dev,'st_ino':value.st_ino})()
   with patch.object(pathlib.Path,'lstat',st),patch.object(m.os,'fsync',side_effect=OSError('fixture ENOSPC')):
    with self.assertRaises(OSError):m.atomic_receipt(output,{'ready':False})
   self.assertFalse(output.exists());self.assertEqual(list(pathlib.Path(temp).glob('.build-only.*')),[])
 def test_atomic_receipt_existing_final_is_never_replaced(self):
  with tempfile.TemporaryDirectory(dir='/private/tmp') as temp:
   output=pathlib.Path(temp)/'receipt.json';output.write_bytes(b'original')
   real_lstat=pathlib.Path.lstat
   def st(path):
    value=real_lstat(path)
    return type('S',(),{'st_mode':value.st_mode & ~0o022,'st_uid':0,'st_dev':value.st_dev,'st_ino':value.st_ino})()
   with patch.object(pathlib.Path,'lstat',st),self.assertRaises(ValueError):m.atomic_receipt(output,{'ready':False})
   self.assertEqual(output.read_bytes(),b'original');self.assertEqual(list(pathlib.Path(temp).glob('.build-only.*')),[])
 def test_real_atomic_parent_failure_retry_and_cleanup_failure(self):
  for kind in ('success','parent-failure','same-retry','cleanup-failure','readback-failure'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory(dir='/private/tmp') as temp:
    output=pathlib.Path(temp)/'receipt.json';result={'ready':False};raw=(json.dumps(result,sort_keys=True)+'\n').encode()
    real_lstat=pathlib.Path.lstat;real_sync=os.fsync;real_unlink=pathlib.Path.unlink;calls=[0]
    def st(path):
     value=real_lstat(path)
     return type('S',(),{'st_mode':value.st_mode & ~0o022,'st_uid':0,'st_dev':value.st_dev,'st_ino':value.st_ino})()
    def read(path,mode=None):
     self.assertEqual(__import__('stat').S_IMODE(real_lstat(path).st_mode),mode)
     if kind=='readback-failure':raise ValueError('readback injected')
     return pathlib.Path(path).read_bytes()
    def sync(fd):
     calls[0]+=1
     if kind in ('parent-failure','cleanup-failure') and calls[0]==2:raise OSError('parent fsync injected')
     return real_sync(fd)
    def unlink(path,*args,**kwargs):
     if kind=='cleanup-failure' and path==output:raise OSError('cleanup injected')
     return real_unlink(path,*args,**kwargs)
    if kind=='same-retry':output.write_bytes(raw);output.chmod(0o600)
    with patch.object(pathlib.Path,'lstat',st),patch.object(m,'private_read',side_effect=read),patch.object(os,'fsync',side_effect=sync),patch.object(pathlib.Path,'unlink',unlink):
     if kind in ('success','same-retry'):self.assertEqual(m.atomic_receipt(output,result),hashlib.sha256(raw).hexdigest())
     elif kind=='readback-failure':
      with self.assertRaisesRegex(ValueError,'readback injected'):m.atomic_receipt(output,result)
     elif kind=='parent-failure':
      with self.assertRaises(OSError):m.atomic_receipt(output,result)
     else:
      with self.assertRaisesRegex(ValueError,'RECEIPT_CLEANUP_UNPROVEN'):m.atomic_receipt(output,result)
    self.assertEqual(output.exists(),kind not in ('parent-failure','readback-failure'))
    if output.exists():self.assertEqual(output.read_bytes(),raw)
    self.assertEqual(list(pathlib.Path(temp).glob('.build-only.*')),[])
 def test_exact_validator_rejects_stored_receipt_drift(self):
  from validate_preflight import validate
  _,_,_,prebuild=self.receipt_fixture();raw=json.dumps(prebuild).encode();stored=validate(prebuild)
  validator=D.parents[2]/'.agents/skills/workspacex-cn-release/scripts/validate_preflight.py'
  with patch.object(m,'private_read',return_value=validator.read_bytes()):
   self.assertEqual(m.validate_full_prebuild(validator,raw,json.dumps(stored).encode()),stored)
   stored['ready']=False
   with self.assertRaises(ValueError):m.validate_full_prebuild(validator,raw,json.dumps(stored).encode())
 def test_full_gate_rejects_missing_schema_or_check(self):
  from validate_preflight import validate,ContractError
  for bad in ('schema','missing-check','failed-check','static-dynamic'):
   binding,manifest,seal,prebuild=self.receipt_fixture()
   if bad=='schema':prebuild.pop('schemaVersion')
   if bad=='missing-check':prebuild['checks'].pop('registry.acr_auth')
   if bad=='failed-check':prebuild['checks']['registry.acr_auth']['status']='failed'
   if bad=='static-dynamic':prebuild['checks']['bootstrap.compatibility']['metadata']['permissionContract']=True
   with self.subTest(bad=bad),self.assertRaises((ValueError,ContractError)):
    m.sealed_receipt(binding,*[json.dumps(x).encode() for x in (manifest,seal,prebuild)],lambda _: 'Digest: sha256:'+'b'*64+'\n',lambda raw:validate(json.loads(raw)))
 def test_source_cache_cannot_be_moving_main(self):
  for key,bad in [('path','/opt/workspacex-cn/release-origin-cache.git'),('ref','refs/heads/main'),('treeSha','notsha'),('inventorySha256','notsha')]:
   with self.subTest(key=key):
    v=self.fixture();v['applicationSource'][key]=bad
    with self.assertRaises(ValueError):m.validate_identity(v,APP,'2026.10.3-cn.1','fixture','prebuild')
 def test_explicit_build_lane_legacy_and_activation_stay_separate(self):
  build=(D/'build-cn-release-candidate.sh').read_text();collector=(D/'collect-cn-release-preflight.sh').read_text();verifier=(D/'verify-cn-release-preflight.sh').read_text()
  self.assertIn('unset CN_BUILD_TOOL_BINDING CN_BUILD_TOOL_ROOT',build)
  self.assertIn('if [[ "$build_only" == 0 ]]; then\n"$PREFLIGHT_COLLECTOR" preactivate',build)
  self.assertIn('ready=false',build)
  self.assertIn('source_path="$TOOL_SOURCE_DIR/${pair%%:*}"',collector)
  self.assertIn('show "$revision:.agents/skills/workspacex-cn-release/scripts/validate_preflight.py"',verifier)
  self.assertNotIn('CN_BUILD_TOOL_BINDING',(D/'deploy-cn-production.sh').read_text())
if __name__=='__main__':unittest.main()
