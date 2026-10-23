"""Real Docker PostgreSQL/CMS/restore/Redis exercise using synthetic data only.
Does not claim production backup, candidate business or browser acceptance.
"""
import hashlib,importlib.util,json,os,pathlib,shutil,subprocess,sys,tempfile,time,unittest,uuid
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('provider',pathlib.Path(__file__).with_name('cn_auto_prepare_provider.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class FingerprintTests(unittest.TestCase):
 def test_actual_process_cgroup_and_ancestors_bound_available_memory(self):
  files={'/proc/meminfo':'MemAvailable: 67108864 kB\n','/proc/self/cgroup':'0::/system.slice/runner.service\n','/sys/fs/cgroup/system.slice/runner.service/memory.max':str(8*1024**3),'/sys/fs/cgroup/system.slice/runner.service/memory.current':str(2*1024**3),'/sys/fs/cgroup/system.slice/memory.max':str(10*1024**3),'/sys/fs/cgroup/system.slice/memory.current':str(5*1024**3)}
  with patch.object(pathlib.Path,'read_text',lambda p:files[str(p)]),patch.object(pathlib.Path,'exists',lambda p:str(p) in files):self.assertEqual(m.available_memory(),5*1024**3)
 def test_capacity_refuses_low_memory_and_disk_before_work(self):
  from types import SimpleNamespace
  with patch.object(m,'available_memory',lambda:8*1024**3),patch.object(m.os,'statvfs',lambda p:SimpleNamespace(f_bavail=100*1024**3,f_frsize=1)):
   with self.assertRaisesRegex(m.NotReady,'MEMORY_HEADROOM_REQUIRED'):m.require_capacity('/unused',1)
  with patch.object(m,'available_memory',lambda:12*1024**3),patch.object(m.os,'statvfs',lambda p:SimpleNamespace(f_bavail=12*1024**3,f_frsize=1)):
   with self.assertRaisesRegex(m.NotReady,'DISK_HEADROOM_REQUIRED'):m.require_capacity('/unused',1024**3)
   m.require_capacity('/unused',1)
 def test_real_stream_aborts_before_output_when_disk_reserve_is_crossed(self):
  script="import os,types;os.statvfs=lambda p:types.SimpleNamespace(f_bavail=9*1024**3,f_frsize=1)\n"+m.STREAM_COUNTER
  result=subprocess.run([sys.executable,'-c',script,'/unused/count.json'],input=b'x'*1024*1024,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  self.assertNotEqual(result.returncode,0);self.assertEqual(result.stdout,b'');self.assertIn(b'DISK_RESERVE',result.stderr)
 def test_real_pipeline_children_are_joined_on_disk_exhaustion(self):
  from types import SimpleNamespace
  env={'sourceDatabase':'/unused','postgresImage':'sha256:'+'a'*64,'redisImage':'sha256:'+'b'*64,'recipientCertificate':'/unused','recipientKey':'/unused'}
  provider=m.Provider({'request':{'identity':{'sourceRevision':'a'*40,'attemptId':'test'}},'policy':{'environment':env}})
  with patch.object(m.os,'statvfs',lambda p:SimpleNamespace(f_bavail=9*1024**3,f_frsize=1)):
   with self.assertRaisesRegex(m.NotReady,'DISK_RESERVE_STREAM_ABORT'):provider.pipeline([[sys.executable,'-c','import time;time.sleep(10)']])
 def test_backup_source_matches_candidate_and_exact_snapshot_not_stale_policy(self):
  identity={'sourceRevision':'a'*40,'baselineSourceRevision':'b'*40,'attemptId':'gha-1-1'}
  environment={'profile':'production','databaseSecretRef':'file:/db','migrationSecretRef':'file:/migration','regionId':'region','rdsInstanceId':'rds','rdsTlsException':{'kind':'aliyun-postgresql-serverless-no-tls','allowedCidrs':['10.0.0.0/8']}}
  config_raw=json.dumps({'environment':environment}).encode();database={'host':'current.example','port':5432,'database':'workspacex','user':'app_rw'};db_raw=json.dumps(database).encode();migration={**database,'user':'existing_migration'}
  chash=m.sha(json.dumps({'deploymentSha256':m.sha(config_raw),'databaseSecretSha256':m.sha(db_raw)},separators=(',',':')).encode());endpoint=m.sha(b'current.example:5432')
  binding={'schemaVersion':3,**identity,'sourceEvidence':{'configuration':{**database,'regionId':'region','rdsInstanceId':'rds','sha256':chash,'endpointSha256':endpoint,'sslMode':'disable','rdsTlsException':environment['rdsTlsException']}},'source':{'configurationSha256':chash,'endpointSha256':endpoint,'sslMode':'disable','clientEncrypted':False,'clientTlsAuthorized':False}}
  binding_raw=json.dumps(binding).encode();plan={'snapshotEvidence':{'sourceBindingSha256':m.sha(binding_raw)}}
  files={'/db':db_raw,'/migration':json.dumps(migration).encode()}
  def read(path,*args):return config_raw if path.endswith('/deployment.json') else binding_raw if path.endswith('/source-binding.json') else files[path]
  env={'sourceDatabase':'/unused','postgresImage':'sha256:'+'a'*64,'redisImage':'sha256:'+'b'*64,'recipientCertificate':'/unused','recipientKey':'/unused','sourceTls':{'exceptionKind':'aliyun-postgresql-serverless-no-tls'}}
  provider=m.Provider({'request':{'identity':identity},'policy':{'environment':env}});source={**migration,'databases':list(m.DBS),'sslmode':'disable','user':'a_different_backup_user'}
  with patch.object(provider,'verify_ordinary_plan',lambda:plan),patch.object(m,'private',read):
   provider.verify_source_binding(source)
   for changes,reason in [({'host':'stale.example'},'SOURCE_CANONICAL_ENDPOINT'),({'port':5433},'SOURCE_CANONICAL_ENDPOINT'),({'sslmode':'verify-full'},'SOURCE_TLS_MODE'),({'databases':['other']},'SOURCE_CANONICAL_ENDPOINT')]:
    with self.assertRaisesRegex(m.NotReady,reason):provider.verify_source_binding({**source,**changes})
   plan['snapshotEvidence']['sourceBindingSha256']='0'*64
   with self.assertRaisesRegex(m.NotReady,'SOURCE_BINDING_RAW_HASH'):provider.verify_source_binding(source)
 def test_tool_tree_rejects_runner_owned_parent_and_old_opt_location(self):
  from types import SimpleNamespace
  env={'sourceDatabase':'/unused','postgresImage':'sha256:'+'a'*64,'redisImage':'sha256:'+'b'*64,'recipientCertificate':'/unused','recipientKey':'/unused','toolCheckout':'/var/lib/workspacex-cn/auto-preparation-tools/'+'a'*40}
  provider=m.Provider({'request':{'identity':{'sourceRevision':'a'*40,'attemptId':'test'}},'policy':{'environment':env,'toolRevision':'a'*40}})
  with patch.object(pathlib.Path,'lstat',lambda p:SimpleNamespace(st_mode=0o40700,st_uid=0)):provider.verify_tool()
  with patch.object(pathlib.Path,'lstat',lambda p:SimpleNamespace(st_mode=0o40755,st_uid=501 if str(p)=='/var/lib/workspacex-cn' else 0)):
   with self.assertRaisesRegex(m.NotReady,'TOOL_PARENT_TRUST'):provider.verify_tool()
  env['toolCheckout']='/opt/workspacex-cn/auto-preparation-tools/'+'a'*40
  with self.assertRaisesRegex(m.NotReady,'TOOL_PATH'):provider.verify_tool()
 def test_actual_stream_parser_is_order_independent_and_detects_changed_rows(self):
  def run(data):return json.loads(subprocess.check_output(['/usr/bin/python3','-c',m.STREAM_FIDELITY],input=data))
  one=b'COPY public.t (id) FROM stdin;\n1\n2\n\\.\n';two=b'COPY public.t (id) FROM stdin;\n2\n1\n\\.\n'
  self.assertEqual(run(one),run(two));self.assertNotEqual(run(one),run(two.replace(b'2\n',b'3\n')));self.assertEqual(next(iter(run(one).values()))['rows'],2)
 def test_host_rejects_unsafe_plan_and_changed_manifest_before_operations(self):
  request={'identity':{'sourceRevision':'a'*40,'baselineSourceRevision':'b'*40,'attemptId':'test'},'images':{},'dependencies':{'manifest':'e'*64},'migrationPlanSha256':''}
  env={'sourceDatabase':'/unused','postgresImage':'sha256:'+'a'*64,'redisImage':'sha256:'+'b'*64,'recipientCertificate':'/unused','recipientKey':'/unused'}
  provider=m.Provider({'request':request,'policy':{'environment':env}})
  for risk,ready,blockers in [('additive',True,[]),('destructive',True,[]),('unknown',True,[]),('additive',False,['OUT_OF_ORDER'])]:
   plan={'targetSha':'a'*40,'baselineSha':'b'*40,'ready':ready,'blockers':blockers,'drift':[],'pending':[{'risk':risk}]};plan['planSha256']=m.sha(json.dumps(plan,separators=(',',':')).encode());request['migrationPlanSha256']=plan['planSha256']
   with patch.object(m,'private',lambda *args:json.dumps(plan).encode()):
    if risk=='additive' and ready:self.assertEqual(provider.verify_ordinary_plan(),plan)
    else:
     with self.assertRaisesRegex(m.NotReady,'ORDINARY_MIGRATION_PLAN_REQUIRED'):provider.verify_ordinary_plan()
  with patch.object(m,'private',lambda *args:b'{}'):
   with self.assertRaisesRegex(m.NotReady,'MANIFEST_RAW_HASH'):provider.effective_manifest()
@unittest.skipUnless(os.environ.get('CN_AUTO_PREPARE_DOCKER_TEST')=='1','explicit real Docker lane')
class DockerTests(unittest.TestCase):
 def test_real_encrypted_three_database_restore_and_owned_cleanup(self):
  docker=shutil.which('docker');self.assertIsNotNone(docker)
  token=uuid.uuid4().hex[:10];network='wsx-autop-test-'+token;source=network+'-source'
  with tempfile.TemporaryDirectory(prefix='cn-auto-provider-') as tmp:
   root=pathlib.Path(tmp);root.chmod(0o700)
   def d(*args):return subprocess.check_output([docker,*args],stderr=subprocess.DEVNULL)
   pg=json.loads(d('image','inspect','postgres:16'))[0];redis=json.loads(d('image','inspect','redis:7'))[0]
   cert=root/'recipient.pem';key=root/'key.pem';subprocess.run(['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-subj','/CN=synthetic-autoprep-test','-days','1'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
   sourceenv=root/'source.env';sourceenv.write_text('POSTGRES_PASSWORD=synthetic-fixture-password\n');sourceenv.chmod(0o600)
   policy={'toolRevision':'a'*40,'environment':{'sourceDatabase':str(root/'source.json'),'postgresImage':pg['Id'],'redisImage':redis['Id'],'recipientCertificate':str(cert),'recipientKey':str(key),'sourceNetwork':network}}
   (root/'source.json').write_text(json.dumps({'host':'sourcepostgres','port':5432,'user':'backup_reader','password':'synthetic-backup-password','sslmode':'disable','databases':list(m.DBS)}))
   request={'identity':{'sourceRevision':'a'*40,'baselineSourceRevision':'b'*40,'baselineSha256':'c'*64,'release':'v1.0.0','attemptId':token},'images':{k:'sha256:'+'d'*64 for k in ('api','web','agent','sandbox')},'migrationPlanSha256':'e'*64,'dependencies':{'backup':'f'*64}}
   def read(path,mode=0o600):return pathlib.Path(path).read_bytes()
   original_docker=m.DOCKER;m.DOCKER=[docker]
   # macOS has no /proc/meminfo; Linux host memory gating is independently tested.
   with patch.object(m,'private',read),patch.object(m,'available_memory',lambda:12*1024**3):
    provider=m.Provider({'request':request,'policy':policy},root=root);provider.dir.mkdir(parents=True,mode=0o700)
    # Source-binding policy itself is covered independently above. This actual
    # Docker lane has a synthetic source, not Aliyun canonical provider evidence.
    provider.verify_source_binding=lambda source:None
    try:
     d('network','create',network);d('run','-d','--rm','--name',source,'--network',network,'--network-alias','sourcepostgres','--env-file',str(sourceenv),pg['Id'])
     for _ in range(100):
      try:d('exec',source,'pg_isready','-h','127.0.0.1','-U','postgres');break
      except subprocess.CalledProcessError:time.sleep(.2)
     d('exec',source,'psql','-U','postgres','-c',"CREATE ROLE backup_reader LOGIN PASSWORD 'synthetic-backup-password'; GRANT pg_read_all_data TO backup_reader;")
     for db in m.DBS:
      d('exec',source,'createdb','-U','postgres',db)
      d('exec',source,'psql','-U','postgres','-d',db,'-c',"CREATE TABLE synthetic (id int, value text); INSERT INTO synthetic VALUES (1, 'synthetic only'), (2, 'retained synthetic');")
     facts,refs=provider.backup();self.assertEqual(len([r for r in refs if r["path"].endswith(".cms")]),3)
     self.assertTrue(all(pathlib.Path(r['path']).stat().st_mode&0o777==0o600 for r in refs))
     self.assertTrue(all(b'synthetic only' not in pathlib.Path(r['path']).read_bytes() for r in refs))
     restored,_=provider.restore_databases();self.assertTrue(restored['dataFidelityVerified'])
     network_state=json.loads(d('network','inspect',provider.name+'-net'))[0];self.assertTrue(network_state['Internal'])
     routes=d('exec',provider.name+'-pg','cat','/proc/net/route').decode().splitlines()[1:]
     self.assertFalse(any(line.split()[1]=='00000000' for line in routes if line.split()))

     count=provider.psql('workspacex','SELECT count(*) FROM synthetic;').decode();self.assertIn('2',count)
     provider.psql('workspacex',"UPDATE synthetic SET value='changed' WHERE id=1;")
     self.assertNotEqual(provider.data_fingerprint('workspacex'),provider.data_fingerprint('workspacex',True))
     clean,_=provider.cleanup();self.assertTrue(clean['ownedContainersAbsent']);self.assertFalse(provider.state.exists())
     self.assertFalse(d('ps','-aq','--filter','label=wsx.auto.owner='+provider.key).strip())
     # A real killed host provider cannot kill a detached daemon container. The
     # independently dispatched cleanup must discover and remove that owner.
     import cn_auto_prepare as dispatcher
     stalled_request=json.loads(json.dumps(request));stalled_request['identity']['attemptId']=token+'-timeout'
     stalled=m.Provider({'request':stalled_request,'policy':policy},root=root);stalled.dir.mkdir(parents=True,mode=0o700)
     argv=[docker,'run','-d','--rm','--name',stalled.name+'-stalled','--label','wsx.auto.owner='+stalled.key,'--network=none','--memory=128m','--pids-limit=32','--entrypoint','sleep',pg['Id'],'60']
     script='import subprocess,time;subprocess.run('+repr(argv)+',check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(60)'
     try:saved=os.dup(9)
     except OSError:saved=None
     lock=os.open(root/'test-lock',os.O_CREAT|os.O_RDWR,0o600)
     try:
      os.dup2(lock,9)
      with self.assertRaisesRegex(dispatcher.NotReady,'PROVIDER_TIMEOUT_JOINED'):dispatcher.bounded([sys.executable,'-c',script],{},5)
      self.assertTrue(d('ps','-aq','--filter','label=wsx.auto.owner='+stalled.key).strip())
      # A collector static bootstrap probe has no attempt network. Reclamation
      # must use its exact owner label, not project name or network membership.
      static_name='wsx-cn-bootstrap-'+token
      d('run','-d','--rm','--name',static_name,'--label','wsx.auto.owner='+stalled.key,'--network=none','--memory=128m','--cpus=.3','--pids-limit=128','--cap-drop=ALL','--security-opt=no-new-privileges','--entrypoint','sleep',pg['Id'],'60')
      self.assertEqual(json.loads(d('inspect',static_name))[0]['HostConfig']['NetworkMode'],'none')
      self.assertEqual(len(d('ps','-aq','--filter','label=wsx.auto.owner='+stalled.key).split()),2)
      stalled.cleanup();self.assertFalse(d('ps','-aq','--filter','label=wsx.auto.owner='+stalled.key).strip())
      self.assertFalse(d('ps','-aq','--filter','name=^/'+static_name+'$').strip())
     finally:
      if saved is None:os.close(9)
      else:os.dup2(saved,9);os.close(saved)
      if lock!=9:os.close(lock)
      try:stalled.cleanup()
      except Exception:pass

    finally:
     try:provider.cleanup()
     except Exception:pass
     subprocess.run([docker,'rm','-f','-v',source],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
     subprocess.run([docker,'network','rm',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
     m.DOCKER=original_docker
if __name__=='__main__':unittest.main()
