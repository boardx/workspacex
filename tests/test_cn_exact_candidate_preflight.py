import copy,hashlib,importlib.util,json,os,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
P=Path(__file__).resolve().parent/'fixtures/cn-exact-candidate/preflight.py'
spec=importlib.util.spec_from_file_location('exact_preflight',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PreflightTests(unittest.TestCase):
 def selection(self):return {'kind':'isolated-f0eb-preserved-selection-v1','sourceRevision':m.preserve.SOURCE,'controlRevision':'a'*40,'preservationRunId':123,'artifacts':{name:{'artifactId':i+1,'wrapperBytes':s['zipBytes'],'wrapperSha256':'b'*64,'file':name+'.zip'}for i,(name,s)in enumerate(m.preserve.SPECS.items())}}
 def test_seven_exact_selection(self):self.assertEqual(m.validate_selection(self.selection())['sourceRevision'],m.preserve.SOURCE)
 def test_missing_and_extra_artifacts(self):
  for op in ('missing','extra'):
   v=self.selection()
   if op=='missing':v['artifacts'].pop('api')
   else:v['artifacts']['other']=v['artifacts']['api']
   with self.assertRaises(Exception):m.validate_selection(v)
 def test_wrong_source_path_duplicate_wrapper(self):
  for mutate in (lambda v:v.update(sourceRevision='a'*40),lambda v:v['artifacts']['api'].update(file='../api.zip'),lambda v:v['artifacts']['api'].update(artifactId=1)):
   v=self.selection();mutate(v)
   with self.assertRaises(Exception):m.validate_selection(v)
 def test_oversized_wrapper(self):
  v=self.selection();v['artifacts']['api']['wrapperBytes']=2**40
  with self.assertRaises(Exception):m.validate_selection(v)
 def test_duplicate_json_rejected(self):
  with self.assertRaises(Exception):m.decode(b'{"a":1,"a":2}')
 def test_copy_hash_and_no_replace(self):
  with tempfile.TemporaryDirectory()as d:
   a=Path(d)/'a';b=Path(d)/'b';a.write_bytes(b'abc')
   m.copy_verified(a,b,3,hashlib.sha256(b'abc').hexdigest(),time.monotonic()+5);self.assertEqual(b.read_bytes(),b'abc')
   with self.assertRaises(FileExistsError):m.copy_verified(a,b,3,hashlib.sha256(b'abc').hexdigest(),time.monotonic()+5)
 def test_copy_wrong_hash_and_expiry(self):
  with tempfile.TemporaryDirectory()as d:
   a=Path(d)/'a';a.write_bytes(b'abc')
   for name,h,deadline in [('b','0'*64,time.monotonic()+5),('c',hashlib.sha256(b'abc').hexdigest(),0)]:
    with self.assertRaises(Exception):m.copy_verified(a,Path(d)/name,3,h,deadline)
 def test_symlink_and_fifo_rejected_without_block(self):
  with tempfile.TemporaryDirectory()as d:
   a=Path(d)/'a';a.write_bytes(b'abc');link=Path(d)/'link';link.symlink_to(a);fifo=Path(d)/'fifo';os.mkfifo(fifo)
   for p in (link,fifo):
    with self.assertRaises(Exception):m.read_file(p,100)
 def test_seven_gib_does_not_admit_original_caps(self):
  with patch.object(m.shutil,'disk_usage',return_value=type('Space',(),{'free':40*1024**3})()):
   r=m.resource_observation(Path('/tmp'),'MemTotal:       7340032 kB\n');self.assertFalse(r['originalCapsWithHeadroomFit']);self.assertTrue(r['minimumBytePreflightMemoryFit'])
 def test_missing_memtotal_rejected(self):
  with self.assertRaises(Exception):m.resource_observation(Path('/tmp'),'Unknown: 1\n')
 def test_non_github_and_non_linux_refused_before_docker(self):
  with patch.dict(os.environ,{'GITHUB_ACTIONS':'false'}):
   with self.assertRaises(Exception):m.environment(self.selection())
if __name__=='__main__':unittest.main()
