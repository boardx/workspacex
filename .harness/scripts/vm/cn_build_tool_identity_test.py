import datetime,importlib.util,pathlib,unittest,copy,hashlib,sys,io
from unittest.mock import patch
D=pathlib.Path(__file__).parent
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
     if args[2]==v['applicationSource']['path']:
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
    with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'private_read',side_effect=read),patch.object(m.subprocess,'check_output',side_effect=git),patch.object(m.subprocess,'run',return_value=type('Result',(),{'returncode':1,'stdout':b''})()),patch.object(m.pathlib.Path,'lstat',return_value=type('Stat',(),{'st_mode':0o40700,'st_uid':0})()),patch.object(m.pathlib.Path,'exists',return_value=False),patch.object(m.pathlib.Path,'glob',return_value=[]),patch.object(sys,'argv',['tool','/manifest',APP,'2026.10.3-cn.1','fixture','prebuild']),patch('sys.stdout',new_callable=io.StringIO):
     if drift=='none':m.main()
     else:
      with self.assertRaises(ValueError):m.main()
 def receipt_fixture(self):
  import json
  binding=self.fixture();manifest={'sourceRevision':APP,'release':binding['release'],'images':{k:{'image':'registry.example/wsx/'+k+'@sha256:'+'b'*64} for k in ('web','api','agent','sandbox','postgres','redis')}}
  raw=json.dumps(manifest).encode();seal={'schemaVersion':1,'status':'sealed','sourceRevision':APP,'manifestSha256':hashlib.sha256(raw).hexdigest()}
  prebuild={'phase':'prebuild','sourceSha':APP,'release':binding['release'],'attemptId':binding['attemptId'],'issuedAt':(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=1)).isoformat(),'expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=10)).isoformat(),'checks':{'bootstrap.compatibility':{'status':'passed','metadata':{'evidenceMode':'source-static','readOnlyTransaction':False,'stateClass':'unknown','schemaContract':False,'permissionContract':False,'agentSeedContract':False}}}}
  return binding,manifest,seal,prebuild
 def test_sealed_receipt_actual_hashes_and_no_ready(self):
  import json
  binding,manifest,seal,prebuild=self.receipt_fixture();raw=[json.dumps(x).encode() for x in (manifest,seal,prebuild)]
  seen=[]
  def inspect(image):seen.append(image);return 'Digest: sha256:'+'b'*64+'\n'
  value=m.sealed_receipt(binding,*raw,inspect)
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
    with self.assertRaises(ValueError):m.sealed_receipt(binding,*[json.dumps(x).encode() for x in (manifest,seal,prebuild)],lambda _: 'Digest: sha256:'+('0' if bad=='registry' else 'b')*64+'\n')
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
