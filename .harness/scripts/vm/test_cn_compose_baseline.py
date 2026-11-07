"""Filesystem/Compose protocol fixtures; not live production baseline evidence."""
import copy
import importlib.util
import json
import io
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('baseline',Path(__file__).with_name('cn_compose_baseline.py'))
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)

class BaselineTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.runtime=self.root/'runtime';self.runtime.mkdir(mode=0o700)
  self.dirs=[self.runtime/n for n in ('a1cb4c-newdb-20261006','maintenance-compose-v1','upgrade-f0eb-switch')]
  for d in self.dirs:d.mkdir(mode=0o700)
  self.files=[str(d/n) for d,n in zip(self.dirs,('compose.json','candidate-images.json','switch-images.json'))]
  self.images={s:'sha256:'+str(i+1)*64 for i,s in enumerate(M.SERVICES)};self.source='f'*40
  self.refs={s:'registry.example/'+s+'@'+image for s,image in self.images.items()}
  for path in self.files:self.write(path,{'services':{s:{'image':ref,'environment':{'PRIVATE':'SECRET_NEVER_PRINT'}} for s,ref in self.refs.items()}})
  (self.dirs[0]/'secrets').mkdir(mode=0o700);self.write(self.dirs[0]/'bootstrap.env',b'PASSWORD=SECRET_NEVER_PRINT\n')
  self.nginx=self.root/'nginx.conf';self.write(self.nginx,b'private nginx config\n');os.chmod(self.nginx,0o644)
  self.stable=self.root/'stable-secrets';self.stable.mkdir(mode=0o700)
  self.containers=[]
  for index,s in enumerate(M.SERVICES):self.containers.append({'Id':str(index+1)*64,'Name':f'/workspacex-cn-{s}-1','Image':self.images[s],'Config':{'Image':self.refs[s],'Labels':{'com.docker.compose.project':M.PROJECT,'com.docker.compose.service':s,'com.docker.compose.project.config_files':','.join(self.files)}},'State':{'Running':True,'Restarting':False}})
  self.calls=[]
  # Only fixture uid/gid/ancestor scope are adapted for non-root macOS unit tests.
  # The actual reader still uses lstat/O_NOFOLLOW/nlink/mode/hash checks.
  self.patches=[patch.object(M,'ROOT',self.runtime),patch.object(M,'NGINX',self.nginx),patch.object(M,'STABLE',self.stable),patch.object(M,'TRUSTED_UID',os.getuid()),patch.object(M,'TRUSTED_GID',os.getgid()),patch.object(M,'protected_parents',self.parents),patch.object(M,'docker',self.docker)]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def write(self,path,value):
  Path(path).write_bytes(value if isinstance(value,bytes) else json.dumps(value).encode());os.chmod(path,0o600)
 def parents(self,path):
  path=Path(path);M.require(path.is_absolute() and path.is_relative_to(self.root) and '..' not in path.parts)
  for directory in path.parents:
   if not directory.is_relative_to(self.root):break
   info=directory.lstat();M.require(stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid() and not info.st_mode&0o022)
 def docker(self,*args):
  self.calls.append(args)
  if args[0]=='inspect':return copy.deepcopy(self.containers)
  if args[:2]==('image','inspect'):
   ref=args[2];image=ref.split('@')[-1]
   M.require(image in self.images.values())
   return [{'Id':image,'Config':{'Labels':{'org.opencontainers.image.revision':self.source}}}]
  self.assertEqual(args[:5],('compose','--env-file','/dev/null','-p',M.PROJECT))
  self.assertEqual(args[-4:],('config','--format','json','--no-interpolate'))
  files=[args[i+1] for i,v in enumerate(args) if v=='-f'];services={}
  for p in files:
   for s,value in json.loads(Path(p).read_bytes())['services'].items():services.setdefault(s,{}).update(value)
  return {'name':M.PROJECT,'services':services}
 def save(self,value):
  path=self.runtime/'snapshot.json';self.write(path,value);return path
 def test_three_ordered_files_live_images_and_source_are_bound_without_secret_values(self):
  value=M.capture();self.assertEqual(value['schemaVersion'],2);self.assertEqual(value['sourceRevision'],self.source)
  self.assertEqual(value['baselineRuntime'],str(self.dirs[0]));self.assertEqual([r['path'] for r in value['composeFiles']],self.files)
  self.assertNotIn('SECRET_NEVER_PRINT',json.dumps(value));self.assertEqual(M.load(self.save(value)),value)
  self.assertEqual(M.stable_identity(value),{'directory':str(self.dirs[0]/'secrets'),'legacy':True})
 def test_file_drift_missing_files_symlink_hardlink_and_writable_mode_fail(self):
  value=M.capture();snapshot=self.save(value);target=Path(self.files[1]);original=target.read_bytes()
  self.write(target,original+b' ')
  with self.assertRaises(M.Rejected):M.load(snapshot)
  target.unlink()
  with self.assertRaises(OSError):M.capture()
  target.symlink_to(self.files[0])
  with self.assertRaises(M.Rejected):M.capture()
  target.unlink();os.link(self.files[0],target)
  with self.assertRaises(M.Rejected):M.capture()
  target.unlink();self.write(target,original);os.chmod(target,0o640)
  with self.assertRaises(M.Rejected):M.capture()
 def test_file_order_and_actual_image_mismatch_fail(self):
  value=M.capture();value['composeFiles'].reverse()
  with self.assertRaises(M.Rejected):M.load(self.save(value))
  self.containers[0]['Image']='sha256:'+'a'*64
  with self.assertRaises(M.Rejected):M.capture()
 def test_foreign_project_duplicate_container_or_differing_file_lists_fail(self):
  for mutate in (lambda c:c[0]['Config']['Labels'].update({'com.docker.compose.project':'foreign'}),lambda c:c[1].update(Id=c[0]['Id']),lambda c:c[1]['Config']['Labels'].update({'com.docker.compose.project.config_files':self.files[0]}),lambda c:c[0]['State'].update(Restarting=True),lambda c:c[0]['Config'].update(Image='registry.example/api:latest')):
   original=copy.deepcopy(self.containers);mutate(self.containers)
   with self.assertRaises(M.Rejected):M.capture()
   self.containers=original
 def test_mixed_image_source_or_missing_container_is_rejected(self):
  original=self.docker
  def mixed(*args):
   result=original(*args)
   if args[:2]==('image','inspect') and args[2]==self.refs['api']:result[0]['Config']['Labels']['org.opencontainers.image.revision']='a'*40
   return result
  with patch.object(M,'docker',mixed):
   with self.assertRaises(M.Rejected):M.capture()
  self.containers.pop()
  with self.assertRaises(M.Rejected):M.capture()
 def test_stable_ref_is_exact_protected_directory_and_bootstrap_is_not_exposed(self):
  value=M.capture();self.write(self.dirs[0]/'stable-secret-directory.ref',(str(self.stable)+'\n').encode())
  self.assertEqual(M.stable_identity(value),{'directory':str(self.stable),'legacy':False})
  self.write(self.dirs[0]/'stable-secret-directory.ref',b'/untrusted\n')
  with self.assertRaises(M.Rejected):M.stable_identity(value)
 def test_capture_stdout_and_file_have_identical_fingerprint_bytes(self):
  path=self.runtime/'cli-snapshot.json';output=io.StringIO()
  with patch.object(M.os,'geteuid',return_value=0),patch.object(M.sys,'argv',['helper','capture',str(path)]),patch.object(M.sys,'stdout',output):M.main()
  self.assertEqual(path.read_bytes(),output.getvalue().encode())
 def test_v1_single_compose_snapshot_remains_readable(self):
  self.containers=[dict(c,Config={**c['Config'],'Labels':{**c['Config']['Labels'],'com.docker.compose.project.config_files':self.files[0]}}) for c in self.containers]
  current=M.capture();v1={k:current[k] for k in ('composeFile','images','nginxSha256')};v1['schemaVersion']=1
  value=M.load(self.save(v1));self.assertEqual(value['sourceRevision'],self.source);self.assertEqual(len(value['composeFiles']),1)
 def test_restore_preserves_all_files_and_durable_exact_image_override(self):
  value=M.capture();commands=[]
  with patch.object(M.subprocess,'run',side_effect=lambda command,**kwargs:commands.append(command)):
   result=M.restore(value)
  override=Path(result['rollbackComposeFile']);self.assertTrue(override.exists());self.assertEqual(stat.S_IMODE(override.stat().st_mode),0o600)
  expected={'services':{s:{'image':image} for s,image in self.images.items()}}
  self.assertEqual(json.loads(override.read_bytes()),expected)
  command=commands[0];files=[command[i+1] for i,v in enumerate(command) if v=='-f'];self.assertEqual(files,self.files+[str(override)])
  for c in self.containers:c['Config']['Labels']['com.docker.compose.project.config_files']=','.join(files)
  M.live_matches(value)
  self.write(override,{'services':{'api':{'image':self.images['api'],'environment':{'UNADMITTED':'change'}}}})
  with self.assertRaises(M.Rejected):M.live_matches(value)

if __name__=='__main__':unittest.main()
