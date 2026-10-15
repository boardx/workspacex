import importlib.util,pathlib,tempfile,subprocess,unittest,os
R=pathlib.Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('source',R/'scripts/directory-release-source.py');v=importlib.util.module_from_spec(s);s.loader.exec_module(v)
class Tests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.p=pathlib.Path(self.t.name);self.old=os.getcwd();os.chdir(self.p)
  self.git('init','-q');self.git('config','user.email','fixture@example.invalid');self.git('config','user.name','Fixture')
  (self.p/'readme').write_text('baseline');self.commit('base');self.base=self.git('rev-parse','HEAD').strip();v.BASE=self.base
  self.git('checkout','-q','-b','payload')
  for p in v.FILES:q=self.p/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_text('accepted frontend')
  self.commit('payload');v.PAYLOAD=self.git('rev-parse','HEAD').strip()
  self.git('checkout','-q','-b','backport',self.base)
  for p in v.FILES:q=self.p/p;q.parent.mkdir(parents=True,exist_ok=True);q.write_text('accepted frontend')
  self.commit('backport');self.source=self.git('rev-parse','HEAD').strip()
 def git(self,*a):return subprocess.check_output(['git',*a],stderr=subprocess.DEVNULL,text=True)
 def commit(self,msg):self.git('add','.');self.git('commit','-qm',msg)
 def tearDown(self):os.chdir(self.old);self.t.cleanup()
 def test_real_git_valid_backport(self):self.assertFalse(v.verify(self.source)['migrationsChanged'])
 def test_extra_backend_file_rejected(self):
  self.git('reset','--soft',self.base);(self.p/'api.sql').write_text('GRANT');self.commit('bad')
  with self.assertRaisesRegex(ValueError,'SOURCE_SCOPE'):v.verify(self.git('rev-parse','HEAD').strip())
 def test_altered_payload_rejected(self):
  self.git('reset','--soft',self.base);(self.p/v.FILES[0]).write_text('unreviewed');self.commit('bad')
  with self.assertRaisesRegex(ValueError,'SOURCE_PAYLOAD'):v.verify(self.git('rev-parse','HEAD').strip())
 def test_additional_parent_step_rejected(self):
  (self.p/'readme').write_text('another change');self.commit('bad')
  with self.assertRaisesRegex(ValueError,'SOURCE_BASELINE'):v.verify(self.git('rev-parse','HEAD').strip())
if __name__=='__main__':unittest.main()
