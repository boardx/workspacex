"""Version external configuration contents; never snapshot or rewrite data mounts."""
import copy,hashlib,json,os,shutil,uuid
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

def freeze(model,sources,directory):
 model=copy.deepcopy(model);directory=Path(directory);directory.mkdir(mode=0o700,parents=True,exist_ok=True)
 sources=set(sources)
 for section in ('configs','secrets'):
  for definition in model.get(section,{}).values():
   if definition.get('external'):raise ValueError('EXTERNAL_CONFIG_REQUIRES_LOCAL_SNAPSHOT')
   if definition.get('file'):sources.add(definition['file'])
 refs=[];mapping={}
 for number,source in enumerate(sorted(sources)):
  p=Path(source);before=digest(p);target=directory/str(number)
  if p.is_dir():shutil.copytree(p,target)
  else:shutil.copy2(p,target)
  if digest(target)!=before or digest(p)!=before:raise ValueError('CONFIG_CHANGED_DURING_SNAPSHOT')
  refs.append({'original':str(p),'copy':str(target),'sha256':before});mapping[str(p)]=str(target)
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
  if not restore:continue
  if target.exists() and digest(target)==ref['sha256']:continue
  # Preserve edited originals beside the destination rather than deleting anything.
  temp=target.parent/('.restore-'+uuid.uuid4().hex)
  if saved.is_dir():shutil.copytree(saved,temp)
  else:shutil.copy2(saved,temp)
  if target.exists() or target.is_symlink():os.rename(target,target.parent/(target.name+'.before-rollback-'+uuid.uuid4().hex))
  os.rename(temp,target)
  if digest(target)!=ref['sha256']:raise ValueError('CONFIG_RESTORE_FAILED')
