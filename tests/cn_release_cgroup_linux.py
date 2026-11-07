#!/usr/bin/env python3
"""Real Linux cgroup-v2 test in one exclusive disposable CI subtree.

Exit nonzero if unsupported. No skipped test is counted as evidence. The only
cgroup killed/removed is the freshly created, random test-owned subtree.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys
import tempfile
import time
import uuid

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('entry',ROOT/'.harness/scripts/vm/cn-release-advance.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)


def current_parent():
    rows=[line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::')]
    if len(rows)!=1 or not rows[0].startswith('/') or '..' in Path(rows[0]).parts:
        raise RuntimeError('CURRENT_CGROUP_REQUIRED')
    parent=Path('/sys/fs/cgroup')/rows[0].lstrip('/')
    if parent.resolve(strict=True)!=parent or not (parent/'cgroup.procs').is_file():
        raise RuntimeError('CURRENT_CGROUP_UNAVAILABLE')
    return parent


def main():
    if sys.platform!='linux' or os.geteuid()!=0:
        print('{"status":"CAPABILITY_UNAVAILABLE","verified":false,"reason":"LINUX_ROOT_REQUIRED"}')
        return 2
    try:parent=current_parent()
    except (OSError,RuntimeError):
        print('{"status":"CAPABILITY_UNAVAILABLE","verified":false,"reason":"CURRENT_CGROUP_UNAVAILABLE"}')
        return 2
    if not (parent/'cgroup.controllers').is_file():
        print('{"status":"CAPABILITY_UNAVAILABLE","verified":false,"reason":"CGROUP_V2_REQUIRED"}')
        return 2
    base=parent/('workspacex-ci-entry-'+uuid.uuid4().hex)
    created=False;identity=None
    try:
        base.mkdir(mode=0o700);created=True
        st=base.lstat();identity=(st.st_dev,st.st_ino)
        assert (base/'cgroup.kill').is_file()
        m.CGROUP_BASE=base;m.KillDomain.preflight()
        with tempfile.TemporaryDirectory(prefix='cn-cgroup-e2e-') as td:
            marker=Path(td)/'escaped-write'
            ready=Path(td)/'session-ready.json'
            def action(delay,hang):
                child=("import os,time,json;os.setsid();os.close(1);os.close(2);"
                       "f=open("+repr(str(ready)+'.tmp')+",'w');json.dump({'pid':os.getpid(),'pgid':os.getpgrp(),'cgroup':open('/proc/self/cgroup').read()},f);"
                       "f.flush();os.fsync(f.fileno());f.close();os.replace("+repr(str(ready)+'.tmp')+","+repr(str(ready))+");time.sleep("+str(delay)+");open("+repr(str(marker))+",'w').write('late')")
                wait=("import json,time,os;from pathlib import Path;p=Path("+repr(str(ready))+");"
                      "deadline=time.monotonic()+2\n"
                      "while not p.exists() and time.monotonic()<deadline:time.sleep(.01)\n"
                      "v=json.loads(p.read_text());assert v['pid']==v['pgid']==os.getpgid(v['pid'])")
                return ('set -e\n'+shlex.quote(sys.executable)+' -I -c '+shlex.quote(child)+' &\n'+
                        shlex.quote(sys.executable)+' -I -c '+shlex.quote(wait)+'\n'+
                        ('sleep 10\n' if hang else '')+"printf '{\"ok\":true}\\n'\n").encode()
            def assert_ready():
                value=json.loads(ready.read_text())
                assert type(value['pid']) is int and value['pid']>0 and value['pid']==value['pgid']
                rows=[line[3:] for line in value['cgroup'].splitlines() if line.startswith('0::')]
                assert len(rows)==1 and rows[0].startswith('/') and '..' not in Path(rows[0]).parts
                child=Path('/sys/fs/cgroup')/rows[0].lstrip('/')
                assert child.parent==base and re.fullmatch('op-[a-f0-9]{32}',child.name),'entry child escaped enclosing suite domain'
            started=[]
            reason,code,output,pid=m.run_command(action(1,False),3,lambda p,domain:started.append((p,domain)))
            assert reason=='EXITED' and code==0 and json.loads(output)=={'ok':True}
            assert_ready()
            assert len(started)==1 and re.fullmatch('op-[a-f0-9]{32}',started[0][1])
            time.sleep(1.2)
            assert not marker.exists(),'setsid descendant performed a late write'
            assert not any(p.is_dir() for p in base.iterdir()),'operation cgroup remains'
            ready.unlink()
            # Both the leader and test require proof of setsid before timeout.
            reason,code,output,pid=m.run_command(action(5,True),3,lambda p,domain:None)
            assert reason=='TIMEOUT'
            assert_ready()
            time.sleep(2.2)
            assert not marker.exists()
            assert not any(p.is_dir() for p in base.iterdir())
    except Exception:
        print('{"status":"FAILED_OR_CAPABILITY_UNAVAILABLE","verified":false,"cloudCalls":0}')
        return 1
    finally:
        if created:
            # Never enumerate or touch sibling cgroups. Reject unexpected names.
            assert base.parent==parent and re.fullmatch('workspacex-ci-entry-[a-f0-9]{32}',base.name)
            st=base.lstat()
            assert stat.S_ISDIR(st.st_mode) and (st.st_dev,st.st_ino)==identity,'test domain identity changed'
            if (base/'cgroup.kill').is_file():
                (base/'cgroup.kill').write_text('1')
            deadline=time.monotonic()+5
            while 'populated 0' not in (base/'cgroup.events').read_text().splitlines() and time.monotonic()<deadline:
                time.sleep(.02)
            assert 'populated 0' in (base/'cgroup.events').read_text().splitlines(),'test domain not empty'
            for child in base.iterdir():
                child_st=child.lstat()
                assert not stat.S_ISLNK(child_st.st_mode),'unexpected cgroup symlink'
                if stat.S_ISDIR(child_st.st_mode):
                    assert re.fullmatch('op-[a-f0-9]{32}',child.name)
                    assert 'populated 0' in (child/'cgroup.events').read_text().splitlines()
                    after=child.lstat()
                    assert (after.st_dev,after.st_ino)==(child_st.st_dev,child_st.st_ino)
                    child.rmdir()
            st=base.lstat();assert (st.st_dev,st.st_ino)==identity
            base.rmdir()
    print('{"status":"PASSED","verified":true,"tests":["setsid_descendant_killed_after_leader_exit","timeout_domain_empty"],"cloudCalls":0}')
    return 0


if __name__=='__main__':sys.exit(main())
