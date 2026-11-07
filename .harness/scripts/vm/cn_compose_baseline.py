#!/usr/bin/env python3
"""Protected multi-file Compose baseline identity; never print rendered secrets."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

ROOT = Path('/var/lib/workspacex-cn/runtime')
NGINX = Path('/etc/nginx/conf.d/workspacex-cn.conf')
STABLE = Path('/var/lib/workspacex-cn/stable-secrets')
PROJECT = 'workspacex-cn'
SERVICES = ('api', 'web', 'agent', 'sandbox')
TRUSTED_UID = 0
TRUSTED_GID = 0
class Rejected(Exception): pass
def require(ok):
    if not ok: raise Rejected('CN_COMPOSE_BASELINE_REJECTED')
def digest(data): return hashlib.sha256(data).hexdigest()
def encoded(value): return json.dumps(value, separators=(',', ':'), sort_keys=True).encode()
def protected_parents(path):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts)
    for directory in reversed(path.parents):
        info = directory.lstat()
        require(stat.S_ISDIR(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_uid == TRUSTED_UID and not info.st_mode & 0o022)
def protected_directory(path):
    protected_parents(path)
    info = Path(path).lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == TRUSTED_UID and info.st_gid == TRUSTED_GID and stat.S_IMODE(info.st_mode) == 0o700)
def file_stamp(info):
    return (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_uid,info.st_gid,info.st_mode,info.st_nlink)
def read_protected(path, private=True):
    path = Path(path); protected_parents(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == TRUSTED_UID and before.st_gid == TRUSTED_GID and before.st_nlink == 1)
    require(stat.S_IMODE(before.st_mode) == 0o600 if private else not before.st_mode & 0o022)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        current = os.fstat(fd)
        require(file_stamp(before) == file_stamp(current))
        require(current.st_size <= 16 * 1024 * 1024)
        with os.fdopen(fd, 'rb', closefd=False) as handle: data = handle.read(16 * 1024 * 1024 + 1)
        require(len(data) == current.st_size)
        after = os.fstat(fd)
        require(file_stamp(current) == file_stamp(after) == file_stamp(path.lstat()))
        return data
    finally: os.close(fd)
def root_runtime_path(value):
    path = Path(value)
    require(path.is_absolute() and str(path) == value and path.is_relative_to(ROOT) and path != ROOT)
    require(all(re.fullmatch(r'[a-zA-Z0-9_.-]{1,160}', p) and p not in ('.','..') for p in path.relative_to(ROOT).parts))
    return path
def docker(*args):
    result = subprocess.run(['/usr/bin/docker', *args], capture_output=True, check=True,
                            env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/root','LC_ALL':'C'}, timeout=90)
    return json.loads(result.stdout)
def compose(files):
    args = ['compose', '--env-file', '/dev/null', '-p', PROJECT]
    for path in files: args += ['-f', path]
    return args
def file_records(files):
    require(1 <= len(files) <= 12 and len(set(files)) == len(files))
    require(Path(files[0]).name == 'compose.json')
    records = []
    for path in files:
        root_runtime_path(path)
        require(Path(path).suffix in ('.json','.yaml','.yml'))
        records.append({'path':path,'sha256':digest(read_protected(path))})
    return records
def image_identity(reference):
    require(isinstance(reference,str) and re.fullmatch(r'(?:[^\s@]+@)?sha256:[a-f0-9]{64}',reference))
    result = docker('image','inspect',reference)
    require(isinstance(result,list) and len(result)==1)
    image=result[0]
    require(re.fullmatch(r'sha256:[a-f0-9]{64}',image.get('Id','')))
    source=image.get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision','')
    require(re.fullmatch(r'[a-f0-9]{40}',source))
    return image['Id'],source
def rendered_identity(files, expected_images):
    model=docker(*compose(files),'config','--format','json','--no-interpolate')
    require(model.get('name')==PROJECT and isinstance(model.get('services'),dict))
    services={};sources=set()
    for service in SERVICES:
        reference=model['services'].get(service,{}).get('image')
        image,source=image_identity(reference)
        require(image==expected_images[service]);sources.add(source)
        services[service]={'image':reference,'imageId':image}
    require(len(sources)==1)
    return {'project':PROJECT,'services':services},next(iter(sources))
def capture():
    inspected=docker('inspect',*[f'{PROJECT}-{service}-1' for service in SERVICES])
    require(isinstance(inspected,list) and len(inspected)==4)
    images={};identifiers=set();file_list=None;sources=set()
    for service,container in zip(SERVICES,inspected):
        require(container.get('Name')==f'/{PROJECT}-{service}-1' and container.get('State',{}).get('Running') is True and container.get('State',{}).get('Restarting') is False)
        identifier=container.get('Id','');require(re.fullmatch(r'[a-f0-9]{64}',identifier) and identifier not in identifiers);identifiers.add(identifier)
        config=container.get('Config',{});labels=config.get('Labels',{})
        require(labels.get('com.docker.compose.project')==PROJECT and labels.get('com.docker.compose.service')==service)
        label=labels.get('com.docker.compose.project.config_files','')
        files=label.split(',');require(','.join(files)==label and all(files))
        if file_list is None: file_list=files
        require(files==file_list)
        image,source=image_identity(config.get('Image'));require(image==container.get('Image'))
        images[service]=image;sources.add(source)
    require(len(sources)==1)
    records=file_records(file_list)
    rendered,source=rendered_identity(file_list,images);require(source==next(iter(sources)))
    # Verify bytes again after render: no changed file may gain a valid snapshot.
    require(records==file_records(file_list))
    return {'schemaVersion':2,'composeFile':file_list[0],'composeFiles':records,
            'baselineRuntime':str(Path(file_list[0]).parent),'sourceRevision':source,
            'images':images,'nginxSha256':digest(read_protected(NGINX,False)),
            'renderedIdentitySha256':digest(encoded(rendered))}
def load(path):
    root_runtime_path(str(path));value=json.loads(read_protected(path))
    require(value.get('schemaVersion') in (1,2))
    records=value.get('composeFiles') if value['schemaVersion']==2 else file_records([value.get('composeFile','')])
    require(isinstance(records,list) and all(isinstance(r,dict) and set(r)=={'path','sha256'} for r in records))
    files=[r['path'] for r in records];require(file_records(files)==records)
    require(value.get('composeFile')==files[0])
    images=value.get('images');require(isinstance(images,dict) and set(images)==set(SERVICES))
    require(all(re.fullmatch(r'sha256:[a-f0-9]{64}',image) for image in images.values()))
    require(re.fullmatch(r'[a-f0-9]{64}',value.get('nginxSha256','')))
    rendered,source=rendered_identity(files,images)
    require(file_records(files)==records)
    if value['schemaVersion']==2:
        require(value.get('baselineRuntime')==str(Path(files[0]).parent) and value.get('sourceRevision')==source)
        require(value.get('renderedIdentitySha256')==digest(encoded(rendered)))
    value.update(composeFiles=records,baselineRuntime=str(Path(files[0]).parent),sourceRevision=source)
    return value
def stable_identity(snapshot):
    runtime=Path(snapshot['baselineRuntime']);ref=runtime/'stable-secret-directory.ref'
    if ref.exists() or ref.is_symlink():
        data=read_protected(ref);require(data.endswith(b'\n') and data.count(b'\n')==1)
        require(data[:-1].decode()==str(STABLE));protected_directory(STABLE)
        return {'directory':str(STABLE),'legacy':False}
    directory=runtime/'secrets';protected_directory(directory)
    return {'directory':str(directory),'legacy':True}
def live_matches(snapshot):
    current=capture();require(current['images']==snapshot['images'] and current['sourceRevision']==snapshot['sourceRevision'] and current['nginxSha256']==snapshot['nginxSha256'])
    original=snapshot['composeFiles'];require(current['composeFiles'][:len(original)]==original)
    # Rollback appends only our durable exact-image override; never change labels.
    for record in current['composeFiles'][len(original):]:
        payload=json.loads(read_protected(record['path']))
        require(payload=={'services':{service:{'image':snapshot['images'][service]} for service in SERVICES}})
def restore(snapshot):
    protected_directory(ROOT)
    directory=Path(tempfile.mkdtemp(prefix='rollback-images-',dir=ROOT));os.chmod(directory,0o700)
    override=directory/'images.json'
    fd=os.open(override,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as handle:handle.write(encoded({'services':{s:{'image':snapshot['images'][s]} for s in SERVICES}})+b'\n');handle.flush();os.fsync(handle.fileno())
    files=[r['path'] for r in snapshot['composeFiles']]
    require(file_records(files)==snapshot['composeFiles'])
    # Keep override: running Compose labels must continue to name existing files.
    subprocess.run(['/usr/bin/docker',*compose(files+[str(override)]),'up','-d','--remove-orphans'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/root','LC_ALL':'C'},timeout=180)
    return {'rollbackComposeFile':str(override)}
def main():
    require(os.geteuid()==0)
    action=sys.argv[1]
    if action in ('capture','source','describe'):
        value=capture()
        if action=='source': print(value['sourceRevision']);return
        if action=='describe':
            require(len(sys.argv)==2);value['stableIdentity']=stable_identity(value);print(json.dumps(value,separators=(',',':'),sort_keys=True));return
        if len(sys.argv)==3:
            output=root_runtime_path(sys.argv[2]);protected_parents(output)
            fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as handle:handle.write(encoded(value)+b'\n');handle.flush();os.fsync(handle.fileno())
        else: require(len(sys.argv)==2)
    else:
        require(len(sys.argv)==3);value=load(sys.argv[2])
        if action=='stable': value=stable_identity(value)
        elif action=='bootstrap':
            path=Path(value['baselineRuntime'])/'bootstrap.env';read_protected(path);print(path);return
        elif action=='live-match':live_matches(value);value={'status':'verified'}
        elif action=='restore':value=restore(value)
        else: require(action=='verify')
    print(json.dumps(value,separators=(',',':'),sort_keys=True))
if __name__=='__main__':
    try:main()
    except (Rejected,OSError,ValueError,KeyError,TypeError,AttributeError,IndexError,subprocess.SubprocessError):
        print('CN_COMPOSE_BASELINE_REJECTED',file=sys.stderr);sys.exit(1)
