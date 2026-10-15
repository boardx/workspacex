#!/usr/bin/env python3
"""Once-dispatch owner protocol. Local primitive; production installation disabled.

A fixture manager is not trusted production authority. The public entry refuses
execution until the installed launcher/unit/terminal observer closure is admitted.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat


class Rejected(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise Rejected(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def parse(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'DUPLICATE_KEY')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def spec(release_sha, plan_sha, launcher_sha, unit_sha):
    for value in (release_sha, plan_sha, launcher_sha, unit_sha):
        need(isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value), 'HASH_INVALID')
    return {'schemaVersion': 1, 'kind': 'migration-owner-start-v1',
            'releaseSha256': release_sha, 'planSha256': plan_sha,
            'launcherSha256': launcher_sha, 'unitSha256': unit_sha,
            'unit': 'workspacex-cn-migration@' + release_sha + '.service'}


class FixtureJournal:
    """FD-relative private storage for isolated tests, NEVER a live admission API."""
    def __init__(self, root):
        path = Path(root)
        need(path.name.startswith('wsx-owner-fixture-'), 'FIXTURE_ROOT_REQUIRED')
        self.path = path
        before = path.lstat()
        self.fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        after = os.fstat(self.fd)
        need(stat.S_ISDIR(after.st_mode) and stat.S_IMODE(after.st_mode) == 0o700
             and after.st_uid == os.geteuid() and (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino), 'ROOT_UNTRUSTED')
        self.identity = (after.st_dev, after.st_ino)
        self.lock = os.open('dispatch.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        self._file(self.lock)
        os.fsync(self.fd)

    def _file(self, fd):
        value = os.fstat(fd)
        need(stat.S_ISREG(value.st_mode) and value.st_uid == os.geteuid()
             and stat.S_IMODE(value.st_mode) == 0o600 and value.st_nlink == 1, 'FILE_UNTRUSTED')
        return value

    def _same(self):
        value = self.path.lstat()
        need((value.st_dev, value.st_ino) == self.identity and stat.S_IMODE(value.st_mode) == 0o700, 'ROOT_CHANGED')
        named = os.stat('dispatch.lock', dir_fd=self.fd, follow_symlinks=False)
        opened = self._file(self.lock)
        need((named.st_dev, named.st_ino) == (opened.st_dev, opened.st_ino), 'LOCK_CHANGED')

    def read(self, name):
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
        except FileNotFoundError:
            return None
        try:
            before = self._file(fd)
            raw = os.read(fd, 65537)
            after = self._file(fd)
            named = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            need(len(raw) <= 65536 and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                 == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                 and (named.st_dev, named.st_ino) == (after.st_dev, after.st_ino), 'FILE_CHANGED')
            return raw
        finally:
            os.close(fd)

    def write_once(self, name, raw):
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        try:
            with os.fdopen(os.dup(fd), 'wb') as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            os.close(fd)
        os.fsync(self.fd)

    def dispatch_once(self, expected, manager):
        """manager is a test port, not an arbitrary trusted production callback."""
        need(expected == spec(expected['releaseSha256'], expected['planSha256'],
                              expected['launcherSha256'], expected['unitSha256']), 'SPEC_INVALID')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Rejected('OWNER_DISPATCH_BUSY') from None
        try:
            self._same()
            raw = encode(expected)
            existing = self.read('claim.json')
            if existing is not None:
                need(existing == raw, 'CLAIM_CONFLICT')
                return self.reconcile(expected, manager)
            self.write_once('claim.json', raw)  # fsync BEFORE any manager call
            try:
                manager.start(expected['unit'])
            except BaseException:
                # Including timeout/lost ACK. Durable claim deliberately remains.
                return {'state': 'unknown', 'startMayHaveOccurred': True, 'retryAllowed': False}
            return self.reconcile(expected, manager)
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)

    def reconcile(self, expected, manager):
        self._same()
        need(self.read('claim.json') == encode(expected), 'CLAIM_MISMATCH')
        observation = manager.observe(expected['unit'])  # NEVER StartUnit here
        started_raw = self.read('started.json')
        if started_raw is None:
            return {'state': 'unknown', 'retryAllowed': False}
        started = parse(started_raw)
        need(set(started) == {'claimSha256', 'invocationId', 'pid', 'startTicks', 'bootId'}, 'STARTED_SCHEMA')
        need(started['claimSha256'] == digest(encode(expected)), 'STARTED_BINDING')
        need(re.fullmatch('[0-9a-f]{32}', started['invocationId']) is not None
             and type(started['pid']) is int and started['pid'] > 1
             and type(started['startTicks']) is int and started['startTicks'] > 0
             and re.fullmatch('[0-9a-f-]{36}', started['bootId']) is not None, 'OWNER_IDENTITY')
        need(observation == {'unit': expected['unit'], **started}, 'OWNER_CHANGED')
        # No success state from systemd active/exit=0. Original terminal receipt
        # observer remains required; this primitive proves owner binding only.
        return {'state': 'owner-observed', 'retryAllowed': False,
                'terminalVerified': False, 'claimSha256': digest(encode(expected))}

    def close(self):
        os.close(self.lock)
        os.close(self.fd)


def main():
    raise Rejected('MIGRATION_OWNER_NOT_INSTALLED')


if __name__ == '__main__':
    try:
        main()
    except Rejected as error:
        print(str(error))
        raise SystemExit(1)
