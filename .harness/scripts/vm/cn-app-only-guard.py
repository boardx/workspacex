#!/usr/bin/python3
"""Read-only check of a pre-staged control/tool closure; never installs or repairs."""
import os
import re
import stat
import subprocess
import sys


def check(root, revision):
    assert re.fullmatch('[a-f0-9]{40}', revision)
    assert root in ('/opt/workspacex-cn/app-only-tools/' + revision,
                    '/var/lib/workspacex-cn/releases/' + revision)
    current = root
    while True:
        info = os.lstat(current)
        assert stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
        if current == '/':
            break
        current = os.path.dirname(current)
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            path = os.path.join(directory, name)
            info = os.lstat(path)
            assert info.st_uid == 0
            if stat.S_ISLNK(info.st_mode):
                assert os.path.exists(path) and os.path.realpath(path).startswith(root + '/')
            else:
                assert not info.st_mode & 0o022
    assert os.path.isdir(root + '/.git') and not os.path.islink(root + '/.git')
    for name in ('alternates', 'http-alternates'):
        assert not os.path.lexists(root + '/.git/objects/info/' + name)
    assert not any(name.endswith('.promisor') for _, _, files in os.walk(root + '/.git/objects') for name in files)
    env = {'PATH': '/usr/bin:/bin', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_NO_LAZY_FETCH': '1', 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_CONFIG_COUNT': '1',
           'GIT_CONFIG_KEY_0': 'safe.directory', 'GIT_CONFIG_VALUE_0': root}
    def git(*args):
        return subprocess.check_output(['/usr/bin/git', '--no-optional-locks', '-C', root, *args],
                                       env=env, text=True, timeout=30, stderr=subprocess.DEVNULL).strip()
    assert git('rev-parse', 'HEAD') == revision and not git('status', '--porcelain', '--untracked-files=no')


if __name__ == '__main__':
    try:
        assert len(sys.argv) == 3
        check(*sys.argv[1:])
    except Exception:
        print('CN_APP_ONLY_TOOLS_UNAVAILABLE', file=sys.stderr)
        sys.exit(2)
