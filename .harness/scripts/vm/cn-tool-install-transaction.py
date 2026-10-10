#!/usr/bin/env python3
"""Bounded manifest-only install. Import-only fixture API; production has fixed trust roots."""
import hashlib,json,os,pathlib,stat,fcntl,signal,sys,tempfile
LOCK='/var/lib/workspacex-cn/runtime/release.lock'
BACKUPS='/var/lib/workspacex-cn/trusted-install-backups'
def require(ok,code):
 if not ok: raise RuntimeError(code)
def sha(data):return hashlib.sha256(data).hexdigest()
def identity(s):return (s.st_dev,s.st_ino)
def parent(path,uid,boundary=None):
 p=pathlib.Path(path).parent
 for d in (p,*p.parents):
  s=d.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==uid and not s.st_mode&0o022,'PARENT_TRUST')
  if boundary and d==boundary:break
 return os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
def read_at(fd,name,uid,max_bytes=8000000):
 f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
 try:
  s=os.fstat(f);require(stat.S_ISREG(s.st_mode) and s.st_uid==uid and s.st_nlink==1 and s.st_size<=max_bytes,'FILE_TRUST')
  chunks=[]
  while True:
   b=os.read(f,65536)
   if not b:break
   chunks.append(b)
  a=os.fstat(f);n=os.stat(name,dir_fd=fd,follow_symlinks=False)
  require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns) and identity(n)==identity(s),'FILE_CHANGED')
  return b''.join(chunks),s
 finally:os.close(f)
def compare(fd,name,expected,uid):
 if expected=={'absent':True}:
  try:os.stat(name,dir_fd=fd,follow_symlinks=False)
  except FileNotFoundError:return None
  raise RuntimeError('ABSENT_CAS')
 data,s=read_at(fd,name,uid)
 actual={'sha256':sha(data),'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink}
 require(actual==expected,'OLD_CAS');return data,s

def stage(fd,data,mode,uid,gid):
 name='.cn-install-'+os.urandom(16).hex();f=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
 try:
  view=memoryview(data)
  while view:view=view[os.write(f,view):]
  if os.geteuid()==0:os.fchown(f,uid,gid)
  require((os.fstat(f).st_uid,os.fstat(f).st_gid)==(uid,gid),'STAGE_OWNER')
  os.fchmod(f,mode);os.fsync(f);s=os.fstat(f)
 except BaseException:os.unlink(name,dir_fd=fd);raise
 finally:os.close(f)
 return name,s

def journal_write(fd,value,uid,gid):
 raw=(json.dumps(value,sort_keys=True)+'\n').encode();sn,ss=stage(fd,raw,0o600,uid,gid)
 os.replace(sn,'journal.json',src_dir_fd=fd,dst_dir_fd=fd);os.fsync(fd)

def validate_journal_entries(entries):
 import re
 require(isinstance(entries,list) and 0<len(entries)<=128,'JOURNAL_ENTRIES')
 require(len({row['target']['destination'] for row in entries})==len(entries),'JOURNAL_DUPLICATE_TARGET')
 for row in entries:
  for key in ('stage','restoreStage'):
   if key in row:require(isinstance(row[key],str) and re.fullmatch(r'\.cn-install-[a-f0-9]{32}',row[key]),'JOURNAL_STAGE_PATH')
  for key in ('parentInode','installedInode','oldInode','restoreInode'):
   if key not in row:continue
   value=row[key]
   require(key=='oldInode' and value is None or isinstance(value,list) and len(value)==2 and all(type(v) is int and v>=0 for v in value),'JOURNAL_INODE')
  path=pathlib.PurePosixPath(row['target']['destination']);require(path.is_absolute() and '..' not in path.parts,'JOURNAL_TARGET')

def manifest_binding(manifest_hash,tool_revision,targets,admitted_at=None):
 import re
 require(re.fullmatch('[a-f0-9]{64}',manifest_hash) and re.fullmatch('[a-f0-9]{40}',tool_revision),'EXACT_BINDING_FORMAT')
 value={'schemaVersion':1,'manifestSha256':manifest_hash,'toolRevision':tool_revision,'targetsSha256':sha(json.dumps(targets,sort_keys=True,separators=(',',':')).encode())}
 if admitted_at is not None:
  require(type(admitted_at) in (int,float) and admitted_at>0 and admitted_at<float('inf'),'ADMITTED_AT_FORMAT');value['admittedAt']=admitted_at
 return value

def recovery_admission(backup_root,basename,journal_hash,manifest_hash,now,uid=0,gid=0,boundary=None):
 """Read-only time anchor; production supplies now internally, never in argv."""
 import re
 require(isinstance(basename,str) and re.fullmatch(r'exact-[a-zA-Z0-9_-]{6,64}',basename),'BACKUP_BASENAME')
 require(re.fullmatch('[a-f0-9]{64}',journal_hash) and re.fullmatch('[a-f0-9]{64}',manifest_hash),'RECOVERY_HASH_FORMAT')
 root=pathlib.Path(backup_root);fd=parent(root/'entry',uid,boundary)
 try:
  rs=os.fstat(fd);require(rs.st_gid==gid and stat.S_IMODE(rs.st_mode)==0o700,'BACKUP_ROOT_PRIVATE')
  bs=os.stat(basename,dir_fd=fd,follow_symlinks=False);require(stat.S_ISDIR(bs.st_mode) and bs.st_uid==uid and bs.st_gid==gid and stat.S_IMODE(bs.st_mode)==0o700,'BACKUP_PRIVATE')
  bfd=os.open(basename,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
  try:
   raw,js=read_at(bfd,'journal.json',uid);require(js.st_gid==gid and stat.S_IMODE(js.st_mode)==0o600 and sha(raw)==journal_hash,'RECOVERY_JOURNAL_PIN')
   br,st=read_at(bfd,'manifest-binding.json',uid);require(st.st_gid==gid and stat.S_IMODE(st.st_mode)==0o600,'RECOVERY_PRIVATE_BINDING');binding=json.loads(br)
   require(json.loads(raw).get('binding')==binding and binding.get('manifestSha256')==manifest_hash,'RECOVERY_ADMISSION_BINDING')
   admitted=binding.get('admittedAt');require(type(admitted) in (int,float) and 0<admitted<=now and admitted<float('inf'),'RECOVERY_ADMITTED_AT')
   return binding
  finally:os.close(bfd)
 finally:os.close(fd)

def reviewed_recovery(backup_root,basename,journal_hash,binding,targets,uid=0,gid=0,boundary=None):
 """Typed internal protocol; production wrapper fixes root/UID/GID and validates Git authority."""
 import re
 require(isinstance(basename,str) and re.fullmatch(r'exact-[a-zA-Z0-9_-]{6,64}',basename),'BACKUP_BASENAME')
 require(re.fullmatch('[a-f0-9]{64}',journal_hash),'JOURNAL_HASH_FORMAT')
 require(binding==manifest_binding(binding['manifestSha256'],binding['toolRevision'],targets,binding.get('admittedAt')),'RECOVERY_TARGETS_BINDING')
 root=pathlib.Path(backup_root);fd=parent(root/'entry',uid,boundary)
 try:
  rs=os.fstat(fd);require(rs.st_gid==gid and stat.S_IMODE(rs.st_mode)==0o700,'BACKUP_ROOT_PRIVATE')
  bs=os.stat(basename,dir_fd=fd,follow_symlinks=False);require(stat.S_ISDIR(bs.st_mode) and bs.st_uid==uid and bs.st_gid==gid and stat.S_IMODE(bs.st_mode)==0o700,'BACKUP_PRIVATE')
 finally:os.close(fd)
 return recover(root/basename,uid,gid,boundary,expected_binding=binding,expected_targets=targets,expected_journal_sha=journal_hash)

def recover(backup,uid=0,gid=0,boundary=None,inject=None,expected_binding=None,expected_targets=None,expected_journal_sha=None):
 """Recover transaction-owned inodes. Reviewed CLI supplies all exact binding checks."""
 backup=pathlib.Path(backup);fd=parent(backup/'entry',uid,boundary);os.close(fd)
 bs=backup.lstat();require(stat.S_ISDIR(bs.st_mode) and bs.st_uid==uid and stat.S_IMODE(bs.st_mode)==0o700 and bs.st_gid==gid,'BACKUP_TRUST')
 bfd=os.open(backup,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);opened=[]
 try:
  raw,js=read_at(bfd,'journal.json',uid);require(stat.S_IMODE(js.st_mode)==0o600 and js.st_gid==gid,'JOURNAL_PRIVATE');j=json.loads(raw)
  require(j['schemaVersion']==1 and j['state'] in ('pending','recovering','recovered','committed'),'JOURNAL_SCHEMA')
  if expected_journal_sha is not None:require(sha(raw)==expected_journal_sha,'JOURNAL_HASH')
  if expected_binding is not None:
   require(j.get('binding')==expected_binding,'JOURNAL_MANIFEST_BINDING')
   br,st=read_at(bfd,'manifest-binding.json',uid)
   require(stat.S_IMODE(st.st_mode)==0o600 and st.st_gid==gid and json.loads(br)==expected_binding,'BACKUP_MANIFEST_BINDING')
  if expected_targets is not None:require([row['target'] for row in j['entries']]==expected_targets,'JOURNAL_TARGET_AUTHORITY')
  validate_journal_entries(j['entries'])
  if j['state']=='committed':return {'ready':False,'committed':True,'recovered':False}
  if j['state']=='recovered':return {'ready':False,'recovered':True}
  j['state']='recovering';journal_write(bfd,j,uid,gid);errors=[]
  for i,row in reversed(list(enumerate(j['entries']))):
   x=row['target'];path=pathlib.Path(x['destination']);require(path.is_absolute() and '..' not in path.parts,'JOURNAL_TARGET')
   dfd=parent(path,uid,boundary);opened.append(dfd);require(list(identity(os.fstat(dfd)))==row['parentInode'],'RECOVERY_PARENT_CHANGED')
   name=path.name
   try:
    try:current=os.stat(name,dir_fd=dfd,follow_symlinks=False)
    except FileNotFoundError:current=None
    before=x['before'];oldinode=row['oldInode'];restored=row.get('restoreInode')
    if current is None and before=={'absent':True}:pass
    elif current is not None and list(identity(current)) in [oldinode,restored]:compare(dfd,name,before,uid)
    else:
     require(current is not None and list(identity(current))==row['installedInode'],'RECOVERY_FOREIGN_INODE')
     # A kill between exclusive link and stage unlink leaves exactly two owned links.
     if current.st_nlink==2:
      staged=os.stat(row['stage'],dir_fd=dfd,follow_symlinks=False)
      require(stat.S_ISREG(current.st_mode) and list(identity(staged))==row['installedInode'] and staged.st_nlink==2,'RECOVERY_LINK_OWNERSHIP')
      os.unlink(row['stage'],dir_fd=dfd);os.fsync(dfd)
     data,cs=read_at(dfd,name,uid);require(sha(data)==x['sha256'] and stat.S_IMODE(cs.st_mode)==x['mode'] and cs.st_gid==gid,'RECOVERY_INSTALLED_DRIFT')
     if before=={'absent':True}:os.unlink(name,dir_fd=dfd)
     else:
      data,bs=read_at(bfd,str(i)+'.before',uid);require(stat.S_IMODE(bs.st_mode)==0o600 and sha(data)==before['sha256'],'RECOVERY_BACKUP_DRIFT')
      if row.get('restoreStage'):
       try:orphan=os.stat(row['restoreStage'],dir_fd=dfd,follow_symlinks=False)
       except FileNotFoundError:pass
       else:
        require(list(identity(orphan))==row['restoreInode'],'RECOVERY_STAGE_FOREIGN');os.unlink(row['restoreStage'],dir_fd=dfd);os.fsync(dfd)
      sn,ss=stage(dfd,data,before['mode'],before['uid'],before['gid']);row['restoreInode']=list(identity(ss));row['restoreStage']=sn;os.fsync(dfd)
      journal_write(bfd,j,uid,gid);os.replace(sn,name,src_dir_fd=dfd,dst_dir_fd=dfd)
     os.fsync(dfd)
     if inject:inject(i)
     compare(dfd,name,before,uid)
    # Remove only owned, unconsumed staging files.
    for key,ino in (('stage',row['installedInode']),('restoreStage',row.get('restoreInode'))):
     if row.get(key):
      try:st=os.stat(row[key],dir_fd=dfd,follow_symlinks=False)
      except FileNotFoundError:continue
      require(list(identity(st))==ino,'RECOVERY_STAGE_FOREIGN');os.unlink(row[key],dir_fd=dfd);os.fsync(dfd)
   except BaseException as e:errors.append({'destination':str(path),'code':str(e)})
  if errors:
   j['errors']=errors;journal_write(bfd,j,uid,gid);raise RuntimeError('RECOVERY_INCOMPLETE_KEEP_BACKUP')
  j['state']='recovered';journal_write(bfd,j,uid,gid);return {'ready':False,'recovered':True}
 finally:
  for fd in opened:os.close(fd)
  os.close(bfd)

def transaction(targets,payloads,backup,uid=0,gid=0,boundary=None,inject=None,binding=None):
 """Fixture parameters are inaccessible from production CLI. Keep backup on all outcomes."""
 backup=pathlib.Path(backup);bs=backup.lstat();require(stat.S_ISDIR(bs.st_mode) and bs.st_uid==uid and stat.S_IMODE(bs.st_mode)==0o700,'BACKUP_TRUST')
 bfd=os.open(backup,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);opened=[];applied=[];stages=[];entries=[]
 require(not os.path.lexists(backup/'journal.json'),'BACKUP_ALREADY_USED')
 require(0<len(targets)<=128 and len({x['destination'] for x in targets})==len(targets),'TARGET_SET')
 try:
  if binding is not None:
   require(not os.path.lexists(backup/'manifest-binding.json'),'BACKUP_BINDING_EXISTS')
   sn,ss=stage(bfd,json.dumps(binding,sort_keys=True).encode(),0o600,uid,gid);os.replace(sn,'manifest-binding.json',src_dir_fd=bfd,dst_dir_fd=bfd);os.fsync(bfd)
  for i,x in enumerate(targets):
   path=pathlib.Path(x['destination']);require(path.is_absolute() and '..' not in path.parts,'TARGET_PATH')
   fd=parent(path,uid,boundary);opened.append((x,fd,path.name));old=compare(fd,path.name,x['before'],uid)
   data=payloads[x['payload']];require(sha(data)==x['sha256'],'PAYLOAD_HASH')
   require(x['uid']==uid and x['gid']==gid and x['mode'] in (0o600,0o644,0o700,0o755),'NEW_METADATA')
   if old:
    bn,ss=stage(bfd,old[0],0o600,uid,gid);os.rename(bn,str(i)+'.before',src_dir_fd=bfd,dst_dir_fd=bfd);os.fsync(bfd)
   sn,ss=stage(fd,data,x['mode'],uid,gid);stages.append((fd,sn,ss));os.fsync(fd)
   entries.append({'target':dict(x),'parentInode':list(identity(os.fstat(fd))),'oldInode':list(identity(old[1])) if old else None,'installedInode':list(identity(ss)),'stage':sn})
  journal={'schemaVersion':1,'state':'pending','entries':entries,'binding':binding};journal_write(bfd,journal,uid,gid)
  for i,((x,fd,name),(sfd,sn,ss)) in enumerate(zip(opened,stages)):
   compare(fd,name,x['before'],uid)
   mask=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGINT,signal.SIGTERM})
   try:
    if x['before']=={'absent':True}:
     os.link(sn,name,src_dir_fd=fd,dst_dir_fd=fd,follow_symlinks=False);applied.append((i,x,fd,name,ss));os.unlink(sn,dir_fd=fd)
    else:os.replace(sn,name,src_dir_fd=fd,dst_dir_fd=fd);applied.append((i,x,fd,name,ss))
   finally:signal.pthread_sigmask(signal.SIG_SETMASK,mask)
   if inject:inject(i)  # Fault boundary: rename completed, directory not yet synced.
   os.fsync(fd)
  for i,x,fd,name,ss in applied:
   data,s=read_at(fd,name,uid);require(identity(s)==identity(ss) and sha(data)==x['sha256'] and stat.S_IMODE(s.st_mode)==x['mode'] and s.st_gid==gid,'READBACK')
  journal['state']='committed';journal_write(bfd,journal,uid,gid)
 except BaseException as original:
  mask=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGINT,signal.SIGTERM})
  try:
   if os.path.lexists(backup/'journal.json'):
    try:recover(backup,uid,gid,boundary,expected_binding=binding,expected_targets=targets)
    except BaseException as e:
     raw=json.dumps({'ready':False,'rollbackIncomplete':True,'code':str(e)},sort_keys=True).encode();sn,s=stage(bfd,raw,0o600,uid,gid);os.replace(sn,'diagnosis.json',src_dir_fd=bfd,dst_dir_fd=bfd);os.fsync(bfd)
     raise RuntimeError('ROLLBACK_INCOMPLETE_KEEP_BACKUP') from original
  finally:signal.pthread_sigmask(signal.SIG_SETMASK,mask)
  raise
 finally:
  for fd,name,s in stages:
   try:
    current=os.stat(name,dir_fd=fd,follow_symlinks=False)
    if identity(current)==identity(s):os.unlink(name,dir_fd=fd);os.fsync(fd)
   except FileNotFoundError:pass
  for x,fd,name in opened:os.close(fd)
  os.close(bfd)
 return {'ready':False,'installationOnly':True,'productionActivated':False}

def trust_git(tool,uid=0,boundary=None):
 import re
 tool=pathlib.Path(tool);fd=parent(tool/'entry',uid,boundary);os.close(fd)
 gd=tool/'.git';s=gd.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==uid and not s.st_mode&0o022,'GIT_ROOT_TRUST')
 for p in ('objects','refs'):
  s=(gd/p).lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==uid and not s.st_mode&0o022,'GIT_DIRECTORY_TRUST')
 for p in ('commondir','gitdir','objects/info/alternates'):
  require(not os.path.lexists(gd/p),'GIT_EXTERNAL')
 for directory,dirs,files in os.walk(gd,followlinks=False):
  for name in dirs+files:
   st=(pathlib.Path(directory)/name).lstat();require(st.st_uid==uid and not st.st_mode&0o022 and (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode) and st.st_nlink==1),'GIT_MEMBER_TRUST')
 require(not list((gd/'objects/pack').glob('*.promisor')) and not list((gd/'refs/replace').glob('*')),'GIT_PROMISOR_REPLACE')
 fd=os.open(gd,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:config,unused=read_at(fd,'config',uid);read_at(fd,'HEAD',uid)
 finally:os.close(fd)
 require(not re.search(rb'^\s*\[(?:include(?:if)?|filter)[\s\]]|^\s*(?:fsmonitor|promisor|partialclone)\s*=',config,re.M|re.I),'GIT_CONFIG_EXECUTION')

def verify_inventory_receipt(inventory_raw,receipt_raw,expected,now,ttl=3600):
 import datetime,re
 require(type(ttl) is int and 0<ttl<=3600,'INVENTORY_TTL')
 inv=json.loads(inventory_raw);r=json.loads(receipt_raw)
 require(set(expected)=={'region','instanceId','sourceInvocation','commandId'} and all(isinstance(v,str) and v for v in expected.values()),'PROVIDER_EXPECTED_REQUEST')
 require(all(r.get(k)==v for k,v in expected.items()),'PROVIDER_REQUEST_IDENTITY')
 require(r.get('schemaVersion')==1 and r.get('invocationStatus')=='Success' and type(r.get('exitCode')) is int and r['exitCode']==0 and type(r.get('dropped')) is int and r['dropped']==0,'PROVIDER_SUCCESS')
 require(r.get('readOnly') is True and r.get('productionModified') is False and inv.get('schemaVersion')==1 and inv.get('readOnly') is True and inv.get('ready') is False,'INVENTORY_READONLY')
 require(inv.get('sourceInvocation')==expected['sourceInvocation'] and r.get('localInventorySha256')==sha(inventory_raw),'INVENTORY_HASH_INVOCATION')
 require(r.get('inventoryObservedAt')==inv.get('observedAt'),'INVENTORY_OBSERVED_BINDING')
 remote=dict(inv);del remote['sourceInvocation'];output=(json.dumps(remote,sort_keys=True)+'\n').encode()
 require(sha(output)==r.get('outputSha256'),'PROVIDER_OUTPUT_HASH')
 def timestamp(value):
  require(isinstance(value,str),'INVENTORY_TIME_FORMAT');d=datetime.datetime.fromisoformat(value.replace('Z','+00:00'));require(d.tzinfo is not None,'INVENTORY_TIMEZONE');return d.timestamp()
 observed=timestamp(inv['observedAt']);start=timestamp(r['startTime'])
 require(0<=now-observed<=ttl and 0<=now-start<=ttl and 0<=observed-start<=300,'INVENTORY_FRESHNESS')
 if r.get('finishTime') is not None:
  finish=timestamp(r['finishTime']);require(start<=finish<=now and observed<=finish+1,'PROVIDER_FINISH_TIME')
 return inv

PROFILE_SCHEMA_SOURCE='.harness/scripts/vm/cn_tool_profile.py'
def profile_content(tool,rows,schema_raw=None,runtime=None,extension=None,expected_extension=None):
 if PROFILE_SCHEMA_SOURCE not in rows:
  require(extension is None and expected_extension is None,'COMPOSE_EXTENSION_SCHEMA_REQUIRED')
  return {'toolRevision':tool,'filesSha256':{name:row['newSha256'] for name,row in rows.items()}}
 require(schema_raw is not None and sha(schema_raw)==rows[PROFILE_SCHEMA_SOURCE]['newSha256'],'PROFILE_SCHEMA_SOURCE_BINDING')
 namespace={'__name__':'exact_git_bound_profile_schema'}
 exec(compile(schema_raw,PROFILE_SCHEMA_SOURCE,'exec'),namespace)
 if extension is None and expected_extension is None:return namespace['build_profile'](tool,rows,runtime)
 return namespace['build_profile'](tool,rows,runtime,extension,expected_extension)

def extension_evidence(tool,rows,schema_raw,extension,expected,app=None,git_blob=None,old_projection=False):
 if extension is None:
  require(expected is None,'COMPOSE_EXTENSION_UNSOLICITED_PIN');return None
 require(PROFILE_SCHEMA_SOURCE in rows and sha(schema_raw)==rows[PROFILE_SCHEMA_SOURCE]['newSha256'],'PROFILE_SCHEMA_SOURCE_BINDING')
 namespace={'__name__':'exact_git_bound_profile_schema'}
 exec(compile(schema_raw,PROFILE_SCHEMA_SOURCE,'exec'),namespace)
 require('validate_compose_extension' in namespace,'COMPOSE_EXTENSION_SCHEMA_REQUIRED')
 if old_projection:return namespace['validate_compose_projection'](extension,tool,app,git_blob)
 return namespace['validate_compose_extension'](extension,expected,tool,app,git_blob)

def rebuild_old_profile(tool,rows,schema_raw,runtime,projection):
 if projection is None:return profile_content(tool,rows,schema_raw,runtime)
 require(PROFILE_SCHEMA_SOURCE in rows and sha(schema_raw)==rows[PROFILE_SCHEMA_SOURCE]['newSha256'],'PROFILE_SCHEMA_SOURCE_BINDING')
 namespace={'__name__':'exact_git_bound_profile_schema'}
 exec(compile(schema_raw,PROFILE_SCHEMA_SOURCE,'exec'),namespace)
 require('rebuild_profile' in namespace,'COMPOSE_EXTENSION_SCHEMA_REQUIRED')
 return namespace['rebuild_profile'](tool,rows,runtime,projection)

def old_profile_allowlist(content,old_files,inventory):
 require(isinstance(old_files,dict) and old_files,'PROFILE_OLD_ALLOWLIST_CLOSURE')
 if 'composeExtensionV1' in content:
  # Exact old Git FILES is preserved separately; extras are reconstructed by
  # old_profile_binding from the root-inventory-pinned old schema/container.
  require(set(content.get('composeBaseFilesSha256',{}))==set(old_files),'PROFILE_OLD_ALLOWLIST_CLOSURE')
 else:require(set(content['filesSha256'])==set(old_files),'PROFILE_OLD_ALLOWLIST_CLOSURE')
 require(all(inventory.get('files',{}).get(source,{}).get('target')==target for source,target in old_files.items()),'PROFILE_OLD_TARGET_AUTHORITY')

def old_profile_binding(old,previous,old_schema_raw=None):
 import base64,re
 require(old.get('present') is True and old.get('regular') is True and old.get('symlink') is False and old.get('mode')=='0600' and all(type(old.get(k)) is int for k in ('uid','gid','links')) and (old['uid'],old['gid'],old['links'])==(0,0,1) and re.fullmatch('[a-f0-9]{64}',old.get('sha256','') or ''),'PROFILE_OLD_PRESENT_TRUST')
 try:raw=base64.b64decode(old['rawBase64'],validate=True);content=json.loads(raw)
 except Exception:require(False,'PROFILE_OLD_RAW')
 require(len(raw)<=8000000 and sha(raw)==old['sha256'] and raw==(json.dumps(content,sort_keys=True)+'\n').encode(),'PROFILE_OLD_RAW_BINDING')
 tool=content.get('toolRevision');require(re.fullmatch('[a-f0-9]{40}',tool or ''),'PROFILE_OLD_TOOL')
 hashes=content.get('filesSha256');require(isinstance(hashes,dict) and hashes,'PROFILE_OLD_CLOSURE')
 extension=content.get('composeExtensionV1')
 base_hashes=content.get('composeBaseFilesSha256') if extension is not None else hashes
 require(isinstance(base_hashes,dict) and base_hashes,'PROFILE_OLD_BASE_CLOSURE')
 rows={}
 for source,digest in base_hashes.items():
  before=previous.get('files',{}).get(source);require(isinstance(before,dict),'PROFILE_OLD_SOURCE_INVENTORY')
  target=before.get('target')
  if target is not None:require(before.get('present') is True and before.get('regular') is True and before.get('symlink') is False and before.get('sha256')==digest and before.get('uid')==0 and before.get('gid')==0 and before.get('links')==1,'PROFILE_OLD_INSTALLED_BINDING')
  rows[source]={'target':target,'newSha256':digest}
 require(content==rebuild_old_profile(tool,rows,old_schema_raw,previous.get('runtimes',{}).get('node'),extension),'PROFILE_OLD_CONTENT_AUTHORITY')
 return tool,rows

def profile_transaction(m,consumer_raw,inventory_raw,receipt_raw,expected,now,ttl=3600,schema_raw=None,old_schema_raw=None,expected_extension=None):
 import ast,re
 require(isinstance(m.get('profileTransactionsV1'),list) and len(m['profileTransactionsV1'])==1,'PROFILE_V1_REQUIRED')
 p=m['profileTransactionsV1'][0];source=p.get('consumerSource');files=m['files']
 require(source in files and pathlib.PurePosixPath(source).name=='cn_maintenance_hold.py','PROFILE_CONSUMER_SOURCE')
 require(sha(consumer_raw)==p.get('consumerSha256')==files[source]['newSha256'],'PROFILE_CONSUMER_BINDING')
 tree=ast.parse(consumer_raw);paths=[];modes=[]
 for node in ast.walk(tree):
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='profile' for t in node.targets) and isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=='Path' and len(node.value.args)==1 and isinstance(node.value.args[0],ast.Constant):paths.append(node.value.args[0].value)
  if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='read' and len(node.args)==2 and isinstance(node.args[0],ast.Name) and node.args[0].id=='profile' and isinstance(node.args[1],ast.Constant):modes.append(node.args[1].value)
 require(len(set(paths))==1 and len(set(modes))==1 and modes[0]==0o600,'PROFILE_CONSUMER_CONTRACT')
 target=paths[0];require(isinstance(target,str) and pathlib.PurePosixPath(target).is_absolute() and '..' not in pathlib.PurePosixPath(target).parts,'PROFILE_TARGET')
 require(p.get('inventoryEvidenceRef')=='inventoryEvidenceV1','PROFILE_EVIDENCE_PROTOCOL')
 require(all(type(p.get(k)) is int for k in ('uid','gid','links','bytes')),'PROFILE_METADATA_TYPES')
 require(p.get('schemaVersion')==1 and p.get('kind') in ('reviewed-profile-create-proposal','reviewed-profile-replace-proposal') and p.get('target')==target and p.get('mode')==format(modes[0],'04o') and (p.get('uid'),p.get('gid'),p.get('links'))==(0,0,1),'PROFILE_METADATA')
 require(re.fullmatch('[a-f0-9]{40}',m.get('toolRevision','') or ''),'PROFILE_EXACT_TOOL')
 content=profile_content(m['toolRevision'],files,schema_raw,json.loads(inventory_raw).get('runtimes',{}).get('node'),m.get('composeExtensionV1'),expected_extension);raw=(json.dumps(content,sort_keys=True)+'\n').encode()
 require(p.get('content')==content and p.get('newSha256')==sha(raw) and p.get('bytes')==len(raw),'PROFILE_CONTENT')
 inv=verify_inventory_receipt(inventory_raw,receipt_raw,expected,now,ttl)
 require(p.get('previousInventorySha256')==m.get('previousInventorySha256')==sha(inventory_raw) and p.get('inventoryObservedAt')==m.get('inventoryObservedAt')==inv['observedAt'] and p.get('inventorySourceInvocation')==m.get('inventorySourceInvocation')==inv['sourceInvocation'],'PROFILE_INVENTORY_BINDING')
 old=inv.get('profiles',{}).get(target)
 require(isinstance(old,dict),'PROFILE_OLD_INVENTORY')
 if old.get('present') is True:
  import base64
  require('composeExtensionV1' not in json.loads(base64.b64decode(old['rawBase64'],validate=True)) or m.get('composeExtensionV1') is not None,'COMPOSE_EXTENSION_REMOVAL_NOT_AUTHORIZED')
  old_profile_binding(old,inv,old_schema_raw)
  require(p.get('kind')=='reviewed-profile-replace-proposal','PROFILE_OPERATION')
 else:
  require(p.get('kind')=='reviewed-profile-create-proposal','PROFILE_OPERATION')
  require(old.get('present') is False and old.get('regular') is False and old.get('symlink') is False and all(old.get(k) is None for k in ('sha256','mode','uid','gid','links')),'PROFILE_OLD_ABSENT')
 require(p.get('oldPresent') is old['present'] and p.get('oldIdentity')==old,'PROFILE_OLD_INVENTORY')
 require(set(inv.get('files',{}))==set(files),'INVENTORY_FILES_CLOSURE')
 for s,row in files.items():
  before=inv['files'][s];require(before.get('target')==row['target'] and before.get('present') is row['oldPresent'],'INVENTORY_OLD_TARGET')
  for ik,rk in (('sha256','oldSha256'),('mode','oldMode'),('uid','oldUid'),('gid','oldGid'),('links','oldNlink')):require(before.get(ik)==row.get(rk),'INVENTORY_OLD_METADATA')
 return {'destination':target,'payload':'profileTransactionsV1/0','before':({'sha256':old['sha256'],'mode':int(old['mode'],8),'uid':old['uid'],'gid':old['gid'],'nlink':old['links']} if old['present'] else {'absent':True}),'sha256':sha(raw),'mode':modes[0],'uid':0,'gid':0},raw

def verify_staged_extension(extension,uid=0,gid=0,boundary=None):
 import base64
 # The installer verifies pre-staged data only; extension never adds targets.
 for name,item in extension['documents'].items():
  p=pathlib.Path(item['path']);fd=parent(p,uid,boundary)
  try:raw,st=read_at(fd,p.name,uid)
  finally:os.close(fd)
  require(st.st_gid==gid and stat.S_IMODE(st.st_mode)==(0o700 if name=='emitter' else 0o600) and raw==base64.b64decode(item['rawBase64'],validate=True) and sha(raw)==item['sha256'],'COMPOSE_EXTENSION_STAGED_BINDING')
 e=extension['candidateComposeEmitter']
 for pathkey,hashkey in (('nodePath','nodeSha256'),('dockerPath','dockerSha256')):
  p=pathlib.Path(e[pathkey]);fd=parent(p,uid,boundary);f=None
  try:
   f=os.open(p.name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd);st=os.fstat(f)
   require(stat.S_ISREG(st.st_mode) and st.st_uid==uid and st.st_gid==gid and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o755 and st.st_size<=256000000,'COMPOSE_EXTENSION_EXECUTABLE_TRUST')
   h=hashlib.sha256()
   while True:
    chunk=os.read(f,65536)
    if not chunk:break
    h.update(chunk)
   after=os.fstat(f);named=os.stat(p.name,dir_fd=fd,follow_symlinks=False)
   signature=lambda z:(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns)
   require(signature(st)==signature(after)==signature(named) and h.hexdigest()==e[hashkey],'COMPOSE_EXTENSION_EXECUTABLE_BINDING')
  finally:
   if f is not None:os.close(f)
   os.close(fd)

def manifest_targets(m):
 require(isinstance(m.get('files'),dict) and m['files'],'MANIFEST_FILES')
 rows=[]
 for source,row in m['files'].items():
  if row['target'] is None:continue
  before={'absent':True} if row['oldPresent'] is False else {'sha256':row['oldSha256'],'uid':row['oldUid'],'gid':row['oldGid'],'mode':int(row['oldMode'],8),'nlink':row['oldNlink']}
  rows.append({'destination':row['target'],'payload':source,'before':before,'sha256':row['newSha256'],'mode':int(row['mode'],8),'uid':0,'gid':0})
 return rows

def inherited_lock(path,heldfd,uid=0,gid=0,boundary=None):
 fd=parent(path,uid,boundary)
 try:
  data,s=read_at(fd,pathlib.Path(path).name,uid);held=os.fstat(heldfd)
  require(s.st_gid==gid and not s.st_mode&0o022 and identity(held)==identity(s),'CANONICAL_FD9')
  # Same open description may re-acquire its own flock; a foreign holder must fail here.
  try:fcntl.flock(heldfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise RuntimeError('FD9_FOREIGN_LOCK_HOLDER')
  other=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
  try:
   require(identity(os.fstat(other))==identity(s),'LOCK_INODE_CHANGED')
   try:fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:pass
   else:raise RuntimeError('LOCK_NOT_HELD')
  finally:os.close(other)
  require(identity(os.stat(path,follow_symlinks=False))==identity(s),'LOCK_PATH_CHANGED')
 finally:os.close(fd)
def require_lock():inherited_lock(LOCK,9)
def verified_manifest(manifest_path,manifest_hash,admitted_at=None,expected_extension=None):
 path=pathlib.Path(manifest_path);fd=parent(path,0)
 try:raw,s=read_at(fd,path.name,0,32000000)
 finally:os.close(fd)
 require(stat.S_IMODE(s.st_mode)==0o600 and s.st_gid==0 and sha(raw)==manifest_hash,'MANIFEST_PIN')
 m=json.loads(raw);require(m['schemaVersion']==1 and m['ready'] is False,'REVIEW_MANIFEST')
 require(m.get('trustedGitClosure') and m.get('profileTransactionsV1') and m.get('inventoryEvidenceV1'),'MANIFEST_CLOSURE_PROFILE_MISSING')
 require(m['trustedGitClosure'].get('toolRevision')==m['toolRevision'],'CLOSURE_BINDING')
 m['targets']=manifest_targets(m)
 require(m.get('profileEntries')==[],'LEGACY_PROFILE_PROTOCOL_REJECTED')
 # Trusted root checkout validator is supplied by the exact manifest, never imported from caller paths.
 tool=pathlib.Path(m['toolRoot']);require(str(tool)=='/opt/workspacex-cn/release-tools/'+m['toolRevision'],'TOOL_ROOT')
 import subprocess
 env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1'}
 for d in (tool,*tool.parents):
  st=d.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'TOOL_PARENT_TRUST')
 trust_git(tool)
 validator=tool/'.harness/scripts/vm/cn-build-tool-identity.py';vf=parent(validator,0)
 try:code,unused=read_at(vf,validator.name,0)
 finally:os.close(vf)
 git=lambda *a:subprocess.check_output(['/usr/bin/git','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.untrackedCache=false','-c','gc.auto=0','-C',str(tool),*a],env=env,stderr=subprocess.DEVNULL)
 import ast
 tree=ast.parse(code);assignments=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FILES' for t in n.targets)]
 require(len(assignments)==1,'FILES_SINGLE_SOURCE');files=ast.literal_eval(assignments[0].value)
 require(set(m['files'])==set(files) and all(m['files'][p]['target']==target and m['files'][p]['mode']==('0700' if target else '0600') for p,target in files.items()),'TARGET_AUTHORITY')
 require(code==git('show',m['toolRevision']+':.harness/scripts/vm/cn-build-tool-identity.py'),'VALIDATOR_GIT_BINDING')
 require(git('rev-parse','HEAD').decode().strip()==m['toolRevision'] and not git('status','--porcelain'),'TOOL_CHECKOUT')
 git('fsck','--full','--no-reflogs');payloads={}
 for source,row in m['files'].items():
  data=git('show',m['toolRevision']+':'+source)
  require(sha(data)==row['newSha256'] and len(data)==row['bytes'],'FULL_GIT_CLOSURE')
 require(m['trustedGitClosure'].get('inventorySha256')==sha(git('ls-tree','-r','-z',m['toolRevision'])),'GIT_INVENTORY_BINDING')
 for x in m['targets']:
  p=pathlib.Path(x['payload']);require(not p.is_absolute() and '..' not in p.parts,'PAYLOAD_PATH')
  f=parent(tool/p,0)
  try:data,unused=read_at(f,p.name,0)
  finally:os.close(f)
  require(data==git('show',m['toolRevision']+':'+str(p)) and sha(data)==x['sha256'],'PAYLOAD_GIT_BINDING');payloads[str(p)]=data
 evidence=m['inventoryEvidenceV1'];inputs=[]
 for pathkey,hashkey in (('inventoryPath','inventorySha256'),('providerReceiptPath','providerReceiptSha256')):
  ep=pathlib.Path(evidence[pathkey]);require(ep.is_absolute() and '..' not in ep.parts,'INVENTORY_EVIDENCE_PATH');ef=parent(ep,0)
  try:eraw,es=read_at(ef,ep.name,0,32000000)
  finally:os.close(ef)
  require(es.st_gid==0 and stat.S_IMODE(es.st_mode)==0o600 and sha(eraw)==evidence[hashkey],'ROOT_PRIVATE_INVENTORY_EVIDENCE');inputs.append(eraw)
 import time
 proposal=m['profileTransactionsV1'][0];consumer=git('show',m['toolRevision']+':'+proposal['consumerSource'])
 validation_time=time.time() if admitted_at is None else admitted_at
 old_schema_raw=None
 old=json.loads(inputs[0]).get('profiles',{}).get(proposal['target'],{})
 if old.get('present') is True:
  import base64
  old_content=json.loads(base64.b64decode(old['rawBase64'],validate=True));old_tool=old_content['toolRevision']
  require('composeExtensionV1' not in old_content or m.get('composeExtensionV1') is not None,'COMPOSE_EXTENSION_REMOVAL_NOT_AUTHORIZED')
  old_tree=ast.parse(git('show',old_tool+':.harness/scripts/vm/cn-build-tool-identity.py'));old_assignments=[n for n in old_tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='FILES' for t in n.targets)];require(len(old_assignments)==1,'PROFILE_OLD_ALLOWLIST');old_files=ast.literal_eval(old_assignments[0].value)
  old_profile_allowlist(old_content,old_files,json.loads(inputs[0]))
  old_schema_raw=git('show',old_tool+':'+PROFILE_SCHEMA_SOURCE) if PROFILE_SCHEMA_SOURCE in old_files else None
  unused,old_rows=old_profile_binding(old,json.loads(inputs[0]),old_schema_raw)
  old_extension=old_content.get('composeExtensionV1')
  if old_extension is not None:extension_evidence(old_tool,old_rows,old_schema_raw,old_extension,None,git_blob=lambda rev,source:git('show',rev+':'+source),old_projection=True)
  for source,row in old_rows.items():require(sha(git('show',old_tool+':'+source))==row['newSha256'],'PROFILE_OLD_GIT_CLOSURE')
 schema_raw=git('show',m['toolRevision']+':'+PROFILE_SCHEMA_SOURCE) if PROFILE_SCHEMA_SOURCE in m['files'] else None
 extension=extension_evidence(m['toolRevision'],m['files'],schema_raw,m.get('composeExtensionV1'),expected_extension,m['applicationRevision'],lambda rev,source:git('show',rev+':'+source))
 if extension is not None:verify_staged_extension(extension)
 pt,pr=profile_transaction(m,consumer,*inputs,evidence['expected'],validation_time,evidence['ttlSeconds'],git('show',m['toolRevision']+':'+PROFILE_SCHEMA_SOURCE) if PROFILE_SCHEMA_SOURCE in m['files'] else None,old_schema_raw,expected_extension)
 require(pt['destination'] not in {x['destination'] for x in m['targets']},'PROFILE_TARGET_DUPLICATE')
 m['targets'].append(pt);payloads[pt['payload']]=pr
 return m,payloads,validation_time

def main():
 recovering=len(sys.argv)>1 and sys.argv[1]=='--recover-reviewed'
 args=sys.argv[2:] if recovering else sys.argv[1:]
 expected_extension=None
 if '--compose-extension' in args:
  i=args.index('--compose-extension');require(i==len(args)-2,'COMPOSE_EXTENSION_ARGUMENTS');expected_extension=args[-1];args=args[:i]
 require(os.geteuid()==0 and len(args)==(4 if recovering else 2),'ROOT_EXACT_ARGUMENTS')
 require_lock()
 if recovering:
  import time
  admission=recovery_admission(BACKUPS,args[2],args[3],args[1],time.time())
  m,payloads,admitted=verified_manifest(args[0],args[1],admission['admittedAt'],expected_extension)
  binding=manifest_binding(args[1],m['toolRevision'],m['targets'],admitted)
  require(binding==admission,'RECOVERY_ADMISSION_BINDING')
 else:
  m,payloads,admitted=verified_manifest(args[0],args[1],expected_extension=expected_extension);binding=manifest_binding(args[1],m['toolRevision'],m['targets'],admitted)
 if recovering:
  print(json.dumps(reviewed_recovery(BACKUPS,args[2],args[3],binding,m['targets'])));return
 # No caller-selected backup path or production fixture UID.
 fd=parent(BACKUPS+'/entry',0)
 try:
  b=pathlib.Path(tempfile.mkdtemp(prefix='exact-',dir=BACKUPS));os.chmod(b,0o700);os.fsync(fd)
 finally:os.close(fd)
 def stopped(signum,frame):raise RuntimeError('INTERRUPTED')
 signal.signal(signal.SIGTERM,stopped);signal.signal(signal.SIGINT,stopped)
 print(json.dumps(transaction(m['targets'],payloads,b,binding=binding)))
if __name__=='__main__':
 try:main()
 except BaseException as e:print(str(e),file=sys.stderr);sys.exit(1)
