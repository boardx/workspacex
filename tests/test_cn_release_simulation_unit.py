"""Resource-unit protocols; no systemd/Docker execution or Linux claim."""
import importlib.util,json,os,subprocess,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('sim_unit',ROOT/'scripts/cn-release-simulation-unit.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SimulationUnit(unittest.TestCase):
 def fixture(self):
  unit='wsx-cn-simulation-'+'a'*32+'.service';root=Path('/var/lib/wsx-cn-simulation-fixture');argv=m.bridge_argv(root)
  value={**m.PROPERTIES,'RuntimeMaxUSec':'4h 35min','Id':unit,'LoadState':'loaded','ActiveState':'active','MainPID':'123','InvocationID':'b'*32,'ControlGroup':'/system.slice/'+unit,'ExecStart':'{ path='+argv[0]+' ; argv[]='+' '.join(argv)+' ; ignore_errors=no ; }'}
  return root,unit,argv,value
 def test_real_memtotal_gate_reserves_docker_and_host(self):
  value=m.resource_gate('MemTotal: 16372479 kB\n');self.assertEqual(value['workerMemoryMaxBytes'],6*1024**3)
  self.assertEqual(value['knownDockerFixtureCapsBytes'],2684354560);self.assertEqual(value['dockerMemoryReserveBytes'],3*1024**3)
  self.assertFalse(value['dockerAggregateEnforced'])
  with self.assertRaisesRegex(RuntimeError,'INSUFFICIENT'):m.resource_gate('MemTotal: 7000000 kB\n')
  with self.assertRaisesRegex(RuntimeError,'INSUFFICIENT'):m.resource_gate('MemTotal: 10000000 kB\n')
  with self.assertRaises(RuntimeError):m.resource_gate('not meminfo')
 def test_exact_manager_identity_budget_and_caps(self):
  _,unit,argv,v=self.fixture();self.assertEqual(m.validate_show(v,unit,argv,16500),123)
  self.assertEqual(m.duration_us('4h35min'),16500*1000000)
  for key,value in [('MemoryMax','infinity'),('MemorySwapMax','infinity'),('TasksMax','max'),('CPUQuotaPerSecUSec','infinity'),('RuntimeMaxUSec','infinity'),('ExecStart','foreign'),('ControlGroup','/runner'),('MainPID','1'),('Restart','always')]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.validate_show({**v,key:value},unit,argv,16500)
  with self.assertRaisesRegex(RuntimeError,'INVOCATION'):m.validate_show(v,unit,argv,16500,'c'*32)
 def test_fixed_worker_arguments_cannot_authorize_other_command(self):
  cmd=[str(Path(sys.executable).absolute()),'-I','-B',str(ROOT/'scripts/cn-release-simulation.py'),'--output',str(Path('/tmp/fresh-report').resolve()),'--workers','3','--timeout-seconds','300','--rounds','1','--seed','0'];m.validate_worker(cmd,ROOT)
  for index,value in [(3,'/tmp/arbitrary.py'),(7,'99'),(9,'999999'),(11,'100'),(13,'-1')]:
   bad=list(cmd);bad[index]=value
   with self.assertRaises(RuntimeError):m.validate_worker(bad,ROOT)
 def test_exact_suite_and_workers_enum_ten_requires_all(self):
  base=[str(Path(sys.executable).absolute()),'-I','-B',str(ROOT/'scripts/cn-release-simulation.py'),'--output',str(Path('/tmp/fresh-report').resolve()),'--workers','3','--timeout-seconds','300','--rounds','1','--seed','0']
  for suite in m.WORKER_SUITES:
   for workers in ('1','3'):
    cmd=[*base,'--suite',suite];cmd[7]=workers;m.validate_worker(cmd,ROOT)
  for index,value in ((7,'2'),(14,'--child'),(15,'linux-process')):
   cmd=[*base,'--suite','release'];cmd[index]=value
   with self.assertRaises(RuntimeError):m.validate_worker(cmd,ROOT)
  cmd=[*base,'--suite','release'];cmd[11]='10'
  with self.assertRaisesRegex(RuntimeError,'TEN_ALL'):m.validate_worker(cmd,ROOT)
 def test_fault_only_exact_entry_and_verified_unit_context(self):
  with tempfile.TemporaryDirectory()as directory:
   registry=Path(directory).resolve();folder=registry/'round-01/api-outer-recovery';folder.mkdir(parents=True)
   receipt=folder/'success';receipt.mkdir();source=b'exact-fixed-fixture'
   plan={'sha':'a'*40,'runId':'123','env':{'CN_SIM14_REGISTRY_ROOT':str(registry),'CN_API_STARTUP_PG_IMAGE':'sha256:fixture'}}
   observed={'unit':'wsx-cn-simulation-'+'a'*32+'.service','invocationId':'b'*32}
   cmd=[str(Path(sys.executable).absolute()),'-I','-B',str(ROOT/m.FAULT_PATH),'--child']
   env={'GITHUB_RUN_ID':'123','CN_API_STARTUP_PG_IMAGE':'sha256:fixture','CN_SIM14_CHILD_ROOT':str(folder/'target')}
   with patch.object(m,'current_unit_context',return_value=(registry,plan,observed)),patch.object(m,'command',return_value=source),patch.object(m,'read',return_value=source):
    evidence=m.admit_fault(cmd,ROOT,env,'a'*40,'123',receipt,'api-outer-sigkill');self.assertEqual(evidence['faultSourceSha256'],m.sha(source))
    for args in ((cmd[:-1]+['--arbitrary'],env,'a'*40,'api-outer-sigkill'),(cmd,{**env,'GH_TOKEN':'secret'},'a'*40,'api-outer-sigkill'),(cmd,env,'c'*40,'api-outer-sigkill'),(cmd,env,'a'*40,'other')):
     with self.assertRaises(RuntimeError):m.admit_fault(args[0],ROOT,args[1],args[2],'123',receipt,args[3])
    with patch.object(m,'read',return_value=b'drift'):
     with self.assertRaisesRegex(RuntimeError,'SOURCE_DRIFT'):m.admit_fault(cmd,ROOT,env,'a'*40,'123',receipt,'api-outer-sigkill')
    with patch.object(m,'current_unit_context',side_effect=RuntimeError('OUTSIDE_UNIT')):
     with self.assertRaisesRegex(RuntimeError,'OUTSIDE_UNIT'):m.admit_fault(cmd,ROOT,env,'a'*40,'123',receipt,'api-outer-sigkill')
 def test_environment_claim_cannot_replace_actual_unit_membership(self):
  with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.object(m.base,'process_identity',return_value=12),patch.object(Path,'read_text',return_value='0::/runner/not-a-unit\n'),patch.dict(os.environ,{'GITHUB_ACTIONS':'true','GITHUB_RUN_ID':'123'}):
   with self.assertRaisesRegex(RuntimeError,'OUTSIDE_UNIT'):m.current_unit_context()
 def test_fault_noop_uses_same_fixed_file_never_python_c(self):
  with patch.object(m,'current_unit_context')as observation:
   with self.assertRaisesRegex(RuntimeError,'FIXED_COMMAND'):m.admit_fault([sys.executable,'-I','-B','-c','pass'],ROOT,{},'a'*40,'123',Path('/var/lib/fake'),'api-outer-noop')
   observation.assert_not_called()
 def test_environment_whitelist_drops_credentials_before_file_or_manager(self):
  self.assertEqual(m.safe_env({'PATH':'/usr/bin','GH_TOKEN':'secret','GITHUB_TOKEN':'secret2','AWS_SECRET_ACCESS_KEY':'secret3','CN_API_STARTUP_PG_IMAGE':'sha256:fixture'}),{'PATH':'/usr/bin','CN_API_STARTUP_PG_IMAGE':'sha256:fixture'})
 def test_setup_node_is_preserved_and_admitted_by_plan_whitelist(self):
  env={'CN_API_STARTUP_NODE':'/owned/sdk/node','GH_TOKEN':'synthetic-secret'}
  self.assertEqual(m.safe_env(env),{'CN_API_STARTUP_NODE':'/owned/sdk/node'})
  self.assertLessEqual(set(m.safe_env(env)),m.ENV_KEYS)
 def test_real_venv_interpreter_keeps_prefix_and_sdk_packages(self):
  with tempfile.TemporaryDirectory()as d:
   venv=Path(d)/'sdk';subprocess.run([sys.executable,'-I','-B','-m','venv','--without-pip',venv],check=True,timeout=30,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
   python=venv/'bin/python'
   site=json.loads(subprocess.check_output([python,'-I','-B','-c','import json,site;print(json.dumps(site.getsitepackages()[0]))'],timeout=5))
   Path(site,'cn_synthetic_sdk.py').write_text('MARKER="local-synthetic-sdk"\n')
   code="import importlib.util,json,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('u',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);import cn_synthetic_sdk;print(json.dumps({'identity':m.python_identity(),'argv':m.bridge_argv(Path('/var/lib/wsx-cn-simulation-fixture')),'sdk':cn_synthetic_sdk.MARKER}))"
   code += ";cmd=[str(Path(sys.executable).absolute()),'-I','-B',str(m.ROOT/'scripts/cn-release-simulation.py'),'--output',str(Path('/var/lib/report').resolve()),'--workers','1','--timeout-seconds','300','--rounds','1','--seed','0','--suite','release'];m.validate_worker(cmd,m.ROOT);cmd[0]=str(Path(sys.executable).resolve());rejected=False\ntry:m.validate_worker(cmd,m.ROOT)\nexcept RuntimeError:rejected=True\nassert rejected, 'resolved interpreter was admitted'"
   value=json.loads(subprocess.check_output([python,'-I','-B','-c',code,ROOT/'scripts/cn-release-simulation-unit.py'],timeout=5))
   self.assertEqual(value['argv'][0],str(python));self.assertEqual(value['identity']['executable'],str(python));self.assertEqual(value['identity']['prefix'],str(venv))
   self.assertEqual(value['identity']['target'],str(python.resolve()));self.assertEqual(value['sdk'],'local-synthetic-sdk');self.assertIsNotNone(value['identity']['venvConfigSha256'])
   lost=subprocess.run([python.resolve(),'-I','-B','-c','import cn_synthetic_sdk'],capture_output=True,timeout=5)
   self.assertNotEqual(lost.returncode,0);self.assertIn(b'ModuleNotFoundError',lost.stderr)
 def test_real_release_pipe_has_no_token_and_rejects_eof_timeout(self):
  a,b=os.pipe()
  try:
   value={'readySha256':'a'*64,'invocationId':'b'*32};m.base.send_frame(b,m.canonical(value),time.monotonic()+1);self.assertEqual(m.release_frame(a),value)
  finally:os.close(a);os.close(b)
  a,b=os.pipe();os.close(b)
  try:
   with self.assertRaisesRegex(RuntimeError,'EOF'):m.release_frame(a)
  finally:os.close(a)
  a,b=os.pipe()
  try:
   with self.assertRaisesRegex(RuntimeError,'TIMEOUT'):m.release_frame(a,.01)
  finally:os.close(a);os.close(b)
 def test_release_rejects_token_field_or_bad_binding_shape(self):
  for value in ({'readySha256':'a'*64,'invocationId':'b'*32,'token':'forbidden'}, {'readySha256':'x','invocationId':'b'*32}):
   a,b=os.pipe()
   try:
    os.write(b,m.canonical(value))
    with self.assertRaises(RuntimeError):m.release_frame(a)
   finally:os.close(a);os.close(b)
 def object(self,root):
  obj=m.Unit(ROOT,root,'a'*40,'123');obj.resources={'fixtureOnly':True};obj.claim={'unit':'wsx-cn-simulation-'+'a'*32+'.service'};obj.observed={'controlGroup':'/system.slice/'+obj.claim['unit'],'invocationId':'b'*32,'device':1,'inode':2};return obj
 def test_wrong_invocation_never_stops_or_runs_recovery(self):
  with tempfile.TemporaryDirectory()as d:
   obj=self.object(Path(d));_,unit,_,v=self.fixture()
   with patch.object(m,'show',return_value={**v,'InvocationID':'c'*32}),patch.object(m,'command')as stop:
    with self.assertRaisesRegex(RuntimeError,'STOP_IDENTITY'):obj.close(None)
    stop.assert_not_called()
   self.assertFalse(json.loads((Path(d)/'simulation-unit-cleanup.json').read_bytes())['verified'])
 def test_actual_observe_rejects_kernel_pid_or_inode_drift(self):
  import types
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);_,unit,_,v=self.fixture();argv=m.bridge_argv(root)
   v['ExecStart']='{ path='+argv[0]+' ; argv[]='+' '.join(argv)+' ; ignore_errors=no ; }'
   plan={'seconds':16500};m.write(root/'simulation-unit-input.json',plan)
   claim={'unit':unit,'bridgeSha256':m.sha(m.read(ROOT/'scripts/cn-release-simulation-unit.py',1048576)),'inputSha256':m.sha(m.read(root/'simulation-unit-input.json'))}
   group=Path('/sys/fs/cgroup')/v['ControlGroup'].lstrip('/')
   original_resolve,original_stat,original_text,original_bytes=Path.resolve,Path.stat,Path.read_text,Path.read_bytes
   for scenario in ('valid','kernel','pid','inode'):
    calls=0
    def resolve(path,*a,**kw):return path if path==group else original_resolve(path,*a,**kw)
    def stat_(path,*a,**kw):
     nonlocal calls
     if path!=group:return original_stat(path,*a,**kw)
     calls+=1;return types.SimpleNamespace(st_dev=1,st_ino=3 if scenario=='inode'and calls>1 else 2)
    def text(path,*a,**kw):
     if str(path)=='/proc/123/cgroup':return '0::'+v['ControlGroup']+'\n'
     if path.parent==group and path.name in m.LIMITS:return 'max' if scenario=='kernel'and path.name=='memory.max' else m.LIMITS[path.name]
     return original_text(path,*a,**kw)
    def bytes_(path,*a,**kw):
     if str(path)=='/proc/123/cmdline':return b'\0'.join(x.encode()for x in argv)+b'\0'
     return original_bytes(path,*a,**kw)
    with self.subTest(scenario=scenario),patch.object(m,'show',return_value=v),patch.object(m.base,'process_identity',side_effect=[10,11 if scenario=='pid'else 10]),patch.object(Path,'resolve',resolve),patch.object(Path,'stat',stat_),patch.object(Path,'read_text',text),patch.object(Path,'read_bytes',bytes_):
     if scenario=='valid':self.assertEqual(m.observe(root,plan,claim)['limits'],m.LIMITS)
     else:
      with self.assertRaises(RuntimeError):m.observe(root,plan,claim)
 def test_unknown_start_is_one_attempt_and_claim_preserved(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);obj=m.Unit(ROOT,root,'a'*40,'123')
   cmd=[str(Path(sys.executable).absolute()),'-I','-B',str(ROOT/'scripts/cn-release-simulation.py'),'--output','/tmp/fresh-report','--workers','3','--timeout-seconds','300','--rounds','1','--seed','0']
   with patch.object(m,'gate'),patch.object(m,'host_resources',return_value={}),patch.object(m.subprocess,'Popen',side_effect=OSError('unknown'))as start:
    with self.assertRaises(OSError):obj.spawn(cmd,cwd=ROOT,env={'GH_TOKEN':'secret'})
    with self.assertRaisesRegex(RuntimeError,'ONE_START'):obj.spawn(cmd,cwd=ROOT,env={})
    self.assertEqual(start.call_count,1);self.assertTrue((root/'simulation-unit-claim.json').exists())
    self.assertNotIn('secret',json.dumps(start.call_args.args));self.assertNotIn('GH_TOKEN',start.call_args.kwargs['env'])
    self.assertNotIn('secret',(root/'simulation-unit-input.json').read_text())
    self.assertIn('--wait',start.call_args.args[0]);self.assertIn('--pipe',start.call_args.args[0]);self.assertNotIn('--collect',start.call_args.args[0])
   with self.assertRaisesRegex(RuntimeError,'OWNERSHIP_UNKNOWN'):obj.close(None)
 def test_verified_absence_reaps_only_own_client(self):
  with tempfile.TemporaryDirectory()as d:
   obj=self.object(Path(d))
   class Process:
    stdin=None
    def poll(self):return 0
    def wait(self,timeout):self.reaped=True;return 0
   obj.process=Process()
   with patch.object(m,'show',return_value={'LoadState':'not-found'}),patch.object(m.Path,'exists',return_value=False):result=obj.close(obj)
   self.assertTrue(result['verified']);self.assertEqual(result['populated'],0);self.assertTrue(obj.process.reaped)
 def test_gone_unit_with_present_group_is_not_cleanup(self):
  with tempfile.TemporaryDirectory()as d:
   obj=self.object(Path(d))
   with patch.object(m,'show',return_value={'LoadState':'not-found'}),patch.object(m.Path,'exists',return_value=True),patch.object(m,'command')as stop:
    with self.assertRaisesRegex(RuntimeError,'ABSENCE_UNPROVEN'):obj.close(None)
    stop.assert_not_called()
 def test_no_parent_controller_or_fallback_or_token_implementation(self):
  raw=(ROOT/'scripts/cn-release-simulation-unit.py').read_text()
  self.assertNotIn('subtree_control',raw);self.assertNotIn('set-property',raw)
  self.assertNotIn("'--collect'",raw);self.assertNotIn("env['GH_TOKEN']",raw)
  self.assertIn("domain.path.parent==",raw)
if __name__=='__main__':unittest.main()
