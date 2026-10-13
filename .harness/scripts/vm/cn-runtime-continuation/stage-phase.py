"""Bound stage only: canonical lock, original binding CAS, immutable receipt files.
No runtime start/stop, image pull, migration, DNS or hold mutation.
"""
import base64,fcntl,hashlib,json,os,re,stat,subprocess
from pathlib import Path
CONFIG=__CONFIG__
RUNTIME=Path('/var/lib/workspacex-cn/runtime')
ALLOWED={'binding.json','upgrade-draft.py','backup-host.py','sessions-after-stop.py','sessions-after-stop.sh','sessions-check-pins.json','switch-images.json','rollback-images.json','stop-receipt.json','backup-result.json','rds-backup-receipt.json','known-five-stop.json'}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def private(path):
 for parent in path.parents:
  s=parent.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb')as f:
  s=os.fstat(f.fileno());assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=1048576
  return f.read()
def write_new(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 assert private(path)==raw

def stage(c):
 assert os.geteuid()==os.getegid()==0
 root=Path(c['root']);assert root.parent==RUNTIME and re.fullmatch('upgrade-f0eb-[a-z0-9-]{1,64}',root.name)
 assert set(c['files'])<=ALLOWED and 'binding.json'in c['files']
 data={k:base64.b64decode(v['base64'],validate=True)for k,v in c['files'].items()}
 for name,raw in data.items():assert len(raw)<=1048576 and sha(raw)==c['files'][name]['sha256']
 b=json.loads(data['binding.json']);assert b['draft'] is False and b['sourceRevision']=='f0eb9d07398a66fdd5646a9e6b855fa1b940e571' and b['baselineRevision']=='5285bef9a6c91bbb9857ede42779aafa64b98f32'
 import datetime
 now=datetime.datetime.now(datetime.timezone.utc);assert datetime.datetime.fromisoformat(b['issuedAt'])<=now<datetime.datetime.fromisoformat(b['expiresAt'])
 lock=os.open(RUNTIME/'release.lock',os.O_RDWR|os.O_NOFOLLOW);s=os.fstat(lock);assert stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  for parent in [RUNTIME,*RUNTIME.parents]:
   s=parent.lstat();assert stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
  helper=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py');assert sha(helper.read_bytes())==b['holdHelperSha256']
  h=json.loads(subprocess.check_output(['/usr/bin/python3','-I','-S','-B',str(helper),'read',str(RUNTIME)],stderr=subprocess.DEVNULL,timeout=30))
  assert h==(b['previousHold']if c['phase']=='hold'else b['hold'])
  for item in b['composeFiles']+b['envFiles']:assert sha(private(Path(item['path'])))==item['sha256']
  previous=c['expectedOldBindingSha256']
  if previous is None:
   assert c['phase']=='hold' and not root.exists() and not root.is_symlink()
   old_raw=None
  else:
   assert re.fullmatch('[a-f0-9]{64}',previous)
   assert stat.S_IMODE(root.lstat().st_mode)==0o700
   old_raw=private(root/'binding.json');assert sha(old_raw)==previous,'BINDING_CAS_CHANGED'
   old=json.loads(old_raw)
   fixed=('sourceRevision','baselineRevision','attemptId','candidateImages','rollbackImages','expectedContainers','composeFiles','envFiles','workingDir','migrationDiffEvidenceSha256','scriptSha256','backupHelperSha256','sessionsHelperSha256','holdHelperSha256')
   assert all(old[k]==b[k]for k in fixed),'IMMUTABLE_ATTEMPT_CHANGED'
   if old['hold'] is not None:assert old['hold']==b['hold']
  # Check collisions before creating any file; only binding/pins are phase pointers.
  for name,raw in data.items():
   if name in ('binding.json','sessions-check-pins.json'):continue
   if root.exists() and (root/name).exists():assert private(root/name)==raw,'EXISTING_FILE_DRIFT'
  os.umask(0o077)
  if old_raw is None:root.mkdir(mode=0o700)
  versions=root/'bindings'
  if not versions.exists():versions.mkdir(mode=0o700)
  for raw in ([old_raw]if old_raw is not None else [])+[data['binding.json']]:
   p=versions/(sha(raw)+'.json')
   if p.exists():assert private(p)==raw
   else:write_new(p,raw)
  for name,raw in data.items():
   if name in ('binding.json','sessions-check-pins.json'):continue
   if not (root/name).exists():write_new(root/name,raw)
  # Preserve previous pins then install new phase pins before binding pointer.
  if 'sessions-check-pins.json'in data:
   path=root/'sessions-check-pins.json';new=data['sessions-check-pins.json']
   if path.exists():
    oldpins=private(path);assert json.loads(oldpins)['bindingSha256']==previous
    saved=versions/('sessions-pins-'+sha(oldpins)+'.json')
    if not saved.exists():write_new(saved,oldpins)
   temp=root/('.new-pins-'+sha(new));write_new(temp,new);os.replace(temp,path)
  if old_raw is not None:assert sha(private(root/'binding.json'))==previous
  temp=root/('.new-binding-'+sha(data['binding.json']));write_new(temp,data['binding.json']);os.replace(temp,root/'binding.json')
  fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
  assert private(root/'binding.json')==data['binding.json']
  print(json.dumps({'phase':c['phase'],'bindingSha256':sha(data['binding.json']),'oldBindingSha256':previous,'originalBindingsPreserved':True,'runtimeMutation':False,'holdChanged':False}))
 finally:os.close(lock)
if __name__=='__main__':stage(CONFIG)
