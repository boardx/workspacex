"""Offline actual consumer branches and real OS termination; never Docker/SQL calls."""
import hashlib,json,os,signal,subprocess,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import isolated_conservation_stage as stage
import isolated_conservation_supervisor as supervisor
import isolated_conservation_supervisor_cleanup_test as cleanup_fixture
import isolated_conservation_evidence_producer_test as producer_fixture
REAL_TEMP=tempfile.TemporaryDirectory
sha=lambda raw:hashlib.sha256(raw).hexdigest()

class ActualConsumers(unittest.TestCase):
 def test_canonical_run_stage_actual_engine_supervisor_accepts_null_node_request(self):
  code=b'canonical-engine-offline-fixture';binding={'accountId':'offline-account','regionId':'offline-region','candidateSha':'a'*40,'targetInstanceId':'pgm-offline','attemptId':'offline-attempt','providerCreatedUtc':'2026-10-02T00:00:00Z','peer':'10.0.0.2','peerSha256':'b'*64,'host':'offline'}
  tls={'sslmode':'disable','approvedException':'aliyun-postgresql-serverless-no-tls','providerSslEvidence':{'targetInstanceId':binding['targetInstanceId'],'providerCreatedUtc':binding['providerCreatedUtc'],'sslEnabled':False}}
  binding.update(tls=tls,frozenManifestPath='/frozen',frozenManifestSha256='c'*64,stageManifestPath='/stages',stageManifestSha256='d'*64)
  secret={**binding,'port':5432,'user':'migration_admin','password':'offline-fixture-secret'}
  secret['roles']={name:{**secret,'user':name} for name in ['app_diag_ro','app_rw','graph_owner','memory_owner','memory_rw','migration_owner']}
  exact='apps/deep-agent-service/fixture.py';raw={exact:b'exact-source', 'canonical-extractor.json':b'{}','python-runtime-manifest.json':b'{}'}
  raw['canonical-source-manifest.json']=json.dumps({'sourceSha':binding['candidateSha'],'filesSha256':{exact:sha(raw[exact])}}).encode()
  entry={'candidateSha':binding['candidateSha'],'actualSqlPeerChecks':True,'language':'python','path':'/engine','sha256':sha(code),'timeoutSeconds':10,'immutableRuntimeId':'sha256:'+'e'*64,'runtimeSourceSha':'f'*40,'supervisor':{'path':'/supervisor','sha256':'0'*64},'canonicalMigrationExtractorInvokeId':'offline','resources':{'exact':{exact:{'path':exact,'sha256':sha(raw[exact])}},'probe':{name:{'path':name,'sha256':sha(raw[name])} for name in ['canonical-source-manifest.json','canonical-extractor.json','python-runtime-manifest.json']}}}
  manifest={'attemptId':binding['attemptId'],'targetInstanceId':binding['targetInstanceId'],'conservationPlan':{},'sourceSqlInventory':{'path':'/inventory','sha256':'1'*64},'stages':{'canonical-setup':entry}}
  store={'/frozen':json.dumps({'candidateSha':binding['candidateSha'],'frozen':True}).encode(),'/stages':json.dumps(manifest).encode(),'/inventory':json.dumps({'sourceSha':binding['candidateSha']}).encode()}
  proof={**{k:binding[k] for k in ['candidateSha','targetInstanceId','attemptId']},'allCanonicalSetupsAccepted':True,'connectionPeerIdentityChecks':4,'memoryPreparedTwice':True,'checkpointSetupTwice':True,'force':False,'seed':False}
  owner=None;removed=[];consumed=[]
  def capture(args,timeout=15,check=True):
   nonlocal owner
   if args[:2]==['image','inspect']:value=[{'Id':entry['immutableRuntimeId'],'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':entry['runtimeSourceSha']},'Env':[]}}]
   elif args[:2]==['network','create']:owner=args[-1];return subprocess.CompletedProcess(args,0,b'net',b'')
   elif args[:2]==['network','inspect']:value=[{'Id':'net','Labels':{'wsx.rehearsal.owner':owner},'Containers':{}}]
   elif args[0]=='inspect':value=[{'Id':'owned','Config':{'Labels':{'wsx.rehearsal.owner':owner}}}]
   elif args[0]=='rm' or args[:2]==['network','rm']:removed.append(args[0]);return subprocess.CompletedProcess(args,0,b'',b'')
   elif args[:2] in [['ps','-aq'],['network','ls']]:return subprocess.CompletedProcess(args,0,b'',b'')
   else:raise AssertionError(args)
   return subprocess.CompletedProcess(args,0,json.dumps(value).encode(),b'')
  class Process:
   returncode=0
   def communicate(self,payload,**kw):consumed.append(json.loads(payload));return json.dumps(proof).encode(),b''
   def poll(self):return 0
  def start(args,**kw):self.assertEqual(args[args.index('--entrypoint')+1],'python');return Process()
  def engine(e,p):return stage.actual_engine(e,p,executor=lambda argv,actual,timeout: supervisor.main(actual))
  with patch.object(stage,'verify_binding',lambda b,s:Path('/offline')),patch.object(stage,'validate_plan',lambda p,b:p),patch.object(stage,'verify_final_sql_inventory',lambda p,i:None),patch.object(stage,'private_bytes',lambda path,digest:code if path=='/engine' else b'verified-supervisor-fixture'),patch.object(stage,'write_proof',lambda *a:{'path':'/offline/proof','sha256':'2'*64}),patch.object(supervisor,'verified',lambda ref:raw[ref['path']]),patch.object(supervisor,'capture',capture),patch.object(supervisor.os,'geteuid',lambda:0),patch.object(supervisor.subprocess,'Popen',start),patch.object(supervisor.tempfile,'TemporaryDirectory',lambda **kw:REAL_TEMP(dir=Path('/tmp').resolve())):
   result=stage.run_stage({'binding':binding,'secret':secret,'operation':'canonical-setup','providerObservation':binding},reader=lambda path,digest:store[path],invoke=engine)
  self.assertTrue(result['accepted']);self.assertEqual(removed,['rm','network']);self.assertNotIn('request',consumed[0]);self.assertEqual(consumed[0]['memoryOwner']['user'],'memory_owner')

class Termination(unittest.TestCase):
 def command(self,kind,path):return [sys.executable,str(Path(__file__).resolve()),'signal-fixture',kind,str(path)]
 def test_real_sigterm_supervisor_runs_owned_container_and_network_cleanup(self):self.exercise('supervisor')
 def test_real_sigterm_evidence_producer_runs_owned_container_cleanup(self):self.exercise('producer')
 def test_real_stage_termination_stops_its_independent_supervisor_group(self):self.exercise('stage')
 def test_real_signal_after_network_create_before_id_assignment_reconciles_owned_network(self):self.exercise('network-create')
 def exercise(self,kind):
  with REAL_TEMP() as directory:
   log=Path(directory)/'events';p=subprocess.Popen(self.command(kind,log),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   try:
    end=time.monotonic()+10
    while (not log.exists() or 'ready' not in log.read_text()) and time.monotonic()<end:time.sleep(.02)
    self.assertTrue(log.exists() and 'ready' in log.read_text());p.send_signal(signal.SIGTERM);self.assertNotEqual(p.wait(timeout=10),0)
    self.assertIn('removed',log.read_text());self.assertIn('network' if kind in ['supervisor','stage','network-create'] else 'owned',log.read_text())
   finally:
    if p.poll() is None:p.kill();p.wait()
 def test_actual_bounded_timeout_enters_supervisor_cleanup(self):
  with REAL_TEMP() as directory:
   log=Path(directory)/'events'
   original_start=subprocess.Popen
   def start_ready(*args,**kwargs):
    process=original_start(*args,**kwargs);end=time.monotonic()+10
    while (not log.exists() or 'ready' not in log.read_text()) and time.monotonic()<end:time.sleep(.02)
    if not log.exists() or 'ready' not in log.read_text():process.kill();process.wait();raise AssertionError('fixture startup did not acknowledge readiness')
    return process
   with patch.object(stage.subprocess,'Popen',start_ready):
    with self.assertRaisesRegex(ValueError,'ENGINE_TIMEOUT'):stage.bounded(self.command('supervisor',log),{},.2)
   self.assertIn('removed container',log.read_text());self.assertIn('removed network',log.read_text())

def signal_fixture(kind,path):
 supervisor.install_termination_handler()
 def record(text):
  with open(path,'a') as f:f.write(text+'\n');f.flush()
 def wait():record('ready');time.sleep(60)
 try:
  if kind=='stage':stage.bounded([sys.executable,str(Path(__file__).resolve()),'signal-fixture','supervisor',str(path)],{},60)
  elif kind=='network-create':cleanup_fixture.Cleanup().exercise(on_network_created=wait,on_removed=lambda name:record('removed '+name))
  elif kind=='supervisor':cleanup_fixture.Cleanup().exercise(on_communicate=wait,on_removed=lambda name:record('removed '+name))
  else:producer_fixture.ProducerTests().exercise(on_communicate=wait,on_removed=lambda name:record('removed '+name))
 except supervisor.OwnedTermination:sys.exit(1)
 raise AssertionError('fixture work must not finish before termination')
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='signal-fixture':signal_fixture(sys.argv[2],sys.argv[3])
 else:unittest.main()
