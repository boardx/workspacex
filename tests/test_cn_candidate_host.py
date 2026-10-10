"""Host admission and canonical binding tests; no credentials or Docker calls."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import cn_image_archive as a

# Production loads all siblings from a verified private closure. Reproduce that
# shape for local tests; never weaken production loader to import a repo path.
CLOSURE = tempfile.TemporaryDirectory()
for name, source in {'cn_candidate_host.py': ROOT / 'scripts/cn_candidate_host.py',
                     'import-cn-image-archives.py': ROOT / '.harness/scripts/vm/import-cn-image-archives.py'}.items():
    (Path(CLOSURE.name) / name).write_bytes(source.read_bytes())
spec = importlib.util.spec_from_file_location('host_under_test', Path(CLOSURE.name) / 'cn_candidate_host.py')
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)


def approval():
    now = datetime.now(timezone.utc)
    return dict(schemaVersion=2, kind='cn-candidate-host-approval-v2',
        candidatePlanRawSha256='1'*64, candidateSetRawSha256='2'*64, publicationIntentRawSha256='3'*64,
        issuedAt=now.isoformat(), expiresAt=(now+timedelta(minutes=30)).isoformat(), publishAuthorized=True,
        accountId=h.legacy.ACCOUNT, ecsInstanceId='i-uf6ga92ewloganobbln6', region='cn-shanghai',
        instanceId=a.INSTANCE, registryPrefix=a.PREFIX,
        immutableRepositories=list(a.REPOSITORIES.values()),
        immutableEvidence=dict(observedAt=now.isoformat(), accountId=h.legacy.ACCOUNT,
            instanceId=a.INSTANCE, region='cn-shanghai', namespace='workspacex-prod',
            repositories={r: dict(repositoryId='crr-test', immutable=True) for r in a.REPOSITORIES.values()},
            providerResponseSha256='4'*64),
        installedToolSha256={n:'5'*64 for n in h.CLOSURE}, canonicalConfigurationSha256='6'*64,
        binaries=dict(docker=dict(path='/usr/bin/docker', sha256='7'*64),
            buildx=dict(path='/usr/lib/docker/cli-plugins/docker-buildx', sha256='8'*64),
            aliyun=dict(path=h.legacy.ALIYUN, sha256=h.legacy.ALIYUN_SHA)),
        maxPublishSeconds=1200, sourceRevision='a'*40, attemptId='candidate-test')


class HostTests(unittest.TestCase):
    def test_approval_exact_schema_and_target(self):
        p = approval(); self.assertIs(h.validate_approval(p, 'a'*40, 'candidate-test'), p)
        for key, value in [('schemaVersion', True), ('kind', 'legacy'), ('publishAuthorized', False),
                           ('region', 'cn-hongkong'), ('sourceRevision', 'b'*40),
                           ('candidatePlanRawSha256', 'bad'), ('maxPublishSeconds', True)]:
            with self.subTest(key=key):
                bad = copy.deepcopy(p); bad[key] = value
                with self.assertRaises(ValueError): h.validate_approval(bad, 'a'*40, 'candidate-test')

    def test_unknown_field_and_expiry_rejected(self):
        p = approval(); p['transportFallback'] = True
        with self.assertRaisesRegex(ValueError, 'FIELDS'): h.validate_approval(p, 'a'*40, 'candidate-test')
        p = approval(); p['expiresAt'] = p['issuedAt']
        with self.assertRaisesRegex(ValueError, 'EXPIRED'): h.validate_approval(p, 'a'*40, 'candidate-test')

    def test_dynamic_import_closure_and_binary_required(self):
        for name in ('hosted-release.py', 'canonical_control.py', 'import-cn-image-archives.py'):
            p = approval(); del p['installedToolSha256'][name]
            with self.assertRaisesRegex(ValueError, 'CLOSURE'): h.validate_approval(p, 'a'*40, 'candidate-test')
        p = approval(); p['binaries']['aliyun']['sha256'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'ALIYUN'): h.validate_approval(p, 'a'*40, 'candidate-test')

    def test_stale_immutable_evidence_and_false_immutable(self):
        p = approval(); p['immutableEvidence']['observedAt'] = (datetime.now(timezone.utc)-timedelta(hours=2)).isoformat()
        with self.assertRaisesRegex(ValueError, 'EXPIRED'): h.validate_approval(p, 'a'*40, 'candidate-test')
        p = approval(); p['immutableEvidence']['repositories']['web']['immutable'] = False
        with self.assertRaisesRegex(ValueError, 'NOT_PROVEN'): h.validate_approval(p, 'a'*40, 'candidate-test')

    def test_snapshot_bounded_copy_and_private_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            h.copy_snapshots({'web': io.BytesIO(b'123')}, folder,
                {'images': {'web': {'size': 3}}}, {'maxArchiveBytes': 3})
            self.assertEqual((folder/'web.tar').read_bytes(), b'123')
            self.assertEqual((folder/'web.tar').stat().st_mode & 0o777, 0o600)
        for raw in (b'12', b'1234'):
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(ValueError, 'CHANGED'):
                    h.copy_snapshots({'web': io.BytesIO(raw)}, Path(directory),
                        {'images': {'web': {'size': 3}}}, {'maxArchiveBytes': 3})

    def test_adapter_uses_real_canonical_method_and_atomic_receipt_hook(self):
        instance = object.__new__(h.Commands)
        instance.plan = approval(); instance.approval_sha = '9'*64
        instance.check_validity = lambda: None
        instance.host_identity = {'ecsInstanceId': 'i-uf6ga92ewloganobbln6', 'region': 'cn-shanghai'}
        binding = {k: instance.plan[k] for k in ('candidatePlanRawSha256', 'candidateSetRawSha256', 'publicationIntentRawSha256')}
        binding.update(candidateIdentity='a'*64, sourceRevision='b'*40, controlRevision='c'*40,
            attemptId='candidate-test', redisImage=a.PREFIX+'/base-redis@sha256:'+'d'*64,
            redisObservedAt=datetime.now(timezone.utc).isoformat(), releaseReady=False, productionReady=False)
        inputs = dict(images={name: {'image': name+'@sha256:'+'f'*64} for name in ('web','api','agent','sandbox','postgres','redis')})
        def canonical(adapter, value):
            self.assertIs(adapter, instance)
            return adapter.receipt(value, b'canonical manifest', b'canonical seal')
        with patch.object(h.legacy.Commands, 'canonical_publish', canonical):
            result = instance.canonical_publish_candidate(inputs, binding)
        self.assertEqual(result['manifestSha256'], a.sha(b'canonical manifest'))
        self.assertEqual(result['images'], inputs['images'])
        self.assertEqual(result['hostApprovalRawSha256'], '9'*64)
        self.assertEqual(result['receiptKind'], 'cn-candidate-published-v2')
        self.assertFalse(result['productionActivated'])
        bad = dict(binding, candidateSetRawSha256='0'*64)
        with self.assertRaisesRegex(ValueError, 'BINDING'):
            instance.canonical_publish_candidate(inputs, bad)

    def test_host_identity_failure_precedes_all_credential_commands(self):
        cases = [([b'token', b'i-another'], 'HOST_INSTANCE_MISMATCH'),
                 ([b'token', b'i-uf6ga92ewloganobbln6', b'cn-hongkong'], 'HOST_REGION_MISMATCH'),
                 ([b''], 'HOST_METADATA_TOKEN_SHAPE'),
                 ([b'token\r\n'], 'HOST_METADATA_TOKEN_SHAPE'),
                 ([b'x'*4097], 'HOST_METADATA_TOKEN_SHAPE'),
                 ([a.Rejected('HOST_METADATA_REQUEST_REJECTED')], 'HOST_METADATA_REQUEST_REJECTED')]
        for responses, expected in cases:
            with self.subTest(expected=expected):
                adapter = object.__new__(h.Commands)
                adapter.plan = approval(); adapter.check_validity = lambda: None
                adapter.command = Mock()
                with patch.object(h, 'metadata_request', side_effect=responses):
                    with self.assertRaisesRegex(ValueError, expected): adapter.authenticate()
                adapter.command.assert_not_called()  # includes STS, ACR token and Docker login

    def test_exact_host_checked_before_real_inherited_acr_authentication(self):
        import time
        adapter = object.__new__(h.Commands)
        adapter.plan = approval(); adapter.check_validity = lambda: None
        adapter.c = a; adapter.docker = '/usr/bin/docker'
        events = []
        def metadata(method, path, headers):
            events.append(path)
            if method == 'PUT':
                self.assertEqual(headers, {'X-aliyun-ecs-metadata-token-ttl-seconds': '60'})
                return b'fixture-metadata-token'
            self.assertEqual(headers, {'X-aliyun-ecs-metadata-token': 'fixture-metadata-token'})
            return b'i-uf6ga92ewloganobbln6' if path.endswith('instance-id') else b'cn-shanghai'
        def command(argv, **kwargs):
            events.append(argv[2] if argv[0] == h.legacy.ALIYUN else 'docker-login')
            self.assertNotIn('fixture-metadata-token', str(argv))
            if argv[2] == 'GetCallerIdentity': return a.json_bytes({'AccountId': h.legacy.ACCOUNT})
            if argv[2] == 'GetAuthorizationToken':
                return a.json_bytes(dict(TempUsername='fixture', AuthorizationToken='fixture-acr-token',
                                        ExpireTime=int((time.time()+3600)*1000)))
            self.assertEqual(kwargs['stdin'].read(), b'fixture-acr-token')
            return b''
        adapter.command = command
        with patch.object(h, 'metadata_request', side_effect=metadata): adapter.authenticate()
        self.assertEqual(events, ['/latest/api/token', '/latest/meta-data/instance-id',
            '/latest/meta-data/region-id', 'GetCallerIdentity', 'GetAuthorizationToken', 'docker-login'])
        self.assertEqual(adapter.host_identity['ecsInstanceId'], 'i-uf6ga92ewloganobbln6')
        self.assertNotIn('token', str(adapter.host_identity))

    def test_metadata_transport_fixed_no_redirect_no_proxy_and_bounded(self):
        for status, payload, error in [(302, b'', None), (401, b'', None), (200, b'x'*4097, None),
                                       (200, b'', None), (200, b'', TimeoutError('private detail'))]:
            connection = Mock(); response = connection.getresponse.return_value
            response.status = status; response.read.return_value = payload
            if error: connection.request.side_effect = error
            with patch.object(h.http.client, 'HTTPConnection', return_value=connection) as factory, \
                 patch.dict(h.os.environ, {'HTTP_PROXY': 'http://untrusted.invalid:8080'}):
                with self.assertRaisesRegex(ValueError, '^HOST_METADATA_REQUEST_REJECTED$'):
                    h.metadata_request('PUT', '/latest/api/token', {})
                factory.assert_called_once_with('100.100.100.200', 80, timeout=2)
                connection.request.assert_called_once()  # no redirect/retry
                connection.close.assert_called_once()
                if status == 200 and not error: response.read.assert_called_once_with(4097)
        with patch.object(h.http.client, 'HTTPConnection') as factory:
            with self.assertRaisesRegex(ValueError, 'HOST_METADATA_ENDPOINT'):
                h.metadata_request('GET', 'http://untrusted.invalid/', {})
            factory.assert_not_called()

    def test_entry_rejects_unisolated_invocation_before_host_read(self):
        entry = ROOT / '.harness/scripts/vm/import-cn-image-candidates.py'
        spec = importlib.util.spec_from_file_location('candidate_entry_test', entry)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with patch.object(sys, 'argv', [str(entry), '--publish', 'a'*40, 'candidate-test', 'b'*64]), \
             patch.object(module, 'protected') as read:
            with self.assertRaisesRegex(ValueError, 'ISOLATED_ROOT_REQUIRED'): module.main()
            read.assert_not_called()

if __name__ == '__main__':
    unittest.main()
