"""Real candidate tar parsing; fake OSS, no cloud access."""
import copy
from datetime import datetime,timedelta,timezone
import os
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cn_candidate_oss as t
import cn_image_archive as a
from test_cn_image_candidate import plan,archive,receipt
from test_cn_archive_oss_independent import Port
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.bundle=self.root/'bundle';self.bundle.mkdir(mode=0o700);self.build=plan();self.pr=a.json_bytes(self.build)
  self.v=receipt(self.build,{s:archive(self.bundle/(s+'.tar'),self.build,s) for s in a.REPOSITORIES});self.raw=a.json_bytes(self.v)
  (self.bundle/t.PLAN).write_bytes(self.pr);(self.bundle/t.SET).write_bytes(self.raw)
  prefix='cn-image-candidates/'+self.build['sourceRevision']+'/'+self.build['attemptId']+'/'
  self.tr=dict(kind='approved-candidate-oss-staging-v2',bucket='fixture-bucket',region='cn-shanghai',endpoint='https://oss-cn-shanghai.aliyuncs.com',prefix=prefix,uploadPrincipal='u',downloadPrincipal='d',objects={f.name:dict(key=prefix+f.name,versionId='',sha256=a.sha(f.read_bytes())) for f in self.bundle.iterdir()});self.port=Port()
 def approval(self,op='upload'):
  now=datetime.now(timezone.utc)
  return dict(schemaVersion=2,transferAuthorized=True,candidatePlanRawSha256=a.sha(self.pr),candidateSetRawSha256=a.sha(self.raw),candidateIdentity=self.v['identity'],**{k:self.build[k] for k in ('sourceRevision','controlRevision','attemptId')},transportSha256=a.sha(a.json_bytes(self.tr)),operation=op,observedAt=now.isoformat(),expiresAt=(now+timedelta(minutes=30)).isoformat(),versioningFenceProofSha256='f'*64)
 def transfer(self,op='upload',approval=None):return t.CandidateTransfer(self.port,self.pr,a.sha(self.pr),self.raw,a.sha(self.raw),self.tr,approval or self.approval(op))
 def key(self,n):return self.tr['prefix']+n
 def puts(self):return [x[1] for x in self.port.calls if x[0]=='put']
 def populate(self):self.port.objects={self.key(p.name):p.read_bytes() for p in self.bundle.iterdir()}
 def test_complete_bytes_marker_last(self):
  r=self.transfer().upload(self.bundle);self.assertEqual(len(self.puts()),7);self.assertEqual(self.puts()[-1],self.key(t.SET));self.assertFalse(r['authenticatedPrincipalProven']);self.assertFalse(r['productionReady']);self.assertEqual(r['expiresAt'],self.v['expiresAt']);self.assertEqual(self.port.objects[self.key(t.PLAN)],self.pr)
 def test_lost_ack_no_duplicate_put(self):
  self.port.lost_ack=True;self.transfer().upload(self.bundle);self.assertEqual(len(self.puts()),7)
 def test_existing_no_put(self):
  self.populate();self.transfer().upload(self.bundle);self.assertEqual(self.puts(),[])
 def test_tar_tamper_before_network(self):
  with (self.bundle/'web.tar').open('ab') as f:f.write(b'x')
  with self.assertRaises(a.Rejected):self.transfer().upload(self.bundle)
  self.assertEqual(self.port.calls,[])
 def test_noncanonical_original_bytes_preserved(self):
  self.pr=b' '+self.pr+b'\n';self.v['planRawSha256']=a.sha(self.pr);self.raw=a.json_bytes(self.v)
  for name,raw in ((t.PLAN,self.pr),(t.SET,self.raw)):(self.bundle/name).write_bytes(raw);self.tr['objects'][name]['sha256']=a.sha(raw)
  self.transfer().upload(self.bundle);self.assertEqual(self.port.objects[self.key(t.PLAN)],self.pr)
 def test_plan_raw_binding(self):
  self.pr=b' '+self.pr
  with self.assertRaises(a.Rejected):self.transfer()
  self.assertEqual(self.port.calls,[])
 def test_disk_metadata_binding(self):
  (self.bundle/t.PLAN).write_bytes(b' '+self.pr)
  with self.assertRaises(a.Rejected):self.transfer().upload(self.bundle)
  self.assertEqual(self.port.calls,[])
 def test_legacy_target_foreign_key_reject(self):
  for key,value in [('kind','approved-oss-staging-v1'),('region','cn-hongkong'),('prefix','foreign/')]:
   old=copy.deepcopy(self.tr);self.tr[key]=value
   with self.assertRaises(a.Rejected):self.transfer()
   self.tr=old
  self.tr['objects']['api.tar']['key']='foreign/api.tar'
  with self.assertRaises(a.Rejected):self.transfer()
  self.assertEqual(self.port.calls,[])
 def test_missing_fence_approval_bindings(self):
  for key,value in [('versioningFenceProofSha256',''),('candidateIdentity','0'*64),('schemaVersion',True),('extra',True)]:
   approval=self.approval();approval[key]=value
   with self.assertRaises(a.Rejected):self.transfer(approval=approval)
  with self.assertRaises(a.Rejected):self.transfer('download').upload(self.bundle)
  self.assertEqual(self.port.calls,[])
 def test_expired_mixed_attempt(self):
  for key,value in [('expiresAt','2000-01-01T00:00:00Z'),('attemptId','foreign')]:
   old=self.raw;v=copy.deepcopy(self.v);v[key]=value;self.raw=a.json_bytes(v)
   with self.assertRaises(a.Rejected):self.transfer()
   self.raw=old
  self.assertEqual(self.port.calls,[])
 def test_mid_transfer_expiry_no_marker(self):
  transfer=self.transfer();original=self.port.put
  def expire(key,stream,size,check):original(key,stream,size,check);transfer.approval['expiresAt']='2000-01-01T00:00:00Z'
  self.port.put=expire
  with self.assertRaises(a.Rejected):transfer.upload(self.bundle)
  self.assertNotIn(self.key(t.SET),self.port.objects)
 def test_incomplete_remote_marker_no_put(self):
  self.port.objects[self.key(t.SET)]=self.raw
  with self.assertRaises(a.Rejected):self.transfer().upload(self.bundle)
  self.assertEqual(self.puts(),[])
 def test_links_rejected(self):
  path=self.bundle/'api.tar';backup=self.root/'original';path.rename(backup)
  for link in [lambda:os.link(backup,path),lambda:path.symlink_to(backup)]:
   link()
   with self.assertRaises((a.Rejected,OSError)):self.transfer().upload(self.bundle)
   path.unlink()
  self.assertEqual(self.port.calls,[])
 def test_download_corruption_cleanup(self):
  self.populate();self.port.objects[self.key('web.tar')]=b'bad';parent=self.root/'download';parent.mkdir(mode=0o700)
  with self.assertRaises(a.Rejected):self.transfer('download').download(parent,'attempt')
  self.assertEqual(list(parent.iterdir()),[])
 @unittest.skipUnless(sys.platform=='linux','Linux renameat2 and proc FD required')
 def test_download_full_no_replace(self):
  self.populate();parent=self.root/'download';parent.mkdir(mode=0o700);self.transfer('download').download(parent,'attempt');self.assertEqual((parent/'attempt'/t.PLAN).read_bytes(),self.pr)
  with self.assertRaises(a.Rejected):self.transfer('download').download(parent,'attempt')
  self.assertEqual((parent/'attempt'/t.SET).read_bytes(),self.raw)
if __name__=='__main__':unittest.main()
