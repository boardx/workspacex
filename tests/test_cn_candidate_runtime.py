"""Offline runtime byte provenance and root-install filesystem failure tests."""
import base64
import copy
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
p=module('runtime_pack',ROOT/'scripts/package-cn-candidate-runtime.py')
i=module('runtime_install',ROOT/'scripts/install-cn-candidate-runtime.py')
ELF=b'\x7fELF\x02\x01'+b'\0'*12+b'\x3e\x00'+b'fixture'

class RuntimeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.runtime=self.root/'runtime';self.runtime.mkdir();self.tarballs=self.root/'tarballs';self.tarballs.mkdir()
  modules=self.runtime/'node_modules';modules.mkdir();(modules/'.bin').mkdir();(modules/'@esbuild').mkdir()
  lock={'lockfileVersion':3,'packages':{'':{'dependencies':p.DEPENDENCIES}}}
  for name in ('tsx','zod','esbuild','get-tsconfig','resolve-pkg-maps','@esbuild/linux-x64'):
   version=p.DEPENDENCIES.get(name,'1.0.0');folder=modules/name;folder.mkdir()
   files={'package.json':json.dumps({'name':name,'version':version}).encode(),'index.js':b'export default 1'}
   if name=='tsx':files['dist/cli.mjs']=b'fixture'
   if name=='esbuild':files['bin/esbuild']=b'fixture'
   if name=='@esbuild/linux-x64':files['bin/esbuild']=ELF
   buffer=io.BytesIO()
   with tarfile.open(fileobj=buffer,mode='w:gz') as archive:
    for relative,raw in files.items():
     path=folder/relative;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
     entry=tarfile.TarInfo('package/'+relative);entry.size=len(raw);archive.addfile(entry,io.BytesIO(raw))
   raw=buffer.getvalue();(self.tarballs/(name.replace('@','').replace('/','-')+'-'+version+'.tgz')).write_bytes(raw)
   lock['packages']['node_modules/'+name]={'version':version,'integrity':'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode()}
  (modules/'.bin/tsx').symlink_to('../tsx/dist/cli.mjs');(modules/'.bin/esbuild').symlink_to('../esbuild/bin/esbuild')
  (self.runtime/'package.json').write_text(json.dumps({'dependencies':p.DEPENDENCIES}))
  (self.runtime/'package-lock.json').write_text(json.dumps(lock));self.lock_sha=p.sha((self.runtime/'package-lock.json').read_bytes())

 def test_dependency_tarball_and_installed_bytes_binding(self):
  files,proof=p.runtime_files(self.runtime,self.lock_sha,self.tarballs)
  self.assertEqual(len(proof),6);self.assertIn('node_modules/@esbuild/linux-x64/bin/esbuild',files)
  (self.runtime/'node_modules/tsx/index.js').write_bytes(b'tampered')
  with self.assertRaisesRegex(ValueError,'INSTALLED_BYTES'):p.runtime_files(self.runtime,self.lock_sha,self.tarballs)

 def test_extra_root_and_escaping_shim_rejected(self):
  extra=self.runtime/'node_modules/foreign';extra.mkdir()
  with self.assertRaisesRegex(ValueError,'EXTRA_ROOT'):p.runtime_files(self.runtime,self.lock_sha,self.tarballs)
  extra.rmdir();shim=self.runtime/'node_modules/.bin/tsx';shim.unlink();shim.symlink_to('/etc/passwd')
  with self.assertRaisesRegex(ValueError,'SHIM_TARGET'):p.runtime_files(self.runtime,self.lock_sha,self.tarballs)

 def test_wrong_lock_tarball_and_native_architecture(self):
  with self.assertRaisesRegex(ValueError,'LOCK_HASH'):p.runtime_files(self.runtime,'0'*64,self.tarballs)
  target=next(self.tarballs.glob('tsx-*'));target.write_bytes(target.read_bytes()+b'x')
  with self.assertRaisesRegex(ValueError,'TARBALL_INTEGRITY'):p.runtime_files(self.runtime,self.lock_sha,self.tarballs)
  with self.assertRaisesRegex(ValueError,'LINUX_X64'):p.linux_x64(b'Mac native Mach-O')

 def test_produce_omits_node_preserves_original_attempt_and_no_overwrite(self):
  node=self.root/'node';node.write_bytes(ELF);out=self.root/'output';source='a'*40;attempt='original-build'
  sources={name:b'{}' for name in p.SOURCES}
  with patch.object(p,'source_files',return_value=sources):
   receipt=p.produce(self.root,'b'*40,node,p.sha(ELF),self.runtime,self.lock_sha,self.tarballs,source,attempt,out)
   with self.assertRaises(FileExistsError):p.produce(self.root,'b'*40,node,p.sha(ELF),self.runtime,self.lock_sha,self.tarballs,source,attempt,out)
  manifest=json.loads((out/'manifest.json').read_text());i.validate(manifest,source,attempt)
  files=i.unpack((out/'runtime.tar.gz').read_bytes(),manifest)
  self.assertNotIn('node',files);self.assertEqual(manifest['existingNode']['path'],'/usr/bin/node')
  self.assertEqual(manifest['buildAttemptId'],attempt);self.assertFalse(receipt['installed'])
  bad=copy.deepcopy(manifest);bad['files']['../escape']=bad['files']['canonical-control.json']
  with self.assertRaisesRegex(ValueError,'FILE_SCOPE'):i.validate(bad,source,attempt)

 def test_node_copy_read_rejects_hash_symlink_hardlink_and_replacement(self):
  folder=self.root/'protected';folder.mkdir();fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY)
  self.addCleanup(os.close,fd);path=folder/'node';path.write_bytes(ELF);path.chmod(0o755)
  expected={'sha256':i.sha(ELF),'size':len(ELF)}
  with patch.object(i,'OWNER',(os.getuid(),os.getgid())):
   self.assertEqual(i.read(fd,'node',expected,0o755),ELF)
   with self.assertRaisesRegex(ValueError,'FILE_HASH'):i.read(fd,'node',dict(expected,sha256='0'*64),0o755)
   os.link(path,folder/'link')
   with self.assertRaisesRegex(ValueError,'FILE_TRUST'):i.read(fd,'node',expected,0o755)
   (folder/'link').unlink();path.unlink();path.symlink_to('/etc/passwd')
   with self.assertRaises(OSError):i.read(fd,'node',expected,0o755)
   path.unlink();path.write_bytes(ELF);path.chmod(0o755);original=i.os.stat
   def changed(name,*args,**kwargs):
    other=folder/'replacement';other.write_bytes(ELF);other.chmod(0o755);os.replace(other,path)
    return original(name,*args,**kwargs)
   with patch.object(i.os,'stat',side_effect=changed):
    with self.assertRaisesRegex(ValueError,'FILE_CHANGED'):i.read(fd,'node',expected,0o755)

 @unittest.skipUnless(Path('/proc/self/fd').is_dir(),'Linux fd paths and renameat2 required')
 def test_linux_atomic_install_config_last_failure_no_overwrite(self):
  folder=self.root/'target';folder.mkdir(mode=0o700);fd=os.open(folder,os.O_RDONLY|os.O_DIRECTORY);self.addCleanup(os.close,fd)
  files={'canonical-control.json':b'{}','canonical-source/a.js':b'one','canonical-source/nested/b.js':b'two'}
  with patch.object(i,'OWNER',(os.getuid(),os.getgid())):
   events=[];original=i.no_replace
   def fail(parent,stage,name):
    events.append(name)
    if name=='canonical-source':raise OSError('injected')
    return original(parent,stage,name)
   with patch.object(i,'no_replace',side_effect=fail):
    with self.assertRaises(OSError):i.install(fd,files,ELF)
   self.assertFalse((folder/'canonical-control.json').exists());self.assertEqual(events,['node','canonical-source'])
   result=i.install(fd,files,ELF);self.assertEqual(result[-1],'canonical-control.json')
   inode=(folder/'node').stat().st_ino;self.assertEqual(i.install(fd,files,ELF),[])
   self.assertEqual(inode,(folder/'node').stat().st_ino)
   (folder/'canonical-source/a.js').write_bytes(b'changed')
   with self.assertRaisesRegex(ValueError,'EXISTING_RUNTIME_MISMATCH'):i.install(fd,files,ELF)

if __name__=='__main__':unittest.main()
