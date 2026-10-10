"""Authenticated candidate transfer caller; never provisions credentials or policy.

An admitted operator calls execute_from_ecs with an independently approved request
hash. The factory uses the existing ECS role provider once, and the same in-memory
credential snapshot signs STS and OSS. No default-chain/config-file fallback.
"""
from datetime import datetime, timezone, timedelta
import copy
import http.client
import logging
import re
from urllib.parse import urlsplit
import time
from email.utils import parsedate_to_datetime

import cn_image_archive as c
from cn_candidate_oss import CandidateTransfer
from cn_archive_oss import OssSdkPort

ACCOUNT = '1177216024653153'
INSTANCE = 'i-uf6ga92ewloganobbln6'
ROLE = 'WorkspacexCnProductionEcsRole'
REGION = 'cn-shanghai'
ENDPOINT = 'https://oss-cn-shanghai.aliyuncs.com'
BUCKET_ACTIONS = ['oss:PutBucketVersioning', 'oss:PutBucketPolicy',
                  'oss:DeleteBucketPolicy', 'oss:PutBucketAcl']
OBJECT_ACTIONS = ['oss:DeleteObject', 'oss:DeleteObjectVersion', 'oss:PutObjectAcl']


def now():
    return datetime.now(timezone.utc)


def validate_request(raw, expected, operation):
    c.require(type(raw) is bytes and len(raw) <= 512 * 1024 and c.sha(raw) == expected,
              'AUTH_TRANSFER_REQUEST_HASH')
    v = c.decode(raw)
    fields = {'kind', 'schemaVersion', 'accountId', 'ecsInstanceId', 'roleName',
              'region', 'expectedPrincipal', 'operation', 'issuedAt', 'expiresAt',
              'bucketPolicyRawSha256', 'fenceStartsAt', 'fenceExpiresAt',
              'candidatePlanRawSha256', 'candidateSetRawSha256', 'transport',
              'transferApproval', 'maxSeconds'}
    optional = {'revalidationRawSha256', 'revalidationPolicyRawSha256'}
    c.require(type(v) is dict and (set(v) == fields or set(v) == fields | optional),
              'AUTH_TRANSFER_REQUEST_FIELDS')
    c.require(v['kind'] == 'cn-candidate-authenticated-transfer-v1'
              and type(v['schemaVersion']) is int and v['schemaVersion'] == 1,
              'AUTH_TRANSFER_REQUEST_SCHEMA')
    c.require(v['accountId'] == ACCOUNT and v['ecsInstanceId'] == INSTANCE
              and v['roleName'] == ROLE and v['region'] == REGION, 'AUTH_TRANSFER_TARGET')
    c.require(operation in ('check', 'upload', 'download')
              and v['operation'] in ('upload', 'download')
              and (operation == 'check' or operation == v['operation']), 'AUTH_TRANSFER_OPERATION')
    c.require(isinstance(v['expectedPrincipal'], str) and re.fullmatch(
              r'acs:ram::' + ACCOUNT + r':assumed-role/' + ROLE + r'/[^/*\s]{1,128}',
              v['expectedPrincipal'], re.IGNORECASE), 'AUTH_TRANSFER_ROLE_PRINCIPAL')
    for key in ('bucketPolicyRawSha256', 'candidatePlanRawSha256', 'candidateSetRawSha256'):
        c.require(c.hex_string(v[key], 64), 'AUTH_TRANSFER_HASH')
    if optional <= set(v):
        c.require(all(c.hex_string(v[key], 64) for key in optional), 'AUTH_REVALIDATION_HASH')
    issued, expiry = c.timestamp(v['issuedAt']), c.timestamp(v['expiresAt'])
    start, end = c.timestamp(v['fenceStartsAt']), c.timestamp(v['fenceExpiresAt'])
    c.require(0 < (expiry-issued).total_seconds() <= 3600 and issued <= now() < expiry,
              'AUTH_TRANSFER_EXPIRED')
    # Thirty seconds of server-clock/in-flight-request margin before policy expiry.
    c.require(0 < (end-start).total_seconds() <= 3600 and start <= issued
              and expiry + timedelta(seconds=30) <= end, 'AUTH_FENCE_WINDOW')
    c.require(type(v['maxSeconds']) is int and 1 <= v['maxSeconds'] <= 1200,
              'AUTH_TRANSFER_DEADLINE')
    t = v['transport']
    c.require(type(t) is dict and t.get('endpoint') == ENDPOINT
              and t.get('region') == REGION
              and t.get(v['operation'] + 'Principal') == v['expectedPrincipal'],
              'AUTH_TRANSFER_PRINCIPAL_BINDING')
    c.require(isinstance(t.get('bucket'), str)
              and re.fullmatch('[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', t['bucket']), 'AUTH_BUCKET')
    c.require(type(v['transferApproval']) is dict
              and v['transferApproval'].get('operation') == v['operation'], 'AUTH_TRANSFER_APPROVAL')
    c.require(c.timestamp(v['transferApproval']['observedAt']) >= issued
              and c.timestamp(v['transferApproval']['expiresAt']) <= expiry,
              'AUTH_TRANSFER_APPROVAL_WINDOW')
    c.require(v['transferApproval'].get('versioningFenceProofSha256') == fence_hash(v),
              'AUTH_FENCE_BINDING')
    return v


def fence_hash(request):
    """Deterministic independently approved claim; not a fabricated live observation."""
    value = {k: request[k] for k in ('accountId', 'bucketPolicyRawSha256',
             'fenceStartsAt', 'fenceExpiresAt')}
    value.update(kind='cn-candidate-oss-fence-claim-v1',
                 transportSha256=c.sha(c.json_bytes(request['transport'])))
    return c.sha(c.json_bytes(value))


def required_statements(request):
    """Pure draft: finite bucket administrative freeze, no Allow/credential fields.

    This prevents version-state changes during the approved operation. It is NOT
    a claim that other writers cannot modify cache objects. Every consumed byte
    is revalidated in the private snapshot using independently approved hashes.
    """
    resource = 'acs:oss:*:' + ACCOUNT + ':' + request['transport']['bucket']
    return [{'Effect': 'Deny', 'Action': BUCKET_ACTIONS, 'Principal': ['*'],
             'Resource': [resource], 'Condition': {
                 'DateGreaterThanEquals': {'acs:CurrentTime': request['fenceStartsAt']},
                 'DateLessThan': {'acs:CurrentTime': request['fenceExpiresAt']}}}]


def validate_policy(raw, request):
    c.require(type(raw) is bytes and len(raw) <= 16 * 1024
              and c.sha(raw) == request['bucketPolicyRawSha256'], 'AUTH_BUCKET_POLICY_HASH')
    policy = c.decode(raw)
    c.require(type(policy) is dict and set(policy) == {'Version', 'Statement'}
              and policy['Version'] == '1' and type(policy['Statement']) is list,
              'AUTH_BUCKET_POLICY_SCHEMA')
    # Deliberately accept only the explicitly reviewed forms, not a homegrown
    # general IAM evaluator. Keep unrelated existing statements unchanged.
    statements = [{k: v for k, v in s.items() if k != 'Sid'} for s in policy['Statement']
                  if type(s) is dict]
    for required in required_statements(request):
        c.require(required in statements, 'AUTH_BUCKET_FENCE_MISSING')


def verify_host():
    """IMDSv2 identity only; credential acquisition is the official provider's job."""
    def get(method, path, headers):
        conn = http.client.HTTPConnection('100.100.100.200', timeout=2)
        try:
            conn.request(method, path, headers=headers)
            response = conn.getresponse()
            c.require(response.status == 200, 'AUTH_HOST_METADATA_STATUS')
            value = response.read(4097)
            c.require(0 < len(value) <= 4096, 'AUTH_HOST_METADATA_SIZE')
            return value
        finally:
            conn.close()
    token = get('PUT', '/latest/api/token', {'X-aliyun-ecs-metadata-token-ttl-seconds': '60'})
    c.require(all(33 <= x <= 126 for x in token), 'AUTH_HOST_METADATA_TOKEN')
    headers = {'X-aliyun-ecs-metadata-token': token.decode('ascii')}
    c.require(get('GET', '/latest/meta-data/instance-id', headers) == INSTANCE.encode()
              and get('GET', '/latest/meta-data/region-id', headers) == REGION.encode(),
              'AUTH_HOST_IDENTITY')


class AuthenticatedPort(OssSdkPort):
    """Real signed readback gate for the exact Bucket used by the transfer port."""
    def __init__(self, bucket, identity_reader, request):
        self.request = copy.deepcopy(request)
        self.identity_reader = identity_reader
        self.deadline = time.monotonic() + request['maxSeconds']
        self.observation = None
        super().__init__(bucket, request['expectedPrincipal'], REGION)

    def valid(self):
        c.require(time.monotonic() < self.deadline, 'AUTH_TRANSFER_DEADLINE')
        c.require(c.timestamp(self.request['issuedAt']) <= now()
                  < c.timestamp(self.request['expiresAt']), 'AUTH_TRANSFER_EXPIRED')

    def observe(self):
        self.valid()
        ident = self.identity_reader()
        c.require(type(ident) is dict and ident.get('AccountId') == ACCOUNT
                  and ident.get('Arn') == self.request['expectedPrincipal']
                  and ident.get('IdentityType') == 'AssumedRoleUser', 'AUTH_STS_IDENTITY')
        info = self.bucket.get_bucket_info()
        c.require(info.name == self.request['transport']['bucket']
                  and info.location == 'oss-cn-shanghai' and info.owner.id == ACCOUNT,
                  'AUTH_BUCKET_OWNER_REGION')
        c.require(self.bucket.get_bucket_acl().acl == 'private', 'AUTH_BUCKET_PRIVATE_REQUIRED')
        c.require(self.bucket.get_bucket_versioning().status is None, 'VERSIONING_MUST_BE_DISABLED')
        policy_result = self.bucket.get_bucket_policy()
        raw = policy_result.policy
        if isinstance(raw, str): raw = raw.encode('utf-8')
        validate_policy(raw, self.request)
        server_time = parsedate_to_datetime(policy_result.headers['Date'])
        c.require(server_time.tzinfo is not None and abs((server_time-now()).total_seconds()) <= 30,
                  'AUTH_PROVIDER_CLOCK')
        remaining = max(0, self.deadline-time.monotonic())
        c.require(c.timestamp(self.request['fenceStartsAt']) <= server_time
                  and server_time + timedelta(seconds=remaining+30)
                  < c.timestamp(self.request['fenceExpiresAt']), 'AUTH_PROVIDER_FENCE_WINDOW')
        self.valid()
        self.observation = {'kind': 'cn-candidate-oss-auth-observation-v1',
            'accountId': ACCOUNT, 'ecsInstanceId': INSTANCE, 'region': REGION,
            'bucket': self.request['transport']['bucket'],
            'principalSha256': c.sha(self.principal.encode()),
            'bucketPolicyRawSha256': c.sha(raw), 'fenceClaimSha256': fence_hash(self.request),
            'providerObservedAt': server_time.isoformat(),
            'remoteCacheImmutable': False, 'observedAt': now().isoformat(), 'expiresAt': self.request['expiresAt'],
            'authenticatedSameCredentialIdentity': True, 'privateAclObserved': True,
            'versioningDisabledObserved': True, 'requiredDenyStatementsObserved': True,
            'productionReady': False, 'releaseReady': False}
        return copy.deepcopy(self.observation)

    def bind(self, transport, operation):
        c.require(transport == self.request['transport'] and operation == self.request['operation'],
                  'AUTH_TRANSPORT_CHANGED')
        self.observe()
        super().bind(transport, operation)

    def get(self, key, version):
        self.valid()
        c.require(key in {x['key'] for x in self.transport_objects()} and version == '',
                  'AUTH_OBJECT_SCOPE')
        return super().get(key, version)

    def transport_objects(self):
        return self.request['transport']['objects'].values()

    def put(self, key, stream, size, check):
        raise c.Rejected('AUTH_ECS_DOWNLOAD_ONLY')


def pin_session(session, hostname, methods):
    """Pin SDK network destinations without reading or serializing signed headers."""
    session.trust_env = False
    original = session.request
    def request(method, url, **kwargs):
        parsed = urlsplit(url)
        c.require(parsed.scheme == 'https' and parsed.hostname == hostname
                  and parsed.port in (None, 443) and parsed.username is None
                  and parsed.password is None and method.upper() in methods,
                  'AUTH_SDK_ENDPOINT')
        kwargs['allow_redirects'] = False
        kwargs['verify'] = True
        kwargs['proxies'] = {}
        return original(method, url, **kwargs)
    session.request = request


def ecs_port(request):
    """No cloud mutations: obtain existing role credentials, build signed clients.

    These official SDK dependencies must be installed in the admitted runtime.
    This function never installs packages, reads CLI/config credentials, assumes
    a new role, changes a policy, or emits credential fields.
    """
    c.require(request['operation'] == 'download', 'AUTH_ECS_DOWNLOAD_ONLY')
    verify_host()
    import oss2
    from alibabacloud_credentials.client import Client
    from alibabacloud_credentials.models import Config
    from aliyunsdkcore.client import AcsClient
    from aliyunsdkcore.auth.credentials import StsTokenCredential
    from aliyunsdksts.request.v20150401.GetCallerIdentityRequest import GetCallerIdentityRequest
    credential = Client(Config(type='ecs_ram_role', role_name=ROLE,
                        disable_imds_v1=True, timeout=2000, connect_timeout=2000)).get_credential()
    c.require(all(isinstance(x, str) and x for x in (credential.access_key_id,
              credential.access_key_secret, credential.security_token)), 'AUTH_TEMPORARY_CREDENTIAL_REQUIRED')
    # Single snapshot: do not let two default provider chains select identities.
    sts = AcsClient(region_id=REGION, credential=StsTokenCredential(credential.access_key_id,
          credential.access_key_secret, credential.security_token), auto_retry=False,
          connect_timeout=5, timeout=10, verify=True, proxy={})
    pin_session(sts.session, 'sts.cn-shanghai.aliyuncs.com', {'POST'})
    session = oss2.Session()
    pin_session(session.session, request['transport']['bucket'] + '.oss-cn-shanghai.aliyuncs.com', {'GET'})
    bucket = oss2.Bucket(oss2.StsAuth(credential.access_key_id, credential.access_key_secret,
                        credential.security_token), ENDPOINT, request['transport']['bucket'],
                        session=session, connect_timeout=10)
    def identity():
        req = GetCallerIdentityRequest()
        req.set_protocol_type('https'); req.set_domain('sts.cn-shanghai.aliyuncs.com')
        req.set_method('POST'); req.set_accept_format('json')
        return c.decode(sts.do_action_with_exception(req))
    return AuthenticatedPort(bucket, identity, request)


def execute_from_ecs(operation, request_raw, request_sha, plan_raw, set_raw,
                     bundle=None, destination_parent=None, destination_name=None,
                     *, revalidation_raw=None, revalidation_policy_raw=None):
    """Actual caller, including signed SDK reads and explicit transfer invocation.

    Request SHA is an independent authorization anchor supplied by the admitted
    operator. Never derive it from untrusted files/downloads. Root/private input
    staging and code/dependency hash admission remain the operator's entry gate.
    """
    previous_logging = logging.root.manager.disable
    # SDK debug logs may contain signed headers. This bounded, main-thread
    # operation intentionally suppresses logging while credentials are alive.
    logging.disable(logging.CRITICAL)
    try:
        return _execute(operation, request_raw, request_sha, plan_raw, set_raw,
                        bundle, destination_parent, destination_name, revalidation_raw,
                        revalidation_policy_raw)
    except Exception:
        # A library caller must not accidentally log signed URLs/provider bodies.
        raise c.Rejected('AUTHENTICATED_TRANSFER_REJECTED') from None
    finally:
        logging.disable(previous_logging)


def _execute(operation, raw, expected, plan_raw, set_raw, bundle, parent, name, proof_raw, policy_raw):
    request = validate_request(raw, expected, operation)
    c.require(request['operation'] == 'download', 'AUTH_ECS_DOWNLOAD_ONLY')
    revalidation = None
    if 'revalidationRawSha256' in request:
        from cn_candidate_revalidation import admit
        c.require(type(proof_raw) is bytes, 'AUTH_REVALIDATION_REQUIRED')
        revalidation = admit(proof_raw, request['revalidationRawSha256'],
                             request['revalidationPolicyRawSha256'], policy_raw)
    else:
        c.require(proof_raw is None and policy_raw is None, 'AUTH_UNEXPECTED_REVALIDATION')
    # Constructor validates original bytes/TTL and approval before credentials.
    kwargs = {'revalidation': revalidation} if revalidation is not None else {}
    pending = CandidateTransfer(None, plan_raw, request['candidatePlanRawSha256'],
        set_raw, request['candidateSetRawSha256'], request['transport'],
        request['transferApproval'], max_seconds=request['maxSeconds'], **kwargs)
    port = ecs_port(request)
    observation = port.observe()
    pending.port = port
    if operation == 'check':
        return {'kind': 'cn-candidate-authenticated-transfer-check-v1',
                'requestRawSha256': expected, 'authentication': observation,
                'transferStarted': False, 'cloudWrites': 0,
                'productionReady': False, 'releaseReady': False}
    c.require(operation == 'download', 'AUTH_ECS_DOWNLOAD_ONLY')
    result = pending.download(parent, name)
    # Original transfer receipt remains non-authorizing, kept intact as a child.
    return {'kind': 'cn-candidate-authenticated-transfer-result-v1',
            'requestRawSha256': expected, 'authentication': port.observe(),
            'transfer': result, 'cacheSnapshotVerified': True,
            'remoteCacheImmutable': False, 'productionReady': False, 'releaseReady': False}
