#!/usr/bin/env python3
"""Run AS THE API USER; validate private, durable usage metadata storage."""
import os
import pathlib
import stat
import tempfile


def ensure_storage(directory: str) -> None:
    path = pathlib.Path(directory)
    if not path.is_absolute():
        raise ValueError('credit receipt directory must be absolute')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    mode = path.lstat()
    if not stat.S_ISDIR(mode.st_mode) or mode.st_uid != os.getuid() or mode.st_mode & 0o077:
        raise ValueError('credit receipt directory must be private and API-user owned')
    fd, probe = tempfile.mkstemp(prefix='.storage-health-', dir=path)
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, b'credit-receipt-health\n')
        os.fsync(fd)
    finally:
        os.close(fd)
        os.unlink(probe)
    directory_fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


if __name__ == '__main__':
    ensure_storage(os.environ['WORKSPACEX_CREDIT_RECEIPT_DIR'])
    print('credit receipt storage: private, writable, fsync ready')
