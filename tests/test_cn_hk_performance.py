import io,json,multiprocessing as mp,os,tempfile,time,unittest,sys,importlib.util,signal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
ROOT=HERE if (HERE/'uploader.py').exists() else HERE.parent/'scripts'
sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('uploader',ROOT/('uploader.py'if ROOT==HERE else 'cn-hk-original-artifact-upload.py'))
u=importlib.util.module_from_spec(spec);sys.modules['uploader']=u;spec.loader.exec_module(u)
import bounded_workers as b


class FixtureWorker:
 def __init__(self,root,records,delay=.06,fail=None):self.root=root;self.records=records;self.delay=delay;self.fail=fail
 def __call__(self,name):
  import resource
  u.save_json(self.root/(name+'.start.json'),dict(time=time.time(),pid=os.getpid()))
  (self.root/(name+'.zip')).write_bytes(b'data')
  # Distinct path per object, all retained. Simulates an issued unknown PUT.
  u.save_json(self.root/(name+'.put-intent.json'),dict(object=name))
  time.sleep(self.delay)
  if name==self.fail:raise TimeoutError()
  u.save_json(self.root/(name+'.end.json'),dict(time=time.time(),rssRaw=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss))
  r=self.records[name]
  return dict(key='prefix/'+name+'.zip',artifactId=r['id'],sha256=r['sha256'],bytes=r['bytes'],readbackVerified=True)


class Bucket:
 def __init__(self,data):self.data=data;self.puts=0;self.gets=0;self.fail=False
 def get_bucket_info(self):return SimpleNamespace(name='bucket',location='oss-cn-hongkong',owner=SimpleNamespace(id=u.ACCOUNT))
 def get_bucket_acl(self):return SimpleNamespace(acl='private')
 def put_object(self,key,stream,headers):
  assert headers=={'x-oss-forbid-overwrite':'true'}
  self.puts+=1;stream.read()
  if self.fail:raise TimeoutError()
  return SimpleNamespace(status=200)
 def get_object(self,key):self.gets+=1;return io.BytesIO(self.data)


class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.records={str(i):dict(id=i+1,bytes=4,sha256=u.sha(b'data'))for i in range(7)}
  self.plan=dict(artifacts=self.records,prefix='prefix/')
 def test_two_worker_timing_and_all_terminal_before_complete(self):
  started=time.monotonic();result=u.pipeline(self.plan,self.root,5,FixtureWorker(self.root,self.records),mp.get_context('spawn'))
  self.assertEqual(set(result),set(self.records));events=[]
  for name in self.records:
   start=json.loads((self.root/(name+'.start.json')).read_text())['time'];end=json.loads((self.root/(name+'.end.json')).read_text())['time']
   events.extend([(start,1),(end,-1)])
  active=peak=0
  for _,delta in sorted(events):active+=delta;peak=max(peak,active)
  self.assertEqual(peak,2);self.assertEqual(active,0)
  self.assertEqual(sum(p.stat().st_size for p in self.root.glob('*.zip')),28)
  rss=[json.loads(p.read_text())['rssRaw']for p in self.root.glob('*.end.json')]
  print(json.dumps({'fixtureElapsedSeconds':time.monotonic()-started,'observedWorkers':peak,'fixtureZipBytes':28,'maxWorkerRssRaw':max(rss),'rssUnit':'bytes on macOS; KiB on Linux','realCloudThroughputMeasured':False}))
 def test_capacity_guard_not_divided_by_worker_count(self):
  expected=28*2+3825868800+2*1024**3
  with patch.object(u.shutil,'disk_usage',return_value=SimpleNamespace(free=expected-1)),self.assertRaises(ValueError):u.capacity(self.plan,self.root)
  with patch.object(u.shutil,'disk_usage',return_value=SimpleNamespace(free=expected)):self.assertEqual(u.capacity(self.plan,self.root),expected)
 def test_signal_immediately_after_start_is_tracked(self):
  ctx=mp.get_context('spawn')
  class Proxy:
   def __init__(self,p):self.p=p
   def __getattr__(self,k):return getattr(self.p,k)
   def start(self):self.p.start();os.kill(os.getpid(),signal.SIGALRM)
  class Context:
   def Pipe(self,**kw):return ctx.Pipe(**kw)
   def Process(self,**kw):return Proxy(ctx.Process(**kw))
  def interrupt(*a):raise TimeoutError()
  previous=signal.signal(signal.SIGALRM,interrupt)
  try:
   with self.assertRaises(b.TransferStopped)as caught:b.run(['0'],FixtureWorker(self.root,self.records,delay=1),5,context=Context())
   self.assertEqual(caught.exception.states['0'],'unknown-stopped')
  finally:signal.signal(signal.SIGALRM,previous)
 def test_exit_race_does_not_abort_group_cleanup(self):
  process=SimpleNamespace(pid=123,is_alive=lambda:True)
  with patch.object(b.os,'killpg',side_effect=ProcessLookupError),patch.object(b.os,'kill',side_effect=ProcessLookupError):b.kill_group(process,signal.SIGTERM)
 def test_failure_retains_intents_no_receipt_or_more_scheduling(self):
  with self.assertRaises(b.TransferStopped):u.pipeline(self.plan,self.root,5,FixtureWorker(self.root,self.records,fail='0'),mp.get_context('spawn'))
  v=json.loads((self.root/'pipeline-failed.json').read_text());self.assertFalse(v['externalWritesTerminal']);self.assertFalse(v['retryAllowed'])
  self.assertFalse((self.root/'pipeline-complete.json').exists());self.assertFalse((self.root/'receipt.json').exists())
  self.assertTrue(list(self.root.glob('*.put-intent.json')));self.assertIn('not-started',v['states'].values())
 def test_total_deadline_is_not_reset_per_object(self):
  with self.assertRaises(b.TransferStopped):u.pipeline(self.plan,self.root,.3,FixtureWorker(self.root,self.records,delay=1),mp.get_context('spawn'))
  before=sorted(p.name for p in self.root.iterdir());time.sleep(.15);self.assertEqual(before,sorted(p.name for p in self.root.iterdir()))
  self.assertFalse((self.root/'receipt.json').exists())
 def upload(self,data=b'data',bucket=None):
  path=self.root/'zip';path.write_bytes(b'data');v={'bucket':'bucket'}
  r=dict(id=1,path=path,key='fixed',sha256=u.sha(b'data'),bytes=4)
  with patch.object(u,'validate_plan',return_value=v):return u.upload_one(v,self.root,'api',r,bucket or Bucket(data))
 def test_full_get_hash_and_size_reject(self):
  for data in (b'bad!',b'dat',b'data!'):
   with self.subTest(data=data),tempfile.TemporaryDirectory()as td:
    self.root=Path(td)
    with self.assertRaises(ValueError):self.upload(data)
    self.assertTrue((self.root/'api.put-intent.json').exists())
 def test_unknown_put_one_call_no_retry(self):
  bucket=Bucket(b'data');bucket.fail=True
  with self.assertRaises(TimeoutError):self.upload(bucket=bucket)
  with self.assertRaises(FileExistsError):self.upload(bucket=bucket)
  self.assertEqual(bucket.puts,1);self.assertEqual(bucket.gets,0)
 def test_verified_put_get_and_exclusive_intent(self):
  bucket=Bucket(b'data');self.assertTrue(self.upload(bucket=bucket)['readbackVerified'])
  with self.assertRaises(FileExistsError):self.upload(bucket=bucket)
  self.assertEqual((bucket.puts,bucket.gets),(1,1))
 def test_metadata_wrong_identity_and_size(self):
  r={'id':1,'bytes':4,'sha256':u.sha(b'data')}
  base=dict(id=1,name=f'cn-image-candidate-api-{u.RUN}-1',expired=False,size_in_bytes=4,digest='sha256:'+r['sha256'],workflow_run={'id':u.RUN,'head_sha':u.CONTROL})
  for key,value in [('id',2),('size_in_bytes',5),('expired',True),('digest','sha256:'+'0'*64),('workflow_run',{'id':u.RUN,'head_sha':'0'*40})]:
   with patch.object(u,'gh',return_value={**base,key:value}),self.assertRaises(ValueError):u.metadata('api',r)
 def test_existing_output_objects_never_reused(self):
  worker=FixtureWorker(self.root,self.records);worker('0')
  with self.assertRaises(b.TransferStopped):u.pipeline(self.plan,self.root,5,worker,mp.get_context('spawn'))
  self.assertFalse((self.root/'pipeline-complete.json').exists())

if __name__=='__main__':unittest.main()
