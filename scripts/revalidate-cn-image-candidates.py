#!/usr/bin/env python3
"""Isolated bootstrap; verify every byte before importing any repository module.
python3 -I -S -B revalidate-cn-image-candidates.py POLICY POLICY_SHA OUTPUT_PARENT
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile

FILES=frozenset(('revalidate-cn-image-candidates.py','cn_candidate_github.py','cn_candidate_revalidation.py',
                 'cn_image_candidate.py','cn_image_archive.py','hosted-release.py','canonical_control.py'))


def require(condition):
    if not condition:raise ValueError('REVALIDATION_BOOTSTRAP_REJECTED')


def read(path,limit,expected,private=False):
    path=Path(path);require(path.is_absolute() and '..' not in path.parts)
    parent=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
            os.close(parent);parent=child;st=os.fstat(parent)
            require(st.st_uid in (0,os.geteuid()) and not st.st_mode & 0o022)
        fd=os.open(path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid in (0,os.geteuid()) and before.st_nlink==1
                    and not before.st_mode & (0o077 if private else 0o022) and 0<before.st_size<=limit)
            raw=stream.read(limit+1);after=os.fstat(fd);named=os.stat(path.name,dir_fd=parent,follow_symlinks=False)
            identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            require(len(raw)<=limit and identity(before)==identity(after)==identity(named)
                    and hashlib.sha256(raw).hexdigest()==expected)
            return raw
    finally:os.close(parent)


def main():
    require(sys.flags.isolated and sys.flags.no_site and sys.dont_write_bytecode and len(sys.argv) in (4,5,7))
    acquisition=len(sys.argv)==5
    if acquisition:
        require(sys.argv[1]=='--acquire')
        policy_path,expected,parent=sys.argv[2:5]
    else:policy_path,expected,parent=sys.argv[1:4]
    cached=len(sys.argv)==7
    if cached:require(sys.argv[4]=='--cached' and re.fullmatch('[a-f0-9]{64}',sys.argv[6]))
    require(re.fullmatch('[a-f0-9]{64}',expected) and Path(parent)==Path(policy_path).parent)
    def pairs(items):
        value={}
        for key,item in items:require(key not in value);value[key]=item
        return value
    raw=read(policy_path,256*1024,expected,True);policy=json.loads(raw,object_pairs_hook=pairs)
    hashes=policy.get('verifierFiles');require(type(hashes) is dict and set(hashes)==FILES)
    require(all(isinstance(v,str) and re.fullmatch('[a-f0-9]{64}',v) for v in hashes.values()))
    own=Path(__file__).absolute();read(own,1024**2,hashes[own.name])
    st=os.lstat(parent);require(stat.S_ISDIR(st.st_mode) and st.st_uid==os.geteuid() and not st.st_mode & 0o077)
    def expired(*_):raise TimeoutError('REVALIDATION_DEADLINE')
    seconds=policy.get('maxSeconds') if acquisition else 3600
    require(type(seconds) is int and 0<seconds<=14400)
    signal.signal(signal.SIGALRM,expired);signal.alarm(seconds)
    with tempfile.TemporaryDirectory(prefix='.revalidation-tools-',dir=parent) as directory:
        for name,digest in hashes.items():
            data=read(own.parent/name,1024**2,digest);target=Path(directory)/name
            with target.open('xb') as output:os.chmod(target,0o700);output.write(data)
        sys.path.insert(0,directory)
        import cn_candidate_github
        if acquisition:result=cn_candidate_github.acquire(policy_path,expected,parent)
        elif cached:result=cn_candidate_github.run(policy_path,expected,parent,cache_manifest_path=sys.argv[5],cache_manifest_sha=sys.argv[6])
        else:result=cn_candidate_github.run(policy_path,expected,parent)
        print(('CN_CANDIDATE_BYTES_ACQUIRED=' if acquisition else 'CN_CANDIDATE_REVALIDATED=')+json.dumps(result,sort_keys=True,separators=(',',':')))

if __name__=='__main__':
    try:main()
    except Exception:
        print('CN_CANDIDATE_REVALIDATION_REJECTED',file=sys.stderr);sys.exit(1)
