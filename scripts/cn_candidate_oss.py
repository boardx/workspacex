"""Candidate v2 byte-preserving OSS transfer; no credentials, CLI or cloud dispatch.

The caller supplies independently authorized bucket/principals and a real fence
proof. Hash fields bind that evidence; this library does not authenticate it.
"""
from contextlib import ExitStack
import copy
import os
from pathlib import Path
import shutil
import tempfile
import time
import cn_image_archive as c
import cn_image_candidate as candidate
import cn_archive_oss as oss
from cn_archive_oss import bounded, directory_fd, private_file, CHUNK

PLAN = 'candidate-plan.json'
SET = 'candidate-set.json'


class CandidateTransfer(oss.Transfer):
    """Reuses bounded readback and SDK ports, never the v1 protocol admission."""
    def __init__(self, port, plan_raw, plan_sha, set_raw, set_sha, transport, approval, max_seconds=1200, *, revalidation=None):
        c.require(type(plan_raw) is bytes and len(plan_raw) <= 16384 and c.sha(plan_raw) == plan_sha,
                  'CANDIDATE_PLAN_RAW_HASH')
        self.build = copy.deepcopy(candidate.validate_plan(c.decode(plan_raw)))
        self.plan_raw = plan_raw; self.plan_sha = plan_sha
        self.revalidation = revalidation
        self.manifest = (candidate.validate_receipt(set_raw, self.build, set_sha) if revalidation is None else
                         revalidation.check(self.build, set_raw, set_sha, plan_sha))
        c.require(self.manifest['planRawSha256'] == plan_sha, 'CANDIDATE_ORIGINAL_PLAN_BINDING')
        c.require(set(self.manifest['images']) == set(c.REPOSITORIES), 'CANDIDATE_COMPLETE_FIVE')
        self.raw = set_raw; self.manifest_sha = set_sha
        self.total = 0
        for service, entry in self.manifest['images'].items():
            c.require(type(entry) is dict and set(entry) == {'file','size','sha256','configSha256','imageId','layers','stagingTag'}
                      and entry['file'] == service + '.tar' and type(entry['size']) is int
                      and 0 < entry['size'] <= self.build['maxArchiveBytes'] and c.hex_string(entry['sha256'],64),
                      'CANDIDATE_TRANSFER_ENTRY')
            self.total += entry['size']
        c.require(self.total <= self.build['maxTotalBytes'], 'CANDIDATE_TOTAL')
        self.total += len(plan_raw) + len(set_raw)
        fields = {'kind','bucket','region','endpoint','prefix','uploadPrincipal','downloadPrincipal','objects'}
        c.require(type(transport) is dict and set(transport) == fields
                  and transport['kind'] == 'approved-candidate-oss-staging-v2', 'CANDIDATE_TRANSPORT_FIELDS')
        for key in ('bucket','region','prefix','uploadPrincipal','downloadPrincipal'):
            c.require(isinstance(transport[key],str) and 0 < len(transport[key]) <= 512
                      and not any(ord(x) < 32 for x in transport[key]), 'TRANSPORT_FIELD_INVALID')
        c.require(c.re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',transport['bucket'])
                  and transport['region'] == 'cn-shanghai'
                  and transport['endpoint'] == 'https://oss-cn-shanghai.aliyuncs.com', 'CANDIDATE_TRANSPORT_TARGET')
        prefix = 'cn-image-candidates/' + self.build['sourceRevision'] + '/' + self.build['attemptId'] + '/'
        c.require(transport['prefix'] == prefix, 'TRANSFER_ATTEMPT_PREFIX')
        hashes = {PLAN: plan_sha, SET: set_sha, **{s+'.tar':e['sha256'] for s,e in self.manifest['images'].items()}}
        c.require(type(transport['objects']) is dict and set(transport['objects']) == set(hashes), 'TRANSPORT_OBJECT_SET')
        for name, sha in hashes.items():
            c.require(transport['objects'][name] == {'key':prefix+name,'versionId':'','sha256':sha}, 'TRANSPORT_OBJECT_BINDING')
        expected = dict(schemaVersion=2, transferAuthorized=True,
                        candidatePlanRawSha256=plan_sha, candidateSetRawSha256=set_sha,
                        candidateIdentity=self.manifest['identity'],
                        **{k:self.build[k] for k in ('sourceRevision','controlRevision','attemptId')},
                        transportSha256=c.sha(c.json_bytes(transport)))
        if revalidation is not None: expected['revalidationRawSha256'] = revalidation.sha
        c.require(type(approval) is dict and set(approval) == set(expected)|{'operation','observedAt','expiresAt','versioningFenceProofSha256'}
                  and all(type(approval[k]) is type(v) and approval[k] == v for k,v in expected.items())
                  and approval['operation'] in ('upload','download')
                  and c.hex_string(approval['versioningFenceProofSha256'],64), 'TRANSFER_APPROVAL_REQUIRED')
        c.require(0 < (c.timestamp(approval['expiresAt'])-c.timestamp(approval['observedAt'])).total_seconds() <= 3600,
                  'TRANSFER_APPROVAL_EXPIRED')
        c.require(type(max_seconds) is int and 0 < max_seconds <= 1200, 'TRANSFER_DEADLINE_INVALID')
        self.deadline = time.monotonic() + max_seconds
        self.port = port; self.transport = copy.deepcopy(transport); self.approval = copy.deepcopy(approval)
        self.check()

    def check(self):
        if self.revalidation is None:
            return super().check()
        c.require(time.monotonic() < self.deadline, 'TRANSFER_DEADLINE')
        c.require(c.timestamp(self.approval['observedAt']) <= c.datetime.now(c.timezone.utc) < c.timestamp(self.approval['expiresAt']), 'TRANSFER_APPROVAL_EXPIRED')
        self.revalidation.check(self.build, self.raw, self.manifest_sha, self.plan_sha)

    def size(self, name):
        if name == PLAN: return len(self.plan_raw)
        if name == SET: return len(self.raw)
        return self.manifest['images'][name[:-4]]['size']

    def verify(self, folder):
        c.require((folder / PLAN).read_bytes() == self.plan_raw and (folder / SET).read_bytes() == self.raw,
                  'CANDIDATE_ORIGINAL_BYTES')
        if self.revalidation is None:
            candidate.verify_bundle(folder, self.build, self.raw, self.manifest_sha, self.plan_sha)
        else:
            self.revalidation.verify_bundle(folder, self.build, self.raw, self.manifest_sha, self.plan_sha)

    def receipt(self):
        self.check()
        result = dict(schemaVersion=2, kind='cn-candidate-transfer-v2', candidatePlanRawSha256=self.plan_sha,
                    candidateSetRawSha256=self.manifest_sha, candidateIdentity=self.manifest['identity'],
                    **{k:self.build[k] for k in ('sourceRevision','controlRevision','attemptId')},
                    expiresAt=self.manifest['expiresAt'], transport=copy.deepcopy(self.transport),
                    authenticatedPrincipalProven=False, releaseReady=False, productionReady=False)
        if self.revalidation is not None:
            result.update(revalidationRawSha256=self.revalidation.sha, revalidationExpiresAt=self.revalidation.expires_at)
        return result

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
                c.require((snapshot / SET).read_bytes() == self.raw, 'SOURCE_MANIFEST_MISMATCH')
                self.verify(snapshot)
                self.check(); self.port.bind(self.transport, 'upload'); self.check()
                # Manifest is completion marker, published only after five complete readbacks.
                names = [PLAN] + [service + '.tar' for service in c.REPOSITORIES] + [SET]
                missing = []
                for name in names:
                    try: self.readback(name)
                    except Exception as error:
                        if not self.port.missing(error): raise
                        missing.append(name)
                c.require(SET in missing or not missing, 'REMOTE_COMPLETION_INCOMPLETE')
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
                for file in [SET, PLAN] + [s + '.tar' for s in c.REPOSITORIES]:
                    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=work_fd)
                    with os.fdopen(fd, 'wb') as out:
                        self.readback(file, out); out.flush(); os.fsync(out.fileno())
                self.verify(Path('/proc/self/fd') / str(work_fd))
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


class UnknownPutOutcome(Exception):
    """A trusted port raises this only after a PUT was actually dispatched."""


class UntrustedCacheTransfer(CandidateTransfer):
    """Separate approval protocol; remote bytes are always untrusted cache data.

    This does not promise atomic immutability against bucket administrators.
    The seven exact objects and their original identities remain independently
    approved; private full-byte verification, not OSS state, admits consumers.
    """
    def __init__(self, port, plan_raw, plan_sha, set_raw, set_sha, transport, approval, max_seconds=1200, *, revalidation=None):
        c.require(type(plan_raw) is bytes and len(plan_raw) <= 16384 and c.sha(plan_raw) == plan_sha,
                  'CANDIDATE_PLAN_RAW_HASH')
        self.build = copy.deepcopy(candidate.validate_plan(c.decode(plan_raw)))
        self.plan_raw = plan_raw; self.plan_sha = plan_sha
        self.revalidation = revalidation
        self.manifest = (candidate.validate_receipt(set_raw, self.build, set_sha) if revalidation is None else
                         revalidation.check(self.build, set_raw, set_sha, plan_sha))
        c.require(self.manifest['planRawSha256'] == plan_sha, 'CANDIDATE_ORIGINAL_PLAN_BINDING')
        c.require(set(self.manifest['images']) == set(c.REPOSITORIES), 'CANDIDATE_COMPLETE_FIVE')
        self.raw = set_raw; self.manifest_sha = set_sha
        self.total = 0
        for service, entry in self.manifest['images'].items():
            c.require(type(entry) is dict and set(entry) == {'file','size','sha256','configSha256','imageId','layers','stagingTag'}
                      and entry['file'] == service + '.tar' and type(entry['size']) is int
                      and 0 < entry['size'] <= self.build['maxArchiveBytes'] and c.hex_string(entry['sha256'],64),
                      'CANDIDATE_TRANSFER_ENTRY')
            self.total += entry['size']
        c.require(self.total <= self.build['maxTotalBytes'], 'CANDIDATE_TOTAL')
        self.total += len(plan_raw) + len(set_raw)
        fields = {'kind','bucket','region','endpoint','prefix','uploadPrincipal','downloadPrincipal','objects','deliveryId'}
        c.require(type(transport) is dict and set(transport) == fields
                  and transport['kind'] == 'approved-candidate-oss-untrusted-cache-v1', 'CANDIDATE_TRANSPORT_FIELDS')
        for key in ('bucket','region','prefix','uploadPrincipal','downloadPrincipal'):
            c.require(isinstance(transport[key],str) and 0 < len(transport[key]) <= 512
                      and not any(ord(x) < 32 for x in transport[key]), 'TRANSPORT_FIELD_INVALID')
        c.require(c.re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',transport['bucket'])
                  and transport['region'] == 'cn-shanghai'
                  and transport['endpoint'] == 'https://oss-cn-shanghai.aliyuncs.com', 'CANDIDATE_TRANSPORT_TARGET')
        c.require(c.hex_string(transport['deliveryId'],32), 'CACHE_DELIVERY_ID')
        prefix = 'cn-image-candidates/' + self.build['sourceRevision'] + '/' + self.build['attemptId'] + '/deliveries/' + transport['deliveryId'] + '/'
        c.require(transport['prefix'] == prefix, 'TRANSFER_ATTEMPT_PREFIX')
        hashes = {PLAN: plan_sha, SET: set_sha, **{s+'.tar':e['sha256'] for s,e in self.manifest['images'].items()}}
        c.require(type(transport['objects']) is dict and set(transport['objects']) == set(hashes), 'TRANSPORT_OBJECT_SET')
        for name, sha in hashes.items():
            c.require(transport['objects'][name] == {'key':prefix+name,'versionId':'','sha256':sha,'bytes':self.size(name)}, 'TRANSPORT_OBJECT_BINDING')
        expected = dict(schemaVersion=1, kind='cn-candidate-untrusted-cache-approval-v1', transferAuthorized=True,
                        candidatePlanRawSha256=plan_sha, candidateSetRawSha256=set_sha,
                        candidateIdentity=self.manifest['identity'],
                        **{k:self.build[k] for k in ('sourceRevision','controlRevision','attemptId')},
                        transportSha256=c.sha(c.json_bytes(transport)))
        if revalidation is not None: expected['revalidationRawSha256'] = revalidation.sha
        c.require(type(approval) is dict and set(approval) == set(expected)|{'operation','observedAt','expiresAt'}
                  and all(type(approval[k]) is type(v) and approval[k] == v for k,v in expected.items())
                  and approval['operation'] in ('upload','download'), 'TRANSFER_APPROVAL_REQUIRED')
        c.require(0 < (c.timestamp(approval['expiresAt'])-c.timestamp(approval['observedAt'])).total_seconds() <= 3600,
                  'TRANSFER_APPROVAL_EXPIRED')
        c.require(type(max_seconds) is int and 0 < max_seconds <= 1200, 'TRANSFER_DEADLINE_INVALID')
        self.deadline = time.monotonic() + max_seconds
        self.port = port; self.transport = copy.deepcopy(transport); self.approval = copy.deepcopy(approval)
        self.check()


    def cache_version(self):
        self.check()
        c.require(self.port.observe_cache_version() == 'Disabled', 'CACHE_VERSION_OBSERVATION')
        self.check()

    def readback(self, name, target=None):
        self.cache_version()
        super().readback(name, target)
        self.cache_version()

    def verify(self, folder):
        super().verify(folder)
        if self.approval['operation'] == 'download':
            # After every tar/config/layer read, before NOREPLACE publication.
            self.cache_version()

    def receipt(self):
        self.cache_version()
        result = super().receipt()
        result.update(schemaVersion=1, kind='cn-candidate-untrusted-cache-transfer-v1',
                      remoteCacheImmutable=False, administrativeRaceExcluded=False,
                      versioningObservedBefore='Disabled', versioningObservedAfter='Disabled')
        return result

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
                c.require((snapshot / SET).read_bytes() == self.raw, 'SOURCE_MANIFEST_MISMATCH')
                self.verify(snapshot)
                self.check(); self.port.bind(self.transport, 'upload'); self.check()
                # Manifest is completion marker, published only after five complete readbacks.
                names = [PLAN] + [service + '.tar' for service in c.REPOSITORIES] + [SET]
                missing = []
                for name in names:
                    try: self.readback(name)
                    except Exception as error:
                        if not self.port.missing(error): raise
                        missing.append(name)
                c.require(SET in missing or not missing, 'REMOTE_COMPLETION_INCOMPLETE')
                for name in missing:
                    self.check()
                    with (snapshot / name).open('rb') as source:
                        try: self.port.put(self.transport['objects'][name]['key'], source, self.size(name), self.check)
                        except UnknownPutOutcome:
                            # Only a dispatched PUT with unknown outcome admits GET recovery; never retry.
                            self.readback(name)
                    self.readback(name)
                return self.receipt()
        finally:
            os.close(directory)
