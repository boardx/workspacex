#!/usr/bin/env python3
"""Bounded read-only host permissions report. Never emits credentials or elevates."""
import grp
import http.client
import json
import os
import pwd
import re
import socket
import stat
import subprocess
import sys

PATHS = ('/run/docker.sock', '/var/lib/workspacex-cn/runtime',
         '/var/lib/workspacex-cn/runtime/release.lock',
         '/etc/workspacex-image-release', '/usr/local/bin/workspacex-image-release')
ENTRIES = ('/usr/local/bin/workspacex-image-release', '/usr/local/bin/workspacex-cn-deploy')
DEVAPP_PROJECTS = frozenset(('workspacex', 'workspacex-devapp', 'devapp', 'wsx-devapp'))
DOCKER_READ_LIMIT = 1048576
API_FLAGS = ('ENABLE_AIDT_MODULE', 'ENABLE_PROJECT_MEMBER_CHAT')

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

class DockerReadError(Exception):
    pass

def docker_json(path):
    """Only the fixed list or a validated container ID can reach this GET-only reader."""
    if path != '/containers/json' and not re.fullmatch(r'/containers/[a-f0-9]{64}/json', path):
        raise DockerReadError('INVALID_READ_PATH')
    connection = DockerHTTP('localhost', timeout=5)
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        if response.status != 200:
            raise DockerReadError('HTTP_REJECTED')
        raw = response.read(DOCKER_READ_LIMIT + 1)
        if len(raw) > DOCKER_READ_LIMIT:
            raise DockerReadError('OUTPUT_BOUND')
        return json.loads(raw)
    except DockerReadError:
        raise
    except Exception:
        raise DockerReadError('READ_UNAVAILABLE') from None
    finally:
        connection.close()

def safe_compose_label(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,62}', value) else None

def flag_state(environment, name):
    matches = [entry for entry in environment if entry.partition('=')[0] == name]
    if not matches:
        return 'unset'
    if len(matches) > 1:
        return 'duplicate'
    _, separator, value = matches[0].partition('=')
    if separator and value in ('1', 'true'):
        return 'enabled'
    if separator and value in ('0', 'false'):
        return 'disabled'
    return 'invalid'

def aidt_readiness():
    """Optional DevApp metadata only: never emit names, environment values or host policy."""
    result = dict(status='UNKNOWN', containers=[], truncated=False,
                  api=dict(status='UNKNOWN', reason='NOT_OBSERVED'))
    try:
        items = docker_json('/containers/json')
        if not isinstance(items, list) or len(items) > 1024:
            raise DockerReadError('INVALID_LIST')
        summaries, candidates = [], []
        for item in items:
            if not isinstance(item, dict):
                raise DockerReadError('INVALID_LIST')
            labels = item.get('Labels') or {}
            if not isinstance(labels, dict):
                raise DockerReadError('INVALID_LABELS')
            project = safe_compose_label(labels.get('com.docker.compose.project'))
            service = safe_compose_label(labels.get('com.docker.compose.service'))
            source = labels.get('org.opencontainers.image.revision')
            source = source if isinstance(source, str) and re.fullmatch(r'[a-f0-9]{40}', source) else None
            if project in DEVAPP_PROJECTS:
                summaries.append(dict(project=project, service=service, sourceRevision=source))
            if project in DEVAPP_PROJECTS and service == 'api':
                candidates.append((item.get('Id'), project))
        result.update(status='READABLE', containers=summaries[:20], truncated=len(summaries) > 20)
        if len(candidates) != 1:
            result['api']['reason'] = 'NO_UNIQUE_API'
            return result
        identifier, project = candidates[0]
        if not isinstance(identifier, str) or not re.fullmatch(r'[a-f0-9]{64}', identifier):
            result['api']['reason'] = 'INVALID_API_ID'
            return result
        detail = docker_json('/containers/' + identifier + '/json')
        if not isinstance(detail, dict) or detail.get('Id') != identifier:
            raise DockerReadError('API_BINDING_CHANGED')
        config = detail.get('Config')
        labels = config.get('Labels') if isinstance(config, dict) else None
        if not isinstance(labels, dict) or labels.get('com.docker.compose.project') != project or labels.get('com.docker.compose.service') != 'api':
            raise DockerReadError('API_BINDING_CHANGED')
        if not isinstance(detail.get('State'), dict) or detail['State'].get('Running') is not True:
            raise DockerReadError('API_NOT_RUNNING')
        environment = config.get('Env')
        if environment is None:
            environment = []
        if not isinstance(environment, list) or not all(isinstance(entry, str) for entry in environment):
            raise DockerReadError('INVALID_ENVIRONMENT')
        result['api'] = dict(status='OBSERVED', aidtModule=flag_state(environment, API_FLAGS[0]),
                             memberChat=flag_state(environment, API_FLAGS[1]))
    except DockerReadError as error:
        safe_errors = ('INVALID_READ_PATH', 'HTTP_REJECTED', 'OUTPUT_BOUND', 'READ_UNAVAILABLE',
                       'INVALID_LIST', 'INVALID_LABELS', 'INVALID_API_ID', 'API_BINDING_CHANGED',
                       'API_NOT_RUNNING', 'INVALID_ENVIRONMENT')
        code = error.args[0] if error.args and error.args[0] in safe_errors else 'READ_UNAVAILABLE'
        result['api'] = dict(status='UNKNOWN', reason=code)
    except Exception:
        result['api'] = dict(status='UNKNOWN', reason='READ_UNAVAILABLE')
    return result

def collect():
    identity = pwd.getpwuid(os.geteuid())
    groups = sorted(set(os.getgroups() + [identity.pw_gid]))
    result = dict(kind='image-release-host-permissions-v1',
                  account=dict(name=identity.pw_name, uid=os.geteuid(), gid=os.getegid(),
                               groups=[dict(gid=g, name=grp.getgrgid(g).gr_name) for g in groups]),
                  paths={path: metadata(path) for path in PATHS}, docker=containers(),
                  changesMade=False)
    if os.environ.get('TARGET_ENVIRONMENT') == 'devapp':
        result['aidtReadiness'] = aidt_readiness()
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
