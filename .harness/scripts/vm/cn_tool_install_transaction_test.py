import importlib.util,pathlib,tempfile,os,stat,unittest
spec=importlib.util.spec_from_file_location('transaction',pathlib.Path(__file__).with_name('cn-tool-install-transaction.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def run_case(self,kind):
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);backup=root/'backup';backup.mkdir(mode=0o700);a=root/'a';b=root/'b';a.write_bytes(b'old');a.chmod(0o644)
   uid=os.getuid();gid=os.getgid();old={'sha256':m.sha(b'old'),'uid':uid,'gid':gid,'mode':0o644,'nlink':1}
   targets=[{'destination':str(a),'payload':'a','sha256':m.sha(b'new'),'before':old,'mode':0o755,'uid':uid,'gid':gid},{'destination':str(b),'payload':'b','sha256':m.sha(b'next'),'before':{'absent':True},'mode':0o600,'uid':uid,'gid':gid}]
   def inject(i):
    if i==1 and kind=='foreign':
     tmp=root/'foreign';tmp.write_bytes(b'new');tmp.chmod(0o755);os.replace(tmp,a);raise RuntimeError('fault')
    if i==1 and kind=='fault':raise RuntimeError('fault')
   if kind=='success':m.transaction(targets,{'a':b'new','b':b'next'},backup,uid,gid,root);self.assertEqual(a.read_bytes(),b'new');self.assertEqual(b.read_bytes(),b'next')
   else:
    with self.assertRaises(RuntimeError):m.transaction(targets,{'a':b'new','b':b'next'},backup,uid,gid,root,inject)
    self.assertFalse(b.exists())
    if kind=='fault':self.assertEqual(a.read_bytes(),b'old')
    else:self.assertEqual(a.read_bytes(),b'new');self.assertTrue((backup/'diagnosis.json').exists())
 def test_old_profile_allowlist_is_independent_and_complete(self):
  files={'schema':None,'script':'/usr/local/lib/old.py'};content={'filesSha256':{'schema':'a'*64,'script':'b'*64}};inv={'files':{'schema':{'target':None},'script':{'target':'/usr/local/lib/old.py'}}}
  m.old_profile_allowlist(content,files,inv)
  for missing in files:
   with self.subTest(missing=missing),self.assertRaises(Exception):m.old_profile_allowlist({'filesSha256':{k:v for k,v in content['filesSha256'].items() if k!=missing}},files,inv)
  with self.assertRaises(Exception):m.old_profile_allowlist(content,files,{'files':{'schema':{'target':None},'script':{'target':'/usr/local/lib/foreign.py'}}})
 def test_success(self):self.run_case('success')
 def test_late_failure_restores_old_and_absent(self):self.run_case('fault')
 def test_same_bytes_foreign_inode_preserved(self):self.run_case('foreign')
 def test_git_trust_rejects_symlink_gitfile_includes_and_filters(self):
  for kind in ('symlink','gitfile','include','filter'):
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as t:
    root=pathlib.Path(t);root.chmod(0o700);gd=root/'.git'
    if kind=='symlink':gd.symlink_to(root,target_is_directory=True)
    elif kind=='gitfile':gd.write_text('gitdir: elsewhere')
    else:
     gd.mkdir(mode=0o700);(gd/'objects').mkdir();(gd/'refs').mkdir();(gd/'HEAD').write_text('ref: refs/heads/main');(gd/'config').write_text('[%s]\n value = forbidden\n'%kind)
    with self.assertRaises(RuntimeError):m.trust_git(root,os.getuid(),root)
 def test_sigkill_recovery_and_interrupted_recovery(self):
  import signal
  for stop in (0,1):
   with self.subTest(stop=stop),tempfile.TemporaryDirectory() as t:
    root=pathlib.Path(t);root.chmod(0o700);backup=root/'backup';backup.mkdir(mode=0o700);a=root/'a';b=root/'b';a.write_bytes(b'old');a.chmod(0o644);uid=os.getuid();gid=os.getgid()
    before={'sha256':m.sha(b'old'),'uid':uid,'gid':gid,'mode':0o644,'nlink':1}
    targets=[{'destination':str(a),'payload':'a','sha256':m.sha(b'new'),'before':before,'mode':0o755,'uid':uid,'gid':gid},{'destination':str(b),'payload':'b','sha256':m.sha(b'next'),'before':{'absent':True},'mode':0o600,'uid':uid,'gid':gid}]
    pid=os.fork()
    if pid==0:
     def kill(i):
      if i==stop:os.kill(os.getpid(),signal.SIGKILL)
     m.transaction(targets,{'a':b'new','b':b'next'},backup,uid,gid,root,kill);os._exit(9)
    _,status=os.waitpid(pid,0);self.assertEqual(os.WTERMSIG(status),signal.SIGKILL)
    # Kill recovery after restoring a file, before its final journal state.
    pid=os.fork()
    if pid==0:
     m.recover(backup,uid,gid,root,lambda i:os.kill(os.getpid(),signal.SIGKILL));os._exit(9)
    _,status=os.waitpid(pid,0);self.assertEqual(os.WTERMSIG(status),signal.SIGKILL)
    self.assertTrue(m.recover(backup,uid,gid,root)['recovered']);self.assertEqual(a.read_bytes(),b'old');self.assertFalse(b.exists())
    self.assertTrue(m.recover(backup,uid,gid,root)['recovered'])
 def test_recovery_foreign_inode_preserves_evidence(self):
  import signal
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);backup=root/'backup';backup.mkdir(mode=0o700);a=root/'a';uid=os.getuid();gid=os.getgid()
   x={'destination':str(a),'payload':'a','sha256':m.sha(b'new'),'before':{'absent':True},'mode':0o600,'uid':uid,'gid':gid}
   pid=os.fork()
   if pid==0:m.transaction([x],{'a':b'new'},backup,uid,gid,root,lambda i:os.kill(os.getpid(),signal.SIGKILL));os._exit(9)
   os.waitpid(pid,0);f=root/'foreign';f.write_bytes(b'new');f.chmod(0o600);os.replace(f,a)
   with self.assertRaisesRegex(RuntimeError,'RECOVERY_INCOMPLETE'):m.recover(backup,uid,gid,root)
   self.assertEqual(a.read_bytes(),b'new');self.assertIn('RECOVERY_FOREIGN_INODE',(backup/'journal.json').read_text())
 def test_fd9_rejects_actual_foreign_lock_holder(self):
  import fcntl
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);lock=root/'release.lock';lock.write_bytes(b'');lock.chmod(0o600);fd=os.open(lock,os.O_RDWR);rd,wr=os.pipe();pid=os.fork()
   if pid==0:
    os.close(rd);os.close(fd);foreign=os.open(lock,os.O_RDWR);fcntl.flock(foreign,fcntl.LOCK_EX);os.write(wr,b'locked');os.close(wr);os.read(os.open('/dev/null',os.O_RDONLY),1)
    # Keep flock held until parent sends SIGTERM.
    import signal
    signal.pause();os._exit(0)
   os.close(wr)
   try:
    self.assertEqual(os.read(rd,6),b'locked')
    with self.assertRaisesRegex(RuntimeError,'FD9_FOREIGN_LOCK_HOLDER'):m.inherited_lock(lock,fd,os.getuid(),os.getgid(),root)
   finally:
    import signal
    os.kill(pid,signal.SIGTERM);os.waitpid(pid,0);os.close(rd)
   try:
    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);m.inherited_lock(lock,fd,os.getuid(),os.getgid(),root)
   finally:os.close(fd)
 def test_injection_is_after_rename_before_destination_fsync(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);backup=root/'backup';backup.mkdir(mode=0o700);a=root/'a';uid=os.getuid();gid=os.getgid();synced=[];actual=os.fsync;parentino=m.identity(root.stat())
   x={'destination':str(a),'payload':'a','sha256':m.sha(b'new'),'before':{'absent':True},'mode':0o600,'uid':uid,'gid':gid}
   def sync(fd):
    if m.identity(os.fstat(fd))==parentino and a.exists():synced.append(True)
    actual(fd)
   def inject(i):self.assertEqual(a.read_bytes(),b'new');self.assertEqual(synced,[])
   with patch.object(m.os,'fsync',sync):m.transaction([x],{'a':b'new'},backup,uid,gid,root,inject)
   self.assertTrue(synced)
 def test_reviewed_recovery_protocol(self):
  import json,signal
  for case in ('valid','arbitrary-target','wrong-manifest','wrong-hash','escape','symlink','stage-escape'):
   with self.subTest(case=case),tempfile.TemporaryDirectory() as t:
    root=pathlib.Path(t);root.chmod(0o700);backups=root/'backups';backups.mkdir(mode=0o700);backup=backups/'exact-fixture123';backup.mkdir(mode=0o700);a=root/'a';uid=os.getuid();gid=os.getgid()
    x={'destination':str(a),'payload':'a','sha256':m.sha(b'new'),'before':{'absent':True},'mode':0o600,'uid':uid,'gid':gid};targets=[x];binding=m.manifest_binding('a'*64,'b'*40,targets)
    pid=os.fork()
    if pid==0:m.transaction(targets,{'a':b'new'},backup,uid,gid,root,lambda i:os.kill(os.getpid(),signal.SIGKILL),binding);os._exit(9)
    os.waitpid(pid,0);jp=backup/'journal.json';raw=jp.read_bytes();basename=backup.name
    if case in ('arbitrary-target','stage-escape'):
     j=json.loads(raw)
     if case=='arbitrary-target':j['entries'][0]['target']['destination']=str(root/'foreign')
     else:j['entries'][0]['stage']='../foreign'
     raw=json.dumps(j).encode();jp.write_bytes(raw)
    if case=='wrong-manifest':binding=dict(binding,manifestSha256='c'*64)
    if case=='escape':basename='../exact-fixture123'
    if case=='symlink':(backups/'exact-symlink123').symlink_to(backup,target_is_directory=True);basename='exact-symlink123'
    digest=m.sha(raw) if case!='wrong-hash' else '0'*64
    if case=='valid':
     result=m.reviewed_recovery(backups,basename,digest,binding,targets,uid,gid,root);self.assertTrue(result['recovered']);self.assertFalse(a.exists())
    else:
     with self.assertRaises((RuntimeError,OSError)):m.reviewed_recovery(backups,basename,digest,binding,targets,uid,gid,root)
     self.assertEqual(a.read_bytes(),b'new');self.assertEqual(jp.read_bytes(),raw)
 def test_profile_v1_authority_and_evidence(self):
  import json,copy,datetime
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);target=str(root/'profile.json');source='.harness/scripts/vm/cn_maintenance_hold.py';consumer=("profile=Path(%r)\nbinding=read(profile,0o600)\n"%target).encode();now=1900000000.0;observed=datetime.datetime.fromtimestamp(now-10,datetime.timezone.utc).isoformat();expected={'region':'test-region','instanceId':'test-instance','sourceInvocation':'test-invoke','commandId':'test-command'}
   old={'present':False,'regular':False,'symlink':False,'sha256':None,'mode':None,'uid':None,'gid':None,'links':None}
   inv={'schemaVersion':1,'readOnly':True,'ready':False,'sourceInvocation':expected['sourceInvocation'],'observedAt':observed,'profiles':{target:old},'files':{source:dict(old,target='/usr/local/lib/test-hold.py')}};ir=(json.dumps(inv,sort_keys=True)+'\n').encode();remote=dict(inv);del remote['sourceInvocation'];output=(json.dumps(remote,sort_keys=True)+'\n').encode();receipt=dict(expected,schemaVersion=1,invocationStatus='Success',exitCode=0,dropped=0,readOnly=True,productionModified=False,localInventorySha256=m.sha(ir),inventoryObservedAt=observed,outputSha256=m.sha(output),startTime=observed,finishTime=None);rr=json.dumps(receipt).encode()
   row={'target':'/usr/local/lib/test-hold.py','mode':'0700','oldPresent':False,'oldSha256':None,'oldMode':None,'oldUid':None,'oldGid':None,'oldNlink':None,'newSha256':m.sha(consumer),'bytes':len(consumer)};content={'toolRevision':'b'*40,'filesSha256':{source:m.sha(consumer)}};contentraw=(json.dumps(content,sort_keys=True)+'\n').encode();p={'schemaVersion':1,'kind':'reviewed-profile-create-proposal','inventoryEvidenceRef':'inventoryEvidenceV1','consumerSource':source,'consumerSha256':m.sha(consumer),'target':target,'mode':'0600','uid':0,'gid':0,'links':1,'content':content,'newSha256':m.sha(contentraw),'bytes':len(contentraw),'oldPresent':False,'oldIdentity':old,'previousInventorySha256':m.sha(ir),'inventoryObservedAt':observed,'inventorySourceInvocation':expected['sourceInvocation']};manifest={'toolRevision':'b'*40,'files':{source:row},'profileTransactionsV1':[p],'previousInventorySha256':m.sha(ir),'inventoryObservedAt':observed,'inventorySourceInvocation':expected['sourceInvocation']}
   pt,raw=m.profile_transaction(manifest,consumer,ir,rr,expected,now);self.assertEqual(pt['destination'],target);self.assertEqual(raw,contentraw)
   for key,value in [('target',str(root/'other')),('mode','0644'),('content',dict(content,toolRevision='c'*40)),('oldIdentity',dict(old,present=True)),('previousInventorySha256','0'*64)]:
    with self.subTest(key=key):
     bad=copy.deepcopy(manifest);bad['profileTransactionsV1'][0][key]=value
     with self.assertRaises(RuntimeError):m.profile_transaction(bad,consumer,ir,rr,expected,now)
   for key,value in [('instanceId','foreign'),('sourceInvocation','foreign'),('commandId','foreign'),('outputSha256','0'*64),('localInventorySha256','0'*64),('exitCode',1),('dropped',1)]:
    with self.subTest(receipt=key):
     bad=dict(receipt);bad[key]=value
     with self.assertRaises(RuntimeError):m.profile_transaction(manifest,consumer,ir,json.dumps(bad).encode(),expected,now)
   with self.assertRaisesRegex(RuntimeError,'FRESHNESS'):m.profile_transaction(manifest,consumer,ir,rr,expected,now+3601)
   bad=dict(manifest,toolRevision=None)
   with self.assertRaisesRegex(RuntimeError,'EXACT_TOOL'):m.profile_transaction(bad,consumer,ir,rr,expected,now)
   # Replacement uses fresh raw old bytes and flows into existing durable CAS/rollback.
   import base64
   oldcontent={'toolRevision':'a'*40,'filesSha256':{source:m.sha(consumer)}};oldraw=(json.dumps(oldcontent,sort_keys=True)+'\n').encode()
   present={'present':True,'regular':True,'symlink':False,'sha256':m.sha(oldraw),'mode':'0600','uid':0,'gid':0,'links':1,'rawBase64':base64.b64encode(oldraw).decode()}
   inv['profiles'][target]=present;inv['files'][source].update(present=True,regular=True,sha256=m.sha(consumer),mode='0700',uid=0,gid=0,links=1)
   oldcontent={'toolRevision':'a'*40,'filesSha256':{source:m.sha(consumer)}}
   ir=(json.dumps(inv,sort_keys=True)+'\n').encode();remote=dict(inv);del remote['sourceInvocation'];receipt.update(localInventorySha256=m.sha(ir),outputSha256=m.sha((json.dumps(remote,sort_keys=True)+'\n').encode()));rr=json.dumps(receipt).encode()
   row.update(oldPresent=True,oldSha256=m.sha(consumer),oldMode='0700',oldUid=0,oldGid=0,oldNlink=1)
   p.update(kind='reviewed-profile-replace-proposal',oldPresent=True,oldIdentity=present,previousInventorySha256=m.sha(ir));manifest['previousInventorySha256']=m.sha(ir)
   replaced,unused=m.profile_transaction(manifest,consumer,ir,rr,expected,now);self.assertEqual(replaced['before'],{'sha256':m.sha(oldraw),'mode':0o600,'uid':0,'gid':0,'nlink':1})
   bad=copy.deepcopy(manifest);bad['profileTransactionsV1'][0]['kind']='reviewed-profile-create-proposal'
   with self.assertRaisesRegex(RuntimeError,'PROFILE_OPERATION'):m.profile_transaction(bad,consumer,ir,rr,expected,now)
   # Profile is an ordinary member of the exact same transaction and recovery journal.
   backup=root/'backup';backup.mkdir(mode=0o700);script=root/'script';script.write_bytes(b'old');script.chmod(0o600);uid=os.getuid();gid=os.getgid();pt=dict(pt,uid=uid,gid=gid)
   x={'destination':str(script),'payload':'script','before':{'sha256':m.sha(b'old'),'uid':uid,'gid':gid,'mode':0o600,'nlink':1},'sha256':m.sha(b'new'),'mode':0o700,'uid':uid,'gid':gid}
   def fault(i):
    if i==1:raise RuntimeError('after-profile')
   with self.assertRaisesRegex(RuntimeError,'after-profile'):m.transaction([x,pt],{'script':b'new',pt['payload']:raw},backup,uid,gid,root,fault)
   self.assertEqual(script.read_bytes(),b'old');self.assertFalse(pathlib.Path(target).exists());journal=json.loads((backup/'journal.json').read_text());self.assertEqual(len(journal['entries']),2);self.assertEqual(journal['state'],'recovered')
   # Production protocol uses the immutable installation admission time even after TTL.
   import signal
   backups=root/'backups';backups.mkdir(mode=0o700);backup2=backups/'exact-admission123';backup2.mkdir(mode=0o700)
   binding=m.manifest_binding('a'*64,manifest['toolRevision'],[x,pt],now)
   pid=os.fork()
   if pid==0:m.transaction([x,pt],{'script':b'new',pt['payload']:raw},backup2,uid,gid,root,lambda i:os.kill(os.getpid(),signal.SIGKILL) if i==1 else None,binding);os._exit(9)
   os.waitpid(pid,0);jp=backup2/'journal.json';bp=backup2/'manifest-binding.json';original=jp.read_bytes();originalbinding=bp.read_bytes();later=now+7200
   admitted=m.recovery_admission(backups,backup2.name,m.sha(original),'a'*64,later,uid,gid,root)
   self.assertEqual(admitted['admittedAt'],now)
   with self.assertRaisesRegex(RuntimeError,'FRESHNESS'):m.profile_transaction(manifest,consumer,ir,rr,expected,later)
   m.profile_transaction(manifest,consumer,ir,rr,expected,admitted['admittedAt'])
   for case in ('tampered','missing','future','expired-at-install'):
    with self.subTest(admission=case):
     j=json.loads(original);b=json.loads(originalbinding)
     if case=='tampered':j['binding']['admittedAt']=now+1
     elif case=='missing':j['binding'].pop('admittedAt');b.pop('admittedAt')
     elif case=='future':j['binding']['admittedAt']=later+1;b['admittedAt']=later+1
     else:j['binding']['admittedAt']=now+3601;b['admittedAt']=now+3601
     changed=json.dumps(j).encode();jp.write_bytes(changed);bp.write_text(json.dumps(b))
     if case=='expired-at-install':
      rejected=m.recovery_admission(backups,backup2.name,m.sha(changed),'a'*64,later,uid,gid,root)
      with self.assertRaisesRegex(RuntimeError,'FRESHNESS'):m.profile_transaction(manifest,consumer,ir,rr,expected,rejected['admittedAt'])
     else:
      with self.assertRaises(RuntimeError):m.recovery_admission(backups,backup2.name,m.sha(changed),'a'*64,later,uid,gid,root)
     self.assertEqual(jp.read_bytes(),changed);self.assertTrue(pathlib.Path(target).exists())
   jp.write_bytes(original);bp.write_bytes(originalbinding)
   self.assertTrue(m.reviewed_recovery(backups,backup2.name,m.sha(original),admitted,[x,pt],uid,gid,root)['recovered'])
   self.assertFalse(pathlib.Path(target).exists());self.assertEqual(script.read_bytes(),b'old')
   # Exact existing profile bytes are durably retained and restored on failed replacement.
   path=pathlib.Path(target);path.write_bytes(oldraw);path.chmod(0o600);backup3=root/'replace-backup';backup3.mkdir(mode=0o700)
   replaced=dict(replaced,uid=uid,gid=gid,before=dict(replaced['before'],uid=uid,gid=gid))
   def fail_replace(i):raise RuntimeError('replacement-fixture-interrupt')
   with self.assertRaisesRegex(RuntimeError,'replacement-fixture-interrupt'):m.transaction([replaced],{replaced['payload']:raw},backup3,uid,gid,root,fail_replace)
   self.assertEqual(path.read_bytes(),oldraw);self.assertEqual((backup3/'0.before').read_bytes(),oldraw);self.assertEqual(json.loads((backup3/'journal.json').read_text())['state'],'recovered')

 def test_exclusive_absent_create_link_window_recovery(self):
  import signal
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);backup=root/'backup';backup.mkdir(mode=0o700);a=root/'profile';uid=os.getuid();gid=os.getgid();x={'destination':str(a),'payload':'a','sha256':m.sha(b'new'),'before':{'absent':True},'mode':0o600,'uid':uid,'gid':gid}
   pid=os.fork()
   if pid==0:
    link=os.link
    def killed_link(*args,**kwargs):link(*args,**kwargs);os.kill(os.getpid(),signal.SIGKILL)
    with patch.object(m.os,'link',killed_link):m.transaction([x],{'a':b'new'},backup,uid,gid,root)
    os._exit(9)
   _,status=os.waitpid(pid,0);self.assertEqual(os.WTERMSIG(status),signal.SIGKILL);self.assertEqual(a.stat().st_nlink,2)
   self.assertTrue(m.recover(backup,uid,gid,root)['recovered']);self.assertFalse(a.exists())
 def test_exclusive_absent_create_does_not_replace_foreign(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as t:
   root=pathlib.Path(t);root.chmod(0o700);backup=root/'backup';backup.mkdir(mode=0o700);a=root/'profile';uid=os.getuid();gid=os.getgid();x={'destination':str(a),'payload':'a','sha256':m.sha(b'new'),'before':{'absent':True},'mode':0o600,'uid':uid,'gid':gid};link=os.link
   def raced_link(*args,**kwargs):a.write_bytes(b'foreign');a.chmod(0o600);return link(*args,**kwargs)
   with patch.object(m.os,'link',raced_link),self.assertRaises(RuntimeError):m.transaction([x],{'a':b'new'},backup,uid,gid,root)
   self.assertEqual(a.read_bytes(),b'foreign')
if __name__=='__main__':unittest.main()
