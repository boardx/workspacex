#!/usr/bin/env python3
"""Root-private pre-launch admission for the single maintenance coordinator.

Staged source, not an installed CLI. Controller profile mapping and executable
artifact packaging are installation prerequisites, not implied by this file.
"""
import os, sys, json, stat, hashlib, fcntl, subprocess

LOCK = '/var/lib/workspacex-cn/runtime/release.lock'
PROFILE = '/etc/workspacex-cn/trusted-tool-binding.json'

def require(ok, code):
    if not ok:
        raise RuntimeError(code)

def protected_bytes(path, mode, limit=4 * 1024 * 1024):
    require(path.startswith('/') and '..' not in path.split('/'), 'PATH_INVALID')
    parts = path.split('/')[1:]
    for i in range(1, len(parts)):
        st = os.lstat('/' + '/'.join(parts[:i]))
        require(stat.S_ISDIR(st.st_mode) and st.st_uid == 0 and st.st_gid == 0 and not st.st_mode & 0o022, 'PARENT_TRUST')
    before = os.lstat(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        after = os.fstat(fd)
        require(stat.S_ISREG(after.st_mode) and after.st_uid == 0 and after.st_gid == 0 and after.st_nlink == 1 and stat.S_IMODE(after.st_mode) == mode, 'FILE_TRUST')
        require((before.st_dev, before.st_ino) == (after.st_dev, after.st_ino), 'FILE_CHANGED')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read(limit + 1)
        final = os.fstat(fd)
        require(len(raw) <= limit and (after.st_size, after.st_mtime_ns, after.st_ctime_ns) == (final.st_size, final.st_mtime_ns, final.st_ctime_ns), 'FILE_CHANGED')
        return raw
    finally:
        os.close(fd)

def main():
    require(os.geteuid() == 0 and os.getegid() == 0 and sys.platform == 'linux', 'ROOT_LINUX_REQUIRED')
    require(len(sys.argv) == 4 and sys.argv[1] == '--launch-reviewed-controller', 'USAGE')
    path, expected_hash = sys.argv[2:]
    raw = protected_bytes(path, 0o600)
    require(hashlib.sha256(raw).hexdigest() == expected_hash, 'PLAN_HASH_MISMATCH')
    plan = json.loads(raw)
    require(plan.get('productionActionsAuthorized') is True, 'PRODUCTION_ACTIONS_NOT_AUTHORIZED')
    profile = json.loads(protected_bytes(PROFILE, 0o600))
    # New installation extension remains absent until mechanically derived from
    # exact FILES and reviewed by the single installer authority.
    descriptor = profile.get('maintenanceHostController')
    require(isinstance(descriptor, dict), 'MAINTENANCE_HOST_CONTROLLER_NOT_INSTALLED')
    require(set(descriptor) == {'path', 'sha256', 'sourcePath', 'toolRevision'}, 'CONTROLLER_DESCRIPTOR_INVALID')
    require(descriptor['toolRevision'] == profile.get('toolRevision') and profile.get('filesSha256', {}).get(descriptor['sourcePath']) == descriptor['sha256'], 'CONTROLLER_PROFILE_BINDING')
    entry = protected_bytes(descriptor['path'], 0o700)
    require(hashlib.sha256(entry).hexdigest() == descriptor['sha256'], 'CONTROLLER_HASH_MISMATCH')
    recovery = profile.get('maintenanceRecoveryExecutor')
    require(isinstance(recovery, dict) and set(recovery) == {'path', 'sha256', 'sourcePath', 'toolRevision'}, 'RECOVERY_DESCRIPTOR_INVALID')
    require(recovery['toolRevision'] == profile['toolRevision'] and profile['filesSha256'].get(recovery['sourcePath']) == recovery['sha256'], 'RECOVERY_PROFILE_BINDING')
    require(hashlib.sha256(protected_bytes(recovery['path'], 0o700)).hexdigest() == recovery['sha256'], 'RECOVERY_HASH_MISMATCH')
    identity = plan['identity']
    recovery_path = '/etc/workspacex-cn/maintenance-recovery/' + identity['sourceRevision'] + '/' + identity['attemptId'] + '/recovery-plan.json'
    require(plan['recoveryPlanPath'] == recovery_path, 'RECOVERY_PLAN_PATH_INVALID')
    require(hashlib.sha256(protected_bytes(recovery_path, 0o600)).hexdigest() == plan['recoveryPlanSha256'], 'RECOVERY_PLAN_HASH_MISMATCH')
    # Executor checks its own entire installed closure; preflight does not open
    # the release lock, pause writers, connect for restore or mutate databases.
    result = subprocess.run(['/usr/bin/python3', '-I', recovery['path'], '--preflight-capability', recovery_path], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=300, env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'})
    require(result.returncode == 0 and len(result.stdout) <= 1048576, 'RECOVERY_PREFLIGHT_FAILED')
    fact = json.loads(result.stdout)
    require(fact == {'schemaVersion':1,'kind':'production-recovery-preflight','identity':identity,'toolRevision':profile['toolRevision'],'planSha256':plan['recoveryPlanSha256'],'liveWritesHeldProven':False,'ready':False}, 'RECOVERY_PREFLIGHT_INVALID')
    node = profile.get('maintenanceNodeRuntime')
    require(isinstance(node,dict) and set(node) == {'path','sha256'}, 'NODE_RUNTIME_BINDING_MISSING')
    # A self-contained CJS entry is mandatory: its hash binds dependencies;
    # ambient node_modules, TypeScript loaders and NODE_OPTIONS are not used.
    require(descriptor['path'] == '/usr/local/lib/workspacex-cn/cn-maintenance-host-controller.cjs', 'CONTROLLER_BUNDLE_REQUIRED')
    require(hashlib.sha256(protected_bytes(node['path'], 0o755, 256 * 1024 * 1024)).hexdigest() == node['sha256'], 'NODE_RUNTIME_HASH_MISMATCH')
    parent = os.lstat(os.path.dirname(LOCK))
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == 0 and parent.st_gid == 0 and stat.S_IMODE(parent.st_mode) == 0o700, 'LOCK_PARENT_UNTRUSTED')
    lock = os.open(LOCK, os.O_RDWR | os.O_NOFOLLOW)
    lock_stat = os.fstat(lock)
    require(stat.S_ISREG(lock_stat.st_mode) and lock_stat.st_uid == 0 and lock_stat.st_gid == 0 and lock_stat.st_nlink == 1 and stat.S_IMODE(lock_stat.st_mode) == 0o600, 'LOCK_UNTRUSTED')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if lock != 9:
        os.dup2(lock, 9, inheritable=True)
        os.close(lock)
    os.set_inheritable(9, True)
    os.execve(node['path'], [node['path'], descriptor['path'], '--run-reviewed-maintenance', path, expected_hash], {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8'})

if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = str(error)
        print(code if code.replace('_', '').isalnum() else 'HOST_LAUNCH_REJECTED', file=sys.stderr)
        sys.exit(1)
