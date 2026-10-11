#!/usr/bin/python3 -I
"""Durable single-writer executor for explicitly installed CN continuation packages.

This is a transport, not a replacement for canonical admission. Commands and
verifiers are installed together by a separately approved root transaction.
No caller-controlled command, path, environment or stage is accepted by the CLI.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import sys
import time

REQUESTS = Path('/etc/workspacex-cn/continuation-requests')
STATE = Path('/var/lib/workspacex-cn/continuation')
OWNER = 0
SHELL = '/bin/bash'
CGROUP_BASE = Path('/sys/fs/cgroup/workspacex-cn-continuation')
STAGES = ('consume', 'publication-stage', 'check-plan', 'publish', 'hold-stage', 'hold',
          'stop-stage', 'stop', 'sessions', 'backup-stage', 'backup', 'rds-backup',
          'switch-stage', 'switch', 'acceptance', 'clear-hold', 'observe')
ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
       'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/root'}
HEX = re.compile(r'[a-f0-9]{64}\Z')
SHA = re.compile(r'[a-f0-9]{40}\Z')
ATTEMPT = re.compile(r'[a-z0-9][a-z0-9-]{0,63}\Z')
MAX = 65536


class Rejected(Exception):
    pass


def need(condition, code):
    if not condition:
        raise Rejected(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def pairs(items):
    value = {}
    for k, v in items:
        need(k not in value, 'DUPLICATE_KEY')
        value[k] = v
    return value


def decode(raw):
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        raise Rejected('JSON_INVALID') from None


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def now():
    return dt.datetime.now(dt.timezone.utc)


def stamp():
    return now().isoformat()


def instant(value):
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        need(parsed.tzinfo is not None, 'TIMEZONE_REQUIRED')
        return parsed
    except (TypeError, AttributeError, ValueError):
        raise Rejected('TIME_INVALID') from None


def directory(path):
    """Check every path component; no symlink or runner-writable parent."""
    for current in reversed((path, *path.parents)):
        s = current.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid in (0, OWNER) and not s.st_mode & 0o022, 'DIRECTORY_UNTRUSTED')


def read(path, limit=MAX):
    directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_uid == OWNER and not before.st_mode & 0o077 and before.st_nlink == 1 and before.st_size <= limit, 'FILE_UNTRUSTED')
        raw = b''
        while len(raw) <= limit:
            part = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not part:
                break
            raw += part
        after = os.fstat(fd)
        need(len(raw) <= limit and (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'FILE_CHANGED')
        return raw
    finally:
        os.close(fd)


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def create(path, raw):
    directory(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as f:
            f.write(raw)
            f.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    fsync_dir(path.parent)


def load_package(request_hash, attempt):
    need(HEX.fullmatch(request_hash) and ATTEMPT.fullmatch(attempt), 'ARGUMENT_INVALID')
    package = REQUESTS / request_hash
    raw = read(package / 'manifest.json')
    need(digest(raw) == request_hash, 'REQUEST_HASH_CHANGED')
    m = decode(raw)
    keys = {'schemaVersion', 'sourceRevision', 'baselineRevision', 'controlRevision', 'attemptId',
            'scope', 'stage', 'previousReceiptSha256', 'issuedAt', 'expiresAt', 'requestedAt', 'deadlineAt', 'timeoutSeconds',
            'actionSha256', 'observerSha256', 'verifierSha256', 'authorizationEvidenceSha256'}
    recovery = isinstance(m, dict) and m.get('scope') == 'runtime-only-reviewed-recovery'
    if recovery:
        keys.add('recoveryOf')
    need(isinstance(m, dict) and set(m) == keys and type(m['schemaVersion']) is int and m['schemaVersion'] == 1, 'MANIFEST_SHAPE')
    need(m['scope'] in ('runtime-only-reviewed-continuation', 'runtime-only-reviewed-recovery') and m['attemptId'] == attempt and m['stage'] in STAGES, 'SCOPE_INVALID')
    for name in ('sourceRevision', 'baselineRevision', 'controlRevision'):
        need(isinstance(m[name], str) and SHA.fullmatch(m[name]), 'REVISION_INVALID')
    for name in ('actionSha256', 'observerSha256', 'verifierSha256', 'authorizationEvidenceSha256'):
        need(isinstance(m[name], str) and HEX.fullmatch(m[name]), 'PIN_INVALID')
    need(m['previousReceiptSha256'] is None or isinstance(m['previousReceiptSha256'], str) and HEX.fullmatch(m['previousReceiptSha256']), 'PREVIOUS_INVALID')
    need(type(m['timeoutSeconds']) is int and 1 <= m['timeoutSeconds'] <= 1200, 'TIMEOUT_INVALID')
    start, end = instant(m['issuedAt']), instant(m['expiresAt'])
    need(start < end and end - start <= dt.timedelta(hours=1), 'WINDOW_INVALID')
    requested, deadline = instant(m['requestedAt']), instant(m['deadlineAt'])
    need(requested < deadline and deadline-requested <= dt.timedelta(minutes=30), 'TOTAL_BUDGET_INVALID')
    if recovery:
        need(isinstance(m['recoveryOf'], str) and HEX.fullmatch(m['recoveryOf']) and requested <= start < end and end-start <= dt.timedelta(minutes=30), 'RECOVERY_WINDOW_INVALID')
    else:
        need(requested <= start < end <= deadline, 'TOTAL_BUDGET_INVALID')
    # Reconciliation may inspect an expired package; advance checks live TTL.
    files = {}
    for name, key in (('action.sh', 'actionSha256'), ('observe.sh', 'observerSha256'), ('verify.py', 'verifierSha256'), ('authorization.json', 'authorizationEvidenceSha256')):
        files[name] = read(package / name)
        need(digest(files[name]) == m[key], 'PACKAGE_FILE_CHANGED')
    return m, files


def alive(pid):
    try:
        os.killpg(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


class KillDomain:
    """Linux cgroup v2 prevents ordinary setsid/daemonize escaping supervision.

    The preinstalled root-only subtree is an explicit installation capability.
    Trusted actions must not manipulate cgroups. This never proves external
    Docker/provider jobs terminal: an independent observer remains mandatory.
    """
    @staticmethod
    def preflight():
        if CGROUP_BASE is not None:
            directory(CGROUP_BASE)
            need((CGROUP_BASE / 'cgroup.controllers').is_file() and (CGROUP_BASE / 'cgroup.kill').is_file() and os.access(CGROUP_BASE, os.W_OK), 'CGROUP_CAPABILITY_REQUIRED')

    def __init__(self):
        self.path = None
        if CGROUP_BASE is None:  # Library-only disposable tests; no CLI switch.
            return
        directory(CGROUP_BASE)
        need((CGROUP_BASE / 'cgroup.controllers').is_file(), 'CGROUP_V2_REQUIRED')
        import secrets
        self.path = CGROUP_BASE / ('op-' + secrets.token_hex(16))
        self.path.mkdir(mode=0o700)
        need((self.path / 'cgroup.kill').is_file(), 'CGROUP_KILL_REQUIRED')

    def attach(self, pid):
        if self.path is not None:
            self.write('cgroup.procs', str(pid))

    def write(self, name, value):
        fd = os.open(self.path / name, os.O_WRONLY | os.O_NOFOLLOW)
        try:
            os.write(fd, value.encode())
        finally:
            os.close(fd)

    def stop(self):
        if self.path is None:
            return True
        self.write('cgroup.kill', '1')
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if 'populated 0' in (self.path / 'cgroup.events').read_text().splitlines():
                self.path.rmdir()
                return True
            time.sleep(.02)
        return False


def execution_terminal(record):
    need(type(record.get('pid')) is int and record['pid'] > 1, 'PROCESS_STATE_UNPROVEN')
    if alive(record['pid']):
        return False
    if CGROUP_BASE is not None:
        name = record.get('isolation')
        need(isinstance(name, str) and re.fullmatch(r'op-[a-f0-9]{32}', name), 'ISOLATION_STATE_UNPROVEN')
        path = CGROUP_BASE / name
        if path.exists():
            need('populated 0' in (path / 'cgroup.events').read_text().splitlines(), 'ISOLATION_STILL_POPULATED')
    return True


def run_command(raw, timeout, started):
    """Fork with a gate: the child cannot execute until its PID is durable.

    No background thread and no race between a still-running write and rollback.
    External Docker/provider effects still require the independent observer.
    """
    domain = KillDomain()
    ready_r, ready_w = os.pipe()
    gate_r, gate_w = os.pipe()
    out_r, out_w = os.pipe()
    # Commands are <=64KiB, but writing before the child reads can deadlock.
    # Use an inherited anonymous temporary descriptor, never a caller path.
    import tempfile
    with tempfile.TemporaryFile() as script:
        script.write(raw)
        script.flush()
        script.seek(0)
        pid = os.fork()
        if pid == 0:
            try:
                os.close(gate_w); os.close(out_r); os.close(ready_r)
                os.setsid()
                os.write(ready_w, b'1')
                os.close(ready_w)
                if os.read(gate_r, 1) != b'1':
                    os._exit(125)
                os.close(gate_r)
                os.dup2(script.fileno(), 0)
                os.dup2(out_w, 1)
                null = os.open('/dev/null', os.O_WRONLY)
                os.dup2(null, 2)
                os.close(out_w); os.close(null)
                os.chdir('/')
                os.execve(SHELL, [SHELL, '--noprofile', '--norc', '-s'], ENV)
            except BaseException:
                os._exit(126)
        os.close(gate_r); os.close(out_w); os.close(ready_w)
        output = bytearray()
        reason = 'EXITED'
        status = None
        try:
            ready, _, _ = select.select([ready_r], [], [], min(timeout, 5))
            need(ready and os.read(ready_r, 1) == b'1' and os.getpgid(pid) == pid, 'CHILD_SESSION_UNPROVEN')
            domain.attach(pid)
            started(pid, domain.path.name if domain.path is not None else None)  # fsync before release.
            os.write(gate_w, b'1')
            os.close(gate_w); gate_w = -1
            end = time.monotonic() + timeout
            while True:
                if time.monotonic() >= end:
                    reason = 'TIMEOUT'
                    break
                ready, _, _ = select.select([out_r], [], [], min(.05, end - time.monotonic()))
                if ready:
                    data = os.read(out_r, 8192)
                    if not data:
                        break
                    output.extend(data)
                    if len(output) > MAX:
                        reason = 'OUTPUT_LIMIT'
                        break
            while status is None and time.monotonic() < end:
                ended, value = os.waitpid(pid, os.WNOHANG)
                if ended:
                    status = value
                else:
                    time.sleep(.01)
            if status is None:
                reason = 'TIMEOUT' if reason == 'EXITED' else reason
        finally:
            if gate_w != -1:
                os.close(gate_w)
            # Kill the kernel domain including setsid descendants, then join.
            try:
                if not domain.stop():
                    reason = 'ISOLATION_UNPROVEN'
            except Exception:
                reason = 'ISOLATION_UNPROVEN'
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError:
                reason = 'ISOLATION_UNPROVEN'
            if status is None:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except OSError:
                    reason = 'ISOLATION_UNPROVEN'
                # Cleanup races must not mask the primary failure or skip fd
                # cleanup. If termination cannot be proven, never report exit.
                until = time.monotonic() + 5
                while status is None and time.monotonic() < until:
                    ended, value = os.waitpid(pid, os.WNOHANG)
                    if ended:
                        status = value
                    else:
                        time.sleep(.01)
                if status is None:
                    reason = 'ISOLATION_UNPROVEN'
            os.close(out_r); os.close(ready_r)
        return reason, os.waitstatus_to_exitcode(status) if status is not None else None, bytes(output[:MAX]), pid



def verify(code, evidence, manifest, previous, mode):
    """Execute only the separately approved verifier, never candidate code."""
    namespace = {'__name__': 'reviewed_continuation_verifier'}
    exec(compile(code, '<reviewed-continuation-verifier>', 'exec'), namespace)
    verdict = namespace['verify'](evidence, manifest, previous, mode)
    if mode in ('pre-recovery', 'terminal', 'recover', 'reconcile-recovery'):
        required = {'externalWritesTerminal'} if mode == 'terminal' else {'externalWritesTerminal', 'safeToRecover'} if mode == 'pre-recovery' else {'baselineBusinessAccepted', 'holdCleared', 'externalWritesTerminal'}
        need(isinstance(verdict, dict) and set(verdict) == required and all(v is True for v in verdict.values()), 'TERMINAL_OR_RECOVERY_UNPROVEN')
    else:
        need(verdict is True, 'EVIDENCE_NOT_VERIFIED')


def verify_receipt_files(path, receipt):
    evidence_path = path.with_name(path.name.replace('.receipt.json', '.evidence.json'))
    need(digest(read(evidence_path)) == receipt.get('evidenceSha256'), 'COMPLETION_EVIDENCE_CHANGED')
    if receipt.get('mode') in ('advance', 'reconcile'):
        observed_path = path.with_name(path.name.replace('.receipt.json', '.terminal-observation.json'))
        need(digest(read(observed_path)) == receipt.get('terminalObservationSha256'), 'COMPLETION_OBSERVATION_CHANGED')


def verify_historical_receipt(path, receipt, manifest):
    """Check a protected successful entry attestation without re-running its action.

    entry() writes this receipt only after both action and live terminal observer
    admission. Later stages may intentionally change the hold/container state;
    current live observation belongs to the current stage, not an old receipt.
    Every file is still root-owned, immutable and linked to its original package.
    """
    need(receipt.get('mode') in ('advance','reconcile'), 'HISTORICAL_NORMAL_RECEIPT_REQUIRED')
    original, _ = load_package(receipt['requestSha256'], receipt['attemptId'])
    need(original == manifest, 'HISTORICAL_PACKAGE_CHANGED')
    for key in ('sourceRevision','baselineRevision','controlRevision','attemptId','scope','stage',
                'requestedAt','deadlineAt','previousReceiptSha256'):
        need(receipt.get(key) == manifest.get(key), 'HISTORICAL_IDENTITY_CHANGED')
    need(instant(manifest['requestedAt']) <= instant(receipt['finishedAt']) <= instant(manifest['deadlineAt']),
         'HISTORICAL_BUDGET_INVALID')
    prefix = str(path).removesuffix('.receipt.json')
    intent = decode(read(Path(prefix + '.intent.json')))
    process = decode(read(Path(prefix + '.process.json')))
    need(intent['requestSha256'] == process['requestSha256'] == receipt['requestSha256'],
         'HISTORICAL_EXECUTION_CHANGED')
    verify_receipt_files(path, receipt)
    admission_raw = read(Path(prefix + '.admission.json'))
    need(digest(admission_raw) == receipt.get('admissionSha256'), 'HISTORICAL_ADMISSION_CHANGED')
    admission = decode(admission_raw)
    need(admission == {'kind':'cn-entry-admission-v1','requestSha256':receipt['requestSha256'],
          'verifierSha256':manifest['verifierSha256'],'observerSha256':manifest['observerSha256'],
          'authorizationEvidenceSha256':manifest['authorizationEvidenceSha256'],
          'evidenceSha256':receipt['evidenceSha256'],
          'terminalObservationSha256':receipt['terminalObservationSha256']}, 'HISTORICAL_ADMISSION_CHANGED')


def completed_attempt(root):
    """Partial files and transport-only receipts cannot release another attempt."""
    candidates = [root / '16-observe.receipt.json', *root.glob('*.recovery.receipt.json')]
    for path in candidates:
        if not path.exists():
            continue
        receipt = decode(read(path))
        need(isinstance(receipt, dict) and receipt.get('stage') in STAGES
             and receipt.get('mode') in ('advance', 'reconcile', 'recover', 'reconcile-recovery')
             and isinstance(receipt.get('requestSha256'), str) and HEX.fullmatch(receipt['requestSha256'])
             and isinstance(receipt.get('evidenceSha256'), str) and HEX.fullmatch(receipt['evidenceSha256']), 'COMPLETION_RECEIPT_INVALID')
        verify_receipt_files(path, receipt)
        return True
    return False


def entry(mode, request_hash, attempt):
    need(mode in ('advance', 'reconcile', 'status', 'recover', 'reconcile-recovery'), 'MODE_INVALID')
    manifest, files = load_package(request_hash, attempt)
    recovery = manifest['scope'] == 'runtime-only-reviewed-recovery'
    need((mode in ('recover', 'reconcile-recovery')) == recovery or mode == 'status', 'RECOVERY_MODE_REQUIRED')
    directory(STATE)
    root = STATE / attempt
    if mode == 'status':
        index = STAGES.index(manifest['stage'])
        prefix = root / ('%02d-%s%s' % (index, manifest['stage'], '.recovery' if recovery else ''))
        receipt_path = Path(str(prefix) + '.receipt.json')
        if receipt_path.exists():
            raw = read(receipt_path)
            need(decode(raw)['requestSha256'] == request_hash, 'STAGE_ALREADY_COMPLETED_OTHER_REQUEST')
            verify_receipt_files(receipt_path, decode(raw))
            return {'status': 'COMPLETED', 'receiptSha256': digest(raw), 'mutationExecuted': False}
        return {'status': 'UNCERTAIN' if Path(str(prefix) + '.intent.json').exists() else 'NOT_STARTED', 'mutationExecuted': False}
    if not root.exists():
        root.mkdir(mode=0o700)
        fsync_dir(STATE)
    directory(root)
    lockfd = os.open(STATE / 'entry.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        s = os.fstat(lockfd)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == OWNER and s.st_nlink == 1 and not s.st_mode & 0o077, 'LOCK_UNTRUSTED')
        try:
            fcntl.flock(lockfd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Rejected('ANOTHER_ENTRY_ACTIVE') from None
        identity = {k: manifest[k] for k in ('sourceRevision', 'baselineRevision', 'controlRevision', 'attemptId', 'scope', 'requestedAt', 'deadlineAt')}
        identity['scope'] = 'runtime-only-reviewed-continuation'
        identity_path = root / 'identity.json'
        if identity_path.exists():
            need(decode(read(identity_path)) == identity, 'IDENTITY_CHANGED')
        else:
            create(identity_path, encode(identity))
        index = STAGES.index(manifest['stage'])
        prefix = root / ('%02d-%s%s' % (index, manifest['stage'], '.recovery' if recovery else ''))
        previous_raw = None
        if index:
            previous_raw = read(root / ('%02d-%s.receipt.json' % (index - 1, STAGES[index - 1])))
            need(digest(previous_raw) == manifest['previousReceiptSha256'], 'PREVIOUS_RECEIPT_CHANGED')
        else:
            need(manifest['previousReceiptSha256'] is None, 'INITIAL_PREVIOUS_INVALID')
        receipt_path = Path(str(prefix) + '.receipt.json')
        intent_path = Path(str(prefix) + '.intent.json')
        process_path = Path(str(prefix) + '.process.json')
        terminal_path = Path(str(prefix) + '.terminal.json')
        if receipt_path.exists():
            receipt = decode(read(receipt_path))
            need(receipt['requestSha256'] == request_hash, 'STAGE_ALREADY_COMPLETED_OTHER_REQUEST')
            verify_receipt_files(receipt_path, receipt)
            return {'status': 'COMPLETED', 'receiptSha256': digest(read(receipt_path)), 'mutationExecuted': False}
        if recovery:
            original, _ = load_package(manifest['recoveryOf'], attempt)
            need(original['scope'] == 'runtime-only-reviewed-continuation' and all(original[k] == manifest[k] for k in identity if k != 'scope') and original['stage'] == manifest['stage'] and original['previousReceiptSha256'] == manifest['previousReceiptSha256'], 'RECOVERY_ORIGINAL_CHANGED')
            original_prefix = root / ('%02d-%s' % (index, manifest['stage']))
            original_intent = decode(read(Path(str(original_prefix)+'.intent.json')))
            original_process = decode(read(Path(str(original_prefix)+'.process.json')))
            need(original_intent['requestSha256'] == manifest['recoveryOf'] and original_process['requestSha256'] == manifest['recoveryOf'] and execution_terminal(original_process), 'ORIGINAL_EXECUTION_UNPROVEN')
        if mode in ('advance', 'recover'):

            need(instant(manifest['issuedAt']) <= now() < instant(manifest['expiresAt']), 'REQUEST_EXPIRED')
            need(not intent_path.exists(), 'UNCERTAIN_RECONCILE_NO_RETRY')
            KillDomain.preflight()
            active = STATE / 'active-attempt.json'
            if active.exists():
                old = decode(read(active))
                need(isinstance(old, str) and ATTEMPT.fullmatch(old), 'ACTIVE_ATTEMPT_INVALID')
                if old != attempt:
                    need(completed_attempt(STATE / old), 'OTHER_RELEASE_INCOMPLETE')
                    pending = STATE / ('active-attempt.%d.json' % os.getpid())
                    create(pending, encode(attempt))
                    os.replace(pending, active)
                    fsync_dir(STATE)
            else:
                create(active, encode(attempt))
            if recovery:
                reason, code, observed, observed_pid = run_command(files['observe.sh'], min(manifest['timeoutSeconds'], 120), lambda p, isolation: None)
                need(reason == 'EXITED' and code == 0 and not alive(observed_pid), 'RECOVERY_OBSERVATION_FAILED')
                verify(files['verify.py'], observed, manifest, decode(previous_raw) if previous_raw else None, 'pre-recovery')
                need(instant(manifest['issuedAt']) <= now() < instant(manifest['expiresAt']), 'RECOVERY_WINDOW_EXPIRED')
            create(intent_path, encode({'requestSha256': request_hash, 'stage': manifest['stage'], 'createdAt': stamp(), 'previousReceiptSha256': manifest['previousReceiptSha256']}))
            reason, code, evidence, pid = run_command(files['action.sh'], min(manifest['timeoutSeconds'], max(.01, (instant(manifest['expiresAt']) - now()).total_seconds())), lambda p, isolation: create(process_path, encode({'pid': p, 'isolation': isolation, 'requestSha256': request_hash})))
            create(terminal_path, encode({'reason': reason, 'exitCode': code, 'stdoutSha256': digest(evidence), 'processGroupStillPresent': alive(pid), 'finishedAt': stamp()}))
            need(reason == 'EXITED' and code == 0 and not alive(pid), 'EXECUTION_UNCERTAIN_RECONCILE_NO_RETRY')
        else:
            need(intent_path.exists() and decode(read(intent_path))['requestSha256'] == request_hash, 'RECONCILE_REQUEST_CHANGED')
            # Missing process journal is ambiguous (crash before fork/PID fsync).
            need(process_path.exists(), 'PROCESS_STATE_UNPROVEN')
            process = decode(read(process_path))
            need(process['requestSha256'] == request_hash and execution_terminal(process), 'PROCESS_STILL_ACTIVE_OR_UNPROVEN')
            reason, code, evidence, pid = run_command(files['observe.sh'], min(manifest['timeoutSeconds'], 120), lambda p, isolation: None)
            need(reason == 'EXITED' and code == 0 and not alive(pid), 'OBSERVATION_FAILED')
        if mode in ('advance', 'recover'):
            need(now() < instant(manifest['expiresAt']), 'RESULT_AFTER_EXPIRY_RECONCILE')
        if mode == 'advance':
            reason, code, observed, observed_pid = run_command(files['observe.sh'], min(manifest['timeoutSeconds'], 120), lambda p, isolation: None)
            need(reason == 'EXITED' and code == 0 and not alive(observed_pid), 'TERMINAL_OBSERVER_FAILED')
            verify(files['verify.py'], observed, manifest, decode(previous_raw) if previous_raw else None, 'terminal')
            need(now() < instant(manifest['expiresAt']), 'OBSERVER_AFTER_EXPIRY_RECONCILE')
        if mode == 'reconcile':
            observed = evidence
            verify(files['verify.py'], observed, manifest, decode(previous_raw) if previous_raw else None, 'terminal')
        verify(files['verify.py'], evidence, manifest, decode(previous_raw) if previous_raw else None, mode)
        # Persist original evidence only AFTER the reviewed verifier accepts it.
        evidence_path = Path(str(prefix) + '.evidence.json')
        if evidence_path.exists():
            need(read(evidence_path) == evidence, 'EVIDENCE_CHANGED')
        else:
            create(evidence_path, evidence)
        observation_hash = None
        if mode in ('advance', 'reconcile'):
            observation_path = Path(str(prefix) + '.terminal-observation.json')
            if observation_path.exists():
                need(read(observation_path) == observed, 'TERMINAL_OBSERVATION_CHANGED')
            else:
                create(observation_path, observed)
            observation_hash = digest(observed)
        admission_hash = None
        if mode in ('advance','reconcile'):
            admission = encode({'kind':'cn-entry-admission-v1','requestSha256':request_hash,
                'verifierSha256':manifest['verifierSha256'],'observerSha256':manifest['observerSha256'],
                'authorizationEvidenceSha256':manifest['authorizationEvidenceSha256'],
                'evidenceSha256':digest(evidence),'terminalObservationSha256':observation_hash})
            admission_path = Path(str(prefix) + '.admission.json')
            if admission_path.exists():need(read(admission_path)==admission,'ADMISSION_CHANGED')
            else:create(admission_path,admission)
            admission_hash = digest(admission)
        finished = now()
        switch_intent = root / '13-switch.intent.json'
        activation_start = decode(read(switch_intent))['createdAt'] if switch_intent.exists() else None
        receipt = {'schemaVersion': 1, **identity, 'stage': manifest['stage'], 'requestSha256': request_hash,
                   'previousReceiptSha256': manifest['previousReceiptSha256'], 'evidenceSha256': digest(evidence),
                   'terminalObservationSha256': observation_hash, 'admissionSha256':admission_hash,
                   'mode': mode, 'finishedAt': finished.isoformat(),
                   'elapsedSeconds': (finished-instant(manifest['requestedAt'])).total_seconds(),
                   'activationStartedAt': activation_start,
                   'activationElapsedSeconds': (finished-instant(activation_start)).total_seconds() if activation_start else None,
                   'withinTotalBudget': finished <= instant(manifest['deadlineAt']),
                   'productionAcceptanceClaimedByTransport': False}
        create(receipt_path, encode(receipt))
        return {'status': 'COMPLETED', 'receiptSha256': digest(encode(receipt)), 'mutationExecuted': mode in ('advance', 'recover')}
    finally:
        os.close(lockfd)


def main():
    try:
        need(os.geteuid() == 0 and len(sys.argv) == 4, 'ROOT_AND_FIXED_ARGUMENTS_REQUIRED')
        installed = Path('/usr/local/bin/workspacex-cn-release-advance')
        need(Path(__file__).absolute() == installed, 'FIXED_INSTALLED_ENTRY_REQUIRED')
        seal = decode(read(Path('/etc/workspacex-cn/continuation-entry-install.json')))
        need(isinstance(seal, dict) and set(seal) == {'schemaVersion','entrySha256'} and type(seal['schemaVersion']) is int and seal['schemaVersion'] == 1 and seal['entrySha256'] == digest(read(installed, 1024*1024)), 'INSTALLED_ENTRY_HASH_CHANGED')
        result = entry(*sys.argv[1:])
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        # Never expose command/provider output, file contents or exception text.
        code = str(error) if isinstance(error, Rejected) and re.fullmatch(r'[A-Z0-9_]{1,80}', str(error)) else 'ENTRY_FAILED_RECONCILE_NO_RETRY'
        print(json.dumps({'status': 'BLOCKED', 'code': code, 'mutationRetried': False}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
