"""Version external configuration contents; never snapshot or rewrite data mounts."""
import copy,hashlib,json,os,shutil,stat,uuid
from pathlib import Path

def digest(path):
 p=Path(path)
 if p.is_symlink():raise ValueError('CONFIG_SYMLINK_UNSUPPORTED')
 if p.is_file():return hashlib.sha256(p.read_bytes()).hexdigest()
 rows=[]
 for item in sorted(p.rglob('*')):
  if item.is_symlink():raise ValueError('CONFIG_SYMLINK_UNSUPPORTED')
  if item.is_file():rows.append((str(item.relative_to(p)),hashlib.sha256(item.read_bytes()).hexdigest()))
 return hashlib.sha256(json.dumps(rows).encode()).hexdigest()

def metadata(path):
 p=Path(path);rows=[]
 for item in [p]+sorted(p.rglob('*')) if p.is_dir() else [p]:
  if item.is_symlink():raise ValueError('CONFIG_SYMLINK_UNSUPPORTED')
  info=item.stat();rows.append([str(item.relative_to(p)),info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode)])
 return rows

def copy_configuration(source,target):
 # copy2/copytree preserve modes, but a root publisher would otherwise own every copy.
 def copy_file(src,dst):
  result=shutil.copy2(src,dst);preserve_owner(src,dst);return result
 def preserve_owner(src,dst):
  info=Path(src).stat();copied=Path(dst).stat()
  if (copied.st_uid,copied.st_gid)!=(info.st_uid,info.st_gid):os.chown(dst,info.st_uid,info.st_gid)
  # chown may clear set-ID bits; restore the original mode afterwards.
  shutil.copystat(src,dst)
 source=Path(source);target=Path(target)
 if source.is_dir():
  shutil.copytree(source,target,copy_function=copy_file)
  for directory in sorted((p for p in source.rglob('*') if p.is_dir()),reverse=True):preserve_owner(directory,target/directory.relative_to(source))
  preserve_owner(source,target)
 else:copy_file(source,target)
 if metadata(source)!=metadata(target):raise ValueError('CONFIG_METADATA_COPY_FAILED')

def freeze(model,sources,directory):
 model=copy.deepcopy(model);directory=Path(directory);directory.mkdir(mode=0o700,parents=True,exist_ok=True)
 sources=set(sources)
 for section in ('configs','secrets'):
  for definition in model.get(section,{}).values():
   if definition.get('external'):raise ValueError('EXTERNAL_CONFIG_REQUIRES_LOCAL_SNAPSHOT')
   if definition.get('file'):sources.add(definition['file'])
 refs=[];mapping={}
 for number,source in enumerate(sorted(sources)):
  p=Path(source);before=digest(p);before_metadata=metadata(p);target=directory/str(number)
  copy_configuration(p,target)
  if digest(target)!=before or digest(p)!=before or metadata(p)!=before_metadata or metadata(target)!=before_metadata:raise ValueError('CONFIG_CHANGED_DURING_SNAPSHOT')
  refs.append({'original':str(p),'copy':str(target),'sha256':before,'metadata':before_metadata});mapping[str(p)]=str(target)
 for service in model['services'].values():
  for mount in service.get('volumes',[]):
   if mount.get('type')=='bind' and mount.get('source') in mapping:mount['source']=mapping[mount['source']]
 for section in ('configs','secrets'):
  for definition in model.get(section,{}).values():
   if definition.get('file') in mapping:definition['file']=mapping[definition['file']]
 return model,refs

def verify(refs,restore=False):
 for ref in refs:
  saved=Path(ref['copy']);target=Path(ref['original'])
  if digest(saved)!=ref['sha256']:raise ValueError('CONFIG_SNAPSHOT_CHANGED')
  if 'metadata' in ref and metadata(saved)!=ref['metadata']:raise ValueError('CONFIG_SNAPSHOT_METADATA_CHANGED')
  if not restore:continue
  if target.exists() and digest(target)==ref['sha256'] and metadata(target)==metadata(saved):continue
  # Preserve edited originals beside the destination rather than deleting anything.
  temp=target.parent/('.restore-'+uuid.uuid4().hex)
  copy_configuration(saved,temp)
  if target.exists() or target.is_symlink():os.rename(target,target.parent/(target.name+'.before-rollback-'+uuid.uuid4().hex))
  os.rename(temp,target)
  if digest(target)!=ref['sha256'] or metadata(target)!=metadata(saved):raise ValueError('CONFIG_RESTORE_FAILED')
