"""Root-owned bounded byte transport. Only the final complete hash-verified stage executes."""
import os,stat,hashlib,base64,json,zlib
CONFIG=__CONFIG__
def need(v):
 if not v:raise ValueError('PUBLICATION_TRANSPORT_REJECTED')
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
def read(fd,name,size,digest):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
 try:
  s=os.fstat(f);need(stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600 and s.st_size==size and 0<size<=8000)
  data=b''
  while len(data)<=size:
   b=os.read(f,min(65536,size-len(data)+1))
   if not b:break
   data+=b
  need(len(data)==size and sha(data)==digest and ident(s)==ident(os.fstat(f))==ident(os.stat(name,dir_fd=fd,follow_symlinks=False)))
  return data
 finally:os.close(f)
def execute(config):
 need(os.geteuid()==os.getegid()==0)
 parent=directory('/var/lib/workspacex-cn/runtime');fd=None
 try:
  name=config['directory'];need(name.startswith('publication-bytes-') and len(name)==82 and all(c in '0123456789abcdef' for c in name[18:]))
  if config['op']=='chunk' and config['index']==0:os.mkdir(name,0o700,dir_fd=parent);os.fsync(parent)
  fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);s=os.fstat(fd)
  need(s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700)
  if config['op']=='chunk':
   need(type(config['index'])is int and 0<=config['index']<256)
   data=base64.b64decode(config['data'],validate=True);need(0<len(data)<=8000 and len(data)==config['size'] and sha(data)==config['sha256'])
   need(set(os.listdir(fd))=={'%03d.part'%i for i in range(config['index'])})
   filename='%03d.part'%config['index'];f=os.open(filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
   with os.fdopen(f,'wb')as out:os.fchmod(out.fileno(),0o600);out.write(data);out.flush();os.fsync(out.fileno())
   os.fsync(fd);read(fd,filename,len(data),config['sha256'])
   print(json.dumps({'ok':True,'chunk':config['index'],'sha256':config['sha256'],'publisherCalled':False}))
  else:
   need(config['op']=='assemble' and 0<len(config['chunks'])<=256)
   expected={'%03d.part'%i for i in range(len(config['chunks']))};need(set(os.listdir(fd))==expected)
   compressed=b''.join(read(fd,'%03d.part'%i,v['size'],v['sha256']) for i,v in enumerate(config['chunks']))
   need(sha(compressed)==config['compressedSha256'] and len(compressed)<=1024**2)
   dec=zlib.decompressobj();data=dec.decompress(compressed,1024**2+1)
   need(dec.eof and not dec.unused_data and not dec.unconsumed_tail and 0<len(data)<=1024**2 and len(data)==config['stageSize'] and sha(data)==config['stageSha256'])
   # Durable intent prevents a second assemble after unknown acknowledgement.
   intent=os.open('assemble.intent',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
   with os.fdopen(intent,'wb') as out:out.write(config['stageSha256'].encode());out.flush();os.fsync(out.fileno())
   os.fsync(fd)
   exec(compile(data,'<reviewed-publication-stage>','exec'),{'__name__':'__main__'})
 finally:
  if fd is not None:os.close(fd)
  os.close(parent)
if __name__=='__main__':
 try:execute(CONFIG)
 except BaseException:
  print('{"ok":false,"code":"PUBLICATION_TRANSPORT_REJECTED_NO_RETRY"}');raise SystemExit(1)
