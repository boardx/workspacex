import pathlib,os,stat,json,hashlib,socket
assert os.geteuid()==0 and socket.gethostname()=='workspacex-cn-prod'
root=pathlib.Path('/usr/local/lib/workspacex-cn-browser-runtime');root.mkdir(mode=0o755,exist_ok=False)
(root/'node_modules').mkdir(mode=0o755)
manifest={}
def write(p,data):
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
 with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fsync(out.fileno())
 manifest[str(p.relative_to(root))]=hashlib.sha256(data).hexdigest()
def opened_directory(path):
 fd=os.open('/',os.O_DIRECTORY|os.O_RDONLY)
 for part in pathlib.Path(path).parts[1:]:
  new=os.open(part,os.O_DIRECTORY|os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=new
 return fd
def copy(fd,dest):
 s=os.fstat(fd);assert s.st_uid==0 and not s.st_mode&0o022
 dest.mkdir(mode=0o755)
 for name in os.listdir(fd):
  s=os.stat(name,dir_fd=fd,follow_symlinks=False);assert s.st_uid==0 and not s.st_mode&0o022
  if stat.S_ISDIR(s.st_mode):
   child=os.open(name,os.O_DIRECTORY|os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
   try:copy(child,dest/name)
   finally:os.close(child)
  else:
   assert stat.S_ISREG(s.st_mode) and s.st_size<16*1024*1024
   child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
   with os.fdopen(child,'rb') as f:
    before=os.fstat(f.fileno());assert before.st_ino==s.st_ino and before.st_uid==0 and not before.st_mode&0o022
    b=f.read();after=os.fstat(f.fileno());assert (before.st_size,before.st_mtime_ns)==(after.st_size,after.st_mtime_ns)
   write(dest/name,b)
for package in ['playwright','playwright-core']:
 source='/opt/workspacex-cn/repository/node_modules/.pnpm/'+package+'@1.63.0-alpha-2026-08-31/node_modules/'+package
 fd=opened_directory(source)
 try:copy(fd,root/'node_modules'/package)
 finally:os.close(fd)
write(root/'package.json',b'{"private":true}\n')
fd=os.open(root/'manifest.json',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:json.dump(manifest,f,sort_keys=True);f.flush();os.fsync(f.fileno())
print('BROWSER_RUNTIME_FROZEN',len(manifest),'root_owned',True,'runner_writable',False)
