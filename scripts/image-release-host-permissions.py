#!/usr/bin/env python3
"""Bounded read-only host permissions report. Never reads credentials or elevates."""
import grp
import http.client
import json
import os
import pwd
import socket
import stat
import subprocess
import sys

PATHS = ('/run/docker.sock', '/var/lib/workspacex-cn/runtime',
         '/var/lib/workspacex-cn/runtime/release.lock',
         '/etc/workspacex-image-release', '/usr/local/bin/workspacex-image-release')
ENTRIES = ('/usr/local/bin/workspacex-image-release', '/usr/local/bin/workspacex-cn-deploy')

def metadata(path):
    try:
        info = os.lstat(path)
        return dict(status='PRESENT', uid=info.st_uid, gid=info.st_gid,
                    mode=oct(stat.S_IMODE(info.st_mode)),
                    readable=os.access(path, os.R_OK), writable=os.access(path, os.W_OK),
                    searchable=os.access(path, os.X_OK), symlink=stat.S_ISLNK(info.st_mode))
    except OSError as error:
        return dict(status=type(error).__name__, errno=error.errno)

class DockerHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect('/run/docker.sock')

def containers():
    connection = DockerHTTP('localhost', timeout=5)
    try:
        connection.request('GET', '/containers/json')
        response = connection.getresponse()
        if response.status != 200:
            return dict(status='HTTP_REJECTED', httpStatus=response.status)
        raw = response.read(1048577)
        if len(raw) > 1048576:
            return dict(status='OUTPUT_BOUND')
        rows = []
        for item in json.loads(raw):
            labels = item.get('Labels') or {}
            if labels.get('com.docker.compose.project') not in ('workspacex', 'workspacex-cn'):
                continue
            rows.append({key: labels.get('com.docker.compose.' + key) for key in
                         ('project', 'service', 'project.config_files', 'project.working_dir')})
        return dict(status='READABLE', containers=rows[:20])
    except OSError as error:
        return dict(status=type(error).__name__, errno=error.errno, resource='/run/docker.sock')
    except Exception as error:
        return dict(status=type(error).__name__)
    finally:
        connection.close()

def collect():
    identity = pwd.getpwuid(os.geteuid())
    groups = sorted(set(os.getgroups() + [identity.pw_gid]))
    result = dict(kind='image-release-host-permissions-v1',
                  account=dict(name=identity.pw_name, uid=os.geteuid(), gid=os.getegid(),
                               groups=[dict(gid=g, name=grp.getgrgid(g).gr_name) for g in groups]),
                  paths={path: metadata(path) for path in PATHS}, docker=containers(),
                  changesMade=False)
    try:
        checked = subprocess.run(['/usr/bin/sudo', '-n', '-l'], capture_output=True, text=True, timeout=10)
        # Never emit the raw policy: summarize only fixed release entry mentions.
        result['sudo'] = dict(exitCode=checked.returncode,
                              entryMentioned={path: path in checked.stdout for path in ENTRIES})
    except (OSError, subprocess.TimeoutExpired) as error:
        result['sudo'] = dict(status=type(error).__name__)
    return result

if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('NO_ARGUMENTS_ALLOWED')
    print(json.dumps(collect(), sort_keys=True))
