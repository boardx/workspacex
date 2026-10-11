#!/usr/bin/env python3
"""Offline specialization of the reviewed continuation materializer.

The production CLI trusts only a root-owned approval under APPROVAL_ROOT. It
never makes an approval, invokes cloud APIs, or dispatches the generated runtime.
The approved package supplies prepare-phase.py and its original validators; this
adapter only binds identities, exact input bytes and their approved hashes.
"""
import argparse
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

APPROVAL_ROOT = Path('/etc/workspacex-cn/continuation-approvals')
PACKAGE_FILES = ('prepare-phase.py', 'upgrade-draft.py', 'backup-host.DRAFT.py',
                 'sessions-after-stop.py', 'sessions-after-stop.sh')
# Recovery retains the original requestedAt via prepare-recovery-stage.py;
# this normal-phase binder must never reopen the release clock.
PHASES = {'hold', 'stop', 'backup', 'switch'}
SCOPE = 'exact-five-runtime-upgrade-no-migration-no-dns-env-secret-topology-change'


def require(value, code):
    if not value:
        raise ValueError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def parse(raw):
    def pairs(values):
        out = {}
        for key, value in values:
            require(key not in out, 'DUPLICATE_JSON_KEY')
            out[key] = value
        return out
    return json.loads(raw, object_pairs_hook=pairs)


def stamp(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'TIMEZONE_REQUIRED')
    return result


def private_read(path):
    """Root authority must not come from a workspace or an approval boolean."""
    path = Path(path)
    for parent in path.parents:
        s = parent.lstat()
        require(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022,
                'UNTRUSTED_APPROVAL_PARENT')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        require(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1
                and stat.S_IMODE(s.st_mode) == 0o600 and s.st_size <= 1048576,
                'UNTRUSTED_APPROVAL_FILE')
        return f.read()


def load_approval(request_sha):
    require(re.fullmatch('[a-f0-9]{64}', request_sha), 'REQUEST_HASH_REQUIRED')
    return private_read(APPROVAL_ROOT / (request_sha + '.json'))


def specialize(raw, source, baseline, old_source, old_baseline, *, backup=False):
    """Rewrite only explicit identity assignments / one legacy backup guard."""
    tree = ast.parse(raw)
    changed = set()
    if backup:
        # The reviewed backup helper predates SOURCE. Normalize exactly its one
        # top-level-main assertion, never arbitrary literals or import nodes.
        matches = [node for node in ast.walk(tree) if isinstance(node, ast.Assert)
                   and ast.dump(node.test) == ast.dump(ast.parse(
                       "b['sourceRevision'] == " + repr(old_source), mode='eval').body)]
        require(len(matches) == 1, 'BACKUP_IDENTITY_GUARD_CHANGED')
        matches[0].test.comparators[0] = ast.Name(id='SOURCE', ctx=ast.Load())
        tree.body.insert(0, ast.Assign(targets=[ast.Name(id='SOURCE', ctx=ast.Store())],
                                      value=ast.Constant(old_source)))
    expected = {'SOURCE'} if backup else {'SOURCE', 'BASELINE'}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in expected:
                require(name not in changed, 'DUPLICATE_IDENTITY_ASSIGNMENT')
                require(ast.literal_eval(node.value) == (old_source if name == 'SOURCE' else old_baseline),
                        'IDENTITY_ASSIGNMENT_CHANGED')
                node.value = ast.Constant(source if name == 'SOURCE' else baseline)
                changed.add(name)
    require(changed == expected, 'IDENTITY_ASSIGNMENT_MISSING')
    return (ast.unparse(ast.fix_missing_locations(tree)) + '\n').encode()


def bind(request_raw, approval_raw, package, inputs, output, *, now=None):
    """Library seam: caller MUST obtain approval_raw through load_approval().

    Tests can supply fixtures here; the CLI provides no alternate approval path.
    A generated binding does not prove publication, authorization or cloud state.
    """
    request, approval = parse(request_raw), parse(approval_raw)
    now = now or dt.datetime.now(dt.timezone.utc)
    require(set(request) == {'schemaVersion', 'sourceRevision', 'baselineRevision',
                            'controlRevision', 'publicationAttemptId', 'attemptId',
                            'phase', 'inputs', 'requestedAt', 'deadlineAt'}, 'REQUEST_FIELDS')
    require(type(request['schemaVersion']) is int and request['schemaVersion'] == 1,
            'REQUEST_VERSION')
    require(request['phase'] in PHASES, 'PHASE')
    requested, deadline = stamp(request['requestedAt']), stamp(request['deadlineAt'])
    require(requested <= now < deadline and dt.timedelta(0) < deadline-requested <= dt.timedelta(minutes=30),
            'END_TO_END_DEADLINE')
    for key in ('sourceRevision', 'baselineRevision', 'controlRevision'):
        require(re.fullmatch('[a-f0-9]{40}', request[key]), 'EXACT_REVISION_REQUIRED')
    for key in ('attemptId', 'publicationAttemptId'):
        require(re.fullmatch('[a-z0-9-]{1,64}', request[key]), 'ATTEMPT_REQUIRED')
    require(approval['kind'] == 'cn-continuation-materialization-approval-v1'
            and approval['requestSha256'] == sha(request_raw), 'APPROVAL_REQUEST_MISMATCH')
    require(stamp(approval['issuedAt']) <= now < stamp(approval['expiresAt']), 'APPROVAL_EXPIRED')
    require(set(approval['packageFiles']) == set(PACKAGE_FILES), 'PACKAGE_CLOSURE')
    phase = request['phase']
    required = {'authorization', 'publication', 'template', 'migrationDiff'}
    if phase != 'hold':
        required.add('hold')
    if phase in ('backup', 'switch', 'rollback'):
        required.add('stop')
    if phase in ('switch', 'rollback'):
        required.update(('hostBackup', 'rdsBackup'))
    require(set(inputs) == required == set(request['inputs']), 'INPUT_CLOSURE')
    for key, raw in inputs.items():
        require(len(raw) <= 1048576 and sha(raw) == request['inputs'][key], 'INPUT_HASH_' + key)
    auth, pub, template, diff = (parse(inputs[k]) for k in
                                  ('authorization', 'publication', 'template', 'migrationDiff'))
    for key in ('sourceRevision', 'baselineRevision', 'attemptId'):
        require(auth[key] == request[key], 'AUTH_IDENTITY_' + key)
    require(auth['scope'] == SCOPE and auth['runtimeStartSideEffectsIncluded'] is True
            and bool(auth.get('directUserEvidence')), 'AUTH_SCOPE')
    require(stamp(auth['issuedAt']) <= now < stamp(auth['expiresAt']) <= deadline, 'AUTH_EXPIRED_OR_OVER_BUDGET')
    for key in ('sourceRevision', 'controlRevision'):
        require(pub[key] == request[key], 'PUBLICATION_IDENTITY_' + key)
    require(pub.get('receiptKind') == 'cn-candidate-published-v2'
            and pub['attemptId'] == request['publicationAttemptId'], 'PUBLICATION_ATTEMPT')
    for key in ('sourceRevision', 'baselineRevision'):
        require(template[key] == diff[key] == request[key], 'INPUT_IDENTITY_' + key)
    require(template['draft'] is True, 'FRESH_TEMPLATE_REQUIRED')
    require(diff['changedFiles'] == [] and diff['schemaMigrationRequired'] is False,
            'NO_MIGRATION_ONLY')
    code = {}
    for name in PACKAGE_FILES:
        path = Path(package) / name
        require(not path.is_symlink(), 'PACKAGE_SYMLINK')
        raw = path.read_bytes()
        require(sha(raw) == approval['packageFiles'][name], 'PACKAGE_HASH_' + name)
        code[name] = raw
    tree = ast.parse(code['upgrade-draft.py'])
    identities = {n.targets[0].id: ast.literal_eval(n.value) for n in tree.body
                  if isinstance(n, ast.Assign) and len(n.targets) == 1
                  and isinstance(n.targets[0], ast.Name)
                  and n.targets[0].id in ('SOURCE', 'BASELINE')}
    require(set(identities) == {'SOURCE', 'BASELINE'}
            and identities['SOURCE'] != identities['BASELINE'], 'RUNTIME_IDENTITIES')
    # This only specializes the original reviewed identity literals. Fixed target,
    # registry, scope, receipts, hold CAS and the original validator stay intact.
    for name in ('upgrade-draft.py', 'backup-host.DRAFT.py'):
        code[name] = specialize(code[name], request['sourceRevision'], request['baselineRevision'],
                                identities['SOURCE'], identities['BASELINE'], backup=name == 'backup-host.DRAFT.py')
    output = Path(output).absolute()
    require(not output.exists(), 'OUTPUT_EXISTS')
    with tempfile.TemporaryDirectory(prefix='cn-continuation-bind-') as tmp:
        root = Path(tmp); prep = root / 'prep'; prep.mkdir()
        for name, raw in code.items():
            (prep / name).write_bytes(raw)
        template.update(requestedAt=request['requestedAt'], deadlineAt=request['deadlineAt'],
                        controlRevision=request['controlRevision'])
        (prep / 'binding.template.json').write_text(json.dumps(template))
        (root / 'migration-diff-evidence.json').write_bytes(inputs['migrationDiff'])
        config = {'phase': phase, 'output': str(output)}
        for key, raw in inputs.items():
            if key in ('template', 'migrationDiff'):
                continue
            path = root / (key + '.json'); path.write_bytes(raw); config[key] = str(path)
        config_path = root / 'phase-config.json'
        config_path.write_text(json.dumps(config))
        # Isolated subprocess: original prepare() imports its own original
        # validators; no cloud credentials are inherited, no shell is involved.
        child = subprocess.run([sys.executable, '-I', '-B', str(prep / 'prepare-phase.py'),
                                str(config_path)], capture_output=True, timeout=30,
                               env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        require(child.returncode == 0, 'CANONICAL_PHASE_MATERIALIZER_REJECTED')
    # Preserve the specialized runtime whose exact hashes the original generator
    # just embedded in binding.json. The caller must stage these exact bytes.
    for name in ('upgrade-draft.py', 'backup-host.DRAFT.py', 'sessions-after-stop.py'):
        target = output / name
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(code[name]); f.flush(); os.fsync(f.fileno())
    result = {'kind': 'cn-continuation-bound-phase-v1', 'requestSha256': sha(request_raw),
              'approvalRawSha256': sha(approval_raw), 'phase': phase,
              'sourceRevision': request['sourceRevision'], 'controlRevision': request['controlRevision'],
              'attemptId': request['attemptId'], 'requestedAt': request['requestedAt'],
              'deadlineAt': request['deadlineAt'], 'packageFiles': approval['packageFiles'],
              'files': {p.name: sha(p.read_bytes()) for p in output.iterdir()},
              'cloudCalls': 0, 'dispatchAuthorizedByGenerator': False,
              'requiresReviewedRootTransport': True}
    fd = os.open(output / 'provenance.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(result, f, sort_keys=True); f.write('\n'); f.flush(); os.fsync(f.fileno())
    fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--request-sha256', required=True)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, required=True,
                        help='Directory of exact <input-name>.json files')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.request.read_bytes()
    require(sha(raw) == args.request_sha256, 'REQUEST_HASH_MISMATCH')
    approval = load_approval(args.request_sha256)
    inputs = {key: (args.inputs / (key + '.json')).read_bytes() for key in parse(raw)['inputs']}
    print(json.dumps(bind(raw, approval, args.package, inputs, args.output), sort_keys=True))


if __name__ == '__main__':
    main()
