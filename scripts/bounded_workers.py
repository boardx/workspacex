"""Two disposable Linux processes; failed/unknown PUTs are never retried."""
import json
import multiprocessing as mp
import os
import signal
import sys
from pathlib import Path
import time


class TransferStopped(RuntimeError):
    def __init__(self, states):
        super().__init__('TRANSFER_FAILED_OR_UNKNOWN')
        self.states = states


def group_live(group):
    if sys.platform == 'linux':
        for path in Path('/proc').glob('[0-9]*/stat'):
            try:
                fields = path.read_text().rsplit(')', 1)[1].split()
                if int(fields[2]) == group and fields[0] not in ('Z', 'X'):
                    return True
            except FileNotFoundError:
                continue
        return False
    try:
        os.killpg(group, 0)
        return True
    except ProcessLookupError:
        return False


def kill_group(process, sig):
    # Leader may have exited, or may not yet have called setsid. Cover both.
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass
    if process.is_alive():
        try:
            os.kill(process.pid, sig)
        except ProcessLookupError:
            pass


def _child(send, function, item):
    try:
        os.setsid()
        signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGALRM, signal.SIGINT, signal.SIGTERM})
        result = function(item)
        raw = json.dumps({'ok': True, 'value': result}).encode()
        if len(raw) > 16384:
            raise ValueError('RESULT_BOUND')
        send.send_bytes(raw)
    except BaseException:
        send.send_bytes(b'{"ok":false}')
    finally:
        send.close()


def run(items, function, seconds, *, context=None):
    """Return only after every successful child exits; stop scheduling on failure.

    Context is injectable for offline POSIX fixtures. Production supplies spawn.
    Parent never infers remote rollback from child termination.
    """
    if not 0 < seconds <= 1500 or len(items) != len(set(items)):
        raise ValueError('BOUNDS')
    ctx = context or mp.get_context('spawn')
    pending = list(items)
    states = {name: 'not-started' for name in pending}
    active, results, messages = {}, {}, {}
    deadline = time.monotonic() + seconds
    failed = False
    try:
        while pending or active:
            if time.monotonic() >= deadline:
                raise TimeoutError('DEADLINE')
            while pending and len(active) < 2 and not failed:
                name = pending.pop(0)
                receive, send = ctx.Pipe(duplex=False)
                process = ctx.Process(target=_child, args=(send, function, name))
                active[name] = (process, receive)
                blocked = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM, signal.SIGINT, signal.SIGTERM})
                try:
                    process.start()
                finally:
                    send.close()
                    signal.pthread_sigmask(signal.SIG_SETMASK, blocked)
                states[name] = 'running'
            for name, (process, receive) in list(active.items()):
                if name not in messages and receive.poll():
                    try:
                        messages[name] = json.loads(receive.recv_bytes(16384))
                    except (EOFError, OSError, ValueError):
                        messages[name] = None
                # A pipe response alone is insufficient: child must have exited.
                if process.is_alive():
                    continue
                process.join()
                if name not in messages and receive.poll():
                    try:
                        messages[name] = json.loads(receive.recv_bytes(16384))
                    except (EOFError, OSError, ValueError):
                        messages[name] = None
                value = messages.get(name) if process.exitcode == 0 else None
                if group_live(process.pid):
                    states[name] = 'descendants-unknown'
                    raise TransferStopped(states)
                receive.close();del active[name]
                if not isinstance(value, dict) or value.get('ok') is not True:
                    states[name] = 'failed-or-unknown'
                    failed = True
                else:
                    results[name] = value['value']
                    states[name] = 'succeeded'
            if failed:
                raise TransferStopped(states)
            time.sleep(min(0.01, max(0, deadline-time.monotonic())))
        return results, states
    except BaseException:
        # Kill/join before reporting failure; no proof or successful receipt.
        for process, _ in active.values():
            if process.pid is not None:
                try:kill_group(process, signal.SIGTERM)
                except OSError:pass
        for name, (process, receive) in active.items():
            try:
                if process.pid is None:
                    states[name]='not-started';continue
                process.join(timeout=1)
                kill_group(process, signal.SIGKILL)
                process.join(timeout=2)
                until=time.monotonic()+2
                while group_live(process.pid) and time.monotonic()<until:
                    time.sleep(.01)
                states[name] = 'unknown-stopped' if not process.is_alive() and not group_live(process.pid) else 'local-group-unresolved'
            except (OSError,ValueError):
                states[name]='local-group-unresolved'
            finally:receive.close()
        raise TransferStopped(dict(states)) from None
