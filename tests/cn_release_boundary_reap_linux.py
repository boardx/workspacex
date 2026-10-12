#!/usr/bin/env python3
"""Linux counterexample for SIM12's offline CGROUP_BASE=None timeout fixture.

Runs real production run_command in a private subprocess made a subreaper.
The old bare sleep leaves a dead adopted child until reaped; explicit exec sleep
is the leader itself and is reaped by the unchanged entry. This diagnoses a
mechanism, not the historical CI process state (no /proc snapshot was retained).
Production cgroup and setsid-descendant tests are separate and unchanged.
"""
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def worker():
    libc = ctypes.CDLL(None, use_errno=True)
    need(libc.prctl(36, 1, 0, 0, 0) == 0, 'SUBREAPER_CAPABILITY_REQUIRED')
    observed = ctypes.c_int()
    need(libc.prctl(37, ctypes.byref(observed), 0, 0, 0) == 0 and observed.value == 1,
         'SUBREAPER_NOT_ENABLED')
    spec = importlib.util.spec_from_file_location('entry_reap_counterexample', ROOT / '.harness/scripts/vm/cn-release-advance.py')
    entry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(entry)
    entry.CGROUP_BASE = None  # Same explicit offline seam as FullChain, not production.
    adopted = []
    try:
        reason, status, output, group = entry.run_command(b'sleep 30\n', .3, lambda *_: None)
        need(reason == 'TIMEOUT' and status != 0, 'OLD_ACTION_DID_NOT_TIMEOUT')
        until = time.monotonic() + 2
        while True:
            children = Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split()
            adopted = []
            states = []
            for text in children:
                pid = int(text)
                stat = Path('/proc/' + text + '/stat').read_text().rsplit(')', 1)[1].split()
                if int(stat[2]) == group:
                    adopted.append(pid)
                    need(int(stat[1]) == os.getpid(), 'MEMBER_NOT_OWNED')
                    states.append(stat[0])
            if adopted and all(state == 'Z' for state in states):
                break
            need(time.monotonic() < until, 'ADOPTED_MEMBER_NOT_OWNED_ZOMBIE')
            time.sleep(.01)
        need(adopted and entry.alive(group), 'BARE_SLEEP_ZOMBIE_COUNTEREXAMPLE_NOT_OBSERVED')
        original_children = list(adopted)
        for pid in list(adopted):
            waited, value = os.waitpid(pid, os.WNOHANG)
            need(waited == pid and os.WIFSIGNALED(value) and os.WTERMSIG(value) == signal.SIGKILL,
                 'ADOPTED_CHILD_NOT_KILLED')
            adopted.remove(pid)
        need(not entry.alive(group), 'GROUP_STILL_PRESENT_AFTER_REAP')
        reason, status, output, new_group = entry.run_command(b'exec sleep 30\n', .3, lambda *_: None)
        need(reason == 'TIMEOUT' and status != 0 and not entry.alive(new_group), 'EXEC_LEADER_NOT_REAPED')
        need(Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().strip() == '',
             'CHILDREN_REMAIN_AFTER_EXEC_CASE')
        return {'verified': True, 'oldBareSleepAdoptedZombies': len(original_children),
                'oldGroupGoneAfterReap': True, 'execSleepGroupGoneOnReturn': True,
                'originalEntryUsed': True, 'offlineCgroupDisabled': True,
                'historicalCiCauseProven': False, 'productionCgroupTested': False}
    finally:
        # Only child PIDs listed as this fresh supervisor's own children; never
        # kill a potentially reused group after its leader has been reaped.
        own = Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split()
        for text in own:
            pid = int(text)
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            until = time.monotonic() + 2
            while True:
                waited, _ = os.waitpid(pid, os.WNOHANG)
                if waited == pid:
                    break
                need(time.monotonic() < until, 'OWN_CHILD_REAP_UNPROVEN')
                time.sleep(.01)


def main():
    if sys.platform != 'linux' or os.geteuid() != 0:
        print(json.dumps({'verified': False, 'reason': 'LINUX_ROOT_CGROUP_SUBREAPER_REQUIRED'}))
        return 2
    domain_spec = importlib.util.spec_from_file_location('reap_owned_domain', ROOT / 'scripts/cn_release_simulation_domain.py')
    domain_module = importlib.util.module_from_spec(domain_spec)
    domain_spec.loader.exec_module(domain_module)
    domain = domain_module.Domain()
    process = None
    cleanup = None
    try:
        process = domain.spawn([sys.executable, '-I', '-B', str(Path(__file__).resolve()), '--worker'],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        out, err = process.communicate(timeout=15)
        need(len(out) + len(err) <= 16384, 'COUNTEREXAMPLE_OUTPUT_LIMIT')
        need(process.returncode == 0, 'COUNTEREXAMPLE_FAILED')
        result = json.loads(out)
        need(result.get('verified') is True, 'COUNTEREXAMPLE_UNVERIFIED')
    finally:
        try:
            cleanup = domain.close(process)
        finally:
            if process is not None:
                process.stdout.close()
                process.stderr.close()
    need(cleanup.get('verified') is True, 'SUPERVISOR_DOMAIN_CLEANUP_UNPROVEN')
    result['supervisorCleanup'] = cleanup
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--worker':
        print(json.dumps(worker(), sort_keys=True))
    else:
        sys.exit(main())
