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
