#!/usr/bin/env python3
"""Root-only one-time binding of the release consumer to an installed selfhost runtime."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

RUNTIME = Path('/etc/workspacex-selfhost')
POLICY = Path('/etc/workspacex-image-release')
STATE = Path('/var/lib/workspacex-image-release/us')
PROBE = Path('/usr/local/bin/workspacex-us-release-probe')
LOCK = Path('/run/workspacex-selfhost-deploy.lock')


def reference(path):
    path = Path(path)
    for parent in [*reversed(path.parents), path]:
        info = parent.lstat()
        if parent.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('UNTRUSTED_HOST_PATH')
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('Usage: sudo python3 scripts/configure-us-image-release.py <runner-user>')
    runner = sys.argv[1]
    # No credential/config copying from DevApp. Preserve this host's private runtime.
    reference(RUNTIME / 'settings.json')
    settings = json.loads((RUNTIME / 'settings.json').read_text())
    domain = settings['domain']
    import re
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]+\.[a-z]{2,}', domain):
        raise ValueError('INVALID_DOMAIN')
    if not (Path('/var/lib/workspacex-selfhost-state/bootstrap-complete')).is_file():
        raise ValueError('INSTALL_SELFHOST_FIRST')
    if (POLICY / 'us.json').exists():
        raise ValueError('US_POLICY_EXISTS_REVIEW_BEFORE_REFRESH')
    for path in (POLICY, STATE):
        path.mkdir(parents=True, mode=0o700, exist_ok=True)
        reference_directory = path.stat()
        if reference_directory.st_uid != 0 or reference_directory.st_mode & 0o077 or path.is_symlink():
            raise ValueError('PRIVATE_ROOT_DIRECTORY_REQUIRED')
    if not LOCK.exists():
        raise ValueError('CANONICAL_INSTALLER_LOCK_REQUIRED')
    reference(LOCK)
    if LOCK.stat().st_mode & 0o777 != 0o600:
        raise ValueError('PRIVATE_CANONICAL_LOCK_REQUIRED')
    # A boot-persistent creation rule preserves the same lock inode while the machine runs.
    Path('/etc/tmpfiles.d/workspacex-us-release.conf').write_text('f /run/workspacex-selfhost-deploy.lock 0600 root root -\n')
    PROBE.write_text('''#!/bin/bash
set -euo pipefail
state=/var/lib/workspacex-selfhost-state
[[ ! -e $state/business-probe-uncertain ]] || exit 79
set +e
/usr/local/bin/workspacex-selfhost-business-probe
status=$?
set -e
if [[ $status == 79 ]]; then touch "$state/business-probe-uncertain"; fi
exit "$status"
''')
    PROBE.chmod(0o755)
    files = [RUNTIME / name for name in ('compose.json', 'compose.env', 'api.env', 'web.env', 'agent.env', 'probe.env')]
    files += [PROBE, Path('/usr/local/bin/workspacex-selfhost-business-probe')]
    pins = [reference(path) for path in files]
    # registryPrefix is already validated by the installer, then revalidated by the consumer.
    prefix = settings['registryPrefix']
    docker_config = Path('/root/.docker')
    reference(docker_config / 'config.json')
    (docker_config / 'config.json').chmod(0o600)
    config = dict(environment='us', registryPrefix=prefix, docker='/usr/bin/docker',
                  dockerConfig=str(docker_config), stateDirectory=str(STATE), lockFile=str(LOCK),
                  project='workspacex-selfhost', composeFiles=[pins[0]], envFile=pins[1],
                  services={'api':'api','web':'web','agent':'agent','sandbox':'sandbox','sandbox-sessions':'sandbox'},
                  health={'url':'https://' + domain + '/api/healthz','expected':{'trustworthy':True}},
                  verificationCommand=[str(PROBE)], verificationFiles=pins[2:], readinessTimeoutSeconds=120)
    path = POLICY / 'us.json'
    with path.open('x') as output:
        os.chmod(path, 0o600)
        json.dump(config, output, indent=2)
        output.write('\n')
    subprocess.run(['bash',str(Path(__file__).resolve().with_name('install-image-release.sh')),runner,'us'],check=True)
    print('US release consumer bound to the existing runtime. No application changes made.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
