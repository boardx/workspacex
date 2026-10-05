import hashlib,json,pathlib,subprocess,tempfile,unittest
HERE=pathlib.Path(__file__).parent
ROOT=HERE.resolve().parents[2]
class SourceFreeze(unittest.TestCase):
 def test_exact_git_bytes_create_once_and_conflicting_revision_rejected(self):
  revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
  prior=subprocess.check_output(['git','rev-parse','HEAD^'],cwd=ROOT,text=True).strip()
  with tempfile.TemporaryDirectory() as tmp:
   output=pathlib.Path(tmp)/'closure.json'
   def run(source):return subprocess.run(['python3','-B',str(HERE.resolve()/'freeze-cn-sop-source.py'),'--source-revision',source,'--output',str(output)],cwd=ROOT,capture_output=True,text=True)
   self.assertEqual(run(revision).returncode,0);raw=output.read_bytes();value=json.loads(raw)
   self.assertEqual(value['sourceCommit'],revision);self.assertFalse(value['installationAuthorized']);self.assertFalse(value['ready'])
   for row in value['files']:
    source=subprocess.check_output(['git','show',revision+':'+row['source']],cwd=ROOT)
    self.assertEqual(row['sha256'],hashlib.sha256(source).hexdigest());self.assertEqual(row['bytes'],len(source))
   self.assertEqual(run(revision).returncode,0);self.assertEqual(output.read_bytes(),raw)
   self.assertEqual(run(prior).returncode,1);self.assertEqual(output.read_bytes(),raw)
 def test_moving_ref_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   result=subprocess.run(['python3','-B',str(HERE.resolve()/'freeze-cn-sop-source.py'),'--source-revision','HEAD','--output',str(pathlib.Path(tmp)/'closure.json')],cwd=ROOT,capture_output=True,text=True)
   self.assertEqual(result.returncode,1)
if __name__=='__main__':unittest.main()
