#!/usr/bin/env python3
"""Disposable Linux cgroup for simulation descendants, including new sessions.

Requires a root CI process and writable cgroup v2. This is cleanup containment
for trusted tests, not a security boundary against root code moving cgroups.
No production cgroup, sibling enumeration, provider API or process-name killing.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
import stat


def current_cgroup():
    rows = [line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines() if line.startswith('0::')]
    if len(rows) != 1 or not rows[0].startswith('/') or '..' in Path(rows[0]).parts:
        raise RuntimeError('SIMULATION_CURRENT_CGROUP_REQUIRED')
    path = Path('/sys/fs/cgroup') / rows[0].lstrip('/')
    if path.resolve(strict=True) != path or not (path / 'cgroup.procs').is_file():
        raise RuntimeError('SIMULATION_CURRENT_CGROUP_UNAVAILABLE')
    return path


def owned_name(name):
    suffix = name.removeprefix('wsx-simulation-')
    return name.startswith('wsx-simulation-') and len(suffix) == 32 and all(x in '0123456789abcdef' for x in suffix)


def named_uuid(name, prefix):
    suffix = name.removeprefix(prefix)
    return name.startswith(prefix) and len(suffix) == 32 and all(x in '0123456789abcdef' for x in suffix)


def owned_child(parent, child):
    # Only these known test-created hierarchies are allowed. In particular an
    # op-* domain is never accepted directly below an outer suite domain.
    if owned_name(parent):
        return owned_name(child) or named_uuid(child, 'workspacex-ci-entry-')
    if named_uuid(parent, 'workspacex-ci-entry-'):
        return named_uuid(child, 'op-')
    return False


def remove_empty_tree(path, identity):
    st = path.lstat()
    if not stat.S_ISDIR(st.st_mode) or (st.st_dev, st.st_ino) != identity:
        raise RuntimeError('SIMULATION_DOMAIN_CHANGED')
    if 'populated 0' not in (path / 'cgroup.events').read_text().splitlines():
        raise RuntimeError('SIMULATION_DOMAIN_NOT_EMPTY')
    for child in path.iterdir():
        child_stat = child.lstat()
        if stat.S_ISDIR(child_stat.st_mode):
            if not owned_child(path.name, child.name):
                raise RuntimeError('SIMULATION_UNEXPECTED_NESTED_DOMAIN')
            remove_empty_tree(child, (child_stat.st_dev, child_stat.st_ino))
        elif stat.S_ISLNK(child_stat.st_mode):
            raise RuntimeError('SIMULATION_DOMAIN_SYMLINK')
    st = path.lstat()
    if (st.st_dev, st.st_ino) != identity:
        raise RuntimeError('SIMULATION_DOMAIN_CHANGED')
    path.rmdir()


class Domain:
    def __init__(self):
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise RuntimeError('SIMULATION_LINUX_ROOT_REQUIRED')
        parent = current_cgroup()
        if not (parent / 'cgroup.controllers').is_file():
            raise RuntimeError('SIMULATION_CGROUP_V2_REQUIRED')
        self.path = parent / ('wsx-simulation-' + uuid.uuid4().hex)
        self.path.mkdir(mode=0o700)
        self.identity = (self.path.stat().st_dev, self.path.stat().st_ino)
        self.process = None
        self.closed = False
        if not (self.path / 'cgroup.kill').is_file():
            self.path.rmdir()
            raise RuntimeError('SIMULATION_CGROUP_KILL_REQUIRED')

    def spawn(self, command, **kwargs):
        if self.closed or self.process is not None:
            raise RuntimeError('SIMULATION_DOMAIN_ONE_PROCESS')
        if not command or not all(isinstance(x, str) for x in command):
            raise ValueError('SIMULATION_COMMAND_REQUIRED')
        # The wrapper performs no forks before joining. Unlike preexec_fn this
        # also works when the simulation submits suites from several threads.
        self.process = subprocess.Popen(
            [sys.executable, '-I', '-B', str(Path(__file__).resolve()),
             '--join', str(self.path), str(self.identity[0]), str(self.identity[1]),
             '--', *command], **kwargs)
        return self.process

    def close(self, process=None, seconds=5):
        if process is not None and process is not self.process:
            raise ValueError('SIMULATION_PROCESS_NOT_OWNED')
        if self.closed:
            raise RuntimeError('SIMULATION_DOMAIN_ALREADY_CLOSED')
        st = self.path.stat()
        if (st.st_dev, st.st_ino) != self.identity:
            raise RuntimeError('SIMULATION_DOMAIN_CHANGED')
        # First stop the just-created wrapper, including the brief pre-join
        # window. Popen owns/reaps this direct child: no recycled PID signaling.
        if self.process is not None:
            if self.process.poll() is None:
                self.process.kill()
            self.process.wait(timeout=seconds)
        (self.path / 'cgroup.kill').write_text('1')
        end = time.monotonic() + seconds
        while 'populated 0' not in (self.path / 'cgroup.events').read_text().splitlines():
            if time.monotonic() >= end:
                raise RuntimeError('SIMULATION_DOMAIN_NOT_EMPTY')
            time.sleep(.01)
        # Nested helpers inherit this domain and create children inside it.
        # Remove only the now-empty owned subtree, never parent/sibling groups.
        remove_empty_tree(self.path, self.identity)
        self.closed = True
        return {'kind': 'linux-cgroup-v2-owned-cleanup', 'domain': self.path.name,
                'populated': 0, 'removed': True, 'verified': True}


def join(argv):
    if len(argv) < 6 or argv[0] != '--join' or argv[4] != '--':
        raise ValueError('SIMULATION_JOIN_ARGUMENTS')
    path = Path(argv[1])
    if path.parent != current_cgroup() or not owned_name(path.name):
        raise ValueError('SIMULATION_JOIN_PATH')
    st = path.stat()
    if (st.st_dev, st.st_ino) != (int(argv[2]), int(argv[3])):
        raise RuntimeError('SIMULATION_JOIN_IDENTITY')
    (path / 'cgroup.procs').write_text(str(os.getpid()))
    if str(os.getpid()) not in (path / 'cgroup.procs').read_text().splitlines():
        raise RuntimeError('SIMULATION_JOIN_UNCONFIRMED')
    os.execvpe(argv[5], argv[5:], os.environ)


if __name__ == '__main__':
    try:
        join(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'simulationDomainFailure': type(error).__name__}), file=sys.stderr)
        sys.exit(125)
