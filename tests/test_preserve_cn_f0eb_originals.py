import importlib.util,json,os,sys,tempfile,unittest,hashlib
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('preserve',Path(__file__).resolve().parents[1]/'scripts/preserve-cn-f0eb-originals.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def metadata(service='agent'):
 s=m.SPECS[service];return {'id':s['id'],'name':'cn-image-candidate-'+service+'-'+str(m.RUN)+'-1','size_in_bytes':s['zipBytes'],'digest':'sha256:'+s['zipSha256'],'expired':False,'created_at':'2026-10-11T14:12:39Z','expires_at':'2026-10-12T14:12:36Z','workflow_run':{'id':m.RUN,'head_sha':m.CONTROL,'repository_id':1000328649}}
class Preserve(unittest.TestCase):
 def test_metadata_exact_identity(self):
  value=metadata();self.assertEqual(m.validate_metadata(value,'agent')['expires_at'],value['expires_at'])
  for field,value2 in [('id',1),('name','wrong'),('expired',True),('digest','sha256:'+'0'*64),('size_in_bytes',1)]:
   bad=metadata();bad[field]=value2
   with self.assertRaises(RuntimeError):m.validate_metadata(bad,'agent')
 def test_producer_binding(self):
  for field,value in [('id',1),('head_sha','0'*40),('repository_id',1)]:
   bad=metadata();bad['workflow_run'][field]=value
   with self.assertRaises(RuntimeError):m.validate_metadata(bad,'agent')
 def test_bounded_stream(self):
  size,digest,raw=m.stream([sys.executable,'-c','print("abc",end="")'],3,2)
  self.assertEqual((size,digest,raw),(3,hashlib.sha256(b'abc').hexdigest(),b'abc'))
  with self.assertRaisesRegex(RuntimeError,'SIZE_LIMIT'):m.stream([sys.executable,'-c','print("x"*70000)'],8,2)
 def test_timeout_no_retry(self):
  with self.assertRaisesRegex(RuntimeError,'DEADLINE'):m.stream([sys.executable,'-c','import time;time.sleep(2)'],8,.05)
 def test_env_debug_removed(self):
  with patch.dict(os.environ,{'GH_DEBUG':'api','DEBUG':'*','GH_HOST':'foreign'}):
   env=m.safe_env();self.assertNotIn('GH_DEBUG',env);self.assertNotIn('DEBUG',env);self.assertEqual(env['GH_HOST'],'github.com')
 def test_not_mac_or_arbitrary_repo(self):
  with patch.dict(os.environ,{'GITHUB_ACTIONS':'false'}):
   with self.assertRaisesRegex(RuntimeError,'GITHUB_SCOPE'):m.validate_event(os.environ,{})
 def test_exact_same_repo_label_event(self):
  env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':m.REPO,'GITHUB_RUN_ATTEMPT':'1','GITHUB_EVENT_NAME':'pull_request','PRESERVE_CHECKOUT_SHA':'a'*40}
  value={'action':'labeled','label':{'name':m.LABEL},'pull_request':{'state':'open','head':{'repo':{'full_name':m.REPO},'ref':m.BRANCH,'sha':'a'*40},'base':{'repo':{'full_name':m.REPO},'ref':'main'}}}
  self.assertEqual(m.validate_event(env,value),'a'*40)
  import copy
  for change in ['synchronize','label','fork','branch','sha','retry']:
   bad=copy.deepcopy(value);e=dict(env)
   if change=='synchronize':bad['action']='synchronize'
   elif change=='label':bad['label']['name']='other'
   elif change=='fork':bad['pull_request']['head']['repo']['full_name']='other/workspacex'
   elif change=='branch':bad['pull_request']['head']['ref']='other'
   elif change=='sha':e['PRESERVE_CHECKOUT_SHA']='b'*40
   else:e['GITHUB_RUN_ATTEMPT']='2'
   with self.assertRaises(RuntimeError):m.validate_event(e,bad)
 def test_manual_main_only(self):
  e={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':m.REPO,'GITHUB_RUN_ATTEMPT':'1','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_REF':'refs/heads/main','GITHUB_SHA':'a'*40,'PRESERVE_CHECKOUT_SHA':'a'*40}
  self.assertEqual(m.validate_event(e,{}),'a'*40)
  with self.assertRaises(RuntimeError):m.validate_event({**e,'GITHUB_REF':'refs/heads/other'},{})
 def test_real_private_acquire_cleanup_original_bytes(self):
  with tempfile.TemporaryDirectory()as tmp:
   raw=b'original-zip-fixture';s={'id':1,'zipBytes':len(raw),'zipSha256':hashlib.sha256(raw).hexdigest()};target=Path(tmp)/'owned';output=Path(tmp)/'output';output.touch()
   def stream(command,limit,timeout,sink=None):
    self.assertTrue(command[-1].endswith('/zip'));sink.write(raw);return len(raw),hashlib.sha256(raw).hexdigest(),b''
   with patch.dict(m.SPECS,{'agent':s}),patch.object(m,'folder',return_value=target),patch.object(m,'metadata',return_value={'expires_at':'historical-unchanged'}),patch.object(m,'stream',side_effect=stream),patch.object(m.shutil,'which',return_value=sys.executable),patch.dict(os.environ,{'GITHUB_OUTPUT':str(output)}):
    m.acquire('agent');self.assertEqual((target/'original.zip').read_bytes(),raw);r=json.loads((target/'receipt.json').read_bytes());self.assertFalse(r['proofRefreshed']);self.assertFalse(r['productionReady']);self.assertEqual(r['originalMetadata']['expires_at'],'historical-unchanged')
    with self.assertRaises(FileExistsError):m.acquire('agent')
    m.cleanup('agent');self.assertFalse(target.exists())
 def test_workflow_scope(self):
  raw=(Path(__file__).resolve().parents[1]/'.github/workflows/preserve-cn-f0eb-originals.yml').read_text()
  self.assertIn('actions: read',raw);self.assertIn('max-parallel: 1',raw);self.assertIn('retention-days: 1',raw);self.assertNotIn('secrets.',raw);self.assertNotIn('docker',raw);self.assertNotIn('id-token:',raw);self.assertIn('types: [labeled]',raw);self.assertNotIn('synchronize',raw);self.assertIn('needs: preserve-plan',raw);self.assertIn('needs: preserve-set',raw);self.assertIn('ref: ${{ env.PRESERVE_CHECKOUT_SHA }}',raw)
if __name__=='__main__':unittest.main()
