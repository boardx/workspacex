import importlib.util,io,json,os,subprocess,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(ROOT/'tests'))
import test_cn_image_candidate as fixtures
spec=importlib.util.spec_from_file_location('diagnostic',ROOT/'scripts/diagnose-cn-image-candidate.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
a=d.a
class Tests(unittest.TestCase):
 def setup_fixture(self,td):
  root=Path(td);p=fixtures.plan();data=b'FROM fixture\nRUN fixture\n'
  for v in p['sourceContracts'].values():v['dockerfileSha256']=a.sha(data)
  return root,p,data,{'EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main','GITHUB_SHA':p['controlRevision']}
 def command(self,p,data,calls,fail=False):
  def invoke(argv,cwd=None):
   calls.append(argv)
   if argv[:3]==['git','rev-parse','HEAD']:return d.c.SOURCE.encode()
   if argv[:2]==['git','show']:
    name=argv[2].split(':',1)[1]
    return (ROOT/name).read_bytes() if name.startswith(('scripts/','.github/')) else data
   if argv[:2]==['git','archive']:
    with tarfile.open(argv[argv.index('--output')+1],'w') as stream:
     entry=tarfile.TarInfo('fixture');entry.size=1;stream.addfile(entry,io.BytesIO(b'x'))
   if argv[:3]==['docker','buildx','build'] and fail:raise d.CommandFailure('DOCKER_BUILD','COMMAND_NONZERO',17)
   return b''
  return invoke
 def test_only_agent_build_then_stop_and_metadata_non_authorizing(self):
  with tempfile.TemporaryDirectory() as td:
   root,p,data,env=self.setup_fixture(td);calls=[]
   with patch.object(d.b,'control'),patch.object(d.shutil,'disk_usage',return_value=type('Space',(),{'free':10*1024**3})()):v=d.execute(a.json_bytes(p),root,root/'diagnostic.json',env,self.command(p,data,calls))
   docker=[x for x in calls if x[0]=='docker'];self.assertEqual(len(docker),1);self.assertEqual(docker[0][:3],['docker','buildx','build']);self.assertIn('--load',docker[0]);self.assertIn('--progress=plain',docker[0]);self.assertIn('PYTHON_IMAGE='+p['baseImages']['python'],docker[0]);self.assertFalse(v['productionReady']);self.assertFalse(v['rootCauseEstablished'])
 def test_manual_main_control_and_source_contract_fail_before_docker(self):
  for field,value,code in [('EVENT_NAME','push','DIAGNOSTIC_EVENT_REF'),('GITHUB_REF','refs/heads/branch','DIAGNOSTIC_EVENT_REF'),('GITHUB_SHA','0'*40,'DIAGNOSTIC_CONTROL_BINDING')]:
   with tempfile.TemporaryDirectory() as td:
    root,p,data,env=self.setup_fixture(td);env[field]=value;calls=[]
    with self.assertRaises(a.Rejected) as caught:d.execute(a.json_bytes(p),root,root/'out',env,self.command(p,data,calls))
    self.assertEqual(d.failure(caught.exception)['checkCode'],code);self.assertFalse(calls)
 def test_second_event_guard_and_failed_build_location(self):
  with tempfile.TemporaryDirectory() as td:
   root,p,data,env=self.setup_fixture(td);calls=[];invoke=self.command(p,data,calls)
   def mutate(argv,cwd=None):
    result=invoke(argv,cwd)
    if argv[:2]==['git','archive']:env['EVENT_NAME']='workflow_run'
    return result
   with patch.object(d.b,'control'),patch.object(d.shutil,'disk_usage',return_value=type('Space',(),{'free':20*1024**3})()):
    with self.assertRaises(a.Rejected):d.execute(a.json_bytes(p),root,root/'out',env,mutate)
   self.assertFalse(any(x[0]=='docker' for x in calls))
   env['EVENT_NAME']='workflow_dispatch'
   with patch.object(d.b,'control'),patch.object(d.shutil,'disk_usage',return_value=type('Space',(),{'free':20*1024**3})()):
    with self.assertRaises(d.CommandFailure) as caught:d.execute(a.json_bytes(p),root,root/'out',env,self.command(p,data,[],True))
   v=d.failure(caught.exception);self.assertEqual(v['phase'],'AGENT_BUILD');self.assertEqual(v['category'],'DOCKER_BUILD');self.assertEqual(v['returncode'],17)
 def test_hints_are_booleans_and_bounded_line_numbers_only(self):
  d.LINE_LIMIT=2;d.HINTS={};d.observe(b'SECRET no such host x509: unauthorized\nDockerfile:2\nDockerfile:3\nDockerfile:0\n')
  v=d.failure(ValueError('SECRET'));self.assertNotIn('SECRET',json.dumps(v));self.assertEqual(v['observedErrorHints']['dockerfileLines'],[2]);self.assertTrue(v['observedErrorHints']['dns']);self.assertFalse(v['rootCauseEstablished'])
 def test_actual_cli_failure_preserves_json_and_nonzero(self):
  with tempfile.TemporaryDirectory() as td:
   out=Path(td)/'diag.json';r=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/diagnose-cn-image-candidate.py'),'--source',td,'--output',str(out)],env={'PATH':os.environ['PATH'],'BUILD_PLAN':'SECRET','EVENT_NAME':'push'},capture_output=True)
   self.assertEqual(r.returncode,1);v=json.loads(out.read_bytes());self.assertEqual(v['checkCode'],'DIAGNOSTIC_EVENT_REF');self.assertNotIn(b'SECRET',r.stdout+r.stderr+out.read_bytes());self.assertLess(out.stat().st_size,16384)
 def test_source_contract_capacity_and_inode_reject_before_docker(self):
  for kind in ('contract','capacity','inodes'):
   with tempfile.TemporaryDirectory() as td:
    root,p,data,env=self.setup_fixture(td);calls=[]
    if kind=='contract':p['sourceContracts']['web']['dockerfileSha256']='0'*64
    free=10*1024**3-1 if kind=='capacity' else 20*1024**3
    inode=4095 if kind=='inodes' else 4096
    with patch.object(d.b,'control'),patch.object(d.shutil,'disk_usage',return_value=type('Space',(),{'free':free})()),patch.object(d.os,'statvfs',return_value=type('Nodes',(),{'f_favail':inode})()):
     with self.assertRaises(a.Rejected) as caught:d.execute(a.json_bytes(p),root,root/'out',env,self.command(p,data,calls))
    self.assertEqual(d.failure(caught.exception)['checkCode'],'CANDIDATE_DOCKERFILE_HASH' if kind=='contract' else 'DIAGNOSTIC_CAPACITY');self.assertFalse(any(x[0]=='docker' for x in calls))
 def test_main_preserves_command_returncode_and_redacts_arbitrary_errors(self):
  with tempfile.TemporaryDirectory() as td:
   out=Path(td)/'out'
   with patch.object(sys,'argv',['diagnostic','--source',td,'--output',str(out)]),patch.object(d,'execute',side_effect=d.CommandFailure('DOCKER_BUILD','COMMAND_NONZERO',17)),patch('sys.stdout',new=io.StringIO()):rc=d.main()
   self.assertEqual(rc,17);self.assertEqual(json.loads(out.read_bytes())['returncode'],17)
   self.assertNotIn('SECRET',json.dumps(d.failure(ValueError('SECRET'))))
 def test_child_environment_is_empty_home_and_empty_docker_config(self):
  d.DEADLINE=None
  code="import json,os,pathlib;print(json.dumps({'secretAbsent':'DIAG_SECRET' not in os.environ,'homeEmpty':set(pathlib.Path(os.environ['HOME']).iterdir())=={pathlib.Path(os.environ['DOCKER_CONFIG'])},'dockerEmpty':list(pathlib.Path(os.environ['DOCKER_CONFIG']).iterdir())==[]}))"
  with patch.dict(os.environ,{'DIAG_SECRET':'SECRET'}):v=json.loads(d.run([sys.executable,'-c',code]))
  self.assertEqual(v,{'secretAbsent':True,'homeEmpty':True,'dockerEmpty':True})
 def test_validator_rejects_secret_fields_wrong_hints_and_oversize(self):
  d.LINE_LIMIT=2;d.HINTS={};v=d.failure(ValueError())
  self.assertEqual(d.validate_metadata(a.json_bytes(v)),v)
  for bad in [dict(v,raw='SECRET'),dict(v,observedErrorHints={'dns':'SECRET'}),dict(v,observedErrorHints={'dockerfileLines':[3]}),dict(v,category='SECRET'),dict(v,phase='SECRET')]:
   with self.assertRaises(a.Rejected):d.validate_metadata(a.json_bytes(bad))
  with self.assertRaises(a.Rejected):d.validate_metadata(b' '*16385)
 def test_workflow_single_manual_job_and_metadata_only_always(self):
  text=(ROOT/'.github/workflows/diagnose-cn-image-candidate.yml').read_text()
  for wanted in ['workflow_dispatch:','refs/heads/main','runs-on: ubuntu-24.04','timeout-minutes: 25','if: always()','retention-days: 1',d.c.SOURCE]:self.assertIn(wanted,text)
  self.assertIn("if: always() && steps.validate_diagnostic.outcome == 'success'",text);self.assertIn('id: validate_diagnostic',text);self.assertIn('diagnostic.validate_metadata(p.read_bytes())',text)
  for forbidden in ['matrix:','continue-on-error','workflow_run:','id-token:','self-hosted','cache','*.tar','collector','--push']:self.assertNotIn(forbidden,text)
if __name__=='__main__':unittest.main()
