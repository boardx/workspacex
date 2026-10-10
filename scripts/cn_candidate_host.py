"""Admitted host implementation for the candidate-v2 publication sequence.

Only the isolated root entry calls run(). This module is not a generic CLI.
All credentials remain within legacy Commands' temporary Docker configuration.
"""
from contextlib import ExitStack
from datetime import datetime, timezone
import importlib.util
import http.client
import os
import re
from pathlib import Path
import shutil
import signal
import tempfile
import time

import canonical_control as canonical
import cn_image_archive as a
import cn_image_candidate as c
import cn_candidate_publication as publication

_spec = importlib.util.spec_from_file_location('candidate_legacy_host',
    Path(__file__).with_name('import-cn-image-archives.py'))
legacy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(legacy)

CLOSURE = frozenset(('import-cn-image-candidates.py', 'import-cn-image-archives.py',
    'cn_candidate_host.py', 'cn_candidate_publication.py', 'cn_image_candidate.py',
    'cn_image_archive.py', 'hosted-release.py', 'canonical_control.py'))


def validate_approval(value, source, attempt, now=None):
    fields = {'schemaVersion', 'kind', 'candidatePlanRawSha256', 'candidateSetRawSha256',
              'publicationIntentRawSha256', 'issuedAt', 'expiresAt', 'publishAuthorized',
              'accountId', 'ecsInstanceId', 'region', 'instanceId', 'registryPrefix',
              'immutableRepositories', 'immutableEvidence', 'installedToolSha256',
              'canonicalConfigurationSha256', 'binaries', 'maxPublishSeconds',
              'sourceRevision', 'attemptId'}
    a.require(type(value) is dict and set(value) == fields, 'CANDIDATE_APPROVAL_FIELDS')
    a.require(type(value['schemaVersion']) is int and value['schemaVersion'] == 2
              and value['kind'] == 'cn-candidate-host-approval-v2', 'CANDIDATE_APPROVAL_SCHEMA')
    a.require(value['sourceRevision'] == source and value['attemptId'] == attempt,
              'CANDIDATE_APPROVAL_IDENTITY')
    a.require(value['publishAuthorized'] is True, 'PUBLISH_NOT_AUTHORIZED')
    a.require(value['accountId'] == legacy.ACCOUNT and value['ecsInstanceId'] == 'i-uf6ga92ewloganobbln6'
              and value['region'] == 'cn-shanghai' and value['instanceId'] == a.INSTANCE
              and value['registryPrefix'] == a.PREFIX, 'APPROVAL_TARGET')
    for key in ('candidatePlanRawSha256', 'candidateSetRawSha256', 'publicationIntentRawSha256',
                'canonicalConfigurationSha256'):
        a.require(a.hex_string(value[key], 64), 'APPROVAL_HASH_REQUIRED')
    tools = value['installedToolSha256']
    a.require(type(tools) is dict and set(tools) == CLOSURE
              and all(a.hex_string(x, 64) for x in tools.values()), 'INSTALLED_CLOSURE_REQUIRED')
    clock = now or datetime.now(timezone.utc)
    issued = a.timestamp(value['issuedAt']); expiry = a.timestamp(value['expiresAt'])
    a.require(0 < (expiry-issued).total_seconds() <= 3600 and issued <= clock < expiry, 'APPROVAL_EXPIRED')
    a.require(type(value['maxPublishSeconds']) is int and 30 <= value['maxPublishSeconds'] <= 1200,
              'PUBLISH_DEADLINE_INVALID')
    repos = value['immutableRepositories']
    a.require(type(repos) is list and len(repos) == 5 and set(repos) == set(a.REPOSITORIES.values()),
              'ALL_REPOSITORY_IMMUTABILITY_REQUIRED')
    evidence = value['immutableEvidence']
    a.require(type(evidence) is dict and set(evidence) == {'observedAt', 'accountId', 'instanceId',
              'region', 'namespace', 'repositories', 'providerResponseSha256'}, 'IMMUTABILITY_EVIDENCE_REQUIRED')
    a.require(evidence['accountId'] == legacy.ACCOUNT and evidence['instanceId'] == a.INSTANCE
              and evidence['region'] == 'cn-shanghai' and evidence['namespace'] == 'workspacex-prod'
              and a.hex_string(evidence['providerResponseSha256'], 64), 'IMMUTABILITY_TARGET')
    a.require(0 <= (clock-a.timestamp(evidence['observedAt'])).total_seconds() <= 3600,
              'IMMUTABILITY_EVIDENCE_EXPIRED')
    a.require(type(evidence['repositories']) is dict
              and set(evidence['repositories']) == set(a.REPOSITORIES.values()), 'IMMUTABILITY_REPOSITORY_SET')
    for item in evidence['repositories'].values():
        a.require(type(item) is dict and set(item) == {'repositoryId', 'immutable'}
                  and item['immutable'] is True and isinstance(item['repositoryId'], str)
                  and re.fullmatch('crr-[a-z0-9]+', item['repositoryId']), 'IMMUTABILITY_NOT_PROVEN')
    binaries = value['binaries']
    a.require(type(binaries) is dict and set(binaries) == {'docker', 'buildx', 'aliyun'}, 'BINARY_SET_REQUIRED')
    for item in binaries.values():
        a.require(type(item) is dict and set(item) == {'path', 'sha256'}
                  and a.hex_string(item['sha256'], 64), 'BINARY_HASH_REQUIRED')
    a.require(binaries['docker']['path'] == '/usr/bin/docker', 'DOCKER_PATH_INVALID')
    a.require(binaries['buildx']['path'] in ('/usr/libexec/docker/cli-plugins/docker-buildx',
              '/usr/lib/docker/cli-plugins/docker-buildx'), 'BUILDX_PATH_INVALID')
    a.require(binaries['aliyun'] == {'path': legacy.ALIYUN, 'sha256': legacy.ALIYUN_SHA}, 'ALIYUN_IDENTITY_INVALID')
    return value


def metadata_request(method, path, headers):
    """Fixed IMDS endpoint: HTTPConnection ignores proxy env and never redirects.

    No caller URL, shell, logs, retry, IMDSv1 fallback, or credential endpoints.
    The only secret here is a short-lived metadata token kept in process memory.
    """
    a.require((method, path) in {('PUT', '/latest/api/token'),
              ('GET', '/latest/meta-data/instance-id'),
              ('GET', '/latest/meta-data/region-id')}, 'HOST_METADATA_ENDPOINT')
    connection = http.client.HTTPConnection('100.100.100.200', 80, timeout=2)
    try:
        connection.request(method, path, headers=headers)
        response = connection.getresponse()
        # 3xx is rejected, never followed, including to the same endpoint.
        a.require(response.status == 200, 'HOST_METADATA_STATUS')
        raw = response.read(4097)
        a.require(0 < len(raw) <= 4096, 'HOST_METADATA_SIZE')
        return raw
    except Exception:
        # Do not propagate request headers, token or provider response text.
        raise a.Rejected('HOST_METADATA_REQUEST_REJECTED') from None
    finally:
        connection.close()


def verify_runtime_host(approval):
    token_raw = metadata_request('PUT', '/latest/api/token',
        {'X-aliyun-ecs-metadata-token-ttl-seconds': '60'})
    a.require(0 < len(token_raw) <= 4096 and all(33 <= byte <= 126 for byte in token_raw),
              'HOST_METADATA_TOKEN_SHAPE')
    token = token_raw.decode('ascii')
    headers = {'X-aliyun-ecs-metadata-token': token}
    instance = metadata_request('GET', '/latest/meta-data/instance-id', headers)
    a.require(instance == approval['ecsInstanceId'].encode('ascii'), 'HOST_INSTANCE_MISMATCH')
    region = metadata_request('GET', '/latest/meta-data/region-id', headers)
    a.require(region == approval['region'].encode('ascii'), 'HOST_REGION_MISMATCH')
    return {'ecsInstanceId': approval['ecsInstanceId'], 'region': approval['region'],
            'observedAt': datetime.now(timezone.utc).isoformat(), 'method': 'aliyun-imdsv2'}


class Commands(legacy.Commands):
    def authenticate(self):
        self.check_validity()
        # This must precede STS/ACR token acquisition and Docker login. Same
        # account/role on another ECS is insufficient to admit this attempt.
        self.host_identity = verify_runtime_host(self.plan)
        self.check_validity()
        return super().authenticate()

    def canonical_publish_candidate(self, build_input, binding):
        # Binding originates only from the sequence after actual authenticated
        # pulls/readbacks. Store it in the same atomic directory as canonical TS
        # manifest and seal, never in an independently written success sidecar.
        self.check_validity()
        a.require(binding['candidatePlanRawSha256'] == self.plan['candidatePlanRawSha256']
                  and binding['candidateSetRawSha256'] == self.plan['candidateSetRawSha256']
                  and binding['publicationIntentRawSha256'] == self.plan['publicationIntentRawSha256'],
                  'CANDIDATE_BINDING_MISMATCH')
        self.binding = dict(binding)
        return super().canonical_publish(build_input)

    def receipt(self, build_input, manifest_raw, seal_raw):
        return dict(self.binding, receiptKind='cn-candidate-published-v2',
                    hostApprovalRawSha256=self.approval_sha,
                    runtimeHostIdentity=self.host_identity,
                    manifestSha256=a.sha(manifest_raw), sealSha256=a.sha(seal_raw),
                    registryPrefix=a.PREFIX, images=build_input['images'],
                    ready=False, prepared=False, productionActivated=False)


def admit_canonical(directory, approval):
    path = directory / 'canonical-control.json'
    raw = legacy.protected(path, 256 * 1024, approval['canonicalConfigurationSha256'], 0o600)
    config = a.decode(raw)
    a.require(type(config) is dict and set(config) == {'schemaVersion', 'nodeExecutable', 'nodeSha256',
              'checkoutDirectory', 'fileSha256'} and type(config['schemaVersion']) is int
              and config['schemaVersion'] == 1 and a.hex_string(config['nodeSha256'], 64)
              and type(config['fileSha256']) is dict and canonical.REQUIRED_SOURCE <= config['fileSha256'].keys()
              and {'node_modules/tsx/package.json', 'node_modules/zod/package.json'} <= config['fileSha256'].keys(),
              'CANONICAL_CONFIGURATION_FIELDS')
    a.require(config['checkoutDirectory'] == str(directory / 'canonical-source')
              and config['nodeExecutable'] == str(directory / 'node'), 'CANONICAL_LOCATION_BOUNDARY')
    legacy.protected(config['nodeExecutable'], 128 * 1024**2, config['nodeSha256'], 0o700)
    for relative, expected in config['fileSha256'].items():
        a.safe_name(relative)
        a.require(a.hex_string(expected, 64), 'CANONICAL_FILE_HASH_REQUIRED')
        legacy.protected(Path(config['checkoutDirectory']) / relative, 64 * 1024**2, expected)
    return path


def copy_snapshots(streams, bundle, receipt, plan):
    for service, stream in streams.items():
        stream.seek(0)
        expected = receipt['images'][service]['size']
        a.require(type(expected) is int and 0 < expected <= plan['maxArchiveBytes'], 'CANDIDATE_SIZE')
        with (bundle / (service + '.tar')).open('xb') as target:
            os.chmod(target.name, 0o600)
            copied = 0
            while True:
                data = stream.read(min(1024**2, expected - copied + 1))
                if not data:
                    break
                copied += len(data)
                a.require(copied <= expected, 'INBOX_ARCHIVE_CHANGED')
                target.write(data)
            a.require(copied == expected, 'INBOX_ARCHIVE_CHANGED')


def run(operation, source, attempt, approval, approval_sha, directory, started):
    a.require(operation in ('--check-plan', '--publish'), 'EXPLICIT_OPERATION_REQUIRED')
    validate_approval(approval, source, attempt)
    raw_plan = legacy.protected(directory / 'candidate-plan.json', 16384,
                                approval['candidatePlanRawSha256'], 0o600)
    plan = c.validate_plan(a.decode(raw_plan))
    a.require(plan['sourceRevision'] == source and plan['attemptId'] == attempt, 'CANDIDATE_APPROVAL_IDENTITY')
    inbox = Path('/var/lib/workspacex-cn/candidate-inbox') / source / attempt
    raw_set = legacy.protected(inbox / 'candidate-set.json', 256 * 1024,
                               approval['candidateSetRawSha256'], 0o600)
    raw_intent = legacy.protected(directory / 'publication-intent.json', 16384,
                                  approval['publicationIntentRawSha256'], 0o600)
    publication.validate_intent(raw_intent, approval['publicationIntentRawSha256'], plan,
        raw_set, approval['candidateSetRawSha256'], approval['candidatePlanRawSha256'])
    receipt = c.validate_receipt(raw_set, plan, approval['candidateSetRawSha256'])
    provider = legacy.protected(directory / 'immutable-provider-response.json', 1024**2,
        approval['immutableEvidence']['providerResponseSha256'], 0o600)
    a.validate_immutable_evidence(a.decode(provider), approval['immutableEvidence'])
    canonical_path = admit_canonical(directory, approval)
    for binary in approval['binaries'].values():
        legacy.protected(binary['path'], 256 * 1024**2, binary['sha256'], 0o755)
    remaining = approval['maxPublishSeconds'] - (time.monotonic() - started)
    a.require(remaining > 0, 'PUBLISH_DEADLINE')
    signal.alarm(max(1, int(remaining)))
    total = sum(item['size'] for item in receipt['images'].values())
    a.require(0 < total <= plan['maxTotalBytes'], 'CANDIDATE_TOTAL')
    # Check mode makes private snapshots for verification but no Docker/registry
    # calls, no lock acquisition and no final publication receipt.
    a.require(shutil.disk_usage('/var/tmp').free >= total * 4 + plan['storageMarginBytes'], 'SPOOL_CAPACITY')
    if operation == '--publish':
        a.require(shutil.disk_usage('/var/lib/docker').free >= total * 4 + plan['storageMarginBytes'], 'DOCKER_CAPACITY')
        a.require(os.statvfs('/var/lib/docker').f_favail >= 4096, 'PUBLISH_INODE_CAPACITY')
    with ExitStack() as pinned:
        streams = {s: pinned.enter_context(legacy.protected_stream(inbox / (s + '.tar'), plan['maxArchiveBytes']))
                   for s in a.REPOSITORIES}
        work = Path(pinned.enter_context(tempfile.TemporaryDirectory(prefix='wsx-candidate-publish-', dir='/var/tmp')))
        bundle = work / 'archives'; bundle.mkdir(mode=0o700)
        copy_snapshots(streams, bundle, receipt, plan)
        c.verify_bundle(bundle, plan, raw_set, approval['candidateSetRawSha256'], approval['candidatePlanRawSha256'])
        if operation == '--check-plan':
            print('CN_CANDIDATE_PLAN_VALIDATED publicationSideEffects=false')
            return
        with legacy.release_lock():
            # Legacy Commands uses buildPlan only to choose atomic receipt attempt;
            # this is an internal path accessor, never a v1 plan/label conversion.
            internal = dict(approval, buildPlan=plan)
            adapter = Commands(internal, a, canonical, canonical_path, work)
            adapter.approval_sha = approval_sha
            adapter.deadline = started + approval['maxPublishSeconds']
            adapter.archive_expiry = receipt['expiresAt']
            result = publication.publish(raw_plan, approval['candidatePlanRawSha256'], raw_set,
                approval['candidateSetRawSha256'], raw_intent, approval['publicationIntentRawSha256'], bundle, adapter)
    print('CN_CANDIDATE_PUBLISHED=' + a.json_bytes(result).decode())
