"""Native OAuth-preserving candidate upload. OSS is an untrusted byte cache.

Integrate with the reviewed authenticated-fence and revalidation modules before
calling execute. This module neither creates policies nor dispatches uploads.
"""
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import copy
import hashlib
import http.client
import os
from pathlib import Path
import shutil
import ssl
import tempfile
import time

import cn_image_archive as c
from cn_candidate_oss import CandidateTransfer, PLAN, SET
from cn_archive_oss import bounded, directory_fd, private_file, CHUNK
from cn_candidate_native_cli import NativeCli

ACCOUNT = '1177216024653153'
BUCKET = 'workspacex-cn-prod-assets'
HOST = 'oss-cn-shanghai.aliyuncs.com'


def provider_clock(deadline):
    remaining = deadline-time.monotonic()
    c.require(remaining > 0, 'NATIVE_DEADLINE')
    conn = http.client.HTTPSConnection(HOST, timeout=min(10, remaining), context=ssl.create_default_context())
    try:
        conn.request('HEAD', '/')
        response = conn.getresponse()
        c.require(response.status in (200, 400, 403, 404), 'PROVIDER_CLOCK_STATUS')
        value = parsedate_to_datetime(response.getheader('Date', ''))
        c.require(value.tzinfo is not None, 'PROVIDER_CLOCK_DATE')
        c.require(time.monotonic() < deadline, 'NATIVE_DEADLINE')
        return value.astimezone(timezone.utc)
    finally:
        conn.close()


def validate_request(raw, expected):
    from cn_candidate_authenticated_oss import fence_hash
    c.require(type(raw) is bytes and len(raw) <= 512*1024 and c.sha(raw) == expected, 'NATIVE_REQUEST_HASH')
    r = c.decode(raw)
    fields = {'kind','schemaVersion','accountId','expectedPrincipal','issuedAt','expiresAt',
              'bucketPolicyRawSha256','fenceStartsAt','fenceExpiresAt','candidatePlanRawSha256',
              'candidateSetRawSha256','transport','transferApproval','maxSeconds'}
    optional = {'revalidationRawSha256','revalidationPolicyRawSha256'}
    c.require(type(r) is dict and set(r) in (fields, fields|optional), 'NATIVE_REQUEST_FIELDS')
    c.require(r['kind'] == 'cn-candidate-native-upload-v1' and type(r['schemaVersion']) is int
              and r['schemaVersion'] == 1 and r['accountId'] == ACCOUNT, 'NATIVE_REQUEST_IDENTITY')
    c.require(type(r['maxSeconds']) is int and 1 <= r['maxSeconds'] <= 1200, 'NATIVE_DEADLINE')
    for key in ('bucketPolicyRawSha256','candidatePlanRawSha256','candidateSetRawSha256'):
        c.require(c.hex_string(r[key],64), 'NATIVE_REQUEST_HASH')
    if optional <= set(r):
        c.require(all(c.hex_string(r[k],64) for k in optional),'NATIVE_REVALIDATION_HASH')
    t = r['transport']; a = r['transferApproval']
    c.require(t['bucket'] == BUCKET and t['region'] == 'cn-shanghai'
              and t['endpoint'] == 'https://' + HOST and t['uploadPrincipal'] == r['expectedPrincipal'], 'NATIVE_TARGET')
    c.require(isinstance(r['expectedPrincipal'], str) and r['expectedPrincipal'].startswith('acs:ram::'+ACCOUNT+':'), 'NATIVE_PRINCIPAL')
    start, end = c.timestamp(r['fenceStartsAt']), c.timestamp(r['fenceExpiresAt'])
    issued, expiry = c.timestamp(r['issuedAt']), c.timestamp(r['expiresAt'])
    c.require(0 < (expiry-issued).total_seconds() <= 3600 and issued <= datetime.now(timezone.utc) < expiry,
              'NATIVE_REQUEST_EXPIRED')
    c.require(0 < (end-start).total_seconds() <= 3600 and start <= issued and expiry+timedelta(seconds=30) <= end,
              'NATIVE_FENCE_WINDOW')
    c.require(a['operation'] == 'upload' and a['versioningFenceProofSha256'] == fence_hash(r)
              and c.timestamp(a['observedAt']) >= issued and c.timestamp(a['expiresAt']) <= expiry, 'NATIVE_APPROVAL')
    return r


class NativePort:
    def __init__(self, cli, request):
        self.cli = cli; self.request = copy.deepcopy(request)
        self.transport = request['transport']; self.observation = None

    def observe(self):
        from cn_candidate_authenticated_oss import validate_policy
        r = self.request; start = provider_clock(self.cli.deadline)
        identity = self.cli.identity()
        c.require(identity.get('AccountId') == ACCOUNT and identity.get('Arn') == r['expectedPrincipal']
                  and identity.get('IdentityType') in ('Account','RAMUser','AssumedRoleUser'), 'NATIVE_AUTH_IDENTITY')
        info = self.cli.api('get-bucket-info', BUCKET)['Bucket']
        acl = self.cli.api('get-bucket-acl', BUCKET)
        version = self.cli.api('get-bucket-versioning', BUCKET)
        c.require(info['Name'] == BUCKET and info['Location'] == 'oss-cn-shanghai'
                  and info['Owner']['ID'] == ACCOUNT and acl['Owner']['ID'] == ACCOUNT
                  and acl['AccessControlList']['Grant'] == 'private', 'NATIVE_BUCKET_IDENTITY')
        c.require(set(version) <= {'+@xmlns'} and 'Status' not in version, 'VERSIONING_MUST_BE_DISABLED')
        # raw format must preserve provider bytes exactly; any decoration fails hash.
        raw = self.cli._run(self.cli._args(['api','get-bucket-policy','--bucket',BUCKET,'--output-format','raw']), limit=16384)
        validate_policy(raw, r)
        end = provider_clock(self.cli.deadline)
        c.require(0 <= (end-start).total_seconds() <= 30 and start >= c.timestamp(r['fenceStartsAt'])
                  and end+timedelta(seconds=max(0,self.cli.deadline-time.monotonic())+30) < c.timestamp(r['fenceExpiresAt']),
                  'NATIVE_PROVIDER_CLOCK_WINDOW')
        self.observation = dict(accountId=ACCOUNT, principal=r['expectedPrincipal'], bucket=BUCKET,
                                versioning='Disabled', authenticatedPolicyObserved=True,
                                policyRawSha256=c.sha(raw), providerClockMethod='fixed-endpoint-tls-head',
                                providerClockStart=start.isoformat(), providerClockEnd=end.isoformat())
        return self.observation

    def bind(self, transport, operation):
        c.require(operation == 'upload' and transport == self.transport, 'NATIVE_BINDING')
        self.observe()

    def put(self, key, stream, size, check):
        c.require(key in {v['key'] for v in self.transport['objects'].values()} and 0 < size <= 4*1024**3,
                  'NATIVE_OBJECT_SCOPE')
        check(); self.observe(); check()
        # Source is the transfer's private fully validated snapshot. No shell or stdin materialization.
        path = Path(stream.name)
        before = os.fstat(stream.fileno())
        c.require(path.is_absolute() and path.stat().st_ino == before.st_ino and before.st_size == size,
                  'NATIVE_SOURCE_CHANGED')
        try:
            self.cli._run(self.cli._args(['api','put-object','--bucket',BUCKET,'--key',key,
                '--body','file://'+str(path),'--forbid-overwrite','--object-acl','private','--output-format','json']))
        finally:
            after = os.fstat(stream.fileno())
            c.require((before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) ==
                      (after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns), 'NATIVE_SOURCE_CHANGED')

    def readback(self, key, size, expected, check):
        check(); self.observe(); check()
        class Sink:
            total=0
            digest=None
            def __init__(self): self.digest=hashlib.sha256()
            def write(self, raw):
                check(); self.total += len(raw); self.digest.update(raw)
        sink = Sink()
        self.cli._run(self.cli._args(['cat','oss://'+BUCKET+'/'+key,'--quiet']), limit=size, target=sink)
        c.require(sink.total == size and sink.digest.hexdigest() == expected, 'REMOTE_CONTENT_MISMATCH')
        self.observe(); check()


class NativeCachePort(NativePort):
    """Untrusted cache observation, deliberately without a bucket policy fence.

    Disabled is an observed state, not an atomic guarantee against an
    administrator. Any failed observation permanently poisons this operation.
    """
    def __init__(self, cli, request):
        super().__init__(cli, request)
        self.observation_failed = False

    def observe(self):
        c.require(not self.observation_failed, 'NATIVE_CACHE_OBSERVATION_FAILED')
        try:
            self.cli.check()
            identity = self.cli.identity()
            c.require(identity.get('AccountId') == ACCOUNT
                      and identity.get('Arn') == self.request['expectedPrincipal']
                      and identity.get('IdentityType') in ('Account','RAMUser','AssumedRoleUser'),
                      'NATIVE_AUTH_IDENTITY')
            info = self.cli.api('get-bucket-info', BUCKET)['Bucket']
            acl = self.cli.api('get-bucket-acl', BUCKET)
            version = self.cli.api('get-bucket-versioning', BUCKET)
            c.require(info['Name'] == BUCKET and info['Location'] == 'oss-cn-shanghai'
                      and info['Owner']['ID'] == ACCOUNT and acl['Owner']['ID'] == ACCOUNT
                      and acl['AccessControlList']['Grant'] == 'private', 'NATIVE_BUCKET_IDENTITY')
            c.require(set(version) <= {'+@xmlns'} and 'Status' not in version,
                      'VERSIONING_MUST_BE_DISABLED')
            self.cli.check()
            self.observation = dict(accountId=ACCOUNT, principal=self.request['expectedPrincipal'],
                                    bucket=BUCKET, versioning='Disabled',
                                    remoteCacheImmutable=False, atomicVersionFence=False,
                                    bucketPolicyRead=False)
            return self.observation
        except BaseException:
            self.observation_failed = True
            raise


class NativeUpload(CandidateTransfer):
    @bounded
    def upload(self, bundle):
        c.require(self.approval['operation'] == 'upload', 'TRANSFER_OPERATION_UNAPPROVED')
        c.require(shutil.disk_usage(tempfile.gettempdir()).free >= self.total+self.build['storageMarginBytes'], 'TRANSFER_CAPACITY')
        c.require(os.statvfs(tempfile.gettempdir()).f_favail >= 4096, 'TRANSFER_INODE_CAPACITY')
        self.check(); directory = directory_fd(bundle)
        try:
            with ExitStack() as stack, tempfile.TemporaryDirectory(prefix='wsx-native-snapshot-') as tmp:
                snapshot = Path(tmp)
                for name in self.transport['objects']:
                    source = stack.enter_context(private_file(directory,name)); before=os.fstat(source.fileno())
                    with (snapshot/name).open('xb') as out:
                        total=0
                        while True:
                            self.check(); raw=source.read(CHUNK)
                            if not raw: break
                            total+=len(raw); c.require(total <= self.size(name),'SOURCE_SIZE_LIMIT'); out.write(raw)
                    after=os.fstat(source.fileno())
                    c.require((before.st_size,before.st_mtime_ns,before.st_ctime_ns) ==
                              (after.st_size,after.st_mtime_ns,after.st_ctime_ns),'SOURCE_CHANGED')
                self.verify(snapshot); self.port.bind(self.transport,'upload'); self.check()
                for name in [PLAN]+[s+'.tar' for s in c.REPOSITORIES]+[SET]:
                    item=self.transport['objects'][name]
                    with (snapshot/name).open('rb') as source:
                        try: self.port.put(item['key'],source,self.size(name),self.check)
                        except Exception:
                            # Unknown acknowledgement or existing object: GET only, never another PUT.
                            self.port.readback(item['key'],self.size(name),item['sha256'],self.check)
                        else:
                            self.port.readback(item['key'],self.size(name),item['sha256'],self.check)
                return self.receipt()
        finally: os.close(directory)


def execute(request_raw, request_sha, plan_raw, set_raw, bundle, *, revalidation_raw=None, revalidation_policy_raw=None):
    try:
        r=validate_request(request_raw,request_sha); kwargs={}
        if 'revalidationRawSha256' in r:
            from cn_candidate_revalidation import admit
            kwargs['revalidation']=admit(revalidation_raw,r['revalidationRawSha256'],r['revalidationPolicyRawSha256'],revalidation_policy_raw)
        else:
            c.require(revalidation_raw is None and revalidation_policy_raw is None,'NATIVE_UNEXPECTED_REVALIDATION')
        transfer=NativeUpload(None,plan_raw,r['candidatePlanRawSha256'],set_raw,r['candidateSetRawSha256'],
                              r['transport'],r['transferApproval'],max_seconds=r['maxSeconds'],**kwargs)
        cli=NativeCli(r['maxSeconds']); cli.deadline=min(cli.deadline,transfer.deadline)
        port=NativePort(cli,r); transfer.port=port
        result=transfer.upload(bundle)
        return dict(kind='cn-candidate-native-upload-result-v1',requestRawSha256=request_sha,
                    transfer=result,authentication=port.observe(),remoteCacheImmutable=False,
                    uploadedBytesReadBack=True,productionReady=False,releaseReady=False)
    except Exception:
        raise c.Rejected('NATIVE_UPLOAD_REJECTED') from None
