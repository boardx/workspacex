#!/usr/bin/env python3
"""Explicit root-only offline runtime installation, no credential or publication calls.

Usage: python3 -I -S -B ENTRY SOURCE ATTEMPT MANIFEST_SHA PACKAGE_SHA
Inputs: /var/lib/workspacex-cn/runtime-inbox/SOURCE/ATTEMPT/{manifest.json,runtime.tar.gz}
"""
import ctypes
import errno
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tarfile

OWNER = (0, 0)
LIMIT = 160 * 1024**2


def need(value, code):
    if not value: raise ValueError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def trusted(fd, mode=None):
    value = os.fstat(fd)
    need(stat.S_ISDIR(value.st_mode) and (value.st_uid,value.st_gid) == OWNER
         and not value.st_mode & 0o022 and (mode is None or stat.S_IMODE(value.st_mode)==mode), 'DIRECTORY_TRUST')


def directory(path, create=False):
    need(Path(path).is_absolute() and '..' not in Path(path).parts, 'DIRECTORY_PATH')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        trusted(fd)
        for part in Path(path).parts[1:]:
            if create:
                try: os.mkdir(part,0o700,dir_fd=fd)
                except FileExistsError: pass
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child;trusted(fd)
        return fd
    except BaseException:
        os.close(fd);raise


def read(parent,name,expected=None,mode=0o600,maximum=LIMIT):
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    with os.fdopen(fd,'rb') as stream:
        before=os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode) and (before.st_uid,before.st_gid)==OWNER
             and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==mode
             and 0 <= before.st_size <= maximum,'FILE_TRUST')
        raw=stream.read(maximum+1)
        ident=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        need(len(raw)<=maximum and ident(before)==ident(os.fstat(stream.fileno()))
             ==ident(os.stat(name,dir_fd=parent,follow_symlinks=False)),'FILE_CHANGED')
        if expected is not None:
            need(len(raw)==expected['size'] and sha(raw)==expected['sha256'],'FILE_HASH')
        return raw


def decode(raw):
    def pairs(items):
        result={}
        for key,value in items:
            need(key not in result,'DUPLICATE_JSON_KEY');result[key]=value
        return result
    return json.loads(raw,object_pairs_hook=pairs)


def validate(manifest,source,attempt):
    need(manifest.get('kind')=='cn-candidate-canonical-runtime-review-v1'
         and type(manifest.get('schemaVersion')) is int and manifest['schemaVersion']==1
         and manifest.get('sourceRevision')==source and manifest.get('buildAttemptId')==attempt
         and manifest.get('architecture')=='linux/amd64','MANIFEST_IDENTITY')
    target='/etc/workspacex-cn/candidate-publish/'+source+'/'+attempt
    need(manifest.get('targetDirectory')==target,'TARGET_BOUNDARY')
    node=manifest['existingNode']
    need(set(node)=={'path','sha256','size','mode'} and node['path']=='/usr/bin/node'
         and node['mode']=='0755' and node['sha256']==manifest['nodeSha256']
         and re.fullmatch('[a-f0-9]{64}',node['sha256']) and type(node['size']) is int
         and 0<node['size']<=LIMIT,'EXISTING_NODE_BINDING')
    files=manifest['files'];need(type(files) is dict and 1<len(files)<=4096,'FILE_SET')
    total=0
    for name,item in files.items():
        need(name=='canonical-control.json' or name.startswith('canonical-source/'),'FILE_SCOPE')
        need(str(Path(name))==name and '..' not in Path(name).parts and '\\' not in name,'FILE_PATH')
        need(set(item)=={'sha256','size','mode'} and re.fullmatch('[a-f0-9]{64}',item['sha256'])
             and type(item['size']) is int and 0<=item['size']<=LIMIT
             and item['mode']==('0600' if name=='canonical-control.json' else '0700'),'FILE_METADATA')
        total+=item['size']
    need(total<=32*1024**2 and 'canonical-control.json' in files,'PAYLOAD_TOTAL')
    return target


def unpack(raw,manifest):
    # Bounded expansion before tar parsing; no extract-to-filesystem operation.
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream: expanded=stream.read(40*1024**2+1)
    need(len(expanded)<=40*1024**2,'PACKAGE_EXPANSION')
    files={}
    with tarfile.open(fileobj=io.BytesIO(expanded),mode='r:') as archive:
        for entry in archive:
            need(entry.name in manifest['files'] and entry.name not in files and entry.isfile()
                 and not entry.pax_headers and entry.uid==entry.gid==0,'PACKAGE_MEMBER')
            item=manifest['files'][entry.name]
            need(entry.size==item['size'] and entry.mode==int(item['mode'],8),'PACKAGE_METADATA')
            content=archive.extractfile(entry).read(item['size']+1)
            need(len(content)==item['size'] and sha(content)==item['sha256'],'PACKAGE_HASH')
            files[entry.name]=content
    need(set(files)==set(manifest['files']),'PACKAGE_COMPLETE')
    config=decode(files['canonical-control.json'])
    need(set(config)=={'schemaVersion','nodeExecutable','nodeSha256','checkoutDirectory','fileSha256'}
         and type(config['schemaVersion']) is int and config['schemaVersion']==1
         and config['nodeExecutable']==manifest['targetDirectory']+'/node'
         and config['nodeSha256']==manifest['nodeSha256']
         and config['checkoutDirectory']==manifest['targetDirectory']+'/canonical-source'
         and config['fileSha256']=={k[len('canonical-source/'):]:v['sha256'] for k,v in manifest['files'].items()
                                  if k.startswith('canonical-source/')}
         and sha(files['canonical-control.json'])==manifest['canonicalConfigurationSha256'],'CONFIG_BINDING')
    return files


def tree(parent,name):
    fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
    try:
        trusted(fd,0o700);result={}
        for child in os.listdir(fd):
            value=os.stat(child,dir_fd=fd,follow_symlinks=False)
            if stat.S_ISDIR(value.st_mode):
                result.update({child+'/'+k:v for k,v in tree(fd,child).items()})
            else: result[child]=read(fd,child,mode=0o700,maximum=32*1024**2)
        return result
    finally: os.close(fd)


def no_replace(parent,stage,name):
    libc=ctypes.CDLL(None,use_errno=True)
    need(hasattr(libc,'renameat2'),'ATOMIC_NOREPLACE_UNSUPPORTED')
    fn=libc.renameat2
    fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]
    fn.restype=ctypes.c_int
    need(fn(stage,os.fsencode(name),parent,os.fsencode(name),1)==0,'TARGET_COLLISION')


def install(parent,files,node):
    trusted(parent)
    wanted={'node':node,'canonical-control.json':files['canonical-control.json']}
    wanted_tree={k[len('canonical-source/'):]:v for k,v in files.items() if k.startswith('canonical-source/')}
    def state(name):
        try:
            if name=='canonical-source': return tree(parent,name)
            return read(parent,name,mode=0o600 if name.endswith('.json') else 0o700)
        except FileNotFoundError: return None
    desired=dict(wanted,**{'canonical-source':wanted_tree})
    before={name:state(name) for name in desired}
    need(all(value is None or value==desired[name] for name,value in before.items()),'EXISTING_RUNTIME_MISMATCH')
    need(before['canonical-control.json'] is None or all(x is not None for x in before.values()),'EXISTING_CONFIG_INCOMPLETE')
    if all(x is not None for x in before.values()):return []
    temporary='.runtime-stage-'+os.urandom(12).hex();os.mkdir(temporary,0o700,dir_fd=parent)
    stage=os.open(temporary,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
    installed=[]
    try:
        os.fchmod(stage,0o700)
        for name,raw in dict(files,node=node).items():
            current=os.dup(stage)
            try:
                parts=Path(name).parts
                for part in parts[:-1]:
                    try:os.mkdir(part,0o700,dir_fd=current)
                    except FileExistsError:pass
                    child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
                    os.close(current);current=child;os.fchmod(current,0o700);trusted(current,0o700)
                fd=os.open(parts[-1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=current)
                with os.fdopen(fd,'wb') as handle:
                    os.fchmod(handle.fileno(),0o600 if name=='canonical-control.json' else 0o700)
                    handle.write(raw);handle.flush();os.fsync(handle.fileno())
                os.fsync(current)
            finally:os.close(current)
        for name in ('node','canonical-source','canonical-control.json'):
            need(state(name)==before[name],'RUNTIME_TARGET_CHANGED')
            if before[name] is not None:continue
            if name=='canonical-control.json':
                need(state('node')==node and state('canonical-source')==wanted_tree,'RUNTIME_CLOSURE_INCOMPLETE')
            no_replace(parent,stage,name);installed.append(name);os.fsync(parent)
        return installed
    finally:
        # Only this invocation's random private stage; installed paths never deleted.
        observed=os.stat(temporary,dir_fd=parent,follow_symlinks=False);held=os.fstat(stage)
        need((observed.st_dev,observed.st_ino)==(held.st_dev,held.st_ino),'STAGE_REPLACED')
        shutil.rmtree(Path('/proc/self/fd')/str(parent)/temporary)
        os.close(stage)


def main():
    need(len(sys.argv)==5 and os.geteuid()==os.getegid()==0 and sys.flags.isolated
         and sys.flags.no_site and sys.dont_write_bytecode,'ISOLATED_EXPLICIT_ROOT_REQUIRED')
    source,attempt,manifest_sha,package_sha=sys.argv[1:]
    need(re.fullmatch('[a-f0-9]{40}',source) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',attempt)
         and all(re.fullmatch('[a-f0-9]{64}',x) for x in (manifest_sha,package_sha)),'INVOCATION_IDENTITY')
    inbox=directory('/var/lib/workspacex-cn/runtime-inbox/'+source+'/'+attempt)
    try:
        raw=read(inbox,'manifest.json',maximum=1024**2);need(sha(raw)==manifest_sha,'MANIFEST_HASH')
        manifest=decode(raw);target=validate(manifest,source,attempt)
        packed=read(inbox,'runtime.tar.gz',maximum=32*1024**2);need(sha(packed)==package_sha,'PACKAGE_HASH')
        files=unpack(packed,manifest)
    finally:os.close(inbox)
    node_parent=directory('/usr/bin')
    try:node=read(node_parent,'node',manifest['existingNode'],0o755)
    finally:os.close(node_parent)
    need(node[:6]==b'\x7fELF\x02\x01' and node[18:20]==b'\x3e\x00','NODE_LINUX_X64')
    lock_parent=directory('/var/lib/workspacex-cn/runtime')
    lock=None
    try:
        read(lock_parent,'release.lock',maximum=4096)
        lock=os.open('release.lock',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=lock_parent)
        held=os.fstat(lock)
        need(stat.S_ISREG(held.st_mode) and (held.st_uid,held.st_gid)==OWNER
             and held.st_nlink==1 and stat.S_IMODE(held.st_mode)==0o600,'LOCK_TRUST')
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        named=os.stat('release.lock',dir_fd=lock_parent,follow_symlinks=False)
        need((held.st_dev,held.st_ino)==(named.st_dev,named.st_ino),'LOCK_CHANGED')
        target_fd=directory(target,create=True)
        try:installed=install(target_fd,files,node)
        finally:os.close(target_fd)
    finally:
        if lock is not None:os.close(lock)
        os.close(lock_parent)
    print(json.dumps(dict(installed=installed,manifestSha256=manifest_sha,packageSha256=package_sha,
                          runtimeExecuted=False,publicationExecuted=False),sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception:
        print('CN_CANDIDATE_RUNTIME_INSTALL_REJECTED',file=sys.stderr);raise SystemExit(1)
