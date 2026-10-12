import importlib.util,json,os,sys,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('exact_job',ROOT/'scripts/cn-exact-f0eb-github.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class ExactGithub(unittest.TestCase):
 def test_source_git_has_only_exact_cross_uid_checkout_trust(self):
  argv=m.source_git();values=[argv[i+1]for i,v in enumerate(argv[:-1])if v=='-c']
  self.assertEqual([v for v in values if v.startswith('safe.directory=')],['safe.directory='+str(ROOT),'safe.directory='+str(ROOT/'.git')])
  self.assertIn('core.hooksPath=/dev/null',values);self.assertNotIn('safe.directory=*',values)
 def test_exact_event_and_fork_branch_retry_rejection(self):
  env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':m.REPO,'GITHUB_EVENT_NAME':'pull_request','GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'12','EXACT_CHECKOUT_SHA':'a'*40}
  event={'action':'labeled','label':{'name':m.LABEL},'pull_request':{'state':'open','head':{'sha':'a'*40,'ref':m.BRANCH,'repo':{'full_name':m.REPO}},'base':{'ref':'main','repo':{'full_name':m.REPO}}}}
  with patch.object(m.sys,'platform','linux'):
   self.assertEqual(m.event_head(env,event),'a'*40)
   for kind in ('fork','branch','label','action','head','retry'):
    e=json.loads(json.dumps(event));v=dict(env)
    if kind=='fork':e['pull_request']['head']['repo']['full_name']='outside/repo'
    elif kind=='branch':e['pull_request']['head']['ref']='other'
    elif kind=='label':e['label']['name']='other'
    elif kind=='action':e['action']='synchronize'
    elif kind=='head':v['EXACT_CHECKOUT_SHA']='b'*40
    else:v['GITHUB_RUN_ATTEMPT']='2'
    with self.assertRaises(RuntimeError):m.event_head(v,e)
 def test_real_fixed_metadata_and_selection(self):
  pins=json.loads((ROOT/'tests/fixtures/cn-exact-candidate/preserved-wrappers.json').read_bytes())
  v=m.selection(pins,'a'*40);self.assertEqual(len(v['artifacts']),7);self.assertEqual(v['controlRevision'],'a'*40)
  for service,pin in pins['artifacts'].items():
   obj={**pin,'expired':False}
   with patch.object(m.datetime,'datetime',wraps=m.datetime.datetime)as clock:
    clock.now.return_value=m.datetime.datetime(2026,10,12,13,tzinfo=m.datetime.timezone.utc)
    self.assertEqual(m.metadata_pin(obj,pin),pin)
    for key in ('id','digest','workflow_run','size_in_bytes'):
     bad=dict(obj);bad[key]=None
     with self.assertRaises(RuntimeError):m.metadata_pin(bad,pin)
 def test_wrapper_expiry_is_real_clock_gate(self):
  pin=json.loads((ROOT/'tests/fixtures/cn-exact-candidate/preserved-wrappers.json').read_bytes())['artifacts']['plan'];pin['expires_at']='2000-01-01T00:00:00Z'
  with self.assertRaisesRegex(RuntimeError,'EXPIRED'):m.metadata_pin({**pin,'expired':False},pin)
 def test_worker_cannot_download_on_mac_or_nonroot(self):
  with patch.object(m.sys,'platform','darwin'),patch.object(m,'run')as run:
   with self.assertRaisesRegex(RuntimeError,'GITHUB_ROOT_WORKER_ONLY'):m.worker(Path('/var/lib/not-owned'),'a'*40)
   run.assert_not_called()
 def test_actual_stream_size_and_timeout_no_retry(self):
  size,h,raw=m.run([sys.executable,'-c','print("abc",end="")'],time.monotonic()+2,3)
  self.assertEqual((size,raw),(3,b'abc'))
  with self.assertRaisesRegex(RuntimeError,'SIZE_LIMIT'):m.run([sys.executable,'-c','print("x"*8000)'],time.monotonic()+2,7)
  with self.assertRaisesRegex(RuntimeError,'DEADLINE'):m.run([sys.executable,'-c','import time;time.sleep(3)'],time.monotonic()+.05,10)
 def test_actual_child_token_environment_is_explicit_only(self):
  argv=[sys.executable,'-c','import os,json;print(json.dumps([os.environ.get("GH_TOKEN"),os.environ.get("GITHUB_TOKEN")]))']
  with patch.dict(os.environ,{'GH_TOKEN':'synthetic-fixture-only','GITHUB_TOKEN':'synthetic-other-only'}):
   _,_,raw=m.run(argv,time.monotonic()+2);self.assertEqual(json.loads(raw),[None,None])
   self.assertEqual(os.environ['GH_TOKEN'],'synthetic-fixture-only')
   _,_,raw=m.run(argv,time.monotonic()+2,token=True);self.assertEqual(json.loads(raw),['synthetic-fixture-only','synthetic-other-only'])
 def test_unknown_load_is_retained_without_docker(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);(root/'load-claim.json').write_text('{}')
   with patch.object(m,'run')as run:
    result=m.cleanup_loaded(root,set(),time.monotonic()+1)
    self.assertFalse(result['verified']);run.assert_not_called();self.assertTrue((root/'load-claim.json').exists())
 def test_no_load_claim_no_daemon_operation(self):
  with tempfile.TemporaryDirectory()as td,patch.object(m,'run')as run:
   self.assertTrue(m.cleanup_loaded(Path(td),set(),time.monotonic()+1)['verified']);run.assert_not_called()
 def test_cleanup_refuses_preexisting_id_and_wrong_original_tag(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);(root/'set').mkdir()
   entries={x:{'stagingTag':'wsx-candidate-fixed/'+x+':'+'f'*40,'imageId':'sha256:'+'a'*64,'sha256':'b'*64}for x in ('agent','api','postgres','sandbox','web')}
   raw=json.dumps({'images':entries}).encode();(root/'set/candidate-set.json').write_bytes(raw)
   loaded={'exactImagesLoaded':True,'servicesStarted':False,'productionReady':False,'applicationRevision':m.preserve.SOURCE,'githubRunId':'12','images':{s:{'tag':e['stagingTag'],'daemonImageId':e['imageId'],'originalConfigId':e['imageId'],'originalTarSha256':e['sha256']}for s,e in entries.items()}}
   (root/'loaded.json').write_text(json.dumps(loaded))
   realsha=m.sha
   with patch.dict(os.environ,{'GITHUB_RUN_ID':'12'}),patch.object(m,'sha',side_effect=lambda b:'17dfdcc38f3d665b631cbeba001928856af6b9c9e4bda14e07abf72470bee193'if b==raw else realsha(b)),patch.object(m.shutil,'which',return_value='/usr/bin/docker'),patch.object(m,'run')as run:
    with self.assertRaisesRegex(RuntimeError,'PREEXISTING'):m.cleanup_loaded(root,{'sha256:'+'a'*64},time.monotonic()+1)
    run.assert_not_called()
    loaded['images']['agent']['tag']='foreign/tag';(root/'loaded.json').write_text(json.dumps(loaded))
    with self.assertRaisesRegex(RuntimeError,'FIXED_CANDIDATE_TAG'):m.cleanup_loaded(root,set(),time.monotonic()+1)
    run.assert_not_called()
 def test_report_whitelist_bounds(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);owned=root/'owned';report=root/'report';owned.mkdir();report.mkdir()
   (owned/'resources.json').write_text('{}');(owned/'credential.txt').write_text('must-not-export')
   m.copy_reports(owned,report);self.assertEqual({p.name for p in report.iterdir()},{'resources.json'})
 def test_workflow_readonly_label_no_service_start(self):
  raw=(ROOT/'.github/workflows/cn-exact-f0eb-preflight.yml').read_text()
  self.assertIn('types: [labeled]',raw);self.assertNotIn('synchronize',raw);self.assertIn('actions: read',raw);self.assertNotIn('secrets.',raw);self.assertNotIn('id-token:',raw)
  self.assertIn('persist-credentials: false',raw);self.assertIn('retention-days: 1',raw);self.assertNotIn('ubuntu-24.04-16core',raw)
  code=(ROOT/'scripts/cn-exact-f0eb-github.py').read_text();self.assertIn("os.environ.pop('GH_TOKEN'",code);self.assertNotIn("'systemctl'",code);self.assertNotIn("'prune'",code)
if __name__=='__main__':unittest.main()
