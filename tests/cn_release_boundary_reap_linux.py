#!/usr/bin/env python3
"""Linux counterexample for SIM12's offline CGROUP_BASE=None timeout fixture.

Runs real production run_command in a private subprocess made a subreaper.
An explicitly retained shell leaves a dead adopted sleep child until reaped; exec sleep
is the leader itself and is reaped by the unchanged entry. This diagnoses a
mechanism, not the historical CI process state (no /proc snapshot was retained).
Production cgroup and setsid-descendant tests are separate and unchanged.
"""
import ctypes
import hashlib
import re
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



def child_diagnostic(stage, returncode, stdout=b'', stderr=b''):
    """Metadata and allowlisted fixture facts only; no raw text, argv or env."""
    allowed = ('child-exit', 'child-timeout', 'child-output', 'child-json')
    codes = {'SUBREAPER_CAPABILITY_REQUIRED', 'SUBREAPER_NOT_ENABLED',
             'SLEEP_CHILD_HANDSHAKE_REQUIRED', 'OLD_ACTION_DID_NOT_TIMEOUT',
             'MEMBER_NOT_OWNED', 'ADOPTED_MEMBER_NOT_OWNED_ZOMBIE',
             'RETAINED_SHELL_ZOMBIE_COUNTEREXAMPLE_NOT_OBSERVED', 'ADOPTED_CHILD_NOT_KILLED',
             'GROUP_STILL_PRESENT_AFTER_REAP', 'EXEC_LEADER_NOT_REAPED',
             'CHILDREN_REMAIN_AFTER_EXEC_CASE', 'OWN_CHILD_REAP_UNPROVEN'}
    result = {'kind': 'boundary-reap-child-diagnostic',
              'stage': stage if stage in allowed else 'unknown', 'returncode': returncode}
    for name, raw in (('stdout', stdout or b''), ('stderr', stderr or b'')):
        if isinstance(raw, str):
            raw = raw.encode()
        result[name] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        if name == 'stderr':
            found = re.findall(rb'RuntimeError: ([A-Z_]{1,128})(?:\n|$)', raw[:16384])
            result['reasonCodes'] = sorted({x.decode() for x in found if x.decode() in codes})
            fixed = raw[:16384]
            types = re.findall(rb'(?:^|\n)(RuntimeError|OSError|PermissionError|FileNotFoundError|ImportError|ModuleNotFoundError|SyntaxError|TypeError|ValueError|ChildProcessError):', fixed)
            result['errorTypes'] = sorted({x.decode() for x in types})
            frames = re.findall(rb'File "[^"\n]*(cn_release_boundary_reap_linux\.py|cn-release-advance\.py)", line ([0-9]{1,6})', fixed)
            result['sourceFrames'] = [{'file': name.decode(), 'line': int(line)} for name, line in frames[-8:]]
            result['errno'] = sorted({int(x) for x in re.findall(rb'\[Errno ([0-9]{1,3})\]', fixed)})[:8]
        else:
            try:
                value = json.loads(raw[:4096]).get('workerFailure', {})
                if not isinstance(value, dict):
                    value = {}
            except (ValueError, AttributeError, UnicodeError):
                value = {}
            facts = {}
            for key in ('group', 'expectedChild'):
                if type(value.get(key)) is int and 1 < value[key] < 2**31:
                    facts[key] = value[key]
            if type(value.get('exitCode')) is int and -255 <= value['exitCode'] <= 255:
                facts['exitCode'] = value['exitCode']
            if value.get('reason') in ('TIMEOUT', 'EXITED', 'OUTPUT_LIMIT', 'ISOLATION_UNPROVEN'):
                facts['reason'] = value['reason']
            children, states = value.get('adoptedChildren'), value.get('states')
            if isinstance(children, list) and len(children) <= 8 and all(type(x) is int and 1 < x < 2**31 for x in children):
                facts['adoptedChildren'] = children
            if isinstance(states, list) and len(states) <= 8 and all(x in ('Z','R','S','D','T','t','X','I') for x in states):
                facts['states'] = states
            result['workerFacts'] = facts
    need(len(json.dumps(result).encode()) <= 8192, 'DIAGNOSTIC_LIMIT')
    return result


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
    evidence = {'historicalCiCauseProven': False}
    try:
        # Do not depend on Bash's optional last-command exec optimization.
        # $! proves the sleep child exists while builtin wait retains its parent.
        raw = b'sleep 30 &\nchild=$!\nprintf "%s\\n" "$child"\nwait "$child"\n'
        reason, status, output, group = entry.run_command(raw, .3, lambda *_: None)
        evidence.update(reason=reason, exitCode=status, group=group)
        need(re.fullmatch(rb'[1-9][0-9]*\n', output) is not None, 'SLEEP_CHILD_HANDSHAKE_REQUIRED')
        expected_child = int(output)
        evidence['expectedChild'] = expected_child
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
            evidence.update(adoptedChildren=list(adopted), states=list(states))
            if adopted == [expected_child] and all(state == 'Z' for state in states):
                break
            need(time.monotonic() < until, 'ADOPTED_MEMBER_NOT_OWNED_ZOMBIE')
            time.sleep(.01)
        need(adopted == [expected_child] and entry.alive(group), 'RETAINED_SHELL_ZOMBIE_COUNTEREXAMPLE_NOT_OBSERVED')
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
        return {'verified': True, 'retainedShellSleepAdoptedZombies': len(original_children),
                'oldGroupGoneAfterReap': True, 'execSleepGroupGoneOnReturn': True,
                'originalEntryUsed': True, 'offlineCgroupDisabled': True,
                'historicalCiCauseProven': False, 'productionCgroupTested': False}
    except Exception as exc:
        evidence['error'] = str(exc) if re.fullmatch(r'[A-Z_]{1,128}', str(exc)) else type(exc).__name__
        print(json.dumps({'workerFailure': evidence}, sort_keys=True), flush=True)
        raise
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
        try:
            out, err = process.communicate(timeout=15)
        except subprocess.TimeoutExpired as exc:
            print(json.dumps(child_diagnostic('child-timeout', process.returncode, exc.stdout, exc.stderr)), flush=True)
            raise
        if len(out) + len(err) > 16384:
            print(json.dumps(child_diagnostic('child-output', process.returncode, out, err)), flush=True)
            raise RuntimeError('COUNTEREXAMPLE_OUTPUT_LIMIT')
        if process.returncode != 0:
            print(json.dumps(child_diagnostic('child-exit', process.returncode, out, err)), flush=True)
            raise RuntimeError('COUNTEREXAMPLE_FAILED')
        try:
            result = json.loads(out)
        except (ValueError, UnicodeError):
            print(json.dumps(child_diagnostic('child-json', process.returncode, out, err)), flush=True)
            raise
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
