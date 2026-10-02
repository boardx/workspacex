import copy,importlib.util,json,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('factory',str(Path(__file__).with_name('isolated_canonical_plan_factory.py')));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
class CanonicalPlans(unittest.TestCase):
 def setUp(self):
  self.ex=json.loads((Path(__file__).parent/'fixtures'/'isolated-canonical-historical'/'actual-python-extractor.json').read_text());self.runtime=json.loads((Path(__file__).parent/'fixtures'/'isolated-canonical-historical'/'python-runtime-inventory-actual.json').read_text());self.source={'sourceSha':self.ex['candidateSha'],'filesSha256':{'apps/deep-agent-service/uv.lock':self.ex['candidateUvLockSha256']},'expectedPackageVersions':self.ex['packageVersions']}
 def run_factory(self):return f.derive(self.source,self.ex,self.runtime,'a'*64,'b'*64,'c'*64,'sha256:'+'d'*64)
 def test_historical_actual_extractor_tables(self):
  p=self.run_factory();self.assertEqual([t['table'] for t in p['workspacex_agent']['expectedCreatedTables']],['checkpoint_blobs','checkpoint_migrations','checkpoint_writes','checkpoints']);self.assertEqual([t['table'] for t in p['workspacex_memory']['expectedCreatedTables']],['store','store_migrations'])
 def test_sha_relabel_rejected(self):
  self.source['sourceSha']='0'*40
  with self.assertRaises(AssertionError):self.run_factory()
 def test_sql_mutated_rejected(self):
  self.ex['memory']['migrations'][0]['sql']+=' drift'
  with self.assertRaises(AssertionError):self.run_factory()
 def test_dependency_drift_rejected(self):
  self.runtime['distributions'][0]['normalizedName']='psycopg';self.runtime['distributions'][0]['version']='0.0'
  self.runtime['distributions']=[d for i,d in enumerate(self.runtime['distributions']) if i==0 or d['normalizedName']!='psycopg']
  with self.assertRaises(AssertionError):self.run_factory()
if __name__=='__main__':unittest.main()
