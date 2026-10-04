#!/usr/bin/env python3
"""Private local hold protocol; not a production writer or recovery adapter.
CLI is root-only. No database, service, network or secret operations.
"""
import contextlib, fcntl, hashlib, json, os, re, secrets, stat, sys
from pathlib import Path

class HoldRejected(ValueError): pass

def identity(value):
    keys={'sourceRevision','baselineRevision','migrationPlanSha256','attemptId'}
    if not isinstance(value,dict) or set(value)!=keys: raise HoldRejected('IDENTITY_INVALID')
    for key,length in [('sourceRevision',40),('baselineRevision',40),('migrationPlanSha256',64)]:
        if not isinstance(value[key],str) or not re.fullmatch('[a-f0-9]{%d}'%length,value[key]): raise HoldRejected('IDENTITY_INVALID')
    if not isinstance(value['attemptId'],str) or not re.fullmatch('[a-zA-Z0-9-]{1,128}',value['attemptId']): raise HoldRejected('IDENTITY_INVALID')
    return dict(value)

class HoldStore:
    # Non-root owners are only for disposable local tests. CLI never exposes this.
    def __init__(self,directory,owner_uid=0,owner_gid=0):
        self.path=Path(directory); self.uid=owner_uid; self.gid=owner_gid
        if not self.path.is_absolute(): raise HoldRejected('ABSOLUTE_DIRECTORY_REQUIRED')
        if len(self.path.parts)<=1:raise HoldRejected('PRIVATE_DIRECTORY_REQUIRED')
    def _directory(self):
        fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
        try:
            for index,part in enumerate(self.path.parts[1:]):
                if part in ('','..','.'): raise HoldRejected('DIRECTORY_INVALID')
                child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                os.close(fd);fd=child;st=os.fstat(fd)
                if st.st_uid not in (0,self.uid) or (st.st_mode&0o022 and not st.st_mode&stat.S_ISVTX): raise HoldRejected('UNTRUSTED_ANCESTOR')
                if index==len(self.path.parts)-2 and (st.st_uid!=self.uid or st.st_gid!=self.gid or stat.S_IMODE(st.st_mode)!=0o700): raise HoldRejected('PRIVATE_DIRECTORY_REQUIRED')
            return fd
        except BaseException: os.close(fd); raise
    def _file(self,st):
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=self.uid or st.st_gid!=self.gid or stat.S_IMODE(st.st_mode)!=0o600 or st.st_nlink!=1: raise HoldRejected('PRIVATE_FILE_REQUIRED')
    @contextlib.contextmanager
    def _locked(self):
        directory=self._directory();lock=None
        try:
            try:
                lock=os.open('hold.lock',os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
                os.fsync(lock);os.fsync(directory)
            except FileExistsError: lock=os.open('hold.lock',os.O_RDWR|os.O_NOFOLLOW,dir_fd=directory)
            self._file(os.fstat(lock));fcntl.flock(lock,fcntl.LOCK_EX)
            a=os.fstat(lock);b=os.stat('hold.lock',dir_fd=directory,follow_symlinks=False);self._file(a);self._file(b)
            if (a.st_dev,a.st_ino)!=(b.st_dev,b.st_ino): raise HoldRejected('LOCK_INODE_CHANGED')
            yield directory
        finally:
            if lock is not None: os.close(lock)
            os.close(directory)
    def _read(self,directory):
        try:fd=os.open('hold.json',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
        except FileNotFoundError:return None
        try:
            before=os.fstat(fd);self._file(before);raw=os.read(fd,65537)
            if len(raw)>65536:raise HoldRejected('HOLD_TOO_LARGE')
            after=os.stat('hold.json',dir_fd=directory,follow_symlinks=False);self._file(after)
            if (before.st_dev,before.st_ino)!=(after.st_dev,after.st_ino):raise HoldRejected('HOLD_INODE_CHANGED')
            try:value=json.loads(raw)
            except (ValueError,UnicodeError):raise HoldRejected('HOLD_UNKNOWN')
            if not isinstance(value,dict) or set(value)!={'schemaVersion','state','generation','identity'} or value['schemaVersion']!=1 or value['state'] not in ('held','cleared') or not isinstance(value['generation'],str) or not re.fullmatch('[a-f0-9]{32}',value['generation']):raise HoldRejected('HOLD_UNKNOWN')
            identity(value['identity'])
            return dict(value,sha256=hashlib.sha256(raw).hexdigest(),device=before.st_dev,inode=before.st_ino)
        finally:os.close(fd)
    def _write(self,directory,value,first=False):
        name='hold.json' if first else '.hold-'+secrets.token_hex(16)
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
        owned=os.fstat(fd);replaced=False
        try:
            self._file(owned);raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
            with os.fdopen(fd,'wb',closefd=False) as stream:stream.write(raw);stream.flush();os.fsync(fd)
            if not first:
                os.replace(name,'hold.json',src_dir_fd=directory,dst_dir_fd=directory);replaced=True
            os.fsync(directory)
        except BaseException:
            # A first-write partial hold remains fail-closed. Only unpublished
            # transition temps can be cleaned, after proving our original inode.
            if not first and not replaced:
                try:
                    actual=os.stat(name,dir_fd=directory,follow_symlinks=False)
                    self._file(actual)
                    if (actual.st_dev,actual.st_ino)==(owned.st_dev,owned.st_ino):
                        os.unlink(name,dir_fd=directory);os.fsync(directory)
                except FileNotFoundError:pass
            raise
        finally:os.close(fd)
    def read(self):
        with self._locked() as directory:return self._read(directory)
    def create(self,expected_identity):
        expected_identity=identity(expected_identity)
        with self._locked() as directory:
            old=self._read(directory)
            if old is not None and old['state']=='held':raise HoldRejected('HOLD_ALREADY_PRESENT')
            value={'schemaVersion':1,'state':'held','generation':secrets.token_hex(16),'identity':expected_identity}
            self._write(directory,value,first=old is None)
            return self._read(directory)
    def clear(self,expected):
        # Require the original actual readback, including inode and exact bytes,
        # not just a caller-supplied generation or accepted flag.
        with self._locked() as directory:
            actual=self._read(directory)
            if not isinstance(expected,dict) or actual is None or actual!=expected or actual['state']!='held':raise HoldRejected('HOLD_CAS_MISMATCH')
            value={key:actual[key] for key in ('schemaVersion','state','generation','identity')};value['state']='cleared'
            self._write(directory,value)
            observed=self._read(directory)
            if observed is None or observed['state']!='cleared' or observed['generation']!=expected['generation'] or observed['identity']!=expected['identity']:raise HoldRejected('HOLD_CLEAR_UNKNOWN')
            return observed
    def admit_ordinary_release(self):
        with self._locked() as directory:
            observed=self._read(directory)
            if observed is not None and observed['state']!='cleared':raise HoldRejected('MAINTENANCE_HOLD_BLOCKS_RELEASE')
            return {'admitted':True,'holdState':'absent' if observed is None else 'cleared'}

CANONICAL_DIRECTORY='/var/lib/workspacex-cn/runtime'
CANONICAL_LOCK=CANONICAL_DIRECTORY+'/release.lock'
def require_canonical_lock(path=CANONICAL_LOCK,owner_uid=0,owner_gid=0):
    # Parameters are test-only API; CLI accepts no path/owner override.
    parent=Path(path).parent
    st=parent.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid!=owner_uid or st.st_gid!=owner_gid or stat.S_IMODE(st.st_mode)!=0o700:raise HoldRejected('CANONICAL_DIRECTORY_TRUST')
    inherited=os.fstat(9)
    fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
    try:
        actual=os.fstat(fd)
        if not stat.S_ISREG(actual.st_mode) or actual.st_uid!=owner_uid or actual.st_gid!=owner_gid or stat.S_IMODE(actual.st_mode)!=0o600 or actual.st_nlink!=1 or (inherited.st_dev,inherited.st_ino)!=(actual.st_dev,actual.st_ino):raise HoldRejected('CANONICAL_LOCK_IDENTITY')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:pass
        else:
            fcntl.flock(fd,fcntl.LOCK_UN);raise HoldRejected('CANONICAL_LOCK_NOT_HELD')
        try:fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise HoldRejected('CANONICAL_LOCK_FOREIGN_HOLDER')
    finally:os.close(fd)
def require_installed_identity():
    path=Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py')
    profile=Path('/etc/workspacex-cn/trusted-tool-binding.json')
    for p in (path,profile):
        for parent in p.parents:
            st=parent.lstat()
            if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o022:raise HoldRejected('TOOL_PARENT_TRUST')
    def read(p,mode):
        fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as f:
            st=os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=mode or st.st_nlink!=1:raise HoldRejected('TOOL_FILE_TRUST')
            return f.read()
    binding=json.loads(read(profile,0o600));raw=read(path,0o700)
    expected=binding.get('filesSha256',{}).get('.harness/scripts/vm/cn_maintenance_hold.py')
    if not re.fullmatch('[a-f0-9]{40}',binding.get('toolRevision','')) or hashlib.sha256(raw).hexdigest()!=expected:raise HoldRejected('TOOL_HASH_BINDING')
def main():
    if os.geteuid()!=0 or os.getegid()!=0:raise HoldRejected('ROOT_ONLY')
    if len(sys.argv)!=3 or sys.argv[1] not in ('read','create','clear','admit'):raise HoldRejected('USAGE')
    operation,directory=sys.argv[1:]
    if directory!=CANONICAL_DIRECTORY:raise HoldRejected('CANONICAL_DIRECTORY_REQUIRED')
    require_installed_identity()
    if operation in ('create','clear','admit'):require_canonical_lock()
    store=HoldStore(directory)
    result={'read':store.read,'admit':store.admit_ordinary_release}.get(operation)
    if result:value=result()
    else:
        raw=sys.stdin.buffer.read(65537)
        if len(raw)>65536:raise HoldRejected('INPUT_TOO_LARGE')
        payload=json.loads(raw);value=store.create(payload) if operation=='create' else store.clear(payload)
    print(json.dumps(value,sort_keys=True))
if __name__=='__main__':
    try:main()
    except BaseException:print('CN_MAINTENANCE_HOLD_REJECTED',file=sys.stderr);sys.exit(1)
