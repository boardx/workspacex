#!/usr/bin/python3
"""One-instance, metadata-only diagnostic. Import is inert; no execution authority."""
import datetime
import hashlib
import http.client
import json
import os
import re
import signal
import socket
import stat
import sys
import urllib.parse
import urllib.request

TARGET = 'i-uf6ga92ewloganobbln6'
CANDIDATE = '41aa8271cd6d312af01ce5fece2b1c96f40b4e0f'
MAX_BODY = 1048576
MAX_OUTPUT = 16384
MAX_CODE_BYTES = 1048576
DEADLINE_SECONDS = 55
PROJECT = 'workspacex-cn'
SERVICES = ('api', 'web', 'agent', 'sandbox', 'sandbox-sessions')
CODE = ('/usr/local/bin/workspacex-cn-deploy',
        '/usr/local/bin/workspacex-cn-build-candidate',
        '/usr/local/bin/workspacex-cn-verify-promotion',
        '/usr/local/bin/workspacex-cn-export-source')
METADATA = ('/etc/nginx/conf.d/workspacex-cn.conf',
            '/opt/workspacex-cn/repository', '/var/lib/workspacex-cn/source-cache.git')
RUNTIME_FILES = ('compose.json', 'baseline.json', 'baseline-nginx.conf',
                 'prepare-receipt.json', 'fast-safe-release.json')
IMDS = 'http://100.100.100.200/latest/meta-data/instance-id'
HEALTH = 'http://127.0.0.1:3200/healthz'
FILTER = urllib.parse.quote(json.dumps({'label': ['com.docker.compose.project='+PROJECT]}, separators=(',', ':')))
CONTAINERS = '/v1.41/containers/json?all=1&filters='+FILTER

class Rejected(Exception):
    pass

def need(condition, code):
    if not condition:
        raise Rejected(code)

def decode(raw):
    def pairs(items):
        obj = {}
        for key, value in items:
            need(key not in obj, 'DUPLICATE_JSON_KEY')
            obj[key] = value
        return obj
    return json.loads(raw, object_pairs_hook=pairs)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Rejected('HTTP_REDIRECT')

class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(5)
        self.sock.connect('/run/docker.sock')

class Host:
    def get(self, url, limit):
        need(url in (IMDS, HEALTH), 'HTTP_TARGET')
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(urllib.request.Request(url, method='GET'), timeout=5) as response:
            need(response.status == 200, 'HTTP_STATUS')
            raw = response.read(limit+1)
            need(len(raw) <= limit, 'HTTP_BOUND')
            return raw

    def trusted(self, path):
        need(path.startswith('/') and '..' not in path.split('/'), 'PATH')
        current = '/'
        root = os.lstat(current)
        need(stat.S_ISDIR(root.st_mode) and root.st_uid == 0 and not root.st_mode & 0o022, 'UNTRUSTED_PARENT')
        for part in path.strip('/').split('/')[:-1]:
            current = os.path.join(current, part)
            info = os.lstat(current)
            need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, 'UNTRUSTED_PARENT')
        return os.lstat(path)

    def containers(self):
        before = self.trusted('/run/docker.sock')
        need(stat.S_ISSOCK(before.st_mode) and before.st_uid == 0 and not before.st_mode & 0o007, 'DOCKER_SOCKET')
        connection = UnixHTTP('localhost', timeout=5)
        try:
            # List metadata only. Never container/image inspect, exec, logs,
            # config, events, POST/DELETE, or any endpoint returning Config.Env.
            connection.request('GET', CONTAINERS)
            response = connection.getresponse()
            need(response.status == 200, 'DOCKER_STATUS')
            raw = response.read(MAX_BODY+1)
            need(len(raw) <= MAX_BODY, 'DOCKER_BOUND')
        finally:
            connection.close()
        after = self.trusted('/run/docker.sock')
        need((before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid) ==
             (after.st_dev, after.st_ino, after.st_mode, after.st_uid, after.st_gid), 'DOCKER_SOCKET_CHANGED')
        return decode(raw)

    def metadata(self, path, code=False):
        try:
            before = self.trusted(path)
            need(stat.S_ISREG(before.st_mode) or (not code and stat.S_ISDIR(before.st_mode)), 'FILE_TYPE')
            need(before.st_uid == 0 and not before.st_mode & 0o022 and before.st_nlink >= 1, 'FILE_AUTHORITY')
            result = dict(status='PRESENT', uid=before.st_uid, gid=before.st_gid,
                          mode=oct(stat.S_IMODE(before.st_mode)), bytes=before.st_size)
            if code:
                need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= MAX_CODE_BYTES, 'CODE_BOUND')
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    opened = os.fstat(fd)
                    need((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) ==
                         (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns), 'CODE_CHANGED')
                    digest = hashlib.sha256(); count = 0
                    while True:
                        chunk = os.read(fd, 65536)
                        if not chunk:
                            break
                        count += len(chunk); need(count <= MAX_CODE_BYTES, 'CODE_BOUND'); digest.update(chunk)
                    after = os.fstat(fd)
                    need(count == before.st_size and (after.st_size, after.st_mtime_ns, after.st_ctime_ns) ==
                         (before.st_size, before.st_mtime_ns, before.st_ctime_ns), 'CODE_CHANGED')
                    result['sha256'] = digest.hexdigest()
                finally:
                    os.close(fd)
            return result
        except FileNotFoundError:
            return dict(status='MISSING')
        except PermissionError:
            return dict(status='DENIED')
        except Rejected as error:
            return dict(status=str(error))


def inventory_pin(values):
    need(type(values) is list and len(values) <= 16, 'CONTAINER_COUNT')
    selected = []
    keys = ('com.docker.compose.project', 'com.docker.compose.service',
            'org.opencontainers.image.revision', 'com.docker.compose.project.config_files')
    for value in values:
        labels = value.get('Labels') or {}
        if labels.get('com.docker.compose.service') in SERVICES:
            selected.append(dict(Id=value.get('Id'), ImageID=value.get('ImageID'), State=value.get('State'),
                Names=value.get('Names'), labels={key: labels.get(key) for key in keys}))
    selected.sort(key=lambda value: str(value['Id']))
    return hashlib.sha256(json.dumps(selected, sort_keys=True).encode()).hexdigest()

def collect(host):
    result = dict(kind='cn-single-host-readonly-diagnostic-v1',
        observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        expectedInstance=TARGET, targetVerified=False, candidateFromVerifiedDevappLog=CANDIDATE,
        productionReady=False, productionAccepted=False, rollbackVerified=False,
        databaseChecked=False, approvalGranted=False, errors=[])
    # Non-credential IMDS GET only; no token PUT or credential metadata access.
    identity = host.get(IMDS, 128).decode('ascii').strip()
    need(identity == TARGET, 'WRONG_OR_UNVERIFIED_INSTANCE')
    result['targetVerified'] = True
    values = host.containers()
    need(type(values) is list and len(values) <= 16, 'CONTAINER_COUNT')
    rows = []; roots = set(); seen = set()
    for value in values:
        labels = value.get('Labels') or {}
        service = labels.get('com.docker.compose.service')
        if service not in SERVICES:
            continue
        need(labels.get('com.docker.compose.project') == PROJECT, 'CONTAINER_PROJECT')
        need(value.get('Names') == ['/'+PROJECT+'-'+service+'-1'] and service not in seen, 'CONTAINER_NAME_OR_DUPLICATE')
        seen.add(service)
        need(re.fullmatch('[a-f0-9]{64}', value.get('Id', '')) and
             re.fullmatch('sha256:[a-f0-9]{64}', value.get('ImageID', '')), 'CONTAINER_IDENTITY')
        row = dict(service=service, containerId=value['Id'], imageId=value['ImageID'], running=value.get('State') == 'running')
        revision = labels.get('org.opencontainers.image.revision', '')
        row['reportedRevision'] = revision if re.fullmatch('[a-f0-9]{40}', revision) else None
        # Do not emit raw labels, Command, Image/tag, Mounts, Ports or env.
        config = labels.get('com.docker.compose.project.config_files', '')
        match = re.fullmatch('/var/lib/workspacex-cn/runtime/([a-f0-9]{40})/compose.json', config)
        if match:
            roots.add(match[1])
        else:
            result['errors'].append('UNVERIFIED_RUNTIME_PATH')
        rows.append(row)
    if len(roots) != 1:
        result['errors'].append('RUNTIME_IDENTITY_UNPROVEN')
    result['containers'] = sorted(rows, key=lambda row: row['service'])
    result['requiredApplicationContainersPresentAndRunning'] = all(any(r['service'] == s and r['running'] for r in rows) for s in SERVICES[:4])
    result['reportedRuntimeDirectoryRevision'] = next(iter(roots)) if len(roots) == 1 and not result['errors'] else None
    result['code'] = {path: host.metadata(path, True) for path in CODE}
    result['pathMetadata'] = {path: host.metadata(path) for path in METADATA}
    if any(value.get('status') != 'PRESENT' for value in result['code'].values()):
        result['errors'].append('TRUSTED_ENTRYPOINTS_UNAVAILABLE')
    if any(value.get('status') != 'PRESENT' for value in result['pathMetadata'].values()):
        result['errors'].append('HOST_PATHS_UNAVAILABLE')
    # Stat only. Never open config/env, baseline JSON, receipts or secret files.
    result['runtimeFileMetadata'] = {}
    if result['reportedRuntimeDirectoryRevision']:
        base = '/var/lib/workspacex-cn/runtime/'+result['reportedRuntimeDirectoryRevision']+'/'
        result['runtimeFileMetadata'] = {name: host.metadata(base+name) for name in RUNTIME_FILES}
        if any(value.get('status') != 'PRESENT' for value in result['runtimeFileMetadata'].values()):
            result['errors'].append('ROLLBACK_METADATA_INCOMPLETE')
    try:
        health = decode(host.get(HEALTH, 65536))
        need(type(health) is dict, 'HEALTH_SHAPE')
        result['health'] = dict(httpStatus=200, trustworthy=health.get('trustworthy') is True)
        if not result['health']['trustworthy']:
            result['errors'].append('HEALTH_NOT_TRUSTWORTHY')
        marker = health.get('deploymentMarker')
        if type(marker) is str and re.fullmatch('[a-f0-9-]{36}', marker):
            result['health']['deploymentMarker'] = marker
    except Exception as error:
        if isinstance(error, Rejected) and str(error) == 'GLOBAL_DEADLINE':
            raise
        result['health'] = dict(status='UNAVAILABLE_OR_REJECTED')
        result['errors'].append('HEALTH_UNAVAILABLE')
    need(inventory_pin(values) == inventory_pin(host.containers()), 'DOCKER_INVENTORY_CHANGED')
    result['status'] = 'OBSERVED' if result['requiredApplicationContainersPresentAndRunning'] and not result['errors'] else 'PARTIAL'
    return result


def encode(value):
    raw = (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()
    need(len(raw) <= MAX_OUTPUT, 'OUTPUT_BOUND')
    return raw


def main():
    def deadline(*args):
        raise Rejected('GLOBAL_DEADLINE')
    signal.signal(signal.SIGALRM, deadline)
    signal.setitimer(signal.ITIMER_REAL, DEADLINE_SECONDS)
    try:
        need(len(sys.argv) == 1, 'NO_ARGUMENTS_ALLOWED')
        result = collect(Host()); raw = encode(result)
        status = 0 if result['status'] == 'OBSERVED' else 2
    except Exception as error:
        code = str(error) if isinstance(error, Rejected) else type(error).__name__
        raw = encode(dict(kind='cn-single-host-readonly-diagnostic-v1', status='REJECTED',
            errorCode=code, productionReady=False, productionAccepted=False))
        status = 2
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    sys.stdout.buffer.write(raw)
    return status

if __name__ == '__main__':
    sys.exit(main())
