import importlib.util,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('simulation',ROOT/'scripts/cn-release-simulation.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class FixtureDomain:
 # Runner unit tests use a process-group fixture; real cgroup ownership and
 # setsid containment belong to the separately mandatory Linux integration.
 def spawn(self,command,**kwargs):return subprocess.Popen(command,**kwargs)
 def close(self,process):
  import signal
  if process is not None:
   try:os.killpg(process.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   process.wait()
  return {'verified':True,'fixtureOnly':True}
class SimulationTests(unittest.TestCase):
 def test_full_control_recovery_is_independent_linux_heavy_suite(self):
  name='linux-application-recovery-complete'
  self.assertEqual(m.SUITES[name],['cn_release_application_recovery_complete_linux.py'])
  self.assertIn(name,m.HEAVY_SUITES)
  self.assertEqual(m.DOCKER_SUITE_REGISTRIES[name],'application-recovery-complete-owner')
  self.assertEqual(len(set(m.DOCKER_SUITE_REGISTRIES.values())),3)
  self.assertEqual(m.EXPORT_NESTED_FILES['application-recovery-complete-owner'],m.EXPORT_REGISTRY_FILES)
  with tempfile.TemporaryDirectory()as td,patch.object(m.platform,'system',return_value='Darwin'):
   with self.assertRaisesRegex(RuntimeError,'LINUX_REQUIRED'):m.child(name,Path(td)/'result.json')
 def test_new_linux_suites_have_distinct_real_child_interfaces_and_budgets(self):
  self.assertEqual(len(m.SUITES),28)
  self.assertEqual(m.SUITES['linux-fsync'],['cn_release_fsync_linux.py'])
  self.assertEqual(m.SUITES['linux-fsync-entry'],['cn_release_fsync_entry_linux.py'])
  import contextlib,io
  for name,seconds in [('linux-fsync-entry',90),('linux-application-recovery-complete',800)]:
   seen=[]
   def execute(suite,command,output,env,budget):
    seen.append((suite,budget));return dict(suite=suite,status='passed',exitCode=0,statistics=self.stats())
   with tempfile.TemporaryDirectory()as td,patch.object(m,'execute',execute),patch.object(m.subprocess,'check_output',side_effect=lambda cmd,**kw:'a'*40+'\n'if 'rev-parse'in cmd else ''),patch.object(sys,'argv',['simulation','--output',str(Path(td)/'out'),'--suite',name]):
    with contextlib.redirect_stdout(io.StringIO()):m.main()
   self.assertEqual(seen,[(name,seconds)])
 def run_case(self,body,seconds=2,limit=4096):
  with tempfile.TemporaryDirectory()as d:
   output=Path(d);env=m.environment(output)
   command=[sys.executable,'-I','-B','-c',body,str(output/'fixture.tests.json')]
   with patch.object(m,'domain_factory',return_value=FixtureDomain()):result=m.execute('fixture',command,output,env,seconds,limit)
   return result,(output/'fixture.log').read_bytes()
 def stats(self):return {'tests':2,'failures':0,'errors':0,'skipped':0,'expectedFailures':0,'unexpectedSuccesses':0}
 def test_real_child_success_and_stats(self):
  body='import json,sys;from pathlib import Path;Path(sys.argv[1]).write_text('+repr(json.dumps(self.stats()))+');print("fixture-executed")'
  value,raw=self.run_case(body);self.assertEqual(value['status'],'passed');self.assertEqual(value['exitCode'],0);self.assertEqual(value['statistics'],self.stats());self.assertIn(b'fixture-executed',raw)
 def test_nonzero_cannot_be_hidden_by_passing_stats(self):
  body='import sys;from pathlib import Path;Path(sys.argv[1]).write_text('+repr(json.dumps(self.stats()))+');sys.exit(7)'
  value,_=self.run_case(body);self.assertEqual(value['status'],'failed');self.assertEqual(value['exitCode'],7)
 def test_empty_or_missing_stats_fail_closed(self):
  value,_=self.run_case('print("no tests")');self.assertEqual(value['status'],'failed')
  stats=self.stats();stats['tests']=0
  value,_=self.run_case('import sys;from pathlib import Path;Path(sys.argv[1]).write_text('+repr(json.dumps(stats))+')');self.assertEqual(value['status'],'failed')
 def test_timeout_stops_real_process(self):
  value,_=self.run_case('import time;time.sleep(10)',seconds=.1);self.assertEqual(value['status'],'failed');self.assertEqual(value['reason'],'timeout');self.assertLess(value['durationSeconds'],2)
 def test_log_limit_is_streamed_and_bounded(self):
  value,raw=self.run_case('import os,time;os.write(1,b"x"*10000);time.sleep(10)',limit=1000);self.assertEqual(value['reason'],'log-limit');self.assertLessEqual(len(raw),1000)
 def test_environment_omits_cloud_and_github_credentials(self):
  with tempfile.TemporaryDirectory()as d,patch.dict(os.environ,{'GH_TOKEN':'synthetic','ALIBABA_CLOUD_ACCESS_KEY_SECRET':'synthetic','AWS_SECRET_ACCESS_KEY':'synthetic','GITHUB_TOKEN':'synthetic'}):
   env=m.environment(Path(d));self.assertFalse(set(env)&{'GH_TOKEN','GITHUB_TOKEN','ALIBABA_CLOUD_ACCESS_KEY_SECRET','AWS_SECRET_ACCESS_KEY'});self.assertEqual(env['HOME'],str(Path(d)/'home'))
 def test_fixed_suites_reference_existing_production_test_files(self):
  for suite,patterns in m.SUITES.items():
   for pattern in patterns:self.assertTrue(list((ROOT/'tests').glob(pattern)),(suite,pattern))
 def test_cli_rejects_existing_output_without_running_tests(self):
  with tempfile.TemporaryDirectory()as d:
   result=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/cn-release-simulation.py'),'--output',d],capture_output=True,timeout=10)
   self.assertNotEqual(result.returncode,0);self.assertEqual(list(Path(d).iterdir()),[])
 def test_workflow_no_production_auth_and_always_evidence(self):
  text=(ROOT/'.github/workflows/cn-release-simulation.yml').read_text()
  for forbidden in ('id-token:','environment:','secrets.','production-cn','workflow_run:'):self.assertNotIn(forbidden,text)
  self.assertEqual(text.count('sudo -n env -i'),2);self.assertIn('scripts/cn-release-simulation-ci.py --sha "$GITHUB_SHA"',text)
  self.assertIn('if: always()',text);self.assertIn('persist-credentials: false',text)
 def test_targeted_heavy_contracts_have_independent_matrix_jobs(self):
  text=(ROOT/'.github/workflows/cn-release-simulation.yml').read_text()
  self.assertIn("options: ['all', 'release', 'targeted', 'linux-application-recovery-complete', 'linux-six-business', 'linux-boundary-reap']",text)
  self.assertIn('fail-fast: false',text)
  self.assertIn('if [ \"$LANE\" != all ] && [ \"$ROUNDS\" = 10 ]; then',text)
  self.assertIn('*) echo CI_FIXED_LANE_REQUIRED >&2; exit 1',text)
  matrix=next(line for line in text.splitlines()if 'suite: ${{ fromJSON('in line)
  self.assertIn("inputs.lane == 'release' && '[\"release\"]'",matrix)
  self.assertIn('case "$LANE" in all|release|targeted|',text)
  self.assertIn("inputs.lane == 'targeted'",matrix)
  self.assertIn("inputs.lane == 'linux-boundary-reap' && '[\"linux-boundary-reap\"]'",matrix)
  for suite in ('release','linux-api-outer-recovery','linux-application-recovery-complete','linux-six-business'):self.assertIn('"'+suite+'"',matrix)
  self.assertIn("|| '[\"all\"]'",matrix)
  self.assertIn('--suite "$SUITE" --workers "$WORKERS"',text)
  self.assertIn("matrix.suite == 'all' && '3' || '1'",text)
  self.assertIn('${{ github.run_attempt }}-${{ matrix.suite }}',text)
 def test_ten_rounds_fixed_commit_distinct_seed_and_output(self):
  seen=[]
  def execute(name,command,output,env,seconds):
   seen.append((str(output),env['CN_RELEASE_SIMULATION_SEED']))
   return dict(suite=name,status='passed',exitCode=0,statistics=self.stats())
  with tempfile.TemporaryDirectory()as d,patch.object(m,'execute',execute),patch.object(m.subprocess,'check_output',side_effect=lambda cmd,**kw:'a'*40+'\n'if 'rev-parse'in cmd else ''),patch.object(sys,'argv',['simulation','--output',str(Path(d)/'out'),'--rounds','10','--seed','42']):
   import contextlib,io
   with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(m.main(),1)
   summary=json.loads((Path(d)/'out/summary.json').read_text())
   self.assertEqual(summary['testsStatus'],'passed');self.assertEqual(summary['exitStatus'],'blocked')
   self.assertEqual(summary['completedRounds'],10);self.assertEqual({r['commit']for r in summary['rounds']},{'a'*40});self.assertEqual([r['seed']for r in summary['rounds']],list(range(42,52)))
   self.assertEqual(len({path for path,seed in seen}),10);self.assertEqual(len(seen),10*len(m.SUITES))
 def test_ten_rounds_dirty_tree_is_rejected(self):
  with tempfile.TemporaryDirectory()as d,patch.object(m,'execute')as execute,patch.object(m.subprocess,'check_output',side_effect=lambda cmd,**kw:'a'*40+'\n'if 'rev-parse'in cmd else ' M scripts/changed.py'),patch.object(sys,'argv',['simulation','--output',str(Path(d)/'out'),'--rounds','10']):
   with self.assertRaisesRegex(ValueError,'CLEAN_FIXED_COMMIT'):m.main()
   execute.assert_not_called()
 def test_failure_keeps_round_evidence_and_stops_next_round(self):
  def failed(name,command,output,env,seconds):return dict(suite=name,status='failed',exitCode=1,statistics=self.stats())
  with tempfile.TemporaryDirectory()as d,patch.object(m,'execute',failed),patch.object(m.subprocess,'check_output',side_effect=lambda cmd,**kw:'a'*40+'\n'if 'rev-parse'in cmd else ''),patch.object(sys,'argv',['simulation','--output',str(Path(d)/'out'),'--rounds','10']):
   import contextlib,io
   with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(m.main(),1)
   summary=json.loads((Path(d)/'out/summary.json').read_text());self.assertEqual(summary['completedRounds'],1);self.assertEqual(summary['requestedRounds'],10);self.assertEqual(summary['status'],'failed');self.assertTrue((Path(d)/'out/round-01/round.json').is_file())
 def test_skip_and_expected_failure_cannot_report_green(self):
  for key in ('skipped','expectedFailures'):
   stats=self.stats();stats[key]=1
   value,_=self.run_case('import sys;from pathlib import Path;Path(sys.argv[1]).write_text('+repr(json.dumps(stats))+')')
   self.assertEqual(value['status'],'failed')
 def test_linux_suite_requires_real_linux(self):
  with tempfile.TemporaryDirectory()as d,patch.object(m.platform,'system',return_value='Darwin'):
   with self.assertRaisesRegex(RuntimeError,'LINUX_REQUIRED'):m.child('linux-process',Path(d)/'result.json')
 def test_case_inventory_keeps_skipped_and_failures(self):
  class Cases(unittest.TestCase):
   def test_pass(self):pass
   @unittest.skip('fixture unavailable')
   def test_skip(self):pass
   def test_fail(self):self.fail('intentional fixture failure')
  with tempfile.TemporaryDirectory()as d,patch.object(m.unittest.TestLoader,'discover',return_value=unittest.defaultTestLoader.loadTestsFromTestCase(Cases)):
   import contextlib,io
   path=Path(d)/'fixture.tests.json'
   with contextlib.redirect_stderr(io.StringIO()):self.assertEqual(m.child('release',path),1)
   cases=json.loads(path.with_suffix('.cases.json').read_text());self.assertEqual({v['status']for v in cases},{'pass','fail','skip'})
   self.assertEqual(len(json.loads(path.with_suffix('.inventory.json').read_text())),3)
 def test_reports_derive_csv_from_json_and_unknown_is_null(self):
  with tempfile.TemporaryDirectory()as d:
   out=Path(d);value={'commit':'a'*40,'githubRunId':None,'finishedAt':'fixture-time','rounds':[{'roundId':'01','durationSeconds':1.5,'finishedAt':'fixture-time','suites':[]}],'requestedRounds':1,'completedRounds':1,'status':'passed','integrationGaps':[]}
   m.quantify(value,out);self.assertIsNone(next(v['value']for v in value['metrics']if v['name']=='artifactBytes'))
   self.assertFalse(value['acceptanceGates']['accepted']);self.assertFalse(value['acceptanceGates']['fullMatrixCoverage'])
   m.write_json(out/'summary.json',value);m.render_reports(out)
   import csv
   rows=list(csv.DictReader((out/'metrics.csv').read_text().splitlines()));self.assertEqual(next(v['value']for v in rows if v['name']=='artifactBytes'),'')
   self.assertIn('Production accepted: false',(out/'report.txt').read_text())

 def test_missing_cleanup_proof_blocks_success(self):
  class Unproven(FixtureDomain):
   def close(self,p):super().close(p);return {'verified':False}
  with tempfile.TemporaryDirectory()as d,patch.object(m,'domain_factory',return_value=Unproven()):
   out=Path(d);command=[sys.executable,'-I','-B','-c','import sys;from pathlib import Path;Path(sys.argv[1]).write_text('+repr(json.dumps(self.stats()))+')',str(out/'fixture.tests.json')]
   value=m.execute('fixture',command,out,m.environment(out),2)
   self.assertEqual(value['status'],'failed');self.assertFalse(value['cleanup']['verified'])
 def test_unavailable_isolation_blocks_before_spawn(self):
  with tempfile.TemporaryDirectory()as d,patch.object(m,'domain_factory',side_effect=RuntimeError('unsupported')):
   out=Path(d);value=m.execute('fixture',[sys.executable,'-c','raise SystemExit(0)'],out,m.environment(out),2)
   self.assertEqual(value['status'],'failed');self.assertIsNone(value['exitCode']);self.assertIsNone(value['cleanup'])

 def test_report_export_keeps_home_private_and_reports_readable(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);source=root/'cn-simulation';target=root/'cn-simulation-artifacts'
   source.mkdir(mode=0o700);target.mkdir(mode=0o700);(source/'home').mkdir(mode=0o700)
   (source/'home/secret').write_text('fixture secret');(source/'summary.json').write_text('{}')
   (source/'round-01').mkdir(mode=0o700);(source/'round-01/release.log').write_text('evidence')
   result=m.export_reports(root);self.assertEqual(result['files'],2);self.assertEqual((target/'summary.json').read_bytes(),b'{}');self.assertFalse((target/'home').exists())
   import stat
   self.assertEqual(stat.S_IMODE(source.stat().st_mode),0o700)
   self.assertEqual((target/'summary.json').stat().st_uid,target.stat().st_uid)
   self.assertEqual(stat.S_IMODE((target/'summary.json').stat().st_mode),0o600)
 def test_heavy_suites_share_one_slot_while_light_suite_can_progress(self):
  import concurrent.futures,threading,time,contextlib,io
  active=0;peak=0;lock=threading.Lock();heavy_started=threading.Event();light_seen=threading.Event()
  def fake(name):
   nonlocal active,peak
   if name in m.HEAVY_SUITES:
    with lock:active+=1;peak=max(peak,active)
    heavy_started.set();light_seen.wait(1);time.sleep(.02)
    with lock:active-=1
   else:
    heavy_started.wait(1);light_seen.set()
   return {'suite':name,'status':'passed'}
  output=io.StringIO()
  with contextlib.redirect_stdout(output),patch.object(m,'execute',side_effect=fake),concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:
   jobs=[pool.submit(m.scheduled_execute,n)for n in ('linux-api-startup','linux-six-business','release')]
   self.assertEqual([j.result(timeout=2)['suite']for j in jobs],['linux-api-startup','linux-six-business','release'])
  self.assertEqual(peak,1);self.assertTrue(light_seen.is_set())
  events=[json.loads(line)for line in output.getvalue().splitlines()]
  for name in ('linux-api-startup','linux-six-business','release'):
   self.assertEqual([e['phase']for e in events if e['simulationSuite']==name],['started','finished'])
  self.assertTrue(all(set(e)<= {'simulationSuite','phase','status'} for e in events))
 def test_report_export_all_ten_rounds_fixed_inventory(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);source=root/'cn-simulation';target=root/'cn-simulation-artifacts';source.mkdir(mode=0o700);target.mkdir(mode=0o700)
   top=m.EXPORT_TOP_FILES
   suffixes=('.log','.tests.json','.tests.inventory.json','.tests.cases.json')
   registry=('owner.json','api-create-intent.json','api-create-receipt.json','cleanup.json')
   for name in top:(source/name).write_bytes(b'')
   for index in range(1,11):
    rd=source/('round-%02d'%index);rd.mkdir(mode=0o700);(rd/'round.json').write_bytes(b'')
    for suite in m.SUITES:
     for suffix in suffixes:(rd/(suite+suffix)).write_bytes(b'')
    for directory,files in m.EXPORT_NESTED_FILES.items():
     owned=rd/directory;owned.mkdir(mode=0o700)
     for name in files:(owned/name).write_bytes(b'')
    (rd/'unapproved.log').write_text('not exported')
   extra=source/'round-11';extra.mkdir();(extra/'round.json').write_text('not exported')
   result=m.export_reports(root);expected=len(top)+10*(1+len(m.SUITES)*len(suffixes)+sum(map(len,m.EXPORT_NESTED_FILES.values())))
   self.assertGreater(expected,500);self.assertEqual(result['files'],expected);self.assertEqual(result['bytes'],0)
   self.assertEqual(len([p for p in target.rglob('*')if p.is_file()]),expected)
   self.assertFalse((target/'round-11').exists());self.assertFalse((target/'round-01/unapproved.log').exists())
 def test_report_export_rejects_symlink_and_does_not_overwrite(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);source=root/'cn-simulation';target=root/'cn-simulation-artifacts';source.mkdir(mode=0o700);target.mkdir(mode=0o700)
   secret=root/'private';secret.write_text('must not export');(source/'summary.json').symlink_to(secret)
   with self.assertRaises(OSError):m.export_reports(root)
   self.assertFalse((target/'summary.json').exists())
   (source/'summary.json').unlink();(source/'summary.json').write_text('{}');m.export_reports(root)
   with self.assertRaises(FileExistsError):m.export_reports(root)
 def test_report_export_refuses_oversize_without_reading_body(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);source=root/'cn-simulation';source.mkdir(mode=0o700);(root/'cn-simulation-artifacts').mkdir(mode=0o700)
   with (source/'summary.json').open('wb')as f:f.truncate(16*1024*1024+1)
   with self.assertRaisesRegex(ValueError,'FILE_REJECTED'):m.export_reports(root)

 def test_one_dirty_round_does_not_claim_fixed_source(self):
  def execute(name,command,output,env,seconds):return dict(suite=name,status='passed',exitCode=0,statistics=self.stats())
  with tempfile.TemporaryDirectory()as d,patch.object(m,'execute',execute),patch.object(m.subprocess,'check_output',side_effect=lambda cmd,**kw:'a'*40+'\n'if 'rev-parse'in cmd else '?? tests/new_case.py'),patch.object(sys,'argv',['simulation','--output',str(Path(d)/'out')]):
   import contextlib,io
   with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(m.main(),1)
   value=json.loads((Path(d)/'out/summary.json').read_text());self.assertFalse(value['rounds'][0]['sourceUnchanged']);self.assertTrue(value['trackedChanges'])
 def test_export_permission_contract_with_cross_uid_on_root_linux(self):
  with tempfile.TemporaryDirectory()as d:
   root=Path(d);root.chmod(0o755);source=root/'cn-simulation';target=root/'cn-simulation-artifacts';source.mkdir(mode=0o700);target.mkdir(mode=0o700)
   (source/'summary.json').write_text('public fixture report');(source/'home').mkdir(mode=0o700);(source/'home/private').write_text('fixture private')
   cross_uid=sys.platform=='linux' and os.geteuid()==0
   if cross_uid:
    os.chown(target,65534,65534)
    probe='import os,sys;os.setgroups([]);os.setgid(65534);os.setuid(65534);print(open(sys.argv[1]).read())'
    before=subprocess.run([sys.executable,'-I','-B','-c',probe,str(source/'summary.json')],capture_output=True)
    self.assertNotEqual(before.returncode,0)
   m.export_reports(root)
   self.assertEqual((target/'summary.json').stat().st_uid,target.stat().st_uid);self.assertFalse((target/'home').exists())
   if cross_uid:
    after=subprocess.run([sys.executable,'-I','-B','-c',probe,str(target/'summary.json')],capture_output=True)
    self.assertEqual(after.returncode,0,after.stderr);self.assertIn(b'public fixture report',after.stdout)
    still_private=subprocess.run([sys.executable,'-I','-B','-c',probe,str(source/'home/private')],capture_output=True)
    self.assertNotEqual(still_private.returncode,0)
 def test_subtest_skip_cannot_be_reported_as_pass(self):
  class Cases(unittest.TestCase):
   def test_subcase(self):
    with self.subTest(fixture='skip'):self.skipTest('fixture unavailable')
  with tempfile.TemporaryDirectory()as d,patch.object(m.unittest.TestLoader,'discover',return_value=unittest.defaultTestLoader.loadTestsFromTestCase(Cases)):
   import contextlib,io
   path=Path(d)/'fixture.tests.json'
   with contextlib.redirect_stderr(io.StringIO()):self.assertEqual(m.child('release',path),1)
   cases=json.loads(path.with_suffix('.cases.json').read_text());self.assertEqual(cases[0]['status'],'skip')

 def test_real_acquire_help_import_does_not_pollute_checkout(self):
  import shutil
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);scripts=root/'scripts';scripts.mkdir()
   for name in ('cn-release-continuation-acquire.py','cn-release-continuation-bind.py'):shutil.copyfile(ROOT/'scripts'/name,scripts/name)
   target=str(scripts/'cn-release-continuation-acquire.py')
   code='import sys,runpy;sys.pycache_prefix=None;sys.argv=[sys.argv[1],"--help"];runpy.run_path(sys.argv[0],run_name="__main__")'
   env={'PATH':os.defpath,'HOME':str(root),'LANG':'C.UTF-8'}
   before=subprocess.run([sys.executable,'-c',code,target],env=env,capture_output=True,timeout=5)
   self.assertEqual(before.returncode,0,before.stderr);cache=scripts/'__pycache__';self.assertTrue(list(cache.glob('cn-release-continuation-bind.*.pyc')))
   shutil.rmtree(cache)
   fixed=subprocess.run([sys.executable,'-I','-B',target,'--help'],env=env,capture_output=True,timeout=5)
   self.assertEqual(fixed.returncode,0,fixed.stderr);self.assertFalse(cache.exists())
   inherited=m.environment(root);self.assertEqual(inherited['PYTHONDONTWRITEBYTECODE'],'1')
   child=subprocess.run([sys.executable,'-c',code,target],env=inherited,capture_output=True,timeout=5)
   self.assertEqual(child.returncode,0,child.stderr);self.assertFalse(cache.exists())
 def test_nested_domain_import_explicit_flag_prevents_bytecode(self):
  import ast,shutil
  tree=ast.parse((ROOT/'tests/cn_release_simulation_domain_linux.py').read_text())
  nested=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='nested_case')
  parents=[ast.literal_eval(n.value) for n in ast.walk(nested) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='parent' for t in n.targets)]
  # Select the Domain branch explicitly; the legacy-entry branch imports a
  # different module. Keep the actual before/after bytecode experiment below.
  domain_parents=[value for value in parents if 'd=m.Domain();' in value]
  self.assertEqual(len(domain_parents),1)
  parent=domain_parents[0]
  spawn=next(n for n in ast.walk(nested) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='spawn' and isinstance(n.func.value,ast.Name) and n.func.value.id=='outer')
  flags=[ast.literal_eval(n) for n in spawn.args[0].elts[1:] if isinstance(n,ast.Constant)]
  self.assertEqual(flags,['-I','-B','-c'])
  # Exercise the exact import prefix without requiring Linux cgroup access.
  code='import sys;sys.pycache_prefix=None\n'+parent.split('d=m.Domain();',1)[0]
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);target=root/'cn_release_simulation_domain.py';shutil.copyfile(ROOT/'scripts'/target.name,target)
   env={'PATH':os.defpath,'HOME':td}
   # Apple's patched Python may disable bytecode for -I by default; make
   # the vulnerable baseline explicit, without changing the fixed child.
   before=subprocess.run([sys.executable,'-I','-c','import sys;sys.dont_write_bytecode=False\n'+code,str(target)],env=env,capture_output=True,timeout=5)
   self.assertEqual(before.returncode,0,before.stderr);cache=root/'__pycache__';self.assertTrue(list(cache.glob('cn_release_simulation_domain.*.pyc')))
   shutil.rmtree(cache)
   env['PYTHONDONTWRITEBYTECODE']='1'
   after=subprocess.run([sys.executable,*flags,code,str(target)],env=env,capture_output=True,timeout=5)
   self.assertEqual(after.returncode,0,after.stderr);self.assertFalse(cache.exists())
 def test_source_status_is_bounded_redacted_and_never_excludes_cache(self):
  raw='?? scripts/__pycache__/module.pyc\n?? bad path-with-control\tvalue\n'+''.join('?? tests/extra%d.py\n'%i for i in range(100))
  state=m.status_snapshot(raw);self.assertTrue(state['dirty']);self.assertTrue(state['truncated']);self.assertEqual(state['entryCount'],102);self.assertEqual(len(state['entries']),64)
  self.assertEqual(state['entries'][0]['path'],'scripts/__pycache__/module.pyc');self.assertTrue(state['entries'][1]['path'].startswith('<redacted:'));self.assertNotIn('control',json.dumps(state))

if __name__=='__main__':unittest.main()
