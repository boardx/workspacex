import base64,hashlib,importlib.util,io,json,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
import test_cn_mvp_chain as chain
s=importlib.util.spec_from_file_location('derive',Path(__file__).parents[1]/'scripts/cn-release-mvp-transfer-input.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
s=importlib.util.spec_from_file_location('master',Path(__file__).parents[1]/'scripts/cn-release-mvp-master.py');master=importlib.util.module_from_spec(s);s.loader.exec_module(master)
class Transfer(unittest.TestCase):
 def fixture(self):
  i,r,a=chain.Chain().fixture();plan=json.dumps({'sourceRevision':i['sourceRevision'],'controlRevision':i['controlRevision']}).encode();archives={}
  for index,files in [(0,{'cn-candidate-plan.json':plan}),(1,{'candidate-plan.json':plan,'candidate-set.json':b'{}'})]:
   stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w')as z:
    for name,raw in files.items():z.writestr(name,raw)
   raw=stream.getvalue();row=a['artifacts'][index];row['size_in_bytes']=len(raw);row['digest']='sha256:'+m.sha(raw);archives[row['id']]=raw
  def read(path,output=None,limit=None):
   if output is not None:
    raw=archives[int(path.split('/')[-2])];self.assertEqual(len(raw),limit);output.write_bytes(raw);return
   if '/contents/'in path:return {'encoding':'base64','content':base64.b64encode(b'actual-control-file').decode()}
   return a if '/artifacts?'in path else r
  return i,read
 def test_actual_metadata_derives_new_template(self):
  identity,read=self.fixture();result=m.derive(identity,42,{'expiresAt':'reviewed'},read)
  self.assertEqual(result['transferPlan']['sourceRun'],42);self.assertEqual(result['revalidationTemplate']['candidateSetRawSha256'],m.sha(b'{}'))
  self.assertEqual(result['transferPlan']['revalidationTemplateSha256'],m.sha(result['templateRaw'].encode()))
 def test_bad_metadata_digest_rejected(self):
  with self.assertRaises(ValueError):m.metadata_zip({'id':1,'bytes':1,'sha256':'0'*64},{'x'},lambda p,out,limit:out.write_bytes(b'x'))
 def test_bridge_actual_missing_entries_fail_closed(self):
  with self.assertRaisesRegex(ValueError,'ROOT_BRIDGE_NOT_READY'):master.bridge_admission({'fixedReleaseInstalled':False})
 def test_status_does_not_grant_authority(self):
  self.assertTrue(master.bridge_admission({k:True for k in ['fixedReleaseInstalled','advanceInstalled','controlInstalled','approvalStoreInstalled','sudoFixedEntryAllowed','evidencePortalInstalled','trustedEvidenceMaterializerInstalled']}))
if __name__=='__main__':unittest.main()
