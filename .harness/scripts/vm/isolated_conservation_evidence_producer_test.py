import hashlib,importlib.util,json,os,stat,subprocess,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('producer',str(Path(__file__).with_name('canonical-evidence-producer.py')));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
REAL_TEMP=tempfile.TemporaryDirectory
class ProducerTests(unittest.TestCase):
 def exercise(self,wrongsource=False,wrongruntime=False,timeout=False,unsafe=False):
  with tempfile.TemporaryDirectory(dir=Path('/tmp').resolve()) as directory:
   root=Path(directory);versions={'psycopg':'3.3.4','langgraph':'1.2.11','langgraph-checkpoint-postgres':'3.1.2'};names={'apps/deep-agent-service/src/deep_agent_service/'+n for n in ['memory_deployment.py','postgres_checkpointer.py','self_hosted_runtime.py']}|{'apps/deep-agent-service/pyproject.toml','apps/deep-agent-service/uv.lock'}
   raw={n:b'exact-committed-fixture' for n in names};manifest={'sourceSha':'a'*40,'filesSha256':{n:hashlib.sha256(v).hexdigest() for n,v in raw.items()},'expectedPackageVersions':versions}
   raw['manifest']=json.dumps(manifest).encode();raw['extract']=b'reviewed-extractor-fixture';raw['runtime']=b'reviewed-runtime-fixture'
   refs={n:{'path':n,'sha256':hashlib.sha256(v).hexdigest()} for n,v in raw.items()};p={'candidateSha':'a'*40,'imageId':'sha256:'+'b'*64,'runtimeSourceSha':'c'*40,'sourceManifest':refs['manifest'],'extractor':refs['extract'],'runtimeExtractor':refs['runtime'],'privateRoot':directory,'sourceFiles':{n:refs[n] for n in names}}
   if wrongsource:raw[next(iter(names))]=b'drifted'
   owner=None;removed=[];calls=[];number=0
   def cap(args,*a,**kw):
    nonlocal owner
    calls.append(args)
    if args[:2]==['image','inspect']:value=[{'Id':p['imageId'],'Os':'linux','Config':{'Labels':{'org.opencontainers.image.revision':p['runtimeSourceSha']}}}]
    elif args[0]=='inspect':value=[{'Id':'owned','Config':{'Labels':{'wsx.rehearsal.owner':owner}}}]
    elif args[0]=='rm':removed.append(args[-1]);return subprocess.CompletedProcess(args,0,b'',b'')
    elif args[:2]==['ps','-aq']:return subprocess.CompletedProcess(args,0,b'',b'')
    else:raise AssertionError(args)
    return subprocess.CompletedProcess(args,0,json.dumps(value).encode(),b'')
   class Process:
    returncode=None if timeout else 0
    def communicate(self,*a,**kw):
     if timeout:raise subprocess.TimeoutExpired('docker',180)
     proof={'candidateSha':'d'*40 if wrongruntime and number==2 else p['candidateSha'],'candidateUvLockSha256':manifest['filesSha256']['apps/deep-agent-service/uv.lock'],'packageVersions':versions,'sourceQueriesAttempted':0,'networkConnectionsAttempted':0}
     return json.dumps(proof).encode(),b''
    def poll(self):return self.returncode
    def kill(self):self.returncode=-9
    def wait(self,**kw):return self.returncode
   def start(args,**kw):
    nonlocal owner,number
    number+=1;owner=args[args.index('--name')+1];assert '--network=none' in args;return Process()
   safe=types.SimpleNamespace(st_mode=stat.S_IFDIR|(0o777 if unsafe else 0o700),st_uid=0,st_gid=0)
   with patch.object(m.tempfile,'TemporaryDirectory',lambda **kw:REAL_TEMP(prefix=kw.get('prefix',''),dir=Path('/tmp').resolve())),patch.object(m.os,'geteuid',lambda:0),patch.object(m,'verified',lambda ref:raw[ref['path']]),patch.object(m,'capture',cap),patch.object(m.subprocess,'Popen',start),patch.object(Path,'lstat',lambda self:safe):
    if wrongsource or wrongruntime or timeout or unsafe:
     with self.assertRaises((AssertionError,subprocess.TimeoutExpired)):m.produce(p)
    else:
     result=m.produce(p);self.assertEqual(result['runtimeSourceSha'],'c'*40);self.assertEqual(result['releaseSourceSha'],'a'*40);self.assertFalse(result['prepared'])
   return removed,number
 def test_success_real_control_flow(self):self.assertEqual(self.exercise()[1],2)
 def test_source_hash_reject_before_process(self):self.assertEqual(self.exercise(wrongsource=True)[1],0)
 def test_runtime_identity_drift(self):self.assertEqual(len(self.exercise(wrongruntime=True)[0]),2)
 def test_timeout_owned_cleanup(self):self.assertEqual(self.exercise(timeout=True)[0],['owned'])
 def test_unsafe_private_root(self):self.assertEqual(self.exercise(unsafe=True)[1],0)
if __name__=='__main__':unittest.main()
