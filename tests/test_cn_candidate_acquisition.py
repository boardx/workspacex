"""Acquisition is non-authorizing and never refetches explicitly adopted ZIPs."""
import base64,copy,json,os
from pathlib import Path
import sys,time,unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_cn_candidate_cached_revalidation as fixture
from test_cn_candidate_revalidation import a,g,rv

class AcquisitionTests(unittest.TestCase):
 def setUp(self):
  fixture.CachedTests.setUp(self)
  self.request=dict(kind='candidate-byte-acquisition-request-v1',schemaVersion=1,acquisitionId='acquire-test',
   selection={k:self.policy[k] for k in g.SELECTION_FIELDS},artifacts={k:{x:v[x] for x in ('zipBytes','zipSha256')} for k,v in self.manifest['artifacts'].items()},
   reusePaths={'api':self.manifest['artifacts']['api']['path']},verifierRevision='d'*40,verifierFiles={n:a.sha((Path(g.__file__).parent/n).read_bytes()) for n in rv.FILES},
   ghExecutable='/fixture',ghSha256='f'*64,maxSeconds=60,workers=4,networkAcquisitionAuthorized=True,previousDownloadStopped=True)
 def test_reuse_calls_no_zip_endpoint(self):
  work=self.cache/'work';work.mkdir();r=g.acquire_one(self.request,self.provider,'api',work)
  self.assertEqual(r['zipSha256'],self.manifest['artifacts']['api']['zipSha256'])
  self.assertFalse(any(p.endswith('/zip') for p in self.provider.calls))
 def test_new_artifact_single_get(self):
  work=self.cache/'work';work.mkdir();g.acquire_one(self.request,self.provider,'web',work)
  self.assertEqual(len([p for p in self.provider.calls if p.endswith('/zip')]),1)
 def test_corrupt_reuse_never_falls_back(self):
  Path(self.request['reusePaths']['api']).write_bytes(b'bad');work=self.cache/'work';work.mkdir()
  with self.assertRaises(a.Rejected):g.acquire_one(self.request,self.provider,'api',work)
  self.assertFalse(any(p.endswith('/zip') for p in self.provider.calls))
 def test_failed_get_no_retry_or_seal(self):
  count=0
  def fail(*args):
   nonlocal count
   count+=1;raise a.Rejected('FIXTURE_GET_FAIL')
  self.provider.fetch=fail;work=self.cache/'work';work.mkdir()
  with self.assertRaises(a.Rejected):g.acquire_one(self.request,self.provider,'web',work)
  self.assertEqual(count,1);self.assertFalse((work/'web.zip').exists())
 def test_schema_and_explicit_old_run_stop(self):
  for field,value in [('previousDownloadStopped',False),('networkAcquisitionAuthorized',False),('workers',5),('maxSeconds',14401)]:
   r=copy.deepcopy(self.request);r[field]=value
   with self.assertRaises(a.Rejected):g.validate_acquisition(r)
 def test_provider_metadata_changed_no_seal(self):
  old=self.provider.json;count=0
  def changed(path):
   nonlocal count
   count+=1;v=old(path)
   if count==2:v['extra']='changed'
   return v
  self.provider.json=changed;work=self.cache/'work';work.mkdir()
  with self.assertRaises(a.Rejected):g.acquire_one(self.request,self.provider,'web',work)
  self.assertFalse((work/'web.zip').exists())
 def test_real_isolated_cli_acquisition_then_cached_verification(self):
  import subprocess
  repo=Path(g.__file__).resolve().parents[1];catalog={}
  for path,v in [('/repos/'+g.REPO+'/actions/runs/456/attempts/1',self.provider.run),('/repos/'+g.REPO+'/contents/'+g.WORKFLOW+'?ref='+self.policy['controlRevision'],dict(encoding='base64',content=base64.b64encode(self.provider.content).decode()))]:catalog[path]=base64.b64encode(a.json_bytes(v)).decode()
  for ident,v in self.provider.metadata.items():
   catalog['/repos/'+g.REPO+'/actions/artifacts/'+str(ident)]=base64.b64encode(a.json_bytes(v)).decode()
   catalog['/repos/'+g.REPO+'/actions/artifacts/'+str(ident)+'/zip']=base64.b64encode(self.provider.blobs[ident]).decode()
  cat=self.cache/'catalog.json';cat.write_text(json.dumps(catalog));cat.chmod(0o600);log=self.cache/'calls'
  binary=self.cache/'fixture-gh';binary.write_text('#!'+sys.executable+'\nimport sys,json,base64\nwith open('+repr(str(log))+',"a") as f:f.write(sys.argv[-1]+"\\n")\ndata=json.load(open('+repr(str(cat))+'))\nsys.stdout.buffer.write(base64.b64decode(data[sys.argv[-1]]))\n');binary.chmod(0o700)
  self.request.update(ghExecutable=str(binary),ghSha256=a.sha(binary.read_bytes()))
  reqraw=a.json_bytes(self.request);req=self.cache/'request.json';req.write_bytes(reqraw);req.chmod(0o600)
  entry=repo/'scripts/revalidate-cn-image-candidates.py'
  result=subprocess.run([sys.executable,'-I','-S','-B',str(entry),'--acquire',str(req),a.sha(reqraw),str(self.cache)],capture_output=True,timeout=30)
  self.assertEqual(result.returncode,0,result.stderr.decode());self.assertIn(b'CN_CANDIDATE_BYTES_ACQUIRED=',result.stdout)
  manifest=self.cache/'acquire-test/acquisition-manifest.json';mraw=manifest.read_bytes()
  calls=log.read_text().splitlines();self.assertEqual(len([x for x in calls if x.endswith('/zip')]),6)
  api='/repos/'+g.REPO+'/actions/artifacts/'+str(self.policy['artifactIds']['api'])+'/zip';self.assertNotIn(api,calls)
  self.assertFalse((self.cache/'acquire-test/candidate-revalidation.json').exists())
  self.policy.update(ghExecutable=str(binary),ghSha256=a.sha(binary.read_bytes()),verifierFiles=self.request['verifierFiles'])
  policy=self.cache/'policy.json';praw=a.json_bytes(self.policy);policy.write_bytes(praw);policy.chmod(0o600)
  result=subprocess.run([sys.executable,'-I','-S','-B',str(entry),str(policy),a.sha(praw),str(self.cache),'--cached',str(manifest),a.sha(mraw)],capture_output=True,timeout=30)
  self.assertEqual(result.returncode,0,result.stderr.decode());self.assertIn(b'prefetched-untrusted-zip',result.stdout)
  self.assertEqual(len([x for x in log.read_text().splitlines() if x.endswith('/zip')]),6)
  proof=(self.cache/'verify-test/candidate-revalidation.json').read_bytes();cap=rv.admit(proof,a.sha(proof),a.sha(praw),praw)
  self.assertEqual(cap._value['originalExpiresAt'],self.receipt['expiresAt'])
  self.assertFalse(cap._value['productionReady'])
if __name__=='__main__':unittest.main()
