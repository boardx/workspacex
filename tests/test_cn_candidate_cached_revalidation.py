"""Real ZIP/tar cached verification, with authenticated metadata stand-in."""
import copy,io,os
from pathlib import Path
import sys,tempfile,time,unittest
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_cn_candidate_revalidation as fixture
from test_cn_candidate_revalidation import a,g,rv

class CachedTests(unittest.TestCase):
 def setUp(self):
  fixture.RevalidationTests.setUp(self)
  # Protected-path checks also apply to fixtures: do not use world-writable /tmp.
  self.safe=tempfile.TemporaryDirectory(prefix='.cache-test-',dir=Path(__file__).resolve().parents[1]);self.addCleanup(self.safe.cleanup)
  self.cache=Path(self.safe.name)
  self.provider.deadline=time.monotonic()+60
  records={}
  for name,ident in self.policy['artifactIds'].items():
   path=self.cache/(name+'.zip');raw=self.provider.blobs[ident];path.write_bytes(raw);path.chmod(0o600)
   records[name]=dict(artifactId=ident,path=str(path),zipBytes=len(raw),zipSha256=a.sha(raw))
  self.manifest=dict(kind=g.CACHE_KIND,schemaVersion=1,**{k:self.policy[k] for k in ('repositoryId','runId','runAttempt','controlRevision','candidatePlanRawSha256','candidateSetRawSha256')},artifacts=records,productionReady=False)
 def cached(self):
  work=self.cache/'verified';work.mkdir();raw=a.json_bytes(self.manifest);manifest=g.validate_cache_manifest(raw,a.sha(raw),self.policy)
  policy_raw=a.json_bytes(self.policy)
  return g.produce_cached(self.policy,a.sha(policy_raw),self.provider,work,policy_raw,manifest,a.sha(raw))
 def test_cached_full_real_bytes_no_network_zip(self):
  raw=self.cached();p=a.decode(raw)
  self.assertEqual(p['originalExpiresAt'],self.receipt['expiresAt'])
  self.assertEqual(p['kind'],'candidate-revalidation-v1')
  self.assertFalse(any(x.endswith('/zip') for x in self.provider.calls))
  self.assertEqual(len(self.provider.calls),18)
  cap=rv.admit(raw,a.sha(raw),a.sha(a.json_bytes(self.policy)),a.json_bytes(self.policy));self.assertEqual(cap.sha,a.sha(raw))
  self.assertFalse(a.decode((self.cache/'verified/cache-verification-observation.json').read_bytes())['freshDownloadClaimed'])
 def test_cache_corrupt_without_refetch(self):
  path=Path(self.manifest['artifacts']['api']['path']);raw=path.read_bytes();path.write_bytes(b'X'+raw[1:])
  with self.assertRaises(a.Rejected):self.cached()
  self.assertFalse(any(x.endswith('/zip') for x in self.provider.calls))
 def test_cache_valid_sha_but_provider_disagrees(self):
  self.manifest['artifacts']['api']['zipSha256']='0'*64
  with self.assertRaises(a.Rejected):self.cached()
 def test_cache_not_authority_missing_artifact(self):
  del self.manifest['artifacts']['api']
  with self.assertRaises(a.Rejected):self.cached()
 def test_cache_exact_integer_ids_and_sizes(self):
  self.manifest['artifacts']['api']['zipBytes']=float(self.manifest['artifacts']['api']['zipBytes'])
  with self.assertRaises(a.Rejected):self.cached()
 def test_cache_sha_independently_bound(self):
  with self.assertRaises(a.Rejected):g.validate_cache_manifest(a.json_bytes(self.manifest),'0'*64,self.policy)
 def test_cache_symlink(self):
  path=Path(self.manifest['artifacts']['api']['path']);other=path.with_suffix('.other');path.rename(other);path.symlink_to(other)
  with self.assertRaises(OSError):self.cached()
 def test_cache_after_metadata_drift(self):
  original=self.provider.json;count=0
  def changing(path):
   nonlocal count
   count+=1;value=original(path)
   if count==10:value['conclusion']='failure'
   return value
  self.provider.json=changing
  with self.assertRaisesRegex(a.Rejected,'CACHE_PROVIDER_CHANGED'):self.cached()
 def test_cache_unmapped_endpoint_cannot_fallback(self):
  adapter=g.CachedGithub(self.provider,self.manifest)
  with self.assertRaises(a.Rejected):adapter.fetch('/repos/boardx/workspacex/actions/artifacts/999/zip',io.BytesIO(),100)
  self.assertEqual(self.provider.calls,[])
 def test_valid_provider_zip_digest_does_not_bypass_tar_validation(self):
  self.files['web']['web.tar']+=b'tampered'
  provider=fixture.Provider(self.policy,self.files);provider.deadline=self.provider.deadline;self.provider=provider
  ident=self.policy['artifactIds']['web'];raw=provider.blobs[ident];record=self.manifest['artifacts']['web']
  Path(record['path']).write_bytes(raw);record.update(zipBytes=len(raw),zipSha256=a.sha(raw))
  with self.assertRaises(a.Rejected):self.cached()
 def test_fd_snapshot_change_rejected(self):
  record=self.manifest['artifacts']['api'];path=Path(record['path'])
  class MutatingTarget:
   def write(inner,data):
    with path.open('ab') as out:out.write(b'changed')
  with self.assertRaises(a.Rejected):g.copy_cache_zip(record,MutatingTarget(),record['zipBytes'],time.monotonic()+5)
if __name__=='__main__':unittest.main()
