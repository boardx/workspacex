#!/usr/bin/env python3
"""DRAFT: locked backup/switch/rollback core; no automatic binding or dispatch.

Requires independent review, a freshly bound package and real stop/backup receipts.
Creates scoped holds and stops exact writers; never migrates, changes env or clears holds.
"""
import datetime, fcntl, hashlib, json, os, re, stat, subprocess, sys
from pathlib import Path

SOURCE = 'f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
BASELINE = '5285bef9a6c91bbb9857ede42779aafa64b98f32'
SERVICES = ('api', 'web', 'agent', 'sandbox', 'sandbox-sessions')
REPOS = dict(zip(SERVICES, ('api', 'web', 'deep-agent', 'skill-sandbox', 'skill-sandbox')))
PREFIX = 'workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com/workspacex-prod/'
RUNTIME = Path('/var/lib/workspacex-cn/runtime')
D = ['/usr/bin/docker', '--host', 'unix:///run/docker.sock']

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def private(path):
    path = Path(path)
    for parent in path.parents:
        s = parent.lstat()
        assert stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(f.fileno())
        assert stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1
        assert stat.S_IMODE(s.st_mode) == 0o600 and s.st_size <= 1048576
        return f.read()

def record(root, name, value):
    raw = (json.dumps(value, sort_keys=True) + '\n').encode()
    fd = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw); f.flush(); os.fsync(f.fileno())
    return sha(raw)

def run(args, timeout=60):
    p = subprocess.run(args, capture_output=True, timeout=timeout, pass_fds=(9,))
    assert p.returncode == 0, 'COMMAND_FAILED_RECONCILE_WITHOUT_RETRY'
    assert len(p.stdout) <= 1048576
    return p.stdout

def validate_binding(b):
    assert b['draft'] is False, 'DRAFT_NOT_EXECUTABLE'
    assert b['sourceRevision'] == SOURCE and b['baselineRevision'] == BASELINE
    assert b['accountId'] == '1177216024653153' and b['ecsInstanceId'] == 'i-uf6ga92ewloganobbln6'
    assert b['region'] == 'cn-shanghai'
    assert b['migrationDiff'] == [] and re.fullmatch('[a-f0-9]{64}', b['migrationDiffEvidenceSha256'])
    assert b['authorizationEvidenceSha256'] and b['publicationReceiptSha256']
    assert set(b['candidateImages']) == set(SERVICES) == set(b['rollbackImages'])
    for field in ('candidateImages', 'rollbackImages'):
        for service, image in b[field].items():
            assert re.fullmatch(re.escape(PREFIX + REPOS[service]) + r'@sha256:[a-f0-9]{64}', image)
        assert b[field]['sandbox'] == b[field]['sandbox-sessions']
    assert b['envFiles'], 'CURRENT_ENV_HASH_BINDINGS_REQUIRED'
    assert b['composeFiles'] and b['backupPaths'] and b['expectedContainers']
    assert b['backupScope'] == 'host-config-and-bind-only'

def inspect_images(b, run):
    for image in sorted(set(b['candidateImages'].values()) | set(b['rollbackImages'].values())):
        xs = json.loads(run(D + ['image', 'inspect', image])); assert len(xs) == 1
        x = xs[0]
        assert x['Os'] == 'linux' and x['Architecture'] == 'amd64' and image in x.get('RepoDigests', []), 'IMAGE_NOT_AVAILABLE'


def rollback_inventory(b, root, run):
    # A successful listing establishes absence; an inspect error is never absence.
    lines = run(D + ['ps', '-a', '--format', '{{json .}}']).decode().splitlines()
    ids = []
    expected_names = {'workspacex-cn-' + service + '-1' for service in SERVICES}
    for line in lines:
        item = json.loads(line)
        if item['Names'] in expected_names: ids.append(item['ID'])
    assert len(ids) <= 5 and len(set(ids)) == len(ids)
    xs = json.loads(run(D + ['inspect', *ids])) if ids else []
    seen = set()
    for x in xs:
        name = x['Name'].lstrip('/'); assert name in expected_names and name not in seen; seen.add(name)
        service = name[len('workspacex-cn-'):-2]
        labels = x['Config']['Labels']
        assert labels['com.docker.compose.project'] == 'workspacex-cn' and labels['com.docker.compose.service'] == service
        assert labels['com.docker.compose.project.working_dir'] == b['workingDir']
        configs = labels['com.docker.compose.project.config_files'].split(',')
        old = [f['path'] for f in b['composeFiles']]
        assert configs in (old, old + [str(root / 'switch-images.json')], old + [str(root / 'rollback-images.json')])
        assert x['Config']['Image'] in (b['candidateImages'][service], b['rollbackImages'][service])
    return xs


def validate_recovery(b, original_sha, recovery, mode, now, reconciliation):
    assert mode in ('rollback', 'abort-original')
    assert recovery['kind'] == 'f0eb-fresh-recovery-v1' and recovery['operation'] == mode
    assert recovery['originalBindingSha256'] == original_sha
    for key in ('attemptId', 'sourceRevision', 'baselineRevision', 'hold'):
        assert recovery[key] == b[key], 'RECOVERY_IDENTITY_CHANGED'
    issued = datetime.datetime.fromisoformat(recovery['issuedAt']); expires = datetime.datetime.fromisoformat(recovery['expiresAt'])
    assert issued <= now < expires and expires-issued <= datetime.timedelta(minutes=30)
    assert re.fullmatch('[a-f0-9]{64}', recovery['authorizationEvidenceSha256'])
    assert reconciliation['priorInvocationTerminal'] is True and reconciliation['activeCloudCommands'] == []
    assert reconciliation['hold'] == b['hold'] and reconciliation['attemptId'] == b['attemptId']
    observed = datetime.datetime.fromisoformat(reconciliation['observedAt'])
    assert datetime.timedelta(0) <= now-observed <= datetime.timedelta(minutes=10)
    assert reconciliation['operation'] == mode


def create_hold_phase(b, root, expected_sha, h, hold, create, record):
    assert h == b['previousHold'] and (h is None or h['state'] == 'cleared'), 'RECONCILE_EXISTING_HOLD'
    identity = {'sourceRevision': SOURCE, 'baselineRevision': BASELINE,
                'attemptId': b['attemptId'], 'migrationPlanSha256': b['migrationDiffEvidenceSha256']}
    record(root, 'hold-intent.json', {'bindingSha256': expected_sha, 'identity': identity})
    p = create(identity)
    assert p.returncode == 0, 'HOLD_CREATE_UNKNOWN_RECONCILE'
    h = json.loads(p.stdout); assert h['state'] == 'held' and h['identity'] == identity and hold() == h
    record(root, 'hold-result.json', h)
    return {'operation':'hold','actualHold':h,'writerStopExecuted':False}


def stop_phase(b, root, expected_sha, h, hold, run, record):
    inspect_images(b, run)
    names = ['workspacex-cn-' + service + '-1' for service in SERVICES]
    xs = json.loads(run(D + ['inspect'] + names)); assert len(xs) == 5
    for x in xs:
        expected = b['expectedContainers'][x['Name']]
        assert x['Id'] == expected['id'] and x['Config']['Image'] == expected['image']
        labels = x['Config']['Labels']
        assert labels['com.docker.compose.project'] == 'workspacex-cn'
        assert labels['com.docker.compose.project.config_files'].split(',') == [f['path'] for f in b['composeFiles']]
        assert labels['com.docker.compose.project.working_dir'] == b['workingDir']
    record(root, 'stop-intent.json', {'bindingSha256': expected_sha, 'holdGeneration': h['generation']})
    # Graceful stop; timeout never escalates to container SIGKILL or blind replay.
    run(D + ['stop', '--time', '-1', *names], 240)
    xs = json.loads(run(D + ['inspect'] + names))
    assert len(xs) == 5 and all(not x['State']['Running'] and not x['State']['Restarting'] for x in xs)
    assert hold() == h
    record(root, 'known-five-stop.json', {'knownFiveStopped':True,'holdGeneration':h['generation'],
                                          'allExternalWritersProvenAbsent':False})
    # Caller obtains a fresh independently reviewed database client-session readback
    # then binds normalized stop-receipt.json; do not invent zero-session evidence.
    return {'operation':'stop','knownFiveStopped':True,'otherDatabaseClientSessions':None,
            'holdRetained':True,'sessionReadbackRequired':True}


def abort_original_phase(b, root, expected_sha, h, hold, run, record):
    assert not (root / 'switch-intent.json').exists(), 'SWITCH_ATTEMPT_REQUIRES_ROLLBACK_RECONCILIATION'
    assert (root / 'stop-intent.json').exists(), 'NO_STOP_ATTEMPT'
    names = ['workspacex-cn-' + service + '-1' for service in SERVICES]
    xs = json.loads(run(D + ['inspect'] + names)); assert len(xs) == 5
    for x in xs:
        expected = b['expectedContainers'][x['Name']]
        assert x['Id'] == expected['id'] and x['Config']['Image'] == expected['image']
        assert not x['State']['Restarting']
    record(root, 'abort-original-intent.json', {'bindingSha256':expected_sha,'holdGeneration':h['generation']})
    run(D + ['start', *names], 180)
    xs = json.loads(run(D + ['inspect'] + names))
    assert len(xs) == 5
    for x in xs:
        expected = b['expectedContainers'][x['Name']]
        assert x['Id'] == expected['id'] and x['Config']['Image'] == expected['image'] and x['State']['Running']
    assert hold() == h
    record(root, 'abort-original-result.json', {'oldExactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False})
    return {'operation':'abort-original','oldExactFiveRunning':True,'holdRetained':True}


def main():
    assert len(sys.argv) in (4, 5), 'usage: upgrade-draft.py ROOT BINDING_SHA hold|stop|backup|switch|rollback|abort-original'
    root = Path(sys.argv[1]); expected_sha = sys.argv[2]; mode = sys.argv[3]
    assert root.parent == RUNTIME and root.name.startswith('upgrade-f0eb-')
    assert mode in ('hold', 'stop', 'backup', 'switch', 'rollback', 'abort-original') and os.geteuid() == 0
    os.umask(0o077)
    raw = private(root / 'binding.json'); assert sha(raw) == expected_sha
    b = json.loads(raw); validate_binding(b)
    now = datetime.datetime.now(datetime.timezone.utc)
    if len(sys.argv) == 5:
        recovery_raw = private(root / 'recovery-binding.json'); assert sha(recovery_raw) == sys.argv[4]
        recovery = json.loads(recovery_raw)
        reconciliation_raw = private(root / 'recovery-reconciliation.json')
        assert sha(reconciliation_raw) == recovery['reconciliationSha256']
        validate_recovery(b, expected_sha, recovery, mode, now, json.loads(reconciliation_raw))
    else:
        assert datetime.datetime.fromisoformat(b['issuedAt']) <= now < datetime.datetime.fromisoformat(b['expiresAt'])
    assert sha(private(root / 'upgrade-draft.py')) == b['scriptSha256']
    fd = os.open(RUNTIME / 'release.lock', os.O_RDWR | os.O_NOFOLLOW)
    s = os.fstat(fd)
    assert stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if fd != 9: os.dup2(fd, 9); os.close(fd)
    os.set_inheritable(9, True)
    hold_helper = Path('/usr/local/lib/workspacex-cn/cn_maintenance_hold.py')
    assert sha(hold_helper.read_bytes()) == b['holdHelperSha256']
    def hold():
        return json.loads(run(['/usr/bin/python3', '-I', '-S', '-B', str(hold_helper), 'read', str(RUNTIME)]))
    h = hold()
    if mode == 'hold':
        def create(identity):
            return subprocess.run(['/usr/bin/python3', '-I', '-S', '-B', str(hold_helper), 'create', str(RUNTIME)], input=json.dumps(identity).encode(), capture_output=True, timeout=30, pass_fds=(9,))
        print(json.dumps(create_hold_phase(b, root, expected_sha, h, hold, create, record))); return
    assert h == b['hold'] and h['state'] == 'held'
    assert h['identity']['sourceRevision'] == SOURCE and h['identity']['baselineRevision'] == BASELINE
    for f in b['composeFiles'] + b['envFiles']:
        assert sha(private(f['path'])) == f['sha256'], 'CONFIG_DRIFT'
    if mode == 'stop':
        print(json.dumps(stop_phase(b, root, expected_sha, h, hold, run, record))); return
    if mode == 'abort-original':
        print(json.dumps(abort_original_phase(b, root, expected_sha, h, hold, run, record))); return
    stop_raw = private(root / 'stop-receipt.json')
    assert sha(stop_raw) == b['stopReceiptSha256']
    stop = json.loads(stop_raw)
    assert stop['holdGeneration'] == h['generation'] and stop['knownFiveStopped'] is True
    assert stop['otherDatabaseClientSessions'] == 0
    names = ['workspacex-cn-' + service + '-1' for service in SERVICES]
    xs = rollback_inventory(b, root, run) if mode == 'rollback' else json.loads(run(D + ['inspect'] + names))
    if mode != 'rollback':
        for x in xs:
            assert x['Id'] == b['expectedContainers'][x['Name']]['id']
            assert x['Config']['Image'] == b['expectedContainers'][x['Name']]['image']
            assert not x['State']['Running'] and not x['State']['Restarting']
    if mode == 'backup':
        # Reviewed tar helper must constrain every source path and preserve permissions.
        helper = root / 'backup-host.py'
        assert sha(private(helper)) == b['backupHelperSha256']
        record(root, 'backup-intent.json', {'bindingSha256': expected_sha, 'holdGeneration': h['generation']})
        result = json.loads(run(['/usr/bin/python3', '-I', '-S', '-B', str(helper), str(root), expected_sha], 600))
        assert result['scope'] == b['backupScope'] and result['restoreTested'] is False
        assert hold() == h
        record(root, 'backup-result.json', {'actual': result, 'holdGeneration': h['generation']})
    else:
        backup_raw = private(root / 'backup-result.json')
        assert sha(backup_raw) == b['hostBackupReceiptSha256']
        assert json.loads(backup_raw)['holdGeneration'] == h['generation']
        # Binding for switch is finalized only after actual host/RDS receipts exist.
        rds_raw = private(root / 'rds-backup-receipt.json')
        assert sha(rds_raw) == b['rdsBackupReceiptSha256']
        assert b['backupProviderObservationReviewed'] is True
        if mode == 'rollback': private(root / 'switch-intent.json')
        images = b['candidateImages' if mode == 'switch' else 'rollbackImages']
        for image in images.values():
            x = json.loads(run(D + ['image', 'inspect', image]))[0]
            assert x['Os'] == 'linux' and x['Architecture'] == 'amd64' and image in x.get('RepoDigests', [])
        override = root / (mode + '-images.json')
        assert json.loads(private(override)) == {'services': {k: {'image': v} for k, v in images.items()}}
        record(root, mode + '-intent.json', {'bindingSha256': expected_sha, 'holdGeneration': h['generation']})
        args = D + ['compose', '--project-directory', b['workingDir'], '-p', 'workspacex-cn']
        for f in b['composeFiles']: args += ['-f', f['path']]
        run(args + ['-f', str(override), 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', *SERVICES], 180)
        xs = json.loads(run(D + ['inspect'] + names))
        for x in xs:
            service = x['Config']['Labels']['com.docker.compose.service']
            assert x['State']['Running'] and x['Config']['Image'] == images[service]
        assert hold() == h
        record(root, mode + '-result.json', {'exactFiveRunning': True, 'holdRetained': True, 'businessAcceptancePassed': False})
    print(json.dumps({'operation': mode, 'completed': True, 'holdRetained': True}))

if __name__ == '__main__':
    try: main()
    except BaseException:
        print('{"ok":false,"code":"DRAFT_OR_GATE_FAILURE_RECONCILE_NO_REPLAY"}')
        sys.exit(1)
