import importlib.util,json,os,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('unit_fixture',ROOT/'scripts/cn-exact-f0eb-unit.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class UnitTests(unittest.TestCase):
 def fixture(self):
  owned=Path('/var/lib/wsx-exact-f0eb-fixture');head='a'*40;unit='wsx-exact-'+'b'*32+'.service';argv=m.expected_argv(owned,head)
  values={**m.PROPERTIES,'Id':unit,'LoadState':'loaded','ActiveState':'active','MainPID':'123','InvocationID':'c'*32,'ControlGroup':'/system.slice/'+unit,'ExecStart':'{ path='+argv[0]+' ; argv[]='+' '.join(argv)+' ; ignore_errors=no ; start_time=now ; }'}
  return owned,head,unit,argv,values
 def test_exact_manager_properties_and_command(self):
  _,_,unit,argv,values=self.fixture();self.assertEqual(m.validate_show(values,unit,argv),123)
 def test_foreign_invocation_exec_and_limits_rejected(self):
  _,_,unit,argv,values=self.fixture()
  for key,value in [('MemoryMax','infinity'),('MemorySwapMax','infinity'),('TasksMax','infinity'),('CPUQuotaPerSecUSec','infinity'),('ExecStart','other'),('ControlGroup','/runner'),('InvocationID','bad'),('Restart','always')]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):m.validate_show({**values,key:value},unit,argv)
  with self.assertRaisesRegex(RuntimeError,'INVOCATION'):m.validate_show(values,unit,argv,'d'*32)
 def test_service_command_no_token_or_shell_or_scope(self):
  owned,head,unit,_,_=self.fixture()
  with patch.dict(os.environ,{'GH_TOKEN':'do-not-copy','GITHUB_TOKEN':'other-secret'}):args=m.service_argv(owned,head,unit)
  raw=json.dumps(args);self.assertNotIn('do-not-copy',raw);self.assertNotIn('other-secret',raw);self.assertNotIn('--scope',args);self.assertNotIn('--collect',args)
  self.assertIn('--pipe',args);self.assertIn('--wait',args);self.assertIn('--service-type=exec',args);self.assertIn('--property=LimitCORE=0',args)
 def test_actual_bounded_pipe_frame(self):
  a,b=os.pipe()
  try:
   value={'token':'synthetic-only','readySha256':'a'*64,'invocationId':'b'*32};m.send_frame(b,m.canonical(value),time.monotonic()+1);os.close(b);b=None;self.assertEqual(m.frame(a),value)
  finally:
   os.close(a)
   if b is not None:os.close(b)
 def test_eof_timeout_and_oversized_frame_reject(self):
  a,b=os.pipe();os.close(b)
  try:
   with self.assertRaisesRegex(RuntimeError,'EOF'):m.frame(a)
  finally:os.close(a)
  a,b=os.pipe()
  try:
   with self.assertRaisesRegex(RuntimeError,'TIMEOUT'):m.frame(a,.01)
   with self.assertRaisesRegex(RuntimeError,'SIZE'):m.send_frame(b,b'x'*65537,time.monotonic()+1)
  finally:os.close(a);os.close(b)
 def test_private_claim_is_no_replace_and_atomic(self):
  with tempfile.TemporaryDirectory()as d:
   path=Path(d)/'claim.json';m.write(path,{'attempt':1});original=m.read(path)
   with self.assertRaises(FileExistsError):m.write(path,{'attempt':2})
   self.assertEqual(m.read(path),original);self.assertEqual(path.stat().st_mode&0o777,0o600)
 def test_parse_duplicate_manager_property_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'SHOW_SHAPE'):m.parse_show(b'Id=a\nId=b\n')
 def test_unproven_ownership_never_stops(self):
  with patch.object(m,'command')as run:
   with self.assertRaisesRegex(RuntimeError,'OWNERSHIP'):m.cleanup_unit({'unit':'anything'},None,Path('/unused'))
   run.assert_not_called()
 def test_wrong_invocation_never_stops(self):
  owned,_,unit,_,values=self.fixture();obs={'controlGroup':values['ControlGroup'],'invocationId':'d'*32,'device':1,'inode':2}
  with patch.object(m,'show',return_value=values),patch.object(m,'command')as run:
   with self.assertRaisesRegex(RuntimeError,'STOP_UNIT_IDENTITY'):m.cleanup_unit({'unit':unit},obs,owned)
   run.assert_not_called()
 def test_no_parent_controller_write_or_service_enable(self):
  source=(ROOT/'scripts/cn-exact-f0eb-unit.py').read_text();self.assertNotIn('subtree_control',source);self.assertNotIn("'enable'",source);self.assertNotIn('set-property',source)
 def test_github_gate_no_mac_execution(self):
  with patch.object(m.sys,'platform','darwin'):
   with self.assertRaisesRegex(RuntimeError,'GITHUB_UNIT_ONLY'):m.gate(Path('/unused'),'a'*40)
 def test_unknown_start_keeps_claim_and_never_redispatches(self):
  with tempfile.TemporaryDirectory()as d:
   owned=Path(d);folder=owned/'launch/scripts';folder.mkdir(parents=True);(folder/'cn-exact-f0eb-unit.py').write_text('fixture only')
   with patch.object(m,'gate'),patch.object(m,'command',return_value=('a'*40+'\n').encode())as git_commands,patch.dict(os.environ,{'GH_TOKEN':'synthetic','GITHUB_RUN_ID':'123'}),patch.object(m.subprocess,'Popen',side_effect=OSError('fixture unknown'))as start:
    with self.assertRaises(OSError):m.run(owned,'a'*40)
    self.assertEqual(start.call_count,1);self.assertTrue((owned/'unit-claim.json').exists());self.assertFalse(json.loads((owned/'unit-cleanup.json').read_bytes())['verified'])
    self.assertNotIn('GH_TOKEN',start.call_args.kwargs['env']);self.assertNotIn('synthetic',json.dumps(start.call_args.args[0]))
    # Root clones a runner-owned checkout. Trust only the exact worktree and
    # upload-pack's exact .git source; a wildcard would broaden this boundary.
    clone=git_commands.call_args_list[0].args[0]
    self.assertIn('clone',clone)
    self.assertEqual([x for x in clone if str(x).startswith('safe.directory=')],
                     ['safe.directory='+str(m.ROOT),'safe.directory='+str(m.ROOT/'.git')])
    self.assertIn('core.hooksPath=/dev/null',clone)
    self.assertIn('--no-hardlinks',clone)
    self.assertEqual(clone[-2:],[m.ROOT,owned/'launch'])
if __name__=='__main__':unittest.main()
