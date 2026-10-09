"""Credential-free OSS SDK v1 adapter. Callers supply an independently authorized Bucket.
No CLI, credential lookup, upload dispatch, Docker, deletion or installation is provided.
"""
from contextlib import ExitStack
import hashlib
import copy
import io
import os
from pathlib import Path
import stat
import signal
import shutil
import threading
import tempfile
import time

import cn_image_archive as c

CHUNK = 1024 * 1024
PART = 16 * CHUNK


def directory_fd(path):
    path = Path(path)
    c.require(path.is_absolute(), 'ABSOLUTE_DIRECTORY_REQUIRED')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            c.require(part not in ('.', '..'), 'DIRECTORY_PATH_INVALID')
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        return fd
    except BaseException:
        os.close(fd); raise


def bounded(operation):
    def invoke(self, *args, **kwargs):
        c.require(threading.current_thread() is threading.main_thread() and signal.getitimer(signal.ITIMER_REAL)[0] == 0,
                  'EXCLUSIVE_MAIN_THREAD_TIMER_REQUIRED')
        previous = signal.getsignal(signal.SIGALRM)
        def expired(*_): raise TransferTimeout()
        signal.signal(signal.SIGALRM, expired)
        try:
            self.check(); signal.setitimer(signal.ITIMER_REAL, max(0.001, self.deadline - time.monotonic()))
            try:
                return operation(self, *args, **kwargs)
            except TransferTimeout:
                raise c.Rejected('TRANSFER_DEADLINE') from None
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, previous)
    return invoke


def private_file(directory_fd, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    stream = os.fdopen(fd, 'rb')
    st = os.fstat(fd)
    if not (stat.S_ISREG(st.st_mode) and st.st_nlink == 1):
        stream.close(); raise c.Rejected('TRANSFER_FILE_TRUST')
    return stream


class TransferTimeout(BaseException):
    pass


class OssSdkPort:
    """Only wraps official oss2.Bucket; authentication is outside this module.

    An independently collected principal must be supplied, not guessed from SDK auth.
    Versioning MUST be disabled: OSS ignores forbid-overwrite in versioned buckets.
    A concurrent versioning change is outside this contract and requires a policy fence.
    """
    def __init__(self, bucket, principal, region):
        self.bucket = bucket; self.principal = principal; self.region = region

    def bind(self, transport, operation):
        c.require(self.bucket.bucket_name == transport['bucket'] and
                  self.bucket.endpoint.rstrip('/') == transport['endpoint'] and self.region == transport['region'] and
                  self.principal == transport[operation + 'Principal'], 'SDK_TARGET_IDENTITY')
        c.require(type(self.bucket.timeout) in (int, float) and 0 < self.bucket.timeout <= 10, 'SDK_TIMEOUT_REQUIRED')
        result = self.bucket.get_bucket_versioning()
        c.require(result.status is None, 'VERSIONING_MUST_BE_DISABLED')

    def get(self, key, version):
        c.require(version == '', 'UNVERSIONED_OBJECT_REQUIRED')
        return self.bucket.get_object(key)

    def put(self, key, stream, size, check):
        headers = {'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private'}
        if size <= PART:
            check(); self.bucket.put_object(key, stream, headers=headers); return
        # Deliberately no automatic abort/delete: interrupted multipart IDs require review.
        from oss2.models import PartInfo
        check(); upload = self.bucket.init_multipart_upload(key, headers=headers).upload_id
        parts = []; remaining = size
        while remaining:
            check(); raw = stream.read(min(PART, remaining))
            c.require(len(raw) == min(PART, remaining), 'UPLOAD_SOURCE_TRUNCATED')
            number = len(parts) + 1
            result = self.bucket.upload_part(key, upload, number, io.BytesIO(raw))
            parts.append(PartInfo(number, result.etag)); remaining -= len(raw)
        check(); self.bucket.complete_multipart_upload(key, upload, parts, headers=headers)

    @staticmethod
    def missing(error):
        return getattr(error, 'status', None) == 404 and getattr(error, 'code', None) == 'NoSuchKey'


class Transfer:
    def __init__(self, port, build, transport, manifest_raw, manifest_sha, approval, max_seconds=1200):
        c.require(type(max_seconds) is int and 0 < max_seconds <= 1200, 'TRANSFER_DEADLINE_INVALID')
        self.deadline = time.monotonic() + max_seconds
        self.port = port; self.build = copy.deepcopy(c.validate_plan(build))
        c.require(len(manifest_raw) <= 256 * 1024 and c.sha(manifest_raw) == manifest_sha, 'ARCHIVE_SET_HASH_MISMATCH')
        self.raw = manifest_raw; self.manifest = c.decode(manifest_raw); self.manifest_sha = manifest_sha
        c.require(type(self.manifest) is dict and type(self.manifest.get('images')) is dict and
                  set(self.manifest['images']) == set(c.REPOSITORIES), 'COMPLETE_FIVE_IMAGES_REQUIRED')
        c.validate_transport(transport, self.manifest, manifest_sha)
        c.require(all(x['versionId'] == '' for x in transport['objects'].values()), 'UNVERSIONED_OBJECT_REQUIRED')
        c.require(transport['prefix'] == 'cn-image-archives/' + build['sourceRevision'] + '/' + build['attemptId'] + '/', 'TRANSFER_ATTEMPT_PREFIX')
        c.require(all(x['key'] == transport['prefix'] + name for name, x in transport['objects'].items()), 'TRANSFER_EXACT_KEY')
        fields = {'schemaVersion', 'receiptKind', 'planSha256', 'producedAt', 'expiresAt', 'images', 'ready', 'prepared', 'productionActivated', 'sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform'}
        c.require(set(self.manifest) == fields and type(self.manifest['schemaVersion']) is int and self.manifest['schemaVersion'] == 1
                  and self.manifest['receiptKind'] == 'cn-image-archive-set-v1'
                  and self.manifest['planSha256'] == c.sha(c.json_bytes(build)), 'TRANSFER_MANIFEST_FIELDS')
        c.require(all(self.manifest[k] == build[k] for k in ('sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform'))
                  and all(self.manifest[k] is False for k in ('ready', 'prepared', 'productionActivated')), 'TRANSFER_MANIFEST_IDENTITY')
        issued = c.timestamp(self.manifest['producedAt']); expiry = c.timestamp(self.manifest['expiresAt'])
        c.require(0 < (expiry - issued).total_seconds() <= 3600, 'ARCHIVE_SET_EXPIRED')
        total = 0
        for service, entry in self.manifest['images'].items():
            c.require(type(entry) is dict and set(entry) == {'file', 'size', 'sha256', 'configSha256', 'imageId', 'layers', 'stagingTag'}
                      and entry['file'] == service + '.tar' and type(entry['size']) is int
                      and 0 < entry['size'] <= build['maxArchiveBytes'] and c.hex_string(entry['sha256'], 64), 'TRANSFER_ENTRY_INVALID')
            total += entry['size']
        c.require(total <= build['maxTotalBytes'], 'ARCHIVE_TOTAL_LIMIT')
        expected = dict(schemaVersion=1, transferAuthorized=True, sourceRevision=build['sourceRevision'],
                        controlRevision=build['controlRevision'], attemptId=build['attemptId'], archiveSetSha256=manifest_sha,
                        transportSha256=c.sha(c.json_bytes(transport)))
        c.require(type(approval) is dict and set(approval) == set(expected) | {'operation', 'observedAt', 'expiresAt', 'versioningFenceProofSha256'}
                  and all(approval[k] == v and type(approval[k]) is type(v) for k,v in expected.items())
                  and approval['operation'] in ('upload', 'download')
                  and c.hex_string(approval['versioningFenceProofSha256'], 64), 'TRANSFER_APPROVAL_REQUIRED')
        c.require(0 < (c.timestamp(approval['expiresAt']) - c.timestamp(approval['observedAt'])).total_seconds() <= 3600,
                  'TRANSFER_APPROVAL_EXPIRED')
        self.approval = copy.deepcopy(approval); self.total = total
        self.transport = copy.deepcopy(transport)
        self.check()

    def check(self):
        c.require(time.monotonic() < self.deadline, 'TRANSFER_DEADLINE')
        c.require(c.timestamp(self.approval['observedAt']) <= c.datetime.now(c.timezone.utc) < c.timestamp(self.approval['expiresAt']), 'TRANSFER_APPROVAL_EXPIRED')
        c.require(c.timestamp(self.manifest['producedAt']) <= c.datetime.now(c.timezone.utc) < c.timestamp(self.manifest['expiresAt']), 'ARCHIVE_SET_EXPIRED')

    def size(self, name):
        return len(self.raw) if name == 'archive-set.json' else self.manifest['images'][name[:-4]]['size']

    def readback(self, name, target=None):
        self.check(); item = self.transport['objects'][name]
        response = self.port.get(item['key'], item['versionId'])
        try:
            c.require(response.headers.get('x-oss-version-id', '') in ('', 'null'), 'REMOTE_VERSION_MISMATCH')
            h = hashlib.sha256(); total = 0
            while True:
                self.check(); raw = response.read(min(CHUNK, self.size(name) - total + 1))
                if not raw: break
                total += len(raw); c.require(total <= self.size(name), 'REMOTE_SIZE_LIMIT'); h.update(raw)
                if target is not None: target.write(raw)
            self.check()
            c.require(total == self.size(name) and h.hexdigest() == item['sha256'], 'REMOTE_CONTENT_MISMATCH')
        finally:
            response.close()

    @bounded
    def upload(self, bundle):
        c.require(self.approval['operation'] == 'upload', 'TRANSFER_OPERATION_UNAPPROVED')
        c.require(shutil.disk_usage(tempfile.gettempdir()).free >= self.total + self.build['storageMarginBytes'], 'TRANSFER_CAPACITY')
        c.require(os.statvfs(tempfile.gettempdir()).f_favail >= 4096, 'TRANSFER_INODE_CAPACITY')
        self.check()
        directory = directory_fd(bundle)
        try:
            with ExitStack() as stack, tempfile.TemporaryDirectory(prefix='wsx-oss-snapshot-') as tmp:
                snapshot = Path(tmp)
                # Snapshot pinned files; validate all Docker-save bytes before any remote write.
                for name in self.transport['objects']:
                    source = stack.enter_context(private_file(directory, name))
                    before = os.fstat(source.fileno())
                    with (snapshot / name).open('xb') as out:
                        total = 0
                        while True:
                            self.check(); raw = source.read(CHUNK)
                            if not raw: break
                            total += len(raw); c.require(total <= self.size(name), 'SOURCE_SIZE_LIMIT'); out.write(raw)
                    after = os.fstat(source.fileno())
                    c.require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                              (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'SOURCE_CHANGED')
                c.require((snapshot / 'archive-set.json').read_bytes() == self.raw, 'SOURCE_MANIFEST_MISMATCH')
                c.validate_set(snapshot, self.raw, self.manifest_sha, self.build)
                self.check(); self.port.bind(self.transport, 'upload'); self.check()
                # Manifest is completion marker, published only after five complete readbacks.
                names = [service + '.tar' for service in c.REPOSITORIES] + ['archive-set.json']
                missing = []
                for name in names:
                    try: self.readback(name)
                    except Exception as error:
                        if not self.port.missing(error): raise
                        missing.append(name)
                c.require('archive-set.json' in missing or not missing, 'REMOTE_COMPLETION_INCOMPLETE')
                for name in missing:
                    self.check()
                    with (snapshot / name).open('rb') as source:
                        try: self.port.put(self.transport['objects'][name]['key'], source, self.size(name), self.check)
                        except Exception:
                            # Lost acknowledgement or a racing writer: exact readback only, no second PUT.
                            self.readback(name)
                    self.readback(name)
                return self.receipt()
        finally:
            os.close(directory)

    @bounded
    def download(self, parent, name):
        c.require(self.approval['operation'] == 'download', 'TRANSFER_OPERATION_UNAPPROVED')
        c.require(shutil.disk_usage(parent).free >= self.total + self.build['storageMarginBytes'], 'TRANSFER_CAPACITY')
        c.require(isinstance(name, str) and c.re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', name), 'DOWNLOAD_NAME_INVALID')
        c.require(os.statvfs(parent).f_favail >= 4096, 'TRANSFER_INODE_CAPACITY')
        self.check()
        parent_fd = directory_fd(parent)
        pending = '.pending-' + os.urandom(12).hex()
        try:
            st = os.fstat(parent_fd)
            c.require(st.st_uid == os.geteuid() and not st.st_mode & 0o022, 'DOWNLOAD_PARENT_TRUST')
            self.port.bind(self.transport, 'download'); self.check()
            os.mkdir(pending, mode=0o700, dir_fd=parent_fd)
            work_fd = os.open(pending, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
            try:
                for file in ['archive-set.json'] + [s + '.tar' for s in c.REPOSITORIES]:
                    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=work_fd)
                    with os.fdopen(fd, 'wb') as out:
                        self.readback(file, out); out.flush(); os.fsync(out.fileno())
                c.validate_set(Path('/proc/self/fd') / str(work_fd), self.raw, self.manifest_sha, self.build)
                # No-replace directory publication; libc interface is already the importer's contract.
                self.check(); os.fsync(work_fd)
                import ctypes
                libc = ctypes.CDLL(None, use_errno=True)
                self.check()
                result = libc.renameat2(parent_fd, os.fsencode(pending), parent_fd, os.fsencode(name), 1)
                c.require(result == 0, 'DOWNLOAD_DESTINATION_COLLISION')
                os.fsync(parent_fd)
                return self.receipt()
            finally:
                os.close(work_fd)
        finally:
            # Only our private pending directory; never delete published objects or destinations.
            try:
                fd = os.open(pending, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
                try:
                    for file in os.listdir(fd): os.unlink(file, dir_fd=fd)
                finally: os.close(fd)
                os.rmdir(pending, dir_fd=parent_fd)
            except FileNotFoundError: pass
            os.close(parent_fd)

    def receipt(self):
        self.check()
        return dict(schemaVersion=1, receiptKind='cn-archive-transfer-v1', archiveSetSha256=self.manifest_sha,
                    sourceRevision=self.build['sourceRevision'], controlRevision=self.build['controlRevision'],
                    attemptId=self.build['attemptId'], transport=copy.deepcopy(self.transport),
                    authenticatedPrincipalProven=False,
                    ready=False, prepared=False, productionActivated=False)
