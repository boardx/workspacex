import fcntl, importlib.util, signal, time
import hashlib,http.server,json,os,pathlib,subprocess,sys,tempfile,threading,unittest
BASE=pathlib.Path(__file__).resolve().parent
SCRIPT=BASE.parent/'scripts/minimal-docker-release.py' if (BASE.parent/'scripts/minimal-docker-release.py').exists() else BASE/'release.py'
def release_module():
 spec=importlib.util.spec_from_file_location('minimal_release',SCRIPT)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
FAKE=r'''#!PYTHON
import io,json,pathlib,sys,tarfile
P=pathlib.Path(STATE); state=json.loads(P.read_text());args=sys.argv[1:];state['calls'].append(args)
def done(value=None):
 P.write_text(json.dumps(state))
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
 P.write_text(json.dumps(state));sys.stdout.buffer.write(data.getvalue());raise SystemExit(0)
if args[0]=='rm':
 assert args[1] in state['probes'];del state['probes'][args[1]];done()
if args[0]=='compose':
 if 'up' in args:state['applied']=True;done()
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
  self.config['lockFile']=str(lock);self.config['readinessTimeoutSeconds']=2
  self.cp=self.root/'config.json';self.cp.write_text(json.dumps(self.config))
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
 def run_cli(self,apply=False,**updates):
  self.state.update(updates);self.statepath.write_text(json.dumps(self.state))
  args=[sys.executable,'-B',str(SCRIPT),'--config',str(self.cp),'--manifest',str(self.mp),'--output',str(self.root/'attempt')]
  if apply:args.append('--apply')
  result=subprocess.run(args,capture_output=True,text=True,timeout=30);self.actual=json.loads(self.statepath.read_text());return result,json.loads(result.stdout)
 def assert_no_switch(self):self.assertFalse(self.actual['applied']);self.assertFalse(any('up' in a for a in self.actual['calls']))
 def test_default_plan_real_cli_never_switches(self):
  p,r=self.run_cli();self.assertEqual((p.returncode,r['status']),(0,'PLANNED'));self.assert_no_switch();self.assertEqual(self.actual['probes'],{})
 def test_apply_success_real_cli_http_no_forbidden_commands(self):
  p,r=self.run_cli(True);self.assertEqual((p.returncode,r['status']),(0,'SUCCEEDED'));self.assertTrue((self.root/'attempt/receipt.json').exists())
  ups=[a for a in self.actual['calls']if 'up'in a];self.assertEqual(len(ups),1);self.assertEqual(ups[0][ups[0].index('up'):],['up','--detach','--no-deps','--pull','never','--no-build','api','web','agent','sandbox','sandbox-sessions'])
  for a in self.actual['calls']:
   self.assertNotIn(a[0],('run','start','pull','build','exec','down','volume','system'));self.assertNotIn('--force-recreate',a)
   if a[0]=='create':self.assertIn('--pull=never',a)
  self.assertEqual(self.actual['probes'],{});self.assertTrue(r['markerUnchanged'])
 def test_wrong_source_rejects_before_switch(self):
  p,r=self.run_cli(True,wrongSource=True);self.assertEqual(p.returncode,1);self.assertEqual(r['code'],'IMAGE_SOURCE_MISMATCH');self.assert_no_switch()
 def test_schema_drift_rejects_before_switch(self):
  p,r=self.run_cli(True,schemaDrift=True);self.assertEqual(r['code'],'SCHEMA_CHANGE_REQUIRES_SEPARATE_RELEASE');self.assert_no_switch();self.assertEqual(self.actual['probes'],{})
 def test_empty_schema_is_not_compatibility(self):
  p,r=self.run_cli(True,emptySchema=True);self.assertEqual(r['code'],'EMPTY_SCHEMA_INVENTORY');self.assert_no_switch()
 def test_compose_env_drift_rejected(self):
  p,r=self.run_cli(True,configDrift=True);self.assertEqual(r['code'],'NON_IMAGE_COMPOSE_CHANGE');self.assert_no_switch()
 def test_starting_then_healthy_does_not_repeat_up(self):
  p,r=self.run_cli(True,starting=True);self.assertEqual(p.returncode,0);self.assertGreaterEqual(r['health']['readinessPolls'],2);self.assertEqual(sum('up'in a for a in self.actual['calls']),1)
 def test_unhealthy_deadline_never_repeats_up(self):
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
if __name__=='__main__':unittest.main()
