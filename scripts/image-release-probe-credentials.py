#!/usr/bin/env python3
"""Human-operated setup of existing application credentials; never changes accounts.

This root-only helper is intentionally absent from runner sudo rules. The human
enters their existing credentials on the server TTY, after authorizing storage.
Only login and a read-only notifications request are sent to the fixed origin.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import socket
import stat
import sys
import tempfile
import urllib.error
import urllib.request

ENVIRONMENTS = {
    'cn': ('workspacex-cn-prod', 'https://app.boardx.com.cn'),
    'devapp': ('iZrj94o0jq479xfhoa83xoZ', 'https://devapp.boardx.us'),
}
ROOT = Path('/etc/workspacex-image-release')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('LOGIN_REDIRECT_REJECTED')


def verify_login(origin, email, password):
    if origin not in {entry[1] for entry in ENVIRONMENTS.values()}:
        raise ValueError('LOGIN_ORIGIN_REJECTED')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    phase = 'LOGIN'
    try:
        request = urllib.request.Request(origin + '/api/auth/login',
            data=json.dumps({'email': email, 'password': password}).encode(),
            headers={'Content-Type': 'application/json'}, method='POST')
        with opener.open(request, timeout=20) as response:
            if response.status != 200:
                raise ValueError()
            raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError()
            token = json.loads(raw).get('sessionToken')
            if not isinstance(token, str) or not token or any(ord(c) < 32 or ord(c) == 127 for c in token):
                raise ValueError()
        phase = 'NOTIFICATIONS'
        request = urllib.request.Request(origin + '/api/notifications',
            headers={'Authorization': 'Bearer ' + token})
        with opener.open(request, timeout=20) as response:
            raw = response.read(1048577)
            if response.status != 200 or len(raw) > 1048576:
                raise ValueError()
            payload = json.loads(raw)
            count = payload.get('unreadCount')
            if not isinstance(payload.get('notifications'), list) or type(count) is not int or count < 0:
                raise ValueError()
    except urllib.error.HTTPError as error:
        # Only bounded numeric status, never URL, response body or provider error.
        code = error.code if type(error.code) is int and 100 <= error.code <= 599 else 0
        raise ValueError(phase + '_HTTP_' + str(code)) from None
    except Exception:
        raise ValueError(phase + '_REJECTED') from None


def configure(environment, email, password, destination):
    if environment not in ENVIRONMENTS:
        raise ValueError('ENVIRONMENT_REJECTED')
    if not all(isinstance(v, str) and v and len(v) <= 4096 and
               not any(ord(c) < 32 or ord(c) == 127 for c in v) for v in (email, password)):
        raise ValueError('CREDENTIAL_FORMAT_REJECTED')
    destination = Path(destination)
    if os.path.lexists(destination):
        raise FileExistsError('CREDENTIAL_FILE_ALREADY_EXISTS')
    verify_login(ENVIRONMENTS[environment][1], email, password)
    fd, temporary = tempfile.mkstemp(prefix='.probe-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            # Literal first-'=' reader only; never shell-source or dotenv-load this file.
            stream.write('PROVISION_ADMIN_EMAIL=' + email + '\nPROVISION_ADMIN_PASSWORD=' + password + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        # Atomic publication with no overwrite, including a concurrent symlink.
        os.link(temporary, destination)
    finally:
        os.unlink(temporary)
    directory = os.open(destination.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def protected_directory(path):
    for parent in [*reversed(path.parents), path]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('UNTRUSTED_CONFIGURATION_DIRECTORY')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('environment', choices=ENVIRONMENTS)
    args = parser.parse_args()
    if os.geteuid() != 0 or not sys.stdin.isatty() or socket.gethostname() != ENVIRONMENTS[args.environment][0]:
        raise ValueError('EXPECTED_HOST_ROOT_TTY_REQUIRED')
    protected_directory(ROOT.parent)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    protected_directory(ROOT)
    destination = ROOT / (args.environment + '-browser.env')
    if os.path.lexists(destination):
        raise FileExistsError('CREDENTIAL_FILE_ALREADY_EXISTS')
    print('Enter the existing APPLICATION login. This does not change its password.')
    print('After login verification, credentials will be saved root-only at ' + str(destination))
    email = input('Application email: ').strip()
    password = getpass.getpass('Existing application password (hidden): ')
    configure(args.environment, email, password, destination)
    print('EXISTING_APPLICATION_PROBE_CREDENTIALS_SAVED')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, EOFError):
        print('CREDENTIAL_SETUP_CANCELLED', file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print('CREDENTIAL_SETUP_FAILED_NO_SECRET_OUTPUT', file=sys.stderr)
        raise SystemExit(1)
