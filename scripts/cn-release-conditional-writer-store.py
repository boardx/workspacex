#!/usr/bin/env python3
"""Disabled library for root-owned A5 policy consumption; no command-line entry.

Deployment must install explicitly approved policy bytes + independent by-release
pointer, this code, and a pinned trusted observer/terminal adapter. This module
never issues policies. Python callers are trusted root control code, not JSON
RPC clients: observer() must verify the actual entry chain under its original
lock, returning (observation_raw, inputs, observed_code_hashes). terminal() must
call the existing derive_writer_resume with the same raw inputs; it must NOT
resume writers. No live adapter is installed by this change.

The offline release lock remains held through terminal revalidation.
This primitive does NOT hold the live entry lock; production is disabled. Existing claims,
including interrupted/unknown claims, are never redispatched. An interrupted
publication may leave an exact approval/pointer, but no writer execution is
performed here; the unchanged terminal path still validates live evidence.
"""
import contextlib
import datetime as dt
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import uuid

BASE = Path(__file__).resolve().parents[1]
SELF = 'scripts/cn-release-conditional-writer-store.py'
POLICY = 'scripts/cn-release-conditional-writer-policy.py'
POLICIES = Path('/etc/workspacex-cn/conditional-writer-policies')
STATE = Path('/var/lib/workspacex-cn/conditional-writer-policy-state')
WRITERS = Path('/etc/workspacex-cn/writer-resume-approvals')
_spec = importlib.util.spec_from_file_location('conditional_policy', BASE / POLICY)
evaluator = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(evaluator)


def need(v, code):
    if not v:
        raise ValueError(code)


class _Directory:
    """FD-relative private directory. Never follows a symlink in its ancestry."""
    def __init__(self, path, uid):
        path = Path(path)
        need(path.is_absolute(), 'ABSOLUTE_PATH')
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
        try:
            for name in path.parts[1:]:
                other = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = other
                s = os.fstat(fd)
                # /tmp may be sticky; the final directory is always private.
                need(s.st_uid in (0, uid) and (not s.st_mode & 0o022 or uid != 0 and s.st_mode & stat.S_ISVTX), 'UNSAFE_PARENT')
            s = os.fstat(fd)
            need(s.st_uid == uid and stat.S_IMODE(s.st_mode) == 0o700, 'PRIVATE_DIRECTORY')
            self.fd = fd
        except BaseException:
            os.close(fd)
            raise

    def close(self):
        os.close(self.fd)

    def read(self, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
        with os.fdopen(fd, 'rb') as f:
            before = os.fstat(f.fileno())
            need(stat.S_ISREG(before.st_mode) and before.st_uid == os.fstat(self.fd).st_uid and
                 stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1 and before.st_size <= 1048576, 'PRIVATE_FILE')
            raw = f.read(1048577)
            after = os.fstat(f.fileno())
            named = os.stat(name, dir_fd=self.fd, follow_symlinks=False)
            need(tuple(getattr(before,k) for k in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns','st_nlink')) ==
                 tuple(getattr(after,k) for k in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns','st_nlink')) and (named.st_dev, named.st_ino, named.st_mtime_ns, named.st_ctime_ns) ==
                 (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns) and
                 len(raw) == before.st_size, 'FILE_CHANGED')
            return raw

    def exclusive(self, name, raw):
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        with os.fdopen(fd, 'wb') as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.fsync(self.fd)

    def publish(self, name, raw):
        temporary = '.pending-' + uuid.uuid4().hex
        self.exclusive(temporary, raw)
        try:
            # link is atomic NOREPLACE. Partial files are never exposed as JSON.
            os.link(temporary, name, src_dir_fd=self.fd, dst_dir_fd=self.fd, follow_symlinks=False)
            os.fsync(self.fd)
        finally:
            os.unlink(temporary, dir_fd=self.fd)
            os.fsync(self.fd)


class _Store:
    """Testable storage implementation; production wrapper fixes paths and uid."""
    def __init__(self, policies, state, writers, uid):
        self.policies, self.state, self.writers, self.uid = Path(policies), Path(state), Path(writers), uid

    @contextlib.contextmanager
    def directory(self, path):
        d = _Directory(path, self.uid)
        try:
            yield d
        finally:
            d.close()

    @contextlib.contextmanager
    def lock(self, release):
        with self.directory(self.state / 'locks') as d:
            fd = os.open(release, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=d.fd)
            try:
                s = os.fstat(fd)
                need(stat.S_ISREG(s.st_mode) and s.st_uid == self.uid and
                     stat.S_IMODE(s.st_mode) == 0o600 and s.st_nlink == 1, 'PRIVATE_LOCK')
                os.fsync(d.fd)
                try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: raise ValueError('POLICY_STORE_ACTIVE') from None
                named = os.stat(release, dir_fd=d.fd, follow_symlinks=False)
                need((named.st_dev, named.st_ino) == (s.st_dev, s.st_ino), 'LOCK_REPLACED')
                yield
            finally:
                os.close(fd)

    def consume(self, release_raw, observer, terminal, *, enabled=False, clock=None, checkpoint=None):
        need(enabled is True, 'POLICY_DISABLED')
        clock = clock or (lambda: dt.datetime.now(dt.timezone.utc))
        checkpoint = checkpoint or (lambda _: None)  # test-only crash injection, never a JSON option
        release = evaluator.sha(release_raw)
        with self.lock(release):
            with self.directory(self.policies / 'by-release') as pointers:
                pointer_raw = pointers.read(release + '.json')
            pointer = evaluator.parse(pointer_raw)
            need(set(pointer) == {'policySha256'} and evaluator.digest(pointer['policySha256']), 'APPROVAL_POINTER')
            with self.directory(self.policies) as policies:
                policy_raw = policies.read(pointer['policySha256'] + '.json')
            need(evaluator.sha(policy_raw) == pointer['policySha256'], 'APPROVAL_RAW_HASH')
            p = evaluator.parse(policy_raw)
            # Mandatory transitive code pins, in addition to evaluator's closure.
            for name in (SELF, POLICY):
                need(p['codeFiles'].get(name) == hashlib.sha256((BASE / name).read_bytes()).hexdigest(), 'STORE_CODE_PIN')
            def snapshot():
                observed, values, hashes = observer()
                need(type(observed) is bytes and type(values) is dict and type(hashes) is dict, 'OBSERVER_SHAPE')
                need(all(type(k) is str and type(v) is bytes for k, v in values.items()), 'OBSERVER_INPUTS')
                need(all(type(k) is str and type(v) is str for k, v in hashes.items()), 'OBSERVER_CODES')
                return observed, dict(values), dict(hashes)
            observation, inputs, codes = snapshot()
            proposal = evaluator.derive_proposal(policy_raw, release_raw, observation, inputs,
                approved_policy_sha256=pointer['policySha256'], verified_observation_sha256=evaluator.sha(observation),
                observed_code_hashes=codes, consumed_policy_ids=(), now=clock(), enabled=True)
            identity = proposal['policyId']
            claim = dict(kind='cn-writer-policy-claim-v1', policyId=identity,
                         policySha256=pointer['policySha256'], releaseSha256=release,
                         observationSha256=proposal['observationSha256'], inputHashes=proposal['inputHashes'],
                         writerApprovalSha256=proposal['writerApprovalSha256'], state='claimed-no-redispatch')
            with self.directory(self.state / 'claims') as claims:
                claims.exclusive(identity + '.json', evaluator.enc(claim))
            checkpoint('claimed')
            # Fresh read must prove the SAME generation, exact bytes and code.
            second = snapshot()
            need(second == (observation, inputs, codes), 'FRESH_FACTS_CHANGED')
            evaluator.derive_proposal(policy_raw, release_raw, observation, inputs,
                approved_policy_sha256=pointer['policySha256'], verified_observation_sha256=evaluator.sha(observation),
                observed_code_hashes=codes, consumed_policy_ids=(), now=clock(), enabled=True)
            with self.directory(self.policies / 'by-release') as pointers:
                need(pointers.read(release + '.json') == pointer_raw, 'APPROVAL_REVOKED')
            with self.directory(self.policies) as policies:
                need(policies.read(pointer['policySha256'] + '.json') == policy_raw, 'APPROVAL_CHANGED')
            raw, approval_sha = proposal['writerApprovalRaw'], proposal['writerApprovalSha256']
            result = terminal(release_raw, raw, inputs)
            need(type(result) is dict and result.get('status') == 'MATERIALIZED_A5' and
                 result.get('intentCreated') is False, 'TERMINAL_RECHECK_FAILED')
            need(snapshot() == (observation, inputs, codes), 'POST_TERMINAL_FACTS_CHANGED')
            evaluator.derive_proposal(policy_raw, release_raw, observation, inputs,
                approved_policy_sha256=pointer['policySha256'], verified_observation_sha256=evaluator.sha(observation),
                observed_code_hashes=codes, consumed_policy_ids=(), now=clock(), enabled=True)
            with self.directory(self.policies / 'by-release') as pointers:
                need(pointers.read(release + '.json') == pointer_raw, 'APPROVAL_REVOKED')
            with self.directory(self.policies) as policies:
                need(policies.read(pointer['policySha256'] + '.json') == policy_raw, 'APPROVAL_CHANGED')
            with self.directory(self.writers) as writers:
                writers.publish(approval_sha + '.json', raw)
            checkpoint('approval-published')
            with self.directory(self.writers / 'by-release') as pointers:
                pointers.publish(release + '.json', evaluator.enc({'approvalSha256': approval_sha}))
            checkpoint('pointer-published')
            decision = dict(kind='cn-writer-policy-decision-v1', claimSha256=evaluator.sha(evaluator.enc(claim)),
                            policyId=identity, releaseSha256=release, writerApprovalSha256=approval_sha,
                            state='published-terminal-reverified', writerResumed=False)
            with self.directory(self.state / 'decisions') as decisions:
                decisions.publish(identity + '.json', evaluator.enc(decision))
            return decision


def consume(release_raw, *, enabled=False):
    """Reserved fixed-path production API; no caller-supplied callback authority.

    Offline _Store tests are not an installed integration. The future adapter
    must be read from fixed root-private path, verified against approved closure,
    and hold original entry lock through validation/CAS/publication in a fixed
    lock order. Until that adapter is independently reviewed this API always
    fails closed, including when enabled=True. No policy is issued or installed.
    """
    need(enabled is True, 'POLICY_DISABLED')
    need(os.geteuid() == 0, 'ROOT_REQUIRED')
    raise ValueError('ADAPTER_NOT_INSTALLED')
