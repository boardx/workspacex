import fcntl, importlib.util, signal, time
import hashlib,http.server,json,os,pathlib,subprocess,sys,tempfile,threading,unittest
BASE=pathlib.Path(__file__).resolve().parent
SCRIPT=BASE.parent/'scripts/minimal-docker-release.py' if (BASE.parent/'scripts/minimal-docker-release.py').exists() else BASE/'release.py'
def release_module():
 spec=importlib.util.spec_from_file_location('minimal_release',SCRIPT)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
FAKE=r'''#!PYTHON
import io,json,os,pathlib,sys,tarfile
P=pathlib.Path(STATE); state=json.loads(P.read_text());args=sys.argv[1:];state['calls'].append(args)
def persist():
 temporary=P.with_name(P.name+'.'+str(os.getpid())+'.tmp')
 try:
  temporary.write_text(json.dumps(state));os.replace(temporary,P)
 finally:temporary.unlink(missing_ok=True)
def done(value=None):
 persist()
 if value is not None: print(value if isinstance(value,str) else json.dumps(value))
 raise SystemExit(0)
def obj(cid):
 if cid in state['probes']:return state['probes'][cid]
 service=cid.removeprefix('live-');role=state['services'][service];ident=state['new'][role] if state['applied'] else state['old'][role]
 health='healthy'
 if state['applied']:
  state['postInspect']=state.get('postInspect',0)+1
  if state.get('alwaysUnhealthy'):health='unhealthy'
  elif state.get('starting') and state['postInspect']<=5:health='starting'
  if state.get('deployedWrong') and service=='api':ident=state['old'][role]
 return {'Id':cid,'Image':ident,'State':{'Running':True,'Health':{'Status':health}},'Config':{'Labels':{'com.docker.compose.project':'example','com.docker.compose.service':service,'com.docker.compose.config-hash':'hash-'+service}}}
if args[:2]==['image','inspect']:
 ident=args[2];source=state['source'] if ident in state['new'].values() else 'b'*40
 if state.get('wrongSource') and ident==state['new']['api']:source='c'*40
 done([{'Id':ident,'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':source}}}])
if args[:2]==['container','inspect']:
 key=args[2]
 if key.startswith('wsx-schema-'):key=next(i for i,v in state['probes'].items() if v['Name']==key)
 done([obj(key)])
if args[0]=='create':
 nonce=args[args.index('--name')+1];cid=hashlib.sha256(nonce.encode()).hexdigest();ident=args[-1]
 state['probes'][cid]={'Id':cid,'Name':nonce,'Image':ident,'State':{'Running':False},'Config':{'Labels':{'wsx.release.schema':nonce.removeprefix('wsx-schema-')}}};done(cid)
if args[0]=='cp':
 cid,path=args[1].split(':',1);image=state['probes'][cid]['Image'];raw=b'stable schema';name='migrations/001.sql' if path.endswith('migrations') else path.rsplit('/',1)[-1]
 if state.get('schemaDrift') and image==state['new']['api']:raw=b'changed schema'
 if state.get('emptySchema') and path.endswith('migrations'):name='migrations/readme.txt'
 data=io.BytesIO()
 with tarfile.open(fileobj=data,mode='w')as t:
  info=tarfile.TarInfo(name);info.size=len(raw);t.addfile(info,io.BytesIO(raw))
 persist();sys.stdout.buffer.write(data.getvalue());raise SystemExit(0)
if args[0]=='rm':
 assert args[1] in state['probes'];del state['probes'][args[1]];done()
if args[0]=='compose':
 if 'up' in args:
  if state.get('automaticRecoveryFixture'):state['upCount']=state.get('upCount',0)+1
  if state.get('automaticRecoveryFixture') and state['upCount']>1:
   if state.get('rollbackFails'):persist();raise SystemExit(1)
   state['applied']=False;state['recovered']=True;done()
  state['applied']=True
  if state.get('cancelOnUp'):
   persist();os.kill(os.getppid(),15)
   import time;time.sleep(30)
  if state.get('upFails'):persist();raise SystemExit(1)
  done()
 if 'ps' in args:done('live-'+args[-1])
 if '--hash' in args:done(args[-1]+' hash-'+args[-1])
 if 'config' in args:
  result={'name':'example','services':{s:{'image':state['old'][r],'environment':{'APP_SETTING':'kept'},'volumes':['/existing:/data']} for s,r in state['services'].items()}}
  files=[args[i+1] for i,x in enumerate(args)if x=='--file']
  if len(files)>1:
   patch=json.loads(pathlib.Path(files[-1]).read_text())
   for s,row in patch['services'].items():result['services'][s].update(row)
   if state.get('configDrift'):result['services']['api']['environment']={'APP_SETTING':'changed'}
  done(result)
raise RuntimeError('unexpected command')
'''.replace('import io,','import hashlib,io,')
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(self.server.code);self.end_headers();self.wfile.write(b'{"trustworthy":true}')
 def log_message(self,*a):pass
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
  self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);self.server.code=200
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
  self.state={'calls':[],'applied':False,'probes':{},'source':'bc3d1254ce05c915801fb73fe6698072730a051c','services':{'api':'api','web':'web','agent':'agent','sandbox':'sandbox','sandbox-sessions':'sandbox'},'new':{},'old':{}}
  for i,r in enumerate(('api','web','agent','sandbox','postgres')):self.state['new'][r]='sha256:'+str(i+1)*64;self.state['old'][r]='sha256:'+str(i+5)*64
  self.statepath=self.root/'state.json';self.statepath.write_text(json.dumps(self.state))
  docker=self.root/'docker';docker.write_text(FAKE.replace('PYTHON',sys.executable).replace('STATE',repr(str(self.statepath))));docker.chmod(0o700)
  compose=self.root/'compose.json';compose.write_text('{}');env=self.root/'existing.env';env.write_text('')
  self.manifest={'kind':'single-host-images-v1','sourceRevision':self.state['source'],'images':{r:{'imageId':v,'archiveSha256':'a'*64,'artifactId':'1','runId':'2'}for r,v in self.state['new'].items()}}
  self.mp=self.root/'manifest.json';self.mp.write_text(json.dumps(self.manifest))
  pin=lambda p:{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
  self.config={'docker':str(docker),'project':'example','manifestSha256':pin(self.mp)['sha256'],'composeFiles':[pin(compose)],'envFile':pin(env),'services':self.state['services'],'health':{'url':f'http://127.0.0.1:{self.server.server_port}/health','expected':{'trustworthy':True}}}
  lock=self.root/'existing-release.lock';lock.write_bytes(b'');lock.chmod(0o600)
  self.config['lockFile']=str(lock);self.config['readinessTimeoutSeconds']=10
  self.cp=self.root/'config.json';self.cp.write_text(json.dumps(self.config))
 def test_resolved_hash_keeps_literal_values_private_and_removes_temporary_model(self):
  from unittest.mock import Mock
  m=release_module();d=Mock()
  model={'name':'example','services':{'api':{'environment':{'VALUE':'literal$credential'}}}}
  def read(args):
   self.assertIn('--no-interpolate',args)
   path=pathlib.Path(args[args.index('--file')+1])
   self.assertEqual(path.stat().st_mode & 0o777,0o600)
   self.assertEqual(json.loads(path.read_text()),model)
   return b'api expected-hash'
  d.run.side_effect=read
  self.assertEqual(m.resolved_config_hash(d,model,'example','api',self.root),['api','expected-hash'])
  self.assertEqual(list(self.root.glob('.resolved-compose-*')),[])
 def test_resolved_hash_inverts_compose_serialized_dollars_exactly_once(self):
  from unittest.mock import Mock
  import copy
  m=release_module();d=Mock()
  serialized={'services':{'api':{'environment':{'ONE':'before$$after','TWO':'before$$$$after','BRACED':'$${DO_NOT_EXPAND}','EMPTY':'','NULL':None},'command':['echo','$$SHELL'],'labels':{'literal':'$$LABEL'}}}}
  unchanged=copy.deepcopy(serialized);semantic=copy.deepcopy(serialized)
  semantic['services']['api']['environment'].update(ONE='before$after',TWO='before$$after',BRACED='${DO_NOT_EXPAND}')
  semantic['services']['api']['command']=['echo','$SHELL'];semantic['services']['api']['labels']={'literal':'$LABEL'}
  def inspect_private_model(args):
   self.assertIn('--no-interpolate',args);path=pathlib.Path(args[args.index('--file')+1]);self.assertEqual(path.stat().st_mode&0o777,0o600)
   self.assertEqual(json.loads(path.read_text()),semantic)
   return b'api actual-live-hash'
  d.run.side_effect=inspect_private_model
  self.assertEqual(m.resolved_config_hash(d,serialized,'example','api',self.root),['api','actual-live-hash'])
  self.assertEqual(serialized,unchanged);self.assertEqual(list(self.root.glob('.resolved-compose-*')),[])
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
 def run_cli(self,apply=False,**updates):
  self.state.update(updates);self.statepath.write_text(json.dumps(self.state))
  args=[sys.executable,'-B',str(SCRIPT),'--config',str(self.cp),'--manifest',str(self.mp),'--output',str(self.root/'attempt')]
  if apply:args.append('--apply')
  result=subprocess.run(args,capture_output=True,text=True,timeout=30);self.actual=json.loads(self.statepath.read_text());return result,json.loads(result.stdout)
 def assert_no_switch(self):self.assertFalse(self.actual['applied']);self.assertFalse(any('up' in a for a in self.actual['calls']))
 def test_default_plan_real_cli_never_switches(self):
  p,r=self.run_cli();self.assertEqual((p.returncode,r['status']),(0,'PLANNED'));self.assert_no_switch();self.assertEqual(self.actual['probes'],{})
 def test_cn_four_existing_services_without_creating_optional_sandbox(self):
  del self.state['services']['sandbox-sessions']
  self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True)
  self.assertEqual((p.returncode,r['status']),(0,'SUCCEEDED'))
  up=next(a for a in self.actual['calls'] if 'up' in a)
  self.assertEqual(up[up.index('--no-build')+1:],['api','web','agent','sandbox'])
 def test_apply_success_real_cli_http_no_forbidden_commands(self):
  p,r=self.run_cli(True);self.assertEqual((p.returncode,r['status']),(0,'SUCCEEDED'));self.assertTrue((self.root/'attempt/receipt.json').exists())
  ups=[a for a in self.actual['calls']if 'up'in a];self.assertEqual(len(ups),1);self.assertEqual(ups[0][ups[0].index('up'):],['up','--detach','--no-deps','--pull','never','--no-build','api','web','agent','sandbox','sandbox-sessions'])
  for a in self.actual['calls']:
   self.assertNotIn(a[0],('run','start','pull','build','exec','down','volume','system'));self.assertNotIn('--force-recreate',a)
   if a[0]=='create':self.assertIn('--pull=never',a)
  self.assertEqual(self.actual['probes'],{});self.assertTrue(r['markerUnchanged'])
 def test_automatic_rollback_after_partial_compose_failure(self):
  self.config['automaticRollback']=True;self.config['readinessTimeoutSeconds']=10;self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True,automaticRecoveryFixture=True,upFails=True)
  self.assertEqual(p.returncode,1);self.assertEqual(r['status'],'ROLLED_BACK')
  self.assertTrue(self.actual['recovered']);self.assertFalse(self.actual['applied'])
  self.assertTrue((self.root/'attempt/rollback.json').exists())
 def test_rollback_failure_remains_nonzero_and_explicit(self):
  self.config['automaticRollback']=True;self.config['readinessTimeoutSeconds']=10;self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True,automaticRecoveryFixture=True,upFails=True,rollbackFails=True)
  self.assertEqual(p.returncode,1);self.assertEqual(r['status'],'ROLLBACK_FAILED')
 def test_automatic_rollback_after_readiness_failure(self):
  self.config['automaticRollback']=True;self.config['readinessTimeoutSeconds']=10;self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True,automaticRecoveryFixture=True,alwaysUnhealthy=True)
  self.assertEqual(p.returncode,1);self.assertEqual(r['status'],'ROLLED_BACK')
  self.assertTrue(self.actual['recovered'])
 def test_cancellation_restores_previous_images(self):
  self.config['automaticRollback']=True;self.config['readinessTimeoutSeconds']=10;self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True,automaticRecoveryFixture=True,cancelOnUp=True)
  self.assertEqual(p.returncode,1);self.assertEqual(r['status'],'ROLLED_BACK')
  self.assertEqual(r['code'],'DEPLOYMENT_CANCELLED');self.assertFalse(self.actual['applied'])
 def test_registry_digest_mismatch_prevents_switch(self):
  self.manifest['kind']='registry-images-v1'
  for role,row in self.manifest['images'].items():row['image']='registry.example/team/'+role+'@sha256:'+'a'*64
  self.mp.write_text(json.dumps(self.manifest));self.config['manifestSha256']=hashlib.sha256(self.mp.read_bytes()).hexdigest();self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True);self.assertEqual(r['code'],'REGISTRY_DIGEST_MISMATCH');self.assert_no_switch()
 def test_preflight_failure_never_attempts_rollback(self):
  self.config['automaticRollback']=True;self.config['readinessTimeoutSeconds']=10;self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True,automaticRecoveryFixture=True,schemaDrift=True)
  self.assertEqual(p.returncode,1);self.assertEqual(r['status'],'REJECTED');self.assert_no_switch()
 def test_wrong_source_rejects_before_switch(self):
  p,r=self.run_cli(True,wrongSource=True);self.assertEqual(p.returncode,1);self.assertEqual(r['code'],'IMAGE_SOURCE_MISMATCH');self.assert_no_switch()
 def test_schema_drift_rejects_before_switch(self):
  p,r=self.run_cli(True,schemaDrift=True);self.assertEqual(r['code'],'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE');self.assert_no_switch();self.assertEqual(self.actual['probes'],{})
 def test_empty_schema_is_not_compatibility(self):
  p,r=self.run_cli(True,emptySchema=True);self.assertEqual(r['code'],'EMPTY_SCHEMA_INVENTORY');self.assert_no_switch()
 def test_compose_env_drift_rejected(self):
  p,r=self.run_cli(True,configDrift=True);self.assertEqual(r['code'],'NON_IMAGE_COMPOSE_CHANGE');self.assert_no_switch()
 def test_starting_then_healthy_does_not_repeat_up(self):
  self.config['readinessTimeoutSeconds']=10;self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True,starting=True);self.assertEqual(p.returncode,0);self.assertGreaterEqual(r['health']['readinessPolls'],2);self.assertEqual(sum('up'in a for a in self.actual['calls']),1)
 def test_unhealthy_deadline_never_repeats_up(self):
  self.config['readinessTimeoutSeconds']=2;self.cp.write_text(json.dumps(self.config))
  p,r=self.run_cli(True,alwaysUnhealthy=True);self.assertEqual(p.returncode,1);self.assertEqual(r['code'],'READINESS_DEADLINE');self.assertEqual(sum('up'in a for a in self.actual['calls']),1)
 def test_live_wrong_image_is_immediate_failure(self):
  p,r=self.run_cli(True,deployedWrong=True);self.assertEqual(r['code'],'DEPLOYED_IMAGE_MISMATCH');self.assertEqual(self.actual['postInspect'],1)
 def test_existing_canonical_lock_busy_zero_docker_calls(self):
  fd=os.open(self.config['lockFile'],os.O_RDONLY)
  try:
   fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);p,r=self.run_cli(True)
   self.assertEqual(p.returncode,1);self.assertEqual(r['code'],'RELEASE_LOCK_BUSY');self.assertEqual(self.actual['calls'],[]);self.assert_no_switch()
  finally:os.close(fd)
 def test_http_failure_preserves_failure_receipt_no_retry(self):
  self.server.code=503;p,r=self.run_cli(True);self.assertEqual(p.returncode,1);self.assertEqual(r['status'],'FAILED_OR_UNCERTAIN');self.assertEqual(r['stage'],'readiness');self.assertFalse(r['automaticRetry']);self.assertEqual(sum('up'in a for a in self.actual['calls']),1)
 def test_late_health_success_is_rejected(self):
  module=release_module();self.config['readinessTimeoutSeconds']=1;self.cp.write_text(json.dumps(self.config))
  def late(*args,**kwargs):time.sleep(1.1);return {'httpStatus':200}
  module.health=late
  result=module.release(self.cp,self.mp,self.root/'attempt',True)
  self.assertEqual(result['code'],'READINESS_DEADLINE')
  self.assertEqual(sum('up'in a for a in json.loads(self.statepath.read_text())['calls']),1)

class DeadlineTests(unittest.TestCase):
 def test_slow_health_has_wall_clock_deadline_and_restores_timer(self):
  module=release_module();original=signal.getsignal(signal.SIGALRM)
  def previous(*args):raise AssertionError('outer timer unexpectedly fired')
  signal.signal(signal.SIGALRM,previous);signal.setitimer(signal.ITIMER_REAL,30)
  try:
   module.read_health=lambda *args:time.sleep(2)
   started=time.monotonic()
   with self.assertRaisesRegex(module.Rejected,'HEALTH_DEADLINE'):module.health({},timeout=.1)
   self.assertLess(time.monotonic()-started,1)
   self.assertIs(signal.getsignal(signal.SIGALRM),previous)
   remaining,_=signal.getitimer(signal.ITIMER_REAL);self.assertGreater(remaining,28);self.assertLess(remaining,30)
  finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,original)
class FixtureStateTests(unittest.TestCase):
 def exercise_interrupted_write(self,kill=False):
  # Pause the actual fake Docker write after opening/truncating its destination.
  # The parent reads while the writer is held, without timing-based retries.
  with tempfile.TemporaryDirectory() as directory:
   statepath=pathlib.Path(directory)/'state.json'
   initial={'calls':[],'applied':False,'probes':{}}
   statepath.write_text(json.dumps(initial))
   fake=FAKE.replace('PYTHON',sys.executable).replace('STATE',repr(str(statepath)))
   wrapper="""import pathlib,sys
original=pathlib.Path.write_text
def held_write(self,value,*args,**kwargs):
 with self.open('w') as stream:
  print('WRITE_OPEN',flush=True)
  sys.stdin.buffer.read(1)
  return stream.write(value)
pathlib.Path.write_text=held_write
sys.argv=['docker','compose','up']
exec(FAKE_CODE)
""".replace('FAKE_CODE',repr(fake))
   process=subprocess.Popen([sys.executable,'-I','-B','-c',wrapper],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   try:
    import select
    self.assertTrue(select.select([process.stdout],[],[],5)[0],'fake writer did not reach the held write')
    self.assertEqual(process.stdout.readline(),b'WRITE_OPEN\n')
    self.assertEqual(json.loads(statepath.read_text()),initial)
    if kill:
     process.kill();process.communicate(timeout=5)
     self.assertEqual(json.loads(statepath.read_text()),initial)
    else:
     _,errors=process.communicate(b'x',timeout=5)
     self.assertEqual(process.returncode,0,errors.decode())
     self.assertEqual(json.loads(statepath.read_text()),{'calls':[['compose','up']],'applied':True,'probes':{}})
   finally:
    if process.poll() is None:process.kill()
    process.communicate(timeout=5)
 def test_reader_observes_complete_old_or_new_state(self):self.exercise_interrupted_write()
 def test_killed_fixture_writer_preserves_complete_old_state(self):self.exercise_interrupted_write(kill=True)

if __name__=='__main__':unittest.main()
