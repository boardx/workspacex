"""Ubuntu process-group and isolated full uploader fixtures; no network SDK."""
import datetime,hashlib,importlib,importlib.util,json,os,signal,subprocess,sys,tempfile,time,unittest,venv
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
t=importlib.import_module('test_performance'if(HERE/'test_performance.py').exists()else'test_cn_hk_performance')
u,b=t.u,t.b


class Orphan:
 def __init__(self,root,wait=False):self.root=root;self.wait=wait
 def __call__(self,name):
  child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'])
  (self.root/(name+'.pid')).write_text(str(child.pid))
  if self.wait:time.sleep(30)
  return {'ok':True}


class Linux(unittest.TestCase):
 def test_dead_leader_descendants_block_success_and_are_stopped(self):
  self.orphan(False)
 def test_deadline_stops_entire_group(self):
  self.orphan(True)
 def orphan(self,wait):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td)
   with self.assertRaises(b.TransferStopped):b.run(['a'],Orphan(root,wait),1)
   for p in root.glob('*.pid'):
    stat=Path('/proc')/p.read_text()/'stat'
    self.assertTrue(not stat.exists()or stat.read_text().rsplit(')',1)[1].split()[0]in('Z','X'))
 def test_full_isolated_uploader_nine_objects_no_network(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);code=root/'code';code.mkdir();bin=root/'bin';bin.mkdir();store=root/'store';store.mkdir()
   venv.EnvBuilder(with_pip=False).create(root/'venv');python=root/'venv/bin/python'
   site=Path(subprocess.check_output([str(python),'-I','-c','import site; print(site.getsitepackages()[0])'],text=True).strip())
   (site/'requests').mkdir();(site/'requests/__init__.py').write_text('')
   (site/'requests/adapters.py').write_text('class HTTPAdapter:\n def __init__(self,**kw): assert kw=={"max_retries":0}\n')
   (site/'oss2.py').write_text('''import os,types,pathlib,io
defaults=types.SimpleNamespace(request_retries=None)
class StsAuth:
 def __init__(self,*args): pass
class HTTP:
 def mount(self,*a): pass
 def request(self,method,url,**kw):
  assert self.trust_env is False and kw['verify'] is True and kw['allow_redirects'] is False and kw['proxies']=={}
 def send(self,*a,**kw): pass
class Session:
 def __init__(self): self.session=HTTP()
class Bucket:
 def __init__(self,auth,endpoint,name,connect_timeout,session):
  assert defaults.request_retries==0 and connect_timeout==30
  self.name=name;self.http=session.session;self.root=pathlib.Path(os.environ['FAKE_STORE'])
 def get_bucket_info(self):
  self.http.request('GET','https://'+self.name+'.oss-cn-hongkong.aliyuncs.com/')
  return types.SimpleNamespace(name=self.name,location='oss-cn-hongkong',owner=types.SimpleNamespace(id='1177216024653153'))
 def get_bucket_acl(self): return types.SimpleNamespace(acl='private')
 def put_object(self,key,stream,headers):
  assert headers=={'x-oss-forbid-overwrite':'true'}
  self.http.request('PUT','https://'+self.name+'.oss-cn-hongkong.aliyuncs.com/'+key)
  with (self.root/key.rsplit('/',1)[-1]).open('xb') as f: f.write(stream.read())
  return types.SimpleNamespace(status=200)
 def get_object(self,key):
  self.http.request('GET','https://'+self.name+'.oss-cn-hongkong.aliyuncs.com/'+key)
  name=key.rsplit('/',1)[-1];data=(self.root/name).read_bytes()
  (self.root/(name+'.get')).write_text('complete')
  return io.BytesIO(data)
''')
   uploader=code/'cn-hk-original-artifact-upload.py';uploader.write_bytes(Path(u.__file__).read_bytes());(code/'bounded_workers.py').write_bytes(Path(b.__file__).read_bytes())
   proof=code/'cn-hk-generate-proof.py';proof.write_text('''import json,pathlib,sys,os
out=pathlib.Path(sys.argv[sys.argv.index('--output')+1]);out.mkdir();store=pathlib.Path(os.environ['FAKE_STORE'])
assert len(list(store.glob('*.zip.get')))==7
p=out/'proof.json';q=out/'policy.json';p.write_text('{}');q.write_text('{}')
print(json.dumps({'proofPath':str(p),'policyPath':str(q)}))
''')
   original=(HERE/'transfer-plan.UNBOUND.json')if(HERE/'transfer-plan.UNBOUND.json').exists()else HERE.parent/'.github/release-plans/hk-original-artifacts.json'
   plan=json.loads(original.read_bytes());plan['expiresAt']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=5)).isoformat()
   for item in plan['artifacts'].values():item['bytes']=4;item['sha256']=u.sha(b'data')
   plan['uploaderFiles']={n:u.sha((code/n).read_bytes())for n in ('cn-hk-original-artifact-upload.py','bounded_workers.py','cn-hk-generate-proof.py')}
   raw=json.dumps(plan).encode();(root/'plan.json').write_bytes(raw)
   catalog={f'/repos/{u.REPO}/actions/runs/{u.RUN}/attempts/1':dict(id=u.RUN,head_sha=u.CONTROL,conclusion='success',status='completed')}
   for name,item in plan['artifacts'].items():
    expected=f'cn-candidate-plan-{u.RUN}-1'if name=='plan'else f'cn-image-candidate-set-{u.RUN}-1'if name=='set'else f'cn-image-candidate-{name}-{u.RUN}-1'
    catalog[f'/repos/{u.REPO}/actions/artifacts/{item["id"]}']=dict(id=item['id'],name=expected,expired=False,size_in_bytes=4,digest='sha256:'+item['sha256'],workflow_run={'id':u.RUN,'head_sha':u.CONTROL})
   gh=bin/'gh';gh.write_text('#!'+sys.executable+'\nimport sys,json\ncatalog='+repr(catalog)+'\np=sys.argv[-1]\nsys.stdout.buffer.write(b"data"if p.endswith("/zip")else json.dumps(catalog[p]).encode())\n');gh.chmod(0o700)
   env={**os.environ,'PATH':str(bin)+':'+os.environ['PATH'],'FAKE_STORE':str(store),'REVIEWED_ROLE_ARN':plan['uploaderRoleArn'],'REVIEWED_OIDC_SUBJECT':plan['subject'],'REVIEWED_PROVIDER_ARN':plan['oidcProviderArn'],'ALIBABA_CLOUD_ACCESS_KEY_ID':'fixture','ALIBABA_CLOUD_ACCESS_KEY_SECRET':'fixture','ALIBABA_CLOUD_SECURITY_TOKEN':'fixture'}
   result=subprocess.run([str(python),'-I','-B',str(uploader),'--plan',str(root/'plan.json'),'--plan-sha256',u.sha(raw),'--output',str(root/'output')],env=env,capture_output=True,timeout=20)
   self.assertEqual(result.returncode,0,result.stdout.decode()+result.stderr.decode());receipt=json.loads((root/'output/receipt.json').read_bytes())
   self.assertEqual(len(receipt['objects']),9);self.assertEqual(len(list(store.glob('*.get'))),9)
   self.assertEqual(len(list((root/'output').glob('*.put-intent.json'))),9)
   self.assertFalse(receipt['productionReady'])
   # Immutable helper drift rejects before fake SDK object write.
   (code/'bounded_workers.py').write_text('raise RuntimeError("UNTRUSTED")')
   result=subprocess.run([str(python),'-I','-B',str(uploader),'--plan',str(root/'plan.json'),'--plan-sha256',u.sha(raw),'--output',str(root/'other')],env=env,capture_output=True,timeout=5)
   self.assertNotEqual(result.returncode,0);self.assertFalse((root/'other').exists())

if __name__=='__main__':
 if sys.platform!='linux':print('LINUX_REQUIRED; not a passing skip');sys.exit(2)
 unittest.main()
