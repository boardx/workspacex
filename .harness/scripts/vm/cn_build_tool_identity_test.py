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
 def test_original_authority_is_required_source_closure(self):
  source='packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts';self.assertIn(source,m.FILES);self.assertIsNone(m.FILES[source]);v=self.fixture();v['filesSha256'].pop(source)
  with self.assertRaisesRegex(ValueError,'TOOL_CLOSURE'):m.validate_identity(v,APP,'2026.10.3-cn.1','fixture','prebuild')
 def test_actual_comparison_rejects_installed_or_object_drift(self):
  import json
  for drift in ['none','installed','object','head','dirty','hash']:
   with self.subTest(drift=drift):
    v=self.fixture();data={k:('file:'+k).encode() for k in m.FILES};v['filesSha256']={k:hashlib.sha256(b).hexdigest() for k,b in data.items()}
    if drift=='hash':v['filesSha256']['packages/cloud-deploy/src/cn-maintenance-host/source_plan_authority.ts']='0'*64
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
  prebuild['phase']='artifact-build'
  for key in ('baselineSha','migrationPlanSha256','baselineSchemaSha256','baselineLedgerContract','baselineSchemaContract','baselinePermissionContract'):prebuild['checks']['bootstrap.compatibility']['metadata'].pop(key)
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
 def test_real_completion_checkout_rejects_unsafe_source_and_git_metadata(self):
  for bad in ('safe','blob','source-symlink','hardlink','gitfile','include','filter','writable-config'):
   with self.subTest(bad=bad),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
    root=pathlib.Path(temp)/'checkout';root.mkdir(mode=0o700);source=root/'migrator.ts';source.write_text('export const migrations=[];');source.chmod(0o600)
    subprocess.run(['git','init','-q',str(root)],check=True);subprocess.run(['git','-C',str(root),'add','.'],check=True);subprocess.run(['git','-C',str(root),'-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],check=True)
    app=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()
    if bad=='blob':source.write_text('throw Error();')
    if bad=='source-symlink':source.unlink();source.symlink_to('/etc/passwd')
    if bad=='hardlink':os.link(source,pathlib.Path(temp)/'external')
    if bad=='gitfile':
     import shutil
     shutil.rmtree(root/'.git');(root/'.git').write_text('gitdir: /external')
    if bad in ('include','filter'):
     with (root/'.git/config').open('a') as f:f.write('\n['+bad+']\n path=/external\n')
    if bad=='writable-config':(root/'.git/config').chmod(0o666)
    if bad=='safe':self.assertEqual(m.verify_completion_checkout(root,app,os.getuid(),temp),str(root))
    else:
     with self.assertRaises((ValueError,OSError)):m.verify_completion_checkout(root,app,os.getuid(),temp)
 def test_real_fsmonitor_command_cannot_execute(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
   root=pathlib.Path(temp)/'tool';marker=pathlib.Path(temp)/'executed';root.mkdir(mode=0o700)
   subprocess.run(['git','init','-q',str(root)],check=True)
   command='touch '+str(marker)
   subprocess.run(['git','-C',str(root),'config','core.fsmonitor',command],check=True)
   m.trust_git_root(root,False,expected_uid=os.getuid(),boundary=temp)
   env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
   subprocess.run(['git',*m.GIT_OPTIONS,'-C',str(root),'status','--porcelain'],env=env,check=True,stdout=subprocess.PIPE)
   self.assertFalse(marker.exists())
 def test_atomic_receipt_failed_write_leaves_no_partial_final(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
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
  with tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
   output=pathlib.Path(temp)/'receipt.json';output.write_bytes(b'original')
   real_lstat=pathlib.Path.lstat
   def st(path):
    value=real_lstat(path)
    return type('S',(),{'st_mode':value.st_mode & ~0o022,'st_uid':0,'st_dev':value.st_dev,'st_ino':value.st_ino})()
   with patch.object(pathlib.Path,'lstat',st),self.assertRaises(ValueError):m.atomic_receipt(output,{'ready':False})
   self.assertEqual(output.read_bytes(),b'original');self.assertEqual(list(pathlib.Path(temp).glob('.build-only.*')),[])
 def test_real_atomic_parent_failure_retry_and_cleanup_failure(self):
  for kind in ('success','parent-failure','same-retry','cleanup-failure','readback-failure'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
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
   self.assertEqual(m.validate_full_prebuild(validator,raw,json.dumps(stored).encode(),artifact_only=True),stored)
   stored['ready']=False
   with self.assertRaises(ValueError):m.validate_full_prebuild(validator,raw,json.dumps(stored).encode(),artifact_only=True)
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


class IndependentBuildCheckout(unittest.TestCase):
 def fixture(self,root):
  def git(where,*args):return subprocess.check_output(['/usr/bin/git',*m.GIT_OPTIONS,'-C',str(where),*args],stderr=subprocess.DEVNULL)
  original=root/'original';original.mkdir();git(original,'init','--initial-branch=main');git(original,'config','user.email','fixture@example.invalid');git(original,'config','user.name','Fixture')
  (original/'source.txt').write_text('baseline');git(original,'add','.');git(original,'commit','-qm','baseline');old=git(original,'rev-parse','HEAD').decode().strip()
  (original/'source.txt').write_text('candidate');git(original,'commit','-qam','candidate');app=git(original,'rev-parse','HEAD').decode().strip();git(original,'branch','candidate',app)
  (root/'build-sources').mkdir();cache=root/'build-sources'/(app+'.git');subprocess.check_output(['/usr/bin/git','clone','--bare','--no-local','--no-hardlinks',str(original),str(cache)],stderr=subprocess.DEVNULL)
  binding={'applicationSource':{'path':str(cache),'ref':'refs/heads/candidate','treeSha':git(cache,'rev-parse',app+'^{tree}').decode().strip(),'inventorySha256':hashlib.sha256(git(cache,'ls-tree','-r','-z',app)).hexdigest()},'mainSource':{'ref':'refs/heads/main','revision':app,'repository':str(cache)}}
  return binding,app,old,git
 def checkout(self,root,binding,app,create=True,base=None):
  return m.build_checkout(binding,app,'attempt-1',create,base=str(base or root/'build-checkouts'),expected_uid=os.getuid(),boundary=root)
 def test_actual_complete_cache_success_and_immutable_reuse(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp).resolve();binding,app,old,git=self.fixture(root);checkout=self.checkout(root,binding,app)
   self.assertEqual(checkout,str(root/'build-checkouts'/app/'attempt-1'));self.assertEqual(git(checkout,'rev-parse','HEAD').decode().strip(),app)
   self.assertEqual((pathlib.Path(checkout)/'source.txt').read_text(),'candidate')
   self.assertEqual(self.checkout(root,binding,app,False),checkout)
   self.assertEqual(git(root/'original','rev-parse','HEAD').decode().strip(),app)
 def test_wrong_cache_hash_shared_path_and_missing_main_fail_closed(self):
  for fault in ('hash','cache-path','shared-checkout','missing-main','wrong-main','old-main'):
   with self.subTest(fault=fault),tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp).resolve();binding,app,old,git=self.fixture(root)
    if fault=='hash':binding['applicationSource']['inventorySha256']='0'*64
    if fault=='cache-path':binding['applicationSource']['path']=str(root/'original')
    if fault=='missing-main':binding.pop('mainSource')
    if fault=='wrong-main':binding['mainSource']['revision']=old
    if fault=='old-main':git(binding['applicationSource']['path'],'update-ref','refs/heads/main',old);binding['mainSource']['revision']=old
    with self.assertRaises((ValueError,subprocess.CalledProcessError)):
     self.checkout(root,binding,app,base=root/'original' if fault=='shared-checkout' else None)
    self.assertFalse((root/'build-checkouts'/app/'attempt-1').exists())
 def test_symlink_cache_or_checkout_and_dirty_reuse_rejected_without_reset(self):
  for fault in ('cache-link','checkout-link','dirty'):
   with self.subTest(fault=fault),tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp).resolve();binding,app,old,git=self.fixture(root)
    if fault=='cache-link':
     cache=pathlib.Path(binding['applicationSource']['path']);real=cache.with_suffix('.saved');cache.rename(real);cache.symlink_to(real,target_is_directory=True)
    else:
     checkout=pathlib.Path(self.checkout(root,binding,app))
     if fault=='checkout-link':
      real=checkout.with_name('saved');checkout.rename(real);checkout.symlink_to(real,target_is_directory=True)
     else:(checkout/'source.txt').write_text('retain-local-change')
    with self.assertRaises(ValueError):self.checkout(root,binding,app)
    if fault=='dirty':self.assertEqual((checkout/'source.txt').read_text(),'retain-local-change')
 def test_independent_tool_repository_main_proof_does_not_relabel_candidate_cache(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp).resolve();binding,app,old,git=self.fixture(root)
   original=root/'original';(original/'next.txt').write_text('later-main');git(original,'add','.');git(original,'commit','-qm','later-main');main=git(original,'rev-parse','HEAD').decode().strip()
   tool=root/'tool';subprocess.check_output(['/usr/bin/git','clone','--no-local','--no-hardlinks',str(original),str(tool)],stderr=subprocess.DEVNULL)
   binding['toolRoot']=str(tool);binding['mainSource']={'repository':str(tool),'ref':'refs/remotes/origin/main','revision':main}
   with self.assertRaises(subprocess.CalledProcessError):git(binding['applicationSource']['path'],'cat-file','-e',main+'^{commit}')
   checkout=self.checkout(root,binding,app);self.assertEqual(git(checkout,'rev-parse','HEAD').decode().strip(),app)
   self.assertEqual(git(binding['applicationSource']['path'],'rev-parse','refs/heads/main').decode().strip(),app)
   binding['mainSource']['repository']=str(original)
   with self.assertRaises(ValueError):self.checkout(root,binding,app)
 def test_shell_build_only_routes_through_original_binding_without_shared_mutation(self):
  shell=(D/'build-cn-release-candidate.sh').read_text();publisher=(D/'publish-cn-release.sh').read_text()
  self.assertIn('--build-checkout "$tool_binding"',shell);self.assertIn('--verify-build-checkout "$tool_binding"',publisher)
  self.assertNotIn('exec 9>"',shell);self.assertIn('exec 9<>',shell)
  block=shell[shell.index('if [[ "$build_only" == 0 ]]; then\ngit -C'):shell.index('# Candidate config')]
  self.assertIn('reset --quiet --hard',block);self.assertIn('clean -ffd',block)
  self.assertNotIn('fetch --no-tags "$source_cache"',shell)

class ShellCheckoutAuthorityRouting(unittest.TestCase):
 def test_actual_shell_authority_statements_route_same_binding_and_reject_failure(self):
  # Execute each actual shell authority command. The test-only dispatcher is the
  # already verified checkout reader, not an arbitrary environment path in product.
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp).resolve();case=IndependentBuildCheckout();binding,app,old,git=case.fixture(root)
   checkout=case.checkout(root,binding,app)
   for name,mode in [('build-cn-release-candidate.sh','--build-checkout'),('publish-cn-release.sh','--verify-build-checkout'),('collect-cn-release-preflight.sh','--verify-build-checkout'),('verify-cn-release-preflight.sh','--verify-build-checkout')]:
    with self.subTest(name=name):
     lines=(D/name).read_text().splitlines();line=next(x.strip() for x in lines if 'REPOSITORY_DIR=$(python3' in x and mode in x)
     binding_var='CN_BUILD_TOOL_BINDING' if 'preflight' in name else 'tool_binding'
     for reject in (False,True):
      prelude='set -euo pipefail\nrevision='+app+'\nrelease=2026.10.6-cn.1\nattempt_id=attempt-1\n'+binding_var+'=/protected/binding\n'
      dispatcher='python3(){ [[ "$1" == /usr/local/lib/workspacex-cn/cn-build-tool-identity.py && "$2" == '+mode+' && "$3" == /protected/binding && "$4" == '+app+' && "$5" == 2026.10.6-cn.1 && "$6" == attempt-1 && "$7" == prebuild ]] || return 2; '
      dispatcher+=('return 1; }\n' if reject else 'printf "%s\\n" "'+checkout+'"; }\n')
      script=prelude+dispatcher+'fail(){ return 1; }\n'+line+'\n[[ "$REPOSITORY_DIR" == "'+checkout+'" ]]\ngit -C "$REPOSITORY_DIR" diff --exit-code\n'
      result=subprocess.run(['/bin/bash','-c',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
      self.assertEqual(result.returncode==0,not reject,(name,result.stderr.decode()))
     self.assertEqual(git(root/'original','rev-parse','HEAD').decode().strip(),app)
 def test_artifact_preflight_reuses_checkout_and_never_truncates_lock(self):
  for name in ('collect-cn-release-preflight.sh','verify-cn-release-preflight.sh'):
   shell=(D/name).read_text()
   self.assertIn('if [[ "$phase" == artifact-build ]]; then\n  REPOSITORY_DIR=$(python3',shell)
   self.assertNotIn('exec 8>"',shell);self.assertIn('exec 8<>"',shell)

if __name__=='__main__':unittest.main()
