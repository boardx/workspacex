import importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('config',Path(__file__).parents[1]/'scripts/unified-release-config.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Configuration(unittest.TestCase):
 def test_freezes_only_config_mounts_and_compose_secrets(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);cert=root/'cert';cert.mkdir();(cert/'ca').write_text('old');secret=root/'secret';secret.write_text('private')
   data=root/'data';data.mkdir();(data/'database').write_text('do not copy')
   model={'services':{'api':{'volumes':[{'type':'bind','source':str(cert),'target':'/run/certs'},{'type':'bind','source':str(data),'target':'/data'}]}},'secrets':{'key':{'file':str(secret)}}}
   frozen,refs=m.freeze(model,[str(cert)],root/'snapshot')
   self.assertEqual(frozen['services']['api']['volumes'][1]['source'],str(data));self.assertEqual(len(refs),2)
   (cert/'ca').write_text('changed');m.verify(refs,restore=True)
   self.assertEqual((cert/'ca').read_text(),'old');self.assertEqual((data/'database').read_text(),'do not copy');self.assertTrue(list(root.glob('cert.before-rollback-*')))
 def test_changed_snapshot_and_symlinks_reject(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);source=root/'source';source.write_text('old');_,refs=m.freeze({'services':{}},[str(source)],root/'snap')
   Path(refs[0]['copy']).write_text('tampered')
   with self.assertRaisesRegex(ValueError,'CONFIG_SNAPSHOT_CHANGED'):m.verify(refs)
   link=root/'link';link.symlink_to(source)
   with self.assertRaisesRegex(ValueError,'CONFIG_SYMLINK_UNSUPPORTED'):m.freeze({'services':{}},[str(link)],root/'other')

@unittest.skipUnless(__import__('sys').platform=='linux' and __import__('os').geteuid()==0,'requires Linux root for real service UID/GID access')
class Ownership(unittest.TestCase):
 def test_private_file_and_recursive_directory_survive_snapshot_and_restore(self):
  import os,stat
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);root.chmod(0o755)
   source=root/'private';source.write_text('secret');os.chown(source,1000,1001);source.chmod(0o600)
   tree=root/'certs';tree.mkdir();nested=tree/'nested';nested.mkdir();key=nested/'key';key.write_text('key')
   for path in (tree,nested,key):os.chown(path,1000,1001);path.chmod(0o700 if path.is_dir() else 0o600)
   _,refs=m.freeze({'services':{}},[str(source),str(tree)],root/'snapshot')
   # Parent is private by design; expose only this disposable test parent for UID checks.
   (root/'snapshot').chmod(0o755)
   def assert_readable(path,expected):
    pid=os.fork()
    if pid==0:
     try:
      os.setgroups([]);os.setgid(1001);os.setuid(1000)
      os._exit(0 if path.read_text()==expected else 2)
     except BaseException:os._exit(3)
    self.assertEqual(os.waitpid(pid,0)[1],0,str(path))
   for ref in refs:
    saved=Path(ref['copy']);original=Path(ref['original'])
    for path in [original]+list(original.rglob('*')) if original.is_dir() else [original]:
     copy=saved/path.relative_to(original);a=path.stat();b=copy.stat()
     self.assertEqual((a.st_uid,a.st_gid,stat.S_IMODE(a.st_mode)),(b.st_uid,b.st_gid,stat.S_IMODE(b.st_mode)))
    assert_readable(saved/'nested/key' if saved.is_dir() else saved,'key' if saved.is_dir() else 'secret')
   source.write_text('changed');key.write_text('changed');m.verify(refs,restore=True)
   assert_readable(source,'secret');assert_readable(key,'key')
   # Equal bytes must not hide owner/mode drift during restore.
   os.chown(source,0,0);source.chmod(0o600);m.verify(refs,restore=True);assert_readable(source,'secret')
   saved=Path(refs[0]['copy']);saved.chmod(0o755 if saved.is_dir() else 0o644)
   with self.assertRaisesRegex(ValueError,'CONFIG_SNAPSHOT_METADATA_CHANGED'):m.verify(refs)
