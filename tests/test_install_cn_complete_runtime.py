import copy,hashlib,importlib.util,io,json,os,subprocess,tarfile,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).parents[1]
s=importlib.util.spec_from_file_location('installer',ROOT/'scripts/install-cn-complete-runtime.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def encode(x):return(json.dumps(x,sort_keys=True,separators=(',',':'))+'\n').encode()
class CompleteInstaller(unittest.TestCase):
 def fixture(self,mutate=None):
  native=Path('/usr/bin/true').read_bytes()
  regular={'control/scripts/entry.py':b'pass\n','control/native':native,'control/.git/HEAD':b'a'*40+b'\n','control/.git/config':b'[core]\nrepositoryformatversion = 0\nbare = false\nfilemode = true\n','source/skills/pack.json':b'{}','entry-control/scripts/entry.py':b'pass\n'}
  regular.update({'entries/'+name:b'#!/bin/sh\nexit 0\n'for name in m.ENTRY_NAMES})
  maps={'control-runtime.json':{n[8:]:m.sha(v)for n,v in regular.items()if n.startswith('control/')and not n.startswith('control/.git/')},'git-files.json':{n[13:]:m.sha(v)for n,v in regular.items()if n.startswith('control/.git/')},'source-files.json':{'skills/pack.json':m.sha(b'{}')},'links.json':{'alias':'native'},'dynamic-bindings.json':[]}
  regular.update({'manifests/'+n:encode(v)for n,v in maps.items()})
  links={'control/alias':'native'};modes={n:0o600 for n in regular};modes['control/native']=0o700
  for n in m.ENTRY_NAMES:modes['entries/'+n]=0o700
  if mutate:mutate(regular,links,modes)
  stream=io.BytesIO()
  with tarfile.open(fileobj=stream,mode='w:gz',format=tarfile.PAX_FORMAT)as tar:
   dirs=set()
   for name in regular|links:
    for p in Path(name).parents:
     if str(p)!='.':dirs.add(str(p))
   for name in sorted(dirs):
    item=tarfile.TarInfo(name);item.type=tarfile.DIRTYPE;item.mode=0o700;tar.addfile(item)
   for name,raw in regular.items():
    item=tarfile.TarInfo(name);item.mode=modes[name];item.size=len(raw);tar.addfile(item,io.BytesIO(raw))
   for name,target in links.items():
    item=tarfile.TarInfo(name);item.type=tarfile.SYMTYPE;item.linkname=target;item.mode=0o777;tar.addfile(item)
  packed=stream.getvalue();entry={'scripts/entry.py':m.sha(b'pass\n')}
  summary=dict(producerRevision='d'*40,controlRevision='a'*40,sourceRevision='a'*40,runId='42',runAttempt='1',platform='linux-x64',archiveSha256=m.sha(packed),archiveBytes=len(packed),unpackedBytes=sum(map(len,regular.values())),credentialsIncluded=False,fixedControlBundleSha256=m.sha(encode(entry)),dynamicBindings=[])
  for filename,pin in m.META.items():summary[pin]=m.sha(regular['manifests/'+filename])
  raw=encode(summary);approval=dict(kind='cn-complete-runtime-install-approval-v1',target=m.TARGET,producerRevision='d'*40,controlRevision='a'*40,sourceRevision='a'*40,runId=42,runAttempt=1,artifactId=99,summarySha256=m.sha(raw),archiveSha256=m.sha(packed),archiveBytes=len(packed),unpackedBytes=summary['unpackedBytes'],wrapperSha256={n:m.sha(regular['entries/'+n])for n in m.ENTRY_NAMES},sudoSha256=m.sha(m.sudo_bytes()),expectedAbsent=[str(p)for p in m.targets(summary).values()]+['/usr/local/bin/'+n for n in m.ENTRY_NAMES.values()]+['/etc/sudoers.d/workspacex-cn-mvp-fixed-entries'],activationApproved=True)
  return raw,packed,approval
 def plan(self):
  raw,packed,a=self.fixture();summary=m.validate_authority(raw,a);return m.inspect_archive(io.BytesIO(packed),summary,a),a
 def test_exact_complete_package_and_symlink_readback(self):
  plan,a=self.plan();self.assertEqual(plan['links'],{'control/alias':'native'});self.assertEqual(plan['modes']['control/native'],0o700)
 def test_corrupt_archive_and_cross_tree_link_rejected(self):
  raw,packed,a=self.fixture();summary=m.validate_authority(raw,a)
  with self.assertRaisesRegex(ValueError,'ARCHIVE_HASH'):m.inspect_archive(io.BytesIO(packed[:-1]+b'x'),summary,a)
  raw,packed,a=self.fixture(lambda files,links,modes:links.update({'control/alias':'../../outside'}));summary=m.validate_authority(raw,a)
  with self.assertRaisesRegex(ValueError,'LINK_ESCAPE'):m.inspect_archive(io.BytesIO(packed),summary,a)
 def test_extra_missing_and_unsafe_permission_rejected(self):
  for mutation,code in [(lambda f,l,p:f.update({'control/extra':b'bad'}),'CONTROL_MANIFEST_COMPLETE'),(lambda f,l,p:p.update({'control/native':0o4755}),'PACKAGE_FILE_MODE')]:
   def mutate(f,l,p):mutation(f,l,p);p.setdefault('control/extra',0o600)
   raw,packed,a=self.fixture(mutate);summary=m.validate_authority(raw,a)
   with self.assertRaisesRegex(ValueError,code):m.inspect_archive(io.BytesIO(packed),summary,a)
 def test_native_mode_preserved_and_sudo_activated_last(self):
  plan,a=self.plan();events=[]
  with tempfile.TemporaryDirectory()as folder:
   def publish(target,files,links,modes,directories):
    events.append(target)
    if target==str(plan['targets']['control']):
     for name,raw in files.items():
      file=Path(folder)/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(raw);file.chmod(modes[name])
     self.assertEqual(subprocess.run([str(Path(folder)/'native')],check=False).returncode,0)
     self.assertEqual((Path(folder)/'scripts/entry.py').stat().st_mode&0o777,0o600)
   result=m.transaction(plan,a,publish=publish,observe_absent=lambda _:True,validate_sudo=lambda _:True,receipt=lambda name,value:None)
  self.assertTrue(result['installed']);self.assertTrue(events[-1].startswith('/etc/sudoers.d/'))
 def test_cas_or_sudo_failure_cannot_activate_sudo(self):
  plan,a=self.plan();events=[]
  with self.assertRaisesRegex(ValueError,'INSTALL_CAS_CHANGED'):m.transaction(plan,a,publish=lambda *args:events.append(args[0]),observe_absent=lambda _:False,validate_sudo=lambda _:True,receipt=lambda *_:None)
  self.assertFalse(events)
  with self.assertRaisesRegex(ValueError,'SUDO_VALIDATION_FAILED'):m.transaction(plan,a,publish=lambda *args:events.append(args[0]),observe_absent=lambda _:True,validate_sudo=lambda _:False,receipt=lambda *_:None)
  self.assertFalse(any(p.startswith('/etc/sudoers.d/')for p in events))
 def test_git_and_manifest_common_modes_are_narrowed_without_hash_changes(self):
  def common_modes(files,links,modes):
   modes['control/.git/HEAD']=0o444
   for name in files:
    if name.startswith('manifests/'):modes[name]=0o644
  raw,packed,a=self.fixture(common_modes);summary=m.validate_authority(raw,a)
  with tempfile.TemporaryDirectory()as folder:
   plan=m.inspect_archive(io.BytesIO(packed),summary,a,Path(folder))
   self.assertEqual(plan['modes']['control/.git/HEAD'],0o600)
   self.assertEqual(plan['regular']['manifests/control-runtime.json'].stat().st_mode&0o777,0o600)
   self.assertEqual(plan['modes']['control/native'],0o700)
 def test_metadata_world_write_and_regular_0644_are_rejected(self):
  for name,mode in [('control/.git/HEAD',0o666),('control/native',0o644),('manifests/links.json',0o700)]:
   raw,packed,a=self.fixture(lambda f,l,p:p.update({name:mode}));summary=m.validate_authority(raw,a)
   with self.assertRaisesRegex(ValueError,'PACKAGE_FILE_MODE'):m.inspect_archive(io.BytesIO(packed),summary,a)
 def test_streamed_staging_keeps_payload_out_of_memory(self):
  raw,packed,a=self.fixture();summary=m.validate_authority(raw,a)
  with tempfile.TemporaryDirectory()as folder:
   plan=m.inspect_archive(io.BytesIO(packed),summary,a,Path(folder));self.assertIsInstance(plan['regular']['control/native'],Path)
   self.assertEqual(plan['regular']['control/native'].stat().st_mode&0o777,0o700)
 def test_git_head_config_and_hooks_are_not_caller_controlled(self):
  for name,content,code in [('control/.git/HEAD',b'b'*40+b'\n','GIT_HEAD_IDENTITY'),('control/.git/config',b'[core]\nhooksPath=/arbitrary\n','GIT_CONFIG_SCOPE'),('control/.git/hooks/pre-commit',b'evil','GIT_MANIFEST_SCOPE')]:
   def change(files,links,modes):
    files[name]=content;modes[name]=0o600
    files['manifests/git-files.json']=encode({n[13:]:m.sha(v)for n,v in files.items()if n.startswith('control/.git/')})
   raw,packed,a=self.fixture(change);summary=m.validate_authority(raw,a)
   with self.assertRaisesRegex(ValueError,code):m.inspect_archive(io.BytesIO(packed),summary,a)
 @unittest.skipUnless(__import__('sys').platform=='linux'and os.geteuid()==os.getegid()==0,'requires disposable Linux root; no production paths')
 def test_real_linux_noreplace_native_and_cleanup(self):
  plan,a=self.plan()
  with tempfile.TemporaryDirectory(prefix='cn-complete-installer-unit-',dir='/run')as folder:
   root=Path(folder);root.chmod(0o700);target=root/'control'
   files={n[8:]:v for n,v in plan['regular'].items()if n.startswith('control/')}
   modes={n[8:]:v for n,v in plan['modes'].items()if n.startswith('control/')}
   m.publish_noreplace(target,files,{'alias':'native'},modes,['.git/refs'])
   self.assertEqual(subprocess.run([str(target/'native')],check=False).returncode,0)
   self.assertEqual((target/'native').stat().st_mode&0o777,0o700)
   self.assertEqual((target/'scripts/entry.py').stat().st_mode&0o777,0o600)
   self.assertTrue((target/'.git/refs').is_dir());before=(target/'native').read_bytes()
   with self.assertRaisesRegex(ValueError,'TARGET_COLLISION'):m.publish_noreplace(target,{'native':b'replacement'},{},{'native':0o700})
   self.assertEqual((target/'native').read_bytes(),before);self.assertFalse(list(root.glob('.complete-stage-*')))
 def test_retained_archive_descriptor_rejects_touch_same_bytes_and_swap(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);archive=root/'runtime.tar.gz';archive.write_bytes(b'unchanged')
   parent=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
   try:
    fd=os.open(archive,os.O_RDONLY);before=os.fstat(fd)
    try:
     m.assert_archive_identity(before,fd,parent)
     os.utime(archive,ns=(before.st_atime_ns,before.st_mtime_ns+1000000000))
     self.assertEqual(archive.read_bytes(),b'unchanged')
     with self.assertRaisesRegex(ValueError,'ARCHIVE_IDENTITY_CHANGED'):m.assert_archive_identity(before,fd,parent)
    finally:os.close(fd)
    fd=os.open(archive,os.O_RDONLY);before=os.fstat(fd)
    try:
     replacement=root/'replacement';replacement.write_bytes(b'unchanged');os.replace(replacement,archive)
     self.assertEqual(archive.read_bytes(),b'unchanged')
     with self.assertRaisesRegex(ValueError,'ARCHIVE_IDENTITY_CHANGED'):m.assert_archive_identity(before,fd,parent)
    finally:os.close(fd)
   finally:os.close(parent)
 def test_named_lock_swap_is_rejected_after_actual_flock(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);lock=root/'release.lock';lock.write_bytes(b'')
   parent=os.open(root,os.O_RDONLY|os.O_DIRECTORY);fd=os.open(lock,os.O_RDONLY)
   try:
    held=os.fstat(fd);m.fcntl.flock(fd,m.fcntl.LOCK_EX|m.fcntl.LOCK_NB)
    m.assert_lock_identity(held,parent)
    replacement=root/'new-lock';replacement.write_bytes(b'');os.replace(replacement,lock)
    with self.assertRaisesRegex(ValueError,'LOCK_CHANGED'):m.assert_lock_identity(held,parent)
   finally:os.close(fd);os.close(parent)
 def test_unknown_authority_and_wrong_producer_rejected(self):
  raw,packed,a=self.fixture();a['target']={**m.TARGET,'ecsInstanceId':'other'}
  with self.assertRaisesRegex(ValueError,'INSTALL_APPROVAL_SCHEMA'):m.validate_authority(raw,a)
if __name__=='__main__':unittest.main()
