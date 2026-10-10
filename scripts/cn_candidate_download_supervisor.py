"""Bound a credential-bearing child without interfering with library SIGALRM.

This module does not authenticate, download, install, or load any SDK. Admission
must be complete before passing a callback. Only a bounded JSON result crosses
the pipe; exceptions and stdout/stderr from the child are suppressed.
"""
import json
import os
import selectors
import signal
import time


class SupervisionError(RuntimeError):
    pass


def supervise(callback, max_seconds, *, output_limit=65536):
    if type(max_seconds) is not int or not 1 <= max_seconds <= 1200:
        raise SupervisionError('AUTH_CHILD_DEADLINE')
    if type(output_limit) is not int or not 1 <= output_limit <= 65536:
        raise SupervisionError('AUTH_CHILD_OUTPUT_LIMIT')
    read_fd, write_fd = os.pipe()
    deadline = time.monotonic() + max_seconds
    pid = os.fork()
    if pid == 0:
        try:
            os.close(read_fd)
            os.setsid()
            with open('/dev/null', 'rb+', buffering=0) as null:
                for fd in (0, 1, 2):
                    os.dup2(null.fileno(), fd)
            os.environ.clear()
            os.environ.update(PATH='/usr/bin:/bin', HOME='/nonexistent', LANG='C.UTF-8')
            value = callback()
            if type(value) is not dict:
                raise ValueError('result')
            raw = json.dumps(value, sort_keys=True, separators=(',', ':'),
                             allow_nan=False).encode('utf-8')
            if len(raw) > output_limit:
                raise ValueError('result size')
            offset = 0
            while offset < len(raw):
                offset += os.write(write_fd, raw[offset:])
            os.close(write_fd)
            os._exit(0)
        except BaseException:
            os._exit(1)
    os.close(write_fd)
    selector = selectors.DefaultSelector()
    selector.register(read_fd, selectors.EVENT_READ)
    raw = bytearray()
    reaped = False
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise SupervisionError('AUTH_CHILD_TIMEOUT')
            events = selector.select(min(remaining, 0.1))
            if events:
                chunk = os.read(read_fd, output_limit + 1 - len(raw))
                if chunk:
                    raw.extend(chunk)
                    if len(raw) > output_limit:
                        raise SupervisionError('AUTH_CHILD_OUTPUT_LIMIT')
                else:
                    break
        while True:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                reaped = True
                if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
                    raise SupervisionError('AUTHENTICATED_TRANSFER_REJECTED')
                break
            if time.monotonic() >= deadline:
                raise SupervisionError('AUTH_CHILD_TIMEOUT')
            time.sleep(0.01)
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError):
            raise SupervisionError('AUTH_CHILD_RESULT') from None
        if type(result) is not dict:
            raise SupervisionError('AUTH_CHILD_RESULT')
        return result
    finally:
        selector.close()
        os.close(read_fd)
        if not reaped:
            # The child creates its own session before invoking any callback.
            # If it has not yet done so, kill only this known child PID.
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            os.waitpid(pid, 0)
