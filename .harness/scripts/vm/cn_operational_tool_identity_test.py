import importlib.util,pathlib,unittest,json,hashlib,subprocess
D=pathlib.Path(__file__).parent
sp=importlib.util.spec_from_file_location('tool',D/'cn-build-tool-identity.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
APP='9'*40;TOOL='a'*40;BASE='b'*40
class Operational(unittest.TestCase):
 def fixture(self):
  manifest={'sourceRevision':APP,'release':'2026.10.3-cn.1'};raw=json.dumps(manifest).encode();seal={'schemaVersion':1,'status':'sealed','sourceRevision':APP,'manifestSha256':hashlib.sha256(raw).hexdigest()};prior={'schemaVersion':2,'phase':'prebuild','sourceSha':APP,'baselineSha':BASE,'release':'2026.10.3-cn.1','attemptId':'fixture'}
  raws=[raw,json.dumps(seal).encode(),json.dumps(prior).encode()]
  value={'schemaVersion':1,'mode':'operational-preactivate','applicationRevision':APP,'toolRevision':TOOL,'toolRoot':'/opt/workspacex-cn/release-tools/'+TOOL,'release':'2026.10.3-cn.1','attemptId':'fixture','filesSha256':{k:'c'*64 for k in m.FILES},'applicationSource':{'path':'/var/lib/workspacex-cn/build-sources/'+APP+'.git','ref':'refs/heads/candidate','treeSha':'d'*40,'inventorySha256':'e'*64},'baselineRevision':BASE}
  for key,b in zip(('manifestSha256','sealSha256','prebuildSha256'),raws):value[key]=hashlib.sha256(b).hexdigest()
  return value,raws
 def test_dynamic_tool_app_pair_and_lineage(self):
  v,raws=self.fixture();self.assertEqual(m.validate_operational_identity(v,APP,v['release'],'fixture','preactivate'),v['toolRoot']);m.verify_operational_lineage(v,*raws)
 def test_modes_and_phases_do_not_cross_authorization(self):
  for mode,phase in [('build-only','preactivate'),('operational-preactivate','prebuild'),('operational-preactivate','activate'),('operational-preactivate','prepare'),('operational-preactivate','migrate')]:
   v,_=self.fixture();v['mode']=mode
   with self.subTest(mode=mode,phase=phase),self.assertRaises(ValueError):m.validate_operational_identity(v,APP,v['release'],'fixture',phase)
  v,_=self.fixture()
  with self.assertRaises(ValueError):m.validate_identity(v,APP,v['release'],'fixture','preactivate')
 def test_exact_lineage_drift_rejected(self):
  for field in ('baselineRevision','sealSha256','manifestSha256','prebuildSha256','applicationRevision','attemptId'):
   v,raws=self.fixture();v[field]='f'*len(v[field])
   with self.subTest(field=field),self.assertRaises(ValueError):m.verify_operational_lineage(v,*raws)
 def test_static_or_wrong_prior_cannot_be_dynamic_admission(self):
  for key,bad in [('phase','preactivate'),('sourceSha',TOOL),('baselineSha','f'*40),('attemptId','other'),('schemaVersion',1)]:
   v,raws=self.fixture();prior=json.loads(raws[2]);prior[key]=bad;raws[2]=json.dumps(prior).encode();v['prebuildSha256']=hashlib.sha256(raws[2]).hexdigest()
   with self.subTest(key=key),self.assertRaises(ValueError):m.verify_operational_lineage(v,*raws)
 def test_real_deploy_cli_dispatch_legacy_and_explicit_operational(self):
  source=(D/'deploy-cn-production.sh').read_text();prefix=source[:source.index('[[ ${EUID}')]
  command=next(line for line in source.splitlines() if line.startswith('"$PREFLIGHT_VERIFIER" ${preflight_flags[@]+"${preflight_flags[@]}"} preactivate'))
  command=command.replace(' \\','').replace(' >/dev/null','')
  import tempfile
  for flags,expected in [([],[]),(['--prepare'],[]),(['--operational'],['--operational']),(['--operational','--prepare'],['--operational'])]:
   with self.subTest(flags=flags),tempfile.TemporaryDirectory(dir=pathlib.Path(tempfile.gettempdir()).resolve()) as temp:
    verifier=pathlib.Path(temp)/'verifier';verifier.write_text('#!/bin/bash\nprintf "%s\\n" "$@"\n');verifier.chmod(0o700)
    script=prefix+'\nPREFLIGHT_VERIFIER='+str(verifier)+'\nrevision='+APP+'; attempt_id=fixture; manifest=unused\nnode(){ echo 2026.10.3-cn.1; }\n'+command+'\n'
    r=subprocess.run(['bash','-c',script,'fixture',*flags,APP,'fixture'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    self.assertEqual(r.returncode,0,r.stderr.decode());self.assertEqual(r.stdout.decode().splitlines(),expected+['preactivate',APP,'2026.10.3-cn.1','fixture'])
  r=subprocess.run(['bash','-c',prefix,'fixture','--unknown',APP,'fixture'],stdout=subprocess.PIPE,stderr=subprocess.PIPE);self.assertEqual(r.returncode,2)
 def test_actual_dynamic_probe_block_unchanged(self):
  # New verification baseline: exact locally recovered merged collector, not missing historical e75.
  raw=(D/'fixtures/collect-cn-release-preflight.merge64cc.sh').read_bytes()
  self.assertEqual(hashlib.sha256(raw).hexdigest(),'c9bc6dcf2947aee7eae3a43f0cbb8446ab58302a7ac1d4bd57e94b645f26efb8')
  old=raw.decode();new=(D/'collect-cn-release-preflight.sh').read_text()
  start='bootstrap_out="$work/bootstrap.out"';end='output_dir="$INPUT_ROOT/$revision/$attempt_id"'
  self.assertEqual(old[old.index(start):old.index(end)],new[new.index(start):new.index(end)])
  self.assertIn('elif [[ -n ${CN_BUILD_TOOL_BINDING:-} ]]; then',new)
  verify=(D/'verify-cn-release-preflight.sh').read_text();self.assertIn('"$phase" == preactivate && -z ${CN_BUILD_TOOL_BINDING:-}',verify)
if __name__=='__main__':unittest.main()
