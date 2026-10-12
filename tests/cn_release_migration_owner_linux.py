#!/usr/bin/env python3
"""Isolated owner lifetime primitive, not systemd or production acceptance."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cgroup_fixture', ROOT / 'tests/cn_release_cgroup_linux.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def main():
    if sys.platform != 'linux' or os.geteuid() != 0:
        print('{"verified":false,"reason":"LINUX_ROOT_REQUIRED"}')
        return 2
    parent = fixture.current_parent()
    base = parent / ('workspacex-ci-entry-' + uuid.uuid4().hex)
    base.mkdir(mode=0o700)
    initial = base.stat()
    owner = None
    fd = None
    try:
        fixture.m.CGROUP_BASE = base
        fixture.m.KillDomain.preflight()
        owner_group = base / ('op-' + uuid.uuid4().hex)
        owner_group.mkdir(mode=0o700)
        with tempfile.TemporaryDirectory(prefix='wsx-owner-lifetime-') as td:
            lock = Path(td) / 'release.lock'
            # Owner moves itself before touching the lock or reporting readiness.
            code = ("import os,sys,fcntl,time,json;"
                    "open(sys.argv[1],'w').write(str(os.getpid()));"
                    "f=os.open(sys.argv[2],os.O_RDWR|os.O_CREAT,0o600);"
                    "fcntl.flock(f,fcntl.LOCK_EX);os.dup2(f,9);"
                    "print(json.dumps({'pid':os.getpid(),'cgroup':open('/proc/self/cgroup').read()}),flush=True);"
                    "time.sleep(30)")
            owner = subprocess.Popen([sys.executable, '-I', '-c', code, str(owner_group / 'cgroup.procs'), str(lock)], stdout=subprocess.PIPE)
            import select
            assert select.select([owner.stdout], [], [], 5)[0], 'OWNER_READY_TIMEOUT'
            fact = json.loads(owner.stdout.readline(4096))
            assert fact['pid'] == owner.pid
            assert fact['cgroup'].strip() == '0::/' + str(owner_group.relative_to('/sys/fs/cgroup'))
            fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
            reason, _, _, _ = fixture.m.run_command(b'sleep 30\n', 1, lambda pid, domain: None)
            assert reason == 'TIMEOUT'
            assert owner.poll() is None, 'FINITE_DISPATCH_KILLED_OWNER'
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise AssertionError('OWNER_LOCK_NOT_RETAINED')
            assert str(owner.pid) in (owner_group / 'cgroup.procs').read_text().splitlines()
    finally:
        current = base.lstat()
        assert (current.st_dev, current.st_ino) == (initial.st_dev, initial.st_ino)
        assert base.parent == parent and re.fullmatch('workspacex-ci-entry-[0-9a-f]{32}', base.name)
        kill = os.open(base / 'cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW)
        try:
            os.write(kill, b'1')
        finally:
            os.close(kill)
        if owner is not None:
            owner.wait(timeout=5)
            owner.stdout.close()
        deadline = time.monotonic() + 5
        while 'populated 0' not in (base / 'cgroup.events').read_text().splitlines() and time.monotonic() < deadline:
            time.sleep(.02)
        assert 'populated 0' in (base / 'cgroup.events').read_text().splitlines()
        for child in base.iterdir():
            st = child.lstat()
            assert not stat.S_ISLNK(st.st_mode)
            if stat.S_ISDIR(st.st_mode):
                assert re.fullmatch('op-[0-9a-f]{32}', child.name)
                assert 'populated 0' in (child / 'cgroup.events').read_text().splitlines()
                assert child.stat().st_ino == st.st_ino
                child.rmdir()
        assert base.stat().st_ino == initial.st_ino
        base.rmdir()
        if fd is not None:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(fd)
    print('{"verified":true,"scope":"isolated-owner-lifetime-primitive","retainedAfterDispatcherTimeout":true,"outerContainmentEmpty":true,"systemdValidated":false,"productionAccepted":false}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
