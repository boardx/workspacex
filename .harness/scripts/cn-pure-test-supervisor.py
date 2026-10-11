#!/usr/bin/env python3
"""Bounded unittest discovery with failure evidence and owned-process cleanup."""
import argparse
import ctypes
import errno
import faulthandler
import os
import pathlib
import signal
import subprocess
import sys
import time
import unittest


class TimedResult(unittest.TextTestResult):
    def startTest(self, test):
        self.started = time.monotonic()
        print('[cn-pure] START ' + test.id(), file=self.stream, flush=True)
        super().startTest(test)

    def stopTest(self, test):
        print('[cn-pure] END %s elapsed=%.6f' % (test.id(), time.monotonic() - self.started),
              file=self.stream, flush=True)
        super().stopTest(test)


def descendants():
    """Only this supervisor's live /proc lineage, including adopted grandchildren."""
    table = {}
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            table[int(entry.name)] = (int(fields[1]), fields[19])
        except (OSError, ValueError, IndexError):
            continue
    owned = {os.getpid()}
    while True:
        found = {pid for pid, (parent, _) in table.items() if parent in owned}
        if found <= owned:
            break
        owned.update(found)
    return {pid: table[pid][1] for pid in owned if pid != os.getpid()}


def kill_owned(pid, started):
    # Bind identity first. A numeric PID may be reassigned after /proc validation;
    # the pidfd cannot be reassigned to the replacement process.
    fd = os.pidfd_open(pid)
    try:
        if descendants().get(pid) != started:
            return False
        signal.pidfd_send_signal(fd, signal.SIGKILL)
        return True
    finally:
        os.close(fd)


def cleanup(child):
    seen = set()
    deadline = time.monotonic() + 2
    while True:
        owned = descendants()
        seen.update(owned)
        for pid, started in owned.items():
            try:
                kill_owned(pid, started)
            except OSError as error:
                if error.errno != errno.ESRCH:
                    raise
        child.poll()
        while True:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    break
            except ChildProcessError:
                break
        remaining = descendants()
        if not remaining or time.monotonic() >= deadline:
            print('[cn-pure] cleanup owned=%d remaining=%d' % (len(seen), len(remaining)),
                  file=sys.stderr, flush=True)
            return bool(remaining)
        time.sleep(.01)


def resources(label):
    # Fixed scheduler counters only; never dump environment variables or credentials.
    print('[cn-pure] %s python=%s machine=%s affinity=%d' %
          (label, sys.version.split()[0], os.uname().machine, len(os.sched_getaffinity(0))),
          file=sys.stderr, flush=True)
    for name in ['/proc/loadavg', '/sys/fs/cgroup/cpu.max', '/sys/fs/cgroup/cpu.stat']:
        try:
            print('[cn-pure] %s %s %s' % (label, name, pathlib.Path(name).read_text().strip().replace('\n', ';')),
                  file=sys.stderr, flush=True)
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    parser.add_argument('--timeout', type=float, default=40)
    parser.add_argument('--worker', action='store_true')
    args = parser.parse_args()
    if args.worker:
        faulthandler.enable()
        faulthandler.register(signal.SIGUSR1, all_threads=True)
        suite = unittest.defaultTestLoader.discover(args.directory, pattern='test_*.py')
        result = unittest.TextTestRunner(verbosity=2, resultclass=TimedResult).run(suite)
        print('[cn-pure] discover testsRun=%d failures=%d errors=%d skipped=%d' %
              (result.testsRun, len(result.failures), len(result.errors), len(result.skipped)),
              file=sys.stderr, flush=True)
        return 0 if result.wasSuccessful() else 1
    if sys.platform != 'linux':
        raise RuntimeError('CN pure-test supervisor requires Linux process ownership evidence')
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('CN pure-test cleanup requires pidfd support; no bare PID fallback')
    # Kernel support must be known before creating anything that needs cleanup.
    probe_fd = os.pidfd_open(os.getpid())
    os.close(probe_fd)
    # Adopt setsid grandchildren when the worker exits; no shared process namespace.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'subreaper unavailable')
    resources('before')
    started = time.monotonic()
    child = subprocess.Popen([sys.executable, '-B', str(pathlib.Path(__file__).resolve()),
                              '--worker', '--directory', args.directory], start_new_session=True)
    code = 1
    try:
        code = child.wait(timeout=args.timeout)
    except subprocess.TimeoutExpired:
        print('[cn-pure] deadline exceeded %.3fs; requesting last-test thread stack' % args.timeout,
              file=sys.stderr, flush=True)
        try:
            os.kill(child.pid, signal.SIGUSR1)
            time.sleep(.1)
        except ProcessLookupError:
            pass
    finally:
        leaked = cleanup(child)
        resources('after')
        print('[cn-pure] supervisor elapsed=%.6f exit=%s' % (time.monotonic() - started, code),
              file=sys.stderr, flush=True)
    return 1 if leaked else code


if __name__ == '__main__':
    sys.exit(main())
