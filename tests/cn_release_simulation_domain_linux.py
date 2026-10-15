#!/usr/bin/env python3
"""Real fork/setsid cleanup tests. Unsupported hosts fail, never skip/pass."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

spec = importlib.util.spec_from_file_location('domain', Path(__file__).resolve().parents[1] / 'scripts/cn_release_simulation_domain.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def case(leader_exits):
    with tempfile.TemporaryDirectory(prefix='wsx-simulation-domain-') as td:
        root = Path(td); ready = root / 'ready'; late = root / 'late'
        code = '''import os,time,signal,sys,json
child=os.fork()
if child==0:
 os.setsid();signal.signal(signal.SIGTERM,signal.SIG_IGN)
 with open(sys.argv[1]+'.tmp','w') as f:json.dump({'pid':os.getpid(),'pgid':os.getpgrp(),'cgroup':open('/proc/self/cgroup').read()},f)
 os.rename(sys.argv[1]+'.tmp',sys.argv[1])
 time.sleep(1.5)
 open(sys.argv[2],'w').write('escaped')
 while True:time.sleep(.1)
if sys.argv[3]=='exit':
 while not os.path.exists(sys.argv[1]):time.sleep(.01)
 os._exit(0)
while True:time.sleep(.1)
'''
        domain = module.Domain(); process = None; receipt = None
        try:
            process = domain.spawn([sys.executable, '-I', '-c', code, str(ready), str(late), 'exit' if leader_exits else 'hang'],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
            end = time.monotonic() + 3
            while not ready.exists() and time.monotonic() < end:
                if process.poll() is not None: break
                time.sleep(.01)
            assert ready.exists(), 'real child did not reach setsid'
            value = json.loads(ready.read_text())
            assert value['pid'] == value['pgid'], 'descendant not new session leader'
            assert domain.path.name in value['cgroup'], 'descendant outside owned domain'
            if leader_exits: assert process.wait(timeout=2) == 0
            else:
                try: process.wait(timeout=.1)
                except subprocess.TimeoutExpired: pass
                else: raise AssertionError('timeout fixture unexpectedly exited')
        finally:
            receipt = domain.close(process)
            if process is not None and process.stderr: process.stderr.close()
        assert receipt['verified'] and receipt['populated'] == 0 and not domain.path.exists()
        time.sleep(1.7)
        assert not late.exists(), 'escaped setsid descendant wrote after cleanup'
        return receipt


def nested_case(legacy_entry=False):
    with tempfile.TemporaryDirectory(prefix='wsx-simulation-nested-') as td:
        ready = Path(td) / 'ready'; late = Path(td) / 'late'
        child = '''import os,time,signal,json,sys
os.setsid();signal.signal(signal.SIGTERM,signal.SIG_IGN)
with open(sys.argv[1]+'.tmp','w') as f:json.dump({'pid':os.getpid(),'pgid':os.getpgrp(),'cgroup':open('/proc/self/cgroup').read()},f)
os.rename(sys.argv[1]+'.tmp',sys.argv[1]);time.sleep(1.5)
open(sys.argv[2],'w').write('escaped')
while True:time.sleep(.1)
'''
        if legacy_entry:
            parent = '''import importlib.util,sys,shlex,uuid
from pathlib import Path
s=importlib.util.spec_from_file_location('domain',sys.argv[1]);d=importlib.util.module_from_spec(s);s.loader.exec_module(d)
entry=Path(sys.argv[1]).parents[1]/'.harness/scripts/vm/cn-release-advance.py'
s=importlib.util.spec_from_file_location('entry',entry);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.CGROUP_BASE=d.current_cgroup()/('workspacex-ci-entry-'+uuid.uuid4().hex);m.CGROUP_BASE.mkdir(mode=0o700)
command=' '.join(shlex.quote(x) for x in [sys.executable,'-I','-B','-c',sys.argv[2],sys.argv[3],sys.argv[4]])+' &'+chr(10)+'wait'+chr(10)
m.run_command(command.encode(),30,lambda pid,domain:None)
'''
        else:
            parent = '''import importlib.util,sys,time
s=importlib.util.spec_from_file_location('nested',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
d=m.Domain();p=d.spawn([sys.executable,'-I','-c',sys.argv[2],sys.argv[3],sys.argv[4]])
while True:time.sleep(.1)
'''
        outer = module.Domain(); process = None
        try:
            process = outer.spawn([sys.executable, '-I', '-B', '-c', parent, str(Path(module.__file__).resolve()), child, str(ready), str(late)],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
            end = time.monotonic() + 3
            while not ready.exists() and time.monotonic() < end:
                if process.poll() is not None: break
                time.sleep(.01)
            assert ready.exists(), 'nested setsid child never became ready'
            value = json.loads(ready.read_text())
            assert value['pid'] == value['pgid']
            cgroup_path = value['cgroup'].strip().removeprefix('0::')
            expected = '/' + str(outer.path.relative_to('/sys/fs/cgroup')) + '/'
            assert cgroup_path.startswith(expected), 'nested domain escaped outer subtree'
            nested = Path('/sys/fs/cgroup') / cgroup_path.lstrip('/')
            if legacy_entry:
                assert nested.parent.parent == outer.path
                assert module.named_uuid(nested.parent.name, 'workspacex-ci-entry-')
                assert module.named_uuid(nested.name, 'op-')
            else:
                assert nested.parent == outer.path and module.owned_name(nested.name)
            try: process.wait(timeout=.1)
            except subprocess.TimeoutExpired: pass
            else: raise AssertionError('outer timeout fixture unexpectedly exited')
        finally:
            receipt = outer.close(process)
            if process is not None and process.stderr: process.stderr.close()
        assert receipt['verified'] and not outer.path.exists() and not nested.exists()
        time.sleep(1.7)
        assert not late.exists(), 'nested setsid descendant wrote after outer cleanup'
        return receipt


def main():
    if sys.platform != 'linux' or os.geteuid() != 0:
        print(json.dumps({'verified': False, 'status': 'CAPABILITY_UNAVAILABLE', 'reason': 'LINUX_ROOT_REQUIRED'}))
        return 2
    try:
        receipts = [case(True), case(False), nested_case(), nested_case(legacy_entry=True)]
        # Cancellation can happen before the join wrapper gets CPU time.
        domain = module.Domain()
        process = domain.spawn([sys.executable, '-I', '-c', 'import time;time.sleep(30)'])
        receipts.append(domain.close(process))
    except Exception as error:
        print(json.dumps({'verified': False, 'status': 'FAILED_OR_CAPABILITY_UNAVAILABLE', 'error': type(error).__name__}))
        return 1
    print(json.dumps({'verified': True, 'status': 'PASSED', 'cloudCalls': 0, 'tests': [
        'leader_exit_kills_setsid_descendant', 'timeout_kills_setsid_descendant',
        'outer_timeout_kills_nested_setsid_descendant',
        'outer_timeout_kills_actual_entry_op_setsid_descendant', 'immediate_cleanup_join_race'], 'cleanup': receipts}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
