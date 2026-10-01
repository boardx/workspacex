from pathlib import Path
import hashlib,importlib.util,json,subprocess,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('supervisor',str(Path(__file__).with_name('isolated_conservation_supervisor.py')));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Cleanup(unittest.TestCase):
 def exercise(self,fail=False,foreign=False):
  owner=None;removed=[];netgone=False
  def cap(args,timeout=15,check=True):
   nonlocal owner,netgone
   if args[:2]==['image','inspect']:x=[{'Id':'sha256:'+'a'*64,'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':'b'*40},'Env':[]}}]
   elif args[:2]==['network','create']:owner=args[-1];return subprocess.CompletedProcess(args,0,b'net',b'')
   elif args[:2]==['network','inspect']:x=[{'Id':'net','Labels':{'wsx.rehearsal.owner':owner},'Containers':{}}]
   elif args[0]=='inspect':x=[{'Id':'container','Config':{'Labels':{'wsx.rehearsal.owner':'foreign' if foreign else owner}}}]
   elif args[0]=='rm':removed.append('container');return subprocess.CompletedProcess(args,0,b'',b'')
   elif args[:2]==['ps','-aq']:return subprocess.CompletedProcess(args,0,b'',b'')
   elif args[:2]==['network','rm']:removed.append('network');return subprocess.CompletedProcess(args,0,b'',b'')
   elif args[:2]==['network','ls']:return subprocess.CompletedProcess(args,0,b'',b'')
   else:raise AssertionError(args)
   return subprocess.CompletedProcess(args,0,json.dumps(x).encode(),b'')
  class P:
   returncode=1 if fail else 0
   def communicate(self,*args,**kwargs):return json.dumps({'readOnly':True,'rollbackComplete':True,'targetInstanceId':'pgm-target','candidateSha':'b'*40,'attemptId':'attempt'}).encode(),b''
   def poll(self):return self.returncode
  code='fixture';payload={'binding':{'targetInstanceId':'pgm-target','candidateSha':'b'*40,'attemptId':'attempt'},'entry':{'immutableRuntimeId':'sha256:'+'a'*64,'runtimeSourceSha':'b'*40,'sha256':hashlib.sha256(code.encode()).hexdigest(),'language':'node','timeoutSeconds':30},'engineBytes':code,'secret':{'targetInstanceId':'pgm-target','attemptId':'attempt','host':'host','port':5432,'user':'migration_admin','password':'fixture-only','tls':{'sslmode':'disable','approvedException':'aliyun-postgresql-serverless-no-tls'}},'plan':{},'request':{},'baseline':{},'before':None}
  payload['binding']['providerCreatedUtc']='2026-10-02T00:00:00Z'
  payload['secret']['tls']['providerSslEvidence']={'targetInstanceId':'pgm-target','providerCreatedUtc':payload['binding']['providerCreatedUtc'],'sslEnabled':False}
  payload['binding']['tls']=payload['secret']['tls']
  with patch.object(s,'capture',cap),patch.object(s.os,'geteuid',lambda:0),patch.object(s.subprocess,'Popen',lambda *a,**kw:P()):
   if fail or foreign:
    with self.assertRaises(AssertionError):s.main(payload)
   else:self.assertTrue(s.main(payload)['ownedCleanupVerified'])
  return removed
 def test_success_owned_cleanup(self):self.assertEqual(self.exercise(),['container','network'])
 def test_failure_owned_cleanup(self):self.assertEqual(self.exercise(fail=True),['container','network'])
 def test_foreign_never_removed(self):self.assertEqual(self.exercise(foreign=True),[])
if __name__=='__main__':unittest.main()
