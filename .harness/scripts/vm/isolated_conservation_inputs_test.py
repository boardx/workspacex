"""Portable small actual-factory fixtures, not a SQL acceptance receipt."""
import copy,hashlib,importlib.util,json,sys,unittest
from pathlib import Path
factory_path=Path(__file__).with_name('isolated_canonical_plan_factory.py')
spec=importlib.util.spec_from_file_location('isolated_canonical_plan_factory',factory_path);factory=importlib.util.module_from_spec(spec);spec.loader.exec_module(factory);sys.modules['isolated_canonical_plan_factory']=factory
from isolated_conservation_inputs import EXPECTED_SOURCE_PATHS,validate_canonical_inputs
sha=lambda raw:hashlib.sha256(raw).hexdigest()
rawjson=lambda x:json.dumps(x,separators=(',',':'),ensure_ascii=False).encode()
class CanonicalInputs(unittest.TestCase):
 def fixture(self):
  store={};counter=0
  def ref(raw):
   nonlocal counter
   if not isinstance(raw,bytes):raw=rawjson(raw)
   path='/fixture/'+str(counter);counter+=1;store[path]=raw;return {'path':path,'sha256':sha(raw)}
  candidate='a'*40;versions={'langgraph':'1.2.11','langgraph-checkpoint-postgres':'3.1.2','psycopg':'3.3.4'}
  exact={name:ref(('exact-source-'+name).encode()) for name in sorted(EXPECTED_SOURCE_PATHS)};source={'schemaVersion':1,'sourceSha':candidate,'sourceQueriesAttempted':0,'networkConnectionsAttempted':0,'filesSha256':{name:r['sha256'] for name,r in exact.items()},'expectedPackageVersions':versions}
  extractor={'schemaVersion':1,'candidateSha':candidate,'candidateUvLockSha256':source['filesSha256']['apps/deep-agent-service/uv.lock'],'packageVersions':versions,'sourceQueriesAttempted':0,'networkConnectionsAttempted':0}
  for key,table,history in [('checkpoint','checkpoints','checkpoint_migrations'),('memory','store','store_migrations')]:
   sql='CREATE TABLE IF NOT EXISTS '+table+' (id text PRIMARY KEY)';extractor[key]={'migrations':[{'version':0,'sql':sql,'sqlSha256':sha(sql.encode())}],'migrationCount':1,'expectedHistoryVersions':[0],'historyTable':history,'orderedMigrationListSha256':sha(rawjson([sql])),'setupSourceSha256':'b'*64}
  distributions=[{'name':n,'normalizedName':n,'version':v} for n,v in sorted(versions.items())];runtime={**{k:extractor[k] for k in ['schemaVersion','candidateSha','candidateUvLockSha256','packageVersions','sourceQueriesAttempted','networkConnectionsAttempted']},'distributionCount':len(distributions),'distributions':distributions,'distributionsCanonicalSha256':sha(json.dumps(distributions,sort_keys=True,separators=(',',':')).encode())}
  probes={name:ref(value) for name,value in [('canonical-source-manifest.json',source),('canonical-extractor.json',extractor),('python-runtime-manifest.json',runtime)]};image='sha256:'+'c'*64
  expected=factory.derive(source,extractor,runtime,probes['canonical-source-manifest.json']['sha256'],probes['canonical-extractor.json']['sha256'],probes['python-runtime-manifest.json']['sha256'],image)
  planrefs={db:ref(value) for db,value in expected.items()};files={n:source['filesSha256']['apps/deep-agent-service/src/deep_agent_service/'+n] for n in ('memory_deployment.py','postgres_checkpointer.py','self_hosted_runtime.py')};files['pyproject.toml']=source['filesSha256']['apps/deep-agent-service/pyproject.toml']
  manifest={'conservationPlan':{'canonicalSourceSha':candidate,'canonicalSourceFiles':files,'canonicalSchemaPlanHashes':{db:r['sha256'] for db,r in planrefs.items()}},'stages':{'canonical-setup':{'immutableRuntimeId':image,'runtimeSourceSha':'d'*40,'resources':{'exact':exact,'probe':probes}},**{stage:{db:{'canonicalPlan':r} for db,r in planrefs.items()} for stage in ('before','after')}}}
  return manifest,{'candidateSha':candidate},store,ref
 def test_actual_factory_positive(self):
  m,b,s,_=self.fixture();r=validate_canonical_inputs(m,b,lambda r:s[r['path']]);self.assertTrue(r['inputSemanticsVerified']);self.assertFalse(r['prepared'])
 def mutate_probe(self,name,mutate):
  m,b,s,ref=self.fixture();probes=m['stages']['canonical-setup']['resources']['probe'];value=json.loads(s[probes[name]['path']]);mutate(value);probes[name]=ref(value)
  with self.assertRaises(ValueError):validate_canonical_inputs(m,b,lambda r:s[r['path']])
 def test_source_sha_relabel(self):self.mutate_probe('canonical-source-manifest.json',lambda x:x.update(sourceSha='e'*40))
 def test_source_network_attempt(self):self.mutate_probe('canonical-source-manifest.json',lambda x:x.update(networkConnectionsAttempted=1))
 def test_extractor_sql_drift(self):self.mutate_probe('canonical-extractor.json',lambda x:x['memory']['migrations'][0].update(sql='CREATE TABLE forged (id text)'))
 def test_runtime_sha_relabel(self):self.mutate_probe('python-runtime-manifest.json',lambda x:x.update(candidateSha='e'*40))
 def test_runtime_package_drift(self):self.mutate_probe('python-runtime-manifest.json',lambda x:x['packageVersions'].update(psycopg='0.0'))
 def test_runtime_distribution_hash(self):self.mutate_probe('python-runtime-manifest.json',lambda x:x.update(distributionsCanonicalSha256='0'*64))
 def test_false_counter_not_zero(self):self.mutate_probe('canonical-extractor.json',lambda x:x.update(sourceQueriesAttempted=False))
 def test_exact_source_bytes_drift(self):
  m,b,s,_=self.fixture();r=next(iter(m['stages']['canonical-setup']['resources']['exact'].values()));s[r['path']]=b'drift'
  with self.assertRaises(ValueError):validate_canonical_inputs(m,b,lambda r:s[r['path']])
 def test_plan_ledger_extra_version(self):
  m,b,s,ref=self.fixture();r=m['stages']['before']['workspacex_agent']['canonicalPlan'];value=json.loads(s[r['path']]);value['ledgers'][0]['expectedVersions'].append('9');m['stages']['before']['workspacex_agent']['canonicalPlan']=ref(value)
  with self.assertRaises(ValueError):validate_canonical_inputs(m,b,lambda r:s[r['path']])
 def test_plan_arbitrary_new_table(self):
  m,b,s,ref=self.fixture();r=m['stages']['after']['workspacex_memory']['canonicalPlan'];value=json.loads(s[r['path']]);value['expectedCreatedTables'].append({'schema':'public','table':'forged','mustBeEmpty':True});m['stages']['after']['workspacex_memory']['canonicalPlan']=ref(value)
  with self.assertRaises(ValueError):validate_canonical_inputs(m,b,lambda r:s[r['path']])
 def test_reformatted_plan_not_runtime_hash(self):
  m,b,s,ref=self.fixture();r=m['stages']['before']['workspacex_memory']['canonicalPlan'];value=json.loads(s[r['path']]);m['stages']['before']['workspacex_memory']['canonicalPlan']=ref(json.dumps(value,indent=2).encode())
  with self.assertRaises(ValueError):validate_canonical_inputs(m,b,lambda r:s[r['path']])
if __name__=='__main__':unittest.main()
