#!/usr/bin/env python3
"""Bounded root candidate closure upgrade; never executes publisher/app code.

Uses the reviewed transaction engine for per-file atomic CAS, backup journal,
entry-last commit and interrupted rollback. Not a general-purpose installer.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import types

OLD_REVISION = '295c19f512335eb2918a41183881a89cf0729b9c'
OLD = {'canonical_control.py': '1b6ba3071d23765e8c1bfa77ac4cea8c62cbdad79e1747cf82b9129e0bf1d490', 'cn_candidate_host.py': 'db96f744d293133bc117d93cddf51dfd4fc8dcaa085ac73ddfda8daf60a11f3a', 'cn_candidate_publication.py': 'fa43761b4f028da05783ca947a12e4fee58cd3a9c743a623f0afc9ea3b3f63e1', 'cn_image_archive.py': 'e6420f23fd54bb62cd9633a1c5506e9898b9209cd9e8e1105f1d90bfde9c4453', 'cn_image_candidate.py': '577ba2cc8ba9405ff524c3cdebea68186ec568c2ec2e5afe248decfba55a5597', 'hosted-release.py': 'c771941174f01743531dab6f0d7da4a665229ffba899894264cd2193c9d1c777', 'import-cn-image-archives.py': '31a0802fc3fce89eb49fcdf29e896575881f1419fdaecb71e43acbc1426e63b5', 'import-cn-image-candidates.py': '14f3645951cb442bb59663c05e6f94620bb34e9bcd054e83a4e341010030196e'}
HELPER_SHA = '74d5a1b1e728ed74ed3e9d7c8f2a602dfa7143f3985eab7234f2710cad88fde8'
ENTRY = 'import-cn-image-candidates.py'
NAMES = frozenset(OLD) | {'cn_candidate_revalidation.py'}
TOOLS = Path('/usr/local/lib/workspacex-cn')
PACKAGES = Path('/etc/workspacex-cn/candidate-tool-upgrade')
BACKUPS = Path('/var/lib/workspacex-cn/candidate-tool-upgrades')
LOCK = Path('/var/lib/workspacex-cn/runtime/release.lock')
HOST = 'i-uf6ga92ewloganobbln6'


def need(condition, code):
    if not condition:raise ValueError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def decode(raw):
    def pairs(items):
        value={}
        for k,v in items:need(k not in value,'DUPLICATE_FIELD');value[k]=v
        return value
    return json.loads(raw,object_pairs_hook=pairs)


def directory(path, uid=0, boundary=None):
    path=Path(path);need(path.is_absolute() and '..' not in path.parts,'DIRECTORY_PATH')
    if boundary is not None:
        need(path.is_relative_to(boundary),'FIXTURE_BOUNDARY');parts=path.relative_to(boundary).parts
        fd=os.open(boundary,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    else:
        fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);parts=path.parts[1:]
    try:
        for part in (None,*parts):
            if part is not None:
                child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
            st=os.fstat(fd);need(st.st_uid==uid and not st.st_mode & 0o022,'DIRECTORY_TRUST')
        return fd
    except BaseException:os.close(fd);raise


def read(path, maximum, digest=None, mode=0o600, uid=0, gid=0, boundary=None):
    path=Path(path);parent=directory(path.parent,uid,boundary)
    try:
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(fd)
            need(stat.S_ISREG(before.st_mode) and before.st_uid==uid and before.st_gid==gid
                 and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==mode and before.st_size<=maximum,'FILE_TRUST')
            raw=stream.read(maximum+1);after=os.fstat(fd);named=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
            ident=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            need(len(raw)<=maximum and ident(before)==ident(after)==ident(named),'FILE_CHANGED')
            if digest is not None:need(sha(raw)==digest,'FILE_HASH')
            return raw
    finally:os.close(parent)


def timestamp(value):
    need(isinstance(value,str),'TIME_FORMAT')
    result=datetime.fromisoformat(value.replace('Z','+00:00'))
    need(result.tzinfo is not None,'TIME_TIMEZONE');return result


def fresh(value):
    start,end=timestamp(value['issuedAt']),timestamp(value['expiresAt'])
    need(start<=datetime.now(timezone.utc)<end and 0<(end-start).total_seconds()<=3600,'UPGRADE_APPROVAL_EXPIRED')


def validate(value, require_fresh=True):
    fields={'kind','schemaVersion','upgradeId','oldRevision','oldFiles','newRevision','files','transactionHelperSha256',
            'installerSha256','issuedAt','expiresAt','ecsInstanceId','installAuthorized'}
    need(type(value) is dict and set(value)==fields and value['kind']=='cn-candidate-tool-upgrade-v1'
         and type(value['schemaVersion']) is int and value['schemaVersion']==1,'UPGRADE_MANIFEST')
    need(value['oldRevision']==OLD_REVISION and value['oldFiles']==OLD,'UPGRADE_OLD_CLOSURE')
    need(value['ecsInstanceId']==HOST and value['installAuthorized'] is True,'UPGRADE_AUTHORITY')
    need(isinstance(value['upgradeId'],str) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',value['upgradeId']),'UPGRADE_ID')
    need(isinstance(value['newRevision'],str) and re.fullmatch('[a-f0-9]{40}',value['newRevision']) and value['newRevision']!=OLD_REVISION,'UPGRADE_REVISION')
    need(value['transactionHelperSha256']==HELPER_SHA and isinstance(value['installerSha256'],str)
         and re.fullmatch('[a-f0-9]{64}',value['installerSha256']),'UPGRADE_HELPER')
    need(type(value['files']) is dict and set(value['files'])==NAMES,'UPGRADE_COMPLETE_CLOSURE')
    for item in value['files'].values():
        need(type(item) is dict and set(item)=={'sha256','size'} and isinstance(item['sha256'],str)
             and re.fullmatch('[a-f0-9]{64}',item['sha256']) and type(item['size']) is int and 0<item['size']<=1024**2,'UPGRADE_PAYLOAD')
    if require_fresh:fresh(value)
    return value


def targets(manifest, tools=TOOLS, uid=0, gid=0):
    result=[]
    for name in sorted(NAMES-{ENTRY})+[ENTRY]:
        before={'sha256':OLD[name],'uid':uid,'gid':gid,'mode':0o700,'nlink':1} if name in OLD else {'absent':True}
        result.append(dict(destination=str(tools/name),payload=name,before=before,sha256=manifest['files'][name]['sha256'],mode=0o700,uid=uid,gid=gid))
    return result


def load_engine(package, uid=0, gid=0, boundary=None):
    raw=read(package/'cn-tool-install-transaction.py',1024**2,HELPER_SHA,0o700,uid,gid,boundary)
    module=types.ModuleType('candidate_upgrade_transaction')
    # Compile the already pinned bytes. Never import an ambient helper path.
    exec(compile(raw,'reviewed-cn-tool-install-transaction.py','exec'),module.__dict__)
    return module


def payloads(manifest, package, uid=0, gid=0, boundary=None):
    result={}
    for name,item in manifest['files'].items():
        raw=read(package/'payloads'/name,item['size'],item['sha256'],0o600,uid,gid,boundary)
        need(len(raw)==item['size'],'UPGRADE_PAYLOAD_SIZE')
        compile(raw,name,'exec')  # Syntax only: no imports, app or publisher execution.
        result[name]=raw
    return result


@contextmanager
def locked(path=LOCK, uid=0, gid=0, boundary=None):
    parent=directory(path.parent,uid,boundary)
    fd=os.open(path.name,os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
    try:
        st=os.fstat(fd)
        need(stat.S_ISREG(st.st_mode) and st.st_uid==uid and st.st_gid==gid and st.st_nlink==1 and not st.st_mode&0o022,'LOCK_TRUST')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        named=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
        need((st.st_dev,st.st_ino)==(named.st_dev,named.st_ino),'LOCK_CHANGED')
        yield
    finally:os.close(fd);os.close(parent)


def host_identity():
    def request(method,path,headers):
        connection=http.client.HTTPConnection('100.100.100.200',80,timeout=2)
        try:
            connection.request(method,path,headers=headers);response=connection.getresponse();raw=response.read(4097)
            need(response.status==200 and 0<len(raw)<=4096,'HOST_IDENTITY_READ');return raw
        finally:connection.close()
    token=request('PUT','/latest/api/token',{'X-aliyun-ecs-metadata-token-ttl-seconds':'60'})
    need(all(33<=x<=126 for x in token),'HOST_TOKEN_FORMAT')
    headers={'X-aliyun-ecs-metadata-token':token.decode('ascii')}
    need(request('GET','/latest/meta-data/instance-id',headers)==HOST.encode()
         and request('GET','/latest/meta-data/region-id',headers)==b'cn-shanghai','HOST_IDENTITY_MISMATCH')


def execute(engine, manifest, manifest_sha, content, tools, backup, uid=0, gid=0, boundary=None, inject=None):
    """Internal fixture seam. Production supplies fixed roots and holds canonical lock."""
    rows=targets(manifest,tools,uid,gid)
    binding=engine.manifest_binding(manifest_sha,manifest['newRevision'],rows,datetime.now(timezone.utc).timestamp())
    for row in rows:
        fd=directory(Path(row['destination']).parent,uid,boundary)
        try:engine.compare(fd,Path(row['destination']).name,row['before'],uid)
        finally:os.close(fd)
    fresh(manifest)
    def after_replace(index):
        fresh(manifest)
        if inject is not None:inject(index)
    return engine.transaction(rows,content,backup,uid,gid,boundary,after_replace,binding)


def main():
    need(os.geteuid()==0 and os.getegid()==0 and sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode,'ISOLATED_ROOT_REQUIRED')
    need(len(sys.argv)==4 and sys.argv[1] in ('--check-plan','--apply','--recover-reviewed'),'EXPLICIT_OPERATION')
    operation,upgrade_id,expected=sys.argv[1:]
    need(re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',upgrade_id) and re.fullmatch('[a-f0-9]{64}',expected),'EXACT_ARGUMENTS')
    package=PACKAGES/upgrade_id
    def stopped(*_):raise RuntimeError('UPGRADE_INTERRUPTED')
    signal.signal(signal.SIGTERM,stopped);signal.signal(signal.SIGINT,stopped)
    signal.signal(signal.SIGALRM,stopped);signal.alarm(120)
    with locked():
        host_identity()
        if operation=='--recover-reviewed':
            recovery=decode(read(package/'recovery.json',16384,expected))
            need(type(recovery) is dict and set(recovery)=={'kind','upgradeId','manifestSha256','journalSha256','issuedAt','expiresAt','recoveryAuthorized'}
                 and recovery['kind']=='cn-candidate-tool-recovery-v1' and recovery['upgradeId']==upgrade_id
                 and recovery['recoveryAuthorized'] is True,'RECOVERY_APPROVAL')
            fresh(recovery)
            expected=recovery['manifestSha256']
        raw=read(package/'manifest.json',256*1024,expected);manifest=validate(decode(raw),operation!='--recover-reviewed')
        need(manifest['upgradeId']==upgrade_id,'UPGRADE_PACKAGE_BINDING')
        read(Path(__file__).absolute(),1024**2,manifest['installerSha256'],0o700)
        engine=load_engine(package);rows=targets(manifest)
        if operation=='--recover-reviewed':
            backup=BACKUPS/upgrade_id
            journal_raw=read(backup/'journal.json',1024**2,recovery['journalSha256'])
            journal=decode(journal_raw);binding=journal.get('binding')
            need(type(binding) is dict and binding==engine.manifest_binding(expected,manifest['newRevision'],rows,binding.get('admittedAt')),'RECOVERY_BINDING')
            admitted=datetime.fromtimestamp(binding['admittedAt'],timezone.utc)
            need(timestamp(manifest['issuedAt'])<=admitted<timestamp(manifest['expiresAt']), 'RECOVERY_ORIGINAL_ADMISSION_TIME')
            result=engine.recover(backup,expected_binding=binding,expected_targets=rows,expected_journal_sha=recovery['journalSha256'])
        else:
            content=payloads(manifest,package)
            for row in rows:
                fd=directory(TOOLS)
                try:engine.compare(fd,Path(row['destination']).name,row['before'],0)
                finally:os.close(fd)
            if operation=='--check-plan':
                print('CN_CANDIDATE_UPGRADE_CHECKED writes=false');return
            # Only this fixed backup subtree may be created. Existing root must be private.
            parent=directory(BACKUPS.parent)
            try:
                try:os.mkdir(BACKUPS.name,0o700,dir_fd=parent);os.fsync(parent)
                except FileExistsError:pass
            finally:os.close(parent)
            parent=directory(BACKUPS)
            try:
                st=os.fstat(parent);need(st.st_gid==0 and stat.S_IMODE(st.st_mode)==0o700,'BACKUP_ROOT_TRUST')
                os.mkdir(upgrade_id,0o700,dir_fd=parent);os.fsync(parent)
            finally:os.close(parent)
            result=execute(engine,manifest,expected,content,TOOLS,BACKUPS/upgrade_id)
        print('CN_CANDIDATE_UPGRADE_RESULT='+json.dumps(result,sort_keys=True,separators=(',',':')))

if __name__=='__main__':
    try:main()
    except BaseException:
        print('CN_CANDIDATE_UPGRADE_REJECTED_KEEP_BACKUP',file=sys.stderr);sys.exit(1)
