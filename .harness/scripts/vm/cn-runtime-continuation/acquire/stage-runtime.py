"""Fixed publication-input staging only. Does not execute publisher or canonical code."""
import os,stat,hashlib,json,base64,fcntl
from datetime import datetime,timezone
CONFIG=__CONFIG__
def need(v):
 if not v:raise ValueError('PUBLICATION_STAGE_REJECTED')
def sha(b):return hashlib.sha256(b).hexdigest()
def ident(s):return s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns
def directory(path):
 need(path.startswith('/') and '..' not in path.split('/'))
 fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:
  for part in path.split('/')[1:]:
   n=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=n;s=os.fstat(fd)
   need(s.st_uid==s.st_gid==0 and not s.st_mode&0o022)
  return fd
 except BaseException:os.close(fd);raise

def read(fd,name,digest,mode,maximum):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
 try:
  s=os.fstat(f);need(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==mode and 0<s.st_size<=maximum)
  data=b''
  while len(data)<=maximum:
   b=os.read(f,65536)
   if not b:break
   data+=b
  need(sha(data)==digest and ident(s)==ident(os.fstat(f))==ident(os.stat(name,dir_fd=fd,follow_symlinks=False)))
  return data
 finally:os.close(f)
def exists(fd,name):
 try:os.stat(name,dir_fd=fd,follow_symlinks=False);return True
 except FileNotFoundError:return False

def stage(config):
 need(os.geteuid()==os.getegid()==0);handles=[]
 try:
  lockdir=directory('/var/lib/workspacex-cn/runtime');handles.append(lockdir)
  lock=os.open('release.lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=lockdir);handles.append(lock);s=os.fstat(lock)
  need(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600)
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);need(ident(s)==ident(os.stat('release.lock',dir_fd=lockdir,follow_symlinks=False)))
  root=directory(config['root']);handles.append(root);need(stat.S_IMODE(os.fstat(root).st_mode)==0o700)
  tools=directory('/usr/local/lib/workspacex-cn');handles.append(tools)
  for name,digest in config['tools'].items():read(tools,name,digest,0o700,2*1024**2)
  read(root,'canonical-control.json',config['canonicalSha'],0o600,256*1024)
  inbox=directory(config['inbox']);handles.append(inbox);read(inbox,'candidate-set.json',config['setSha'],0o600,256*1024)
  data={k:base64.b64decode(v['base64'],validate=True) for k,v in config['files'].items()}
  need(set(data)=={'approval.json','candidate-plan.json','publication-intent.json','immutable-provider-response.json','candidate-revalidation.json','candidate-revalidation-policy.json'})
  for name,raw in data.items():need(sha(raw)==config['files'][name]['sha256'])
  approval=json.loads(data['approval.json']);need(approval['publishAuthorized'] is True and approval['installedToolSha256']==config['tools'])
  def fresh():need(datetime.fromisoformat(approval['issuedAt'])<=datetime.now(timezone.utc)<datetime.fromisoformat(approval['expiresAt']))
  fresh();need(not exists(root,'approval.json'))
  # Reject any conflicting file before writing; never touch canonical/node/source.
  for name in data:
   if exists(root,name):read(root,name,config['files'][name]['sha256'],0o600,1024**2)
  for name in sorted(set(data)-{'approval.json'})+['approval.json']:
   fresh()
   if exists(root,name):continue
   raw=data[name];tmp='.publication-stage-'+config['files'][name]['sha256'][:24]+'-'+name
   f=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=root)
   with os.fdopen(f,'wb') as out:os.fchmod(out.fileno(),0o600);out.write(raw);out.flush();os.fsync(out.fileno())
   read(root,tmp,config['files'][name]['sha256'],0o600,1024**2);fresh()
   os.link(tmp,name,src_dir_fd=root,dst_dir_fd=root,follow_symlinks=False);os.unlink(tmp,dir_fd=root);os.fsync(root)
   read(root,name,config['files'][name]['sha256'],0o600,1024**2)
  print(json.dumps({'ok':True,'staged':6,'approvalSha256':config['files']['approval.json']['sha256'],'publisherCalled':False,'canonicalModified':False}))
 finally:
  for f in reversed(handles):os.close(f)
if __name__=='__main__':
 try:stage(CONFIG)
 except BaseException:
  print('{"ok":false,"code":"PUBLICATION_STAGE_REJECTED_NO_RETRY"}');raise SystemExit(1)
