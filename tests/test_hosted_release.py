"""Behavioral contracts with a fully synthetic Docker/Git/Node subprocess boundary."""
import copy
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import tarfile
import unittest
import sys
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('hosted_release', Path(__file__).resolve().parents[1] / 'scripts/hosted-release.py')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
h = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(h)
import canonical_control as control
SHA = 'a' * 40
DIGEST = 'b' * 64


def fixture():
    return dict(schemaVersion=1, sourceRevision=SHA, release='2026.10.7-cn.1',
                attemptId='gha-123-1', platform='linux/amd64',
                registryPrefix='reviewed.cn-hongkong.cr.aliyuncs.com/workspacex',
                registryProbeImage='reviewed.cn-hongkong.cr.aliyuncs.com/workspacex/probe@sha256:' + DIGEST,
                acrRegion='cn-hongkong', acrInstanceId='cri-reviewed123',
                baseImages={k: f'base.example/library/{k}@sha256:{DIGEST}'
                            for k in ('node', 'python', 'postgres', 'redis')})


class HostBoundary:
    """Fake process results, not replacement implementation functions."""
    def __init__(self, plan, fail_build=False, revision=None, registry_digest=None, existing_tag=False, missing_build_label=False):
        self.plan = plan
        self.fail_build = fail_build
        self.revision = revision or plan['sourceRevision']
        self.registry_digest = registry_digest or DIGEST
        self.calls = []
        self.existing_tag = existing_tag
        self.missing_build_label = missing_build_label

    def __call__(self, argv, **kwargs):
        self.calls.append((argv, kwargs))
        code, out, err = 0, '', ''
        if argv[:3] == ['git', 'rev-parse', 'HEAD']:
            out = self.revision + '\n'
        elif argv[:3] == ['git', 'rev-parse', '--is-shallow-repository']:
            out = 'false\n'
        elif argv[:3] == ['git', 'config', '--get']:
            code = 1
        elif argv[:2] == ['git', 'archive']:
            output = argv[argv.index('--output') + 1]
            with tarfile.open(output, 'w'):
                pass
        elif argv[:3] == ['docker', 'manifest', 'inspect']:
            if not self.existing_tag:
                code, err = 1, 'manifest unknown'
        elif argv[:3] == ['docker', 'buildx', 'build'] and self.fail_build:
            code, err = 1, 'synthetic build failure'
        elif argv[:3] == ['docker', 'image', 'inspect']:
            image = argv[-1]
            repository = image.split('@')[0] if '@' in image else image.rsplit(':', 1)[0]
            labels = {'org.opencontainers.image.revision': self.revision}
            if not self.missing_build_label:
                labels[h.BUILD_IDENTITY_LABEL] = h.build_identity(self.plan)
            out = json.dumps([dict(Os='linux', Architecture='amd64',
                Config={'Labels': labels},
                RepoDigests=[repository + '@sha256:' + DIGEST])])
        elif argv[:4] == ['docker', 'buildx', 'imagetools', 'inspect']:
            digest = DIGEST if argv[-1] == self.plan['registryProbeImage'] else self.registry_digest
            out = 'Digest: sha256:' + digest + '\n'
        elif Path(argv[0]).name == 'node':
            # Model the successful file protocol of the canonical TS CLI.
            # The actual CLI must be validated separately by repository tests.
            if argv[3].endswith('release-manifest-cli.ts'):
                Path(argv[5]).write_text(Path(argv[4]).read_text())
            elif argv[4] == 'seal':
                Path(argv[6]).write_text(json.dumps({'sourceRevision': self.plan['sourceRevision']}))
        return subprocess.CompletedProcess(argv, code, out, err)


class HostedReleaseContracts(unittest.TestCase):
    def test_build_identity_label_required_for_all_five_builds_redis_exempt(self):
        boundary = HostBoundary(self.plan, missing_build_label=True)
        with self.subprocesses(boundary):
            for service, mapping in h.SERVICES.items():
                with self.subTest(service=service), self.assertRaisesRegex(ValueError, 'IMAGE_BUILD_IDENTITY_MISMATCH'):
                    h.inspection(self.plan['registryPrefix'] + '/' + mapping[0] + '@sha256:' + DIGEST, self.plan, service, {})
            self.assertEqual(h.inspection(self.plan['baseImages']['redis'], self.plan, 'redis', {}), self.plan['baseImages']['redis'])

    def test_stable_build_identity_excludes_release_attempt_and_registry(self):
        original = h.validate_input(fixture())
        changed = copy.deepcopy(original)
        changed.update(release='2026.10.8-cn.1', attemptId='gha-999-2', registryPrefix='other.example/workspacex')
        self.assertEqual(h.build_identity(original), h.build_identity(changed))

    def test_existing_tag_wrong_base_source_or_legacy_label_never_overwritten(self):
        for mutation in ('base', 'package-source', 'legacy'):
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(self.plan)
                if mutation == 'base':
                    changed['baseImages']['node'] = 'base.example/library/node@sha256:' + 'e' * 64
                elif mutation == 'package-source':
                    changed['packageSources']['npmRegistry'] = 'https://reviewed-other.example/npm'
                boundary = HostBoundary(self.plan, existing_tag=True, missing_build_label=mutation == 'legacy')
                output = self.root / ('result-' + mutation + '.json')
                with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), self.subprocesses(boundary):
                    with self.assertRaisesRegex(ValueError, 'IMAGE_BUILD_IDENTITY_MISMATCH'):
                        h.build(changed, 'api', output)
                self.assertFalse(output.exists())
                self.assertFalse(any(argv[:3] == ['docker', 'buildx', 'build'] or argv[:2] == ['docker', 'push'] for argv, _ in boundary.calls))

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.plan = h.validate_input(fixture())
        self.plan['_planSha256'] = 'd' * 64
        self.control_root = self.root / 'control'; self.control_root.mkdir()
        self.node = self.root / 'node'; self.node.write_bytes(b'synthetic-node-boundary')
        self.control_files = {}
        for relative in control.REQUIRED_SOURCE | {'node_modules/tsx/package.json', 'node_modules/zod/package.json'}:
            path = self.control_root / relative; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic-reviewed-file')
            self.control_files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.control_config = self.root / 'control.json'
        self.control_config.write_text(json.dumps(dict(schemaVersion=1, nodeExecutable=str(self.node), nodeSha256=hashlib.sha256(self.node.read_bytes()).hexdigest(), checkoutDirectory=str(self.control_root), fileSha256=self.control_files)))
        self.control_sha = hashlib.sha256(self.control_config.read_bytes()).hexdigest()

    def aggregate(self, plan, directory, output):
        return h.aggregate(plan, directory, output, self.control_config, self.control_sha)

    def results(self):
        directory = self.root / 'results'
        directory.mkdir()
        for service, spec in h.SERVICES.items():
            value = {k: self.plan[k] for k in ('sourceRevision', 'attemptId', 'platform')}
            value.update(service=service, image=self.plan['registryPrefix'] + '/' + spec[0] + '@sha256:' + DIGEST, planSha256=self.plan['_planSha256'])
            (directory / (service + '.json')).write_text(json.dumps(value))
        return directory

    def subprocesses(self, boundary):
        return patch.object(h.subprocess, 'run', side_effect=boundary)

    def test_input_rejects_nonexact_sha_region_registry_and_mutable_bases(self):
        mutations = [('sourceRevision', 'main'), ('sourceRevision', 'a' * 39),
                     ('acrRegion', 'ap-southeast-1'), ('acrRegion', 'cn-shanghai'),
                     ('registryPrefix', 'https://registry.example/ns'),
                     ('registryPrefix', 'registry.example/ns/../../escape')]
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                data = fixture(); data[field] = value
                with self.assertRaises(ValueError):
                    h.validate_input(data)
        data = fixture(); data['baseImages']['node'] = 'node:22'
        with self.assertRaisesRegex(ValueError, 'REVIEWED_DIGEST_REQUIRED'):
            h.validate_input(data)

    def test_source_mismatch_stops_before_docker(self):
        path = self.root / 'plan.json'
        path.write_text(json.dumps({k: v for k, v in self.plan.items() if not k.startswith('_')} | {'services': list(h.SERVICES)}))
        boundary = HostBoundary(self.plan, revision='c' * 40)
        with self.subprocesses(boundary), self.assertRaisesRegex(ValueError, 'CHECKOUT_SHA_MISMATCH'):
            h.load_plan(path)
        self.assertFalse(any(argv[0] == 'docker' for argv, _ in boundary.calls))

    def test_missing_service_never_seals(self):
        directory = self.results(); (directory / 'api.json').unlink()
        self.assert_aggregate_rejected(directory, 'RESULT_COUNT_MISMATCH')

    def test_duplicate_service_never_seals(self):
        directory = self.results()
        (directory / 'web.json').write_text((directory / 'api.json').read_text())
        self.assert_aggregate_rejected(directory, 'DUPLICATE_OR_UNKNOWN_SERVICE')

    def test_cross_attempt_source_platform_and_namespace_never_seal(self):
        directory = self.results(); path = directory / 'api.json'; original = json.loads(path.read_text())
        for field, value, code in [('attemptId', 'gha-123-2', 'RESULT_IDENTITY_MISMATCH'),
                                 ('sourceRevision', 'c' * 40, 'RESULT_IDENTITY_MISMATCH'),
                                 ('platform', 'linux/arm64', 'RESULT_IDENTITY_MISMATCH'),
                                 ('image', 'foreign.example/ns/api@sha256:' + DIGEST, 'RESULT_NAMESPACE_MISMATCH')]:
            with self.subTest(field=field):
                path.write_text(json.dumps(original | {field: value}))
                self.assert_aggregate_rejected(directory, code)

    def assert_aggregate_rejected(self, directory, code):
        boundary = HostBoundary(self.plan); target = self.root / 'sealed'
        with self.subprocesses(boundary), self.assertRaisesRegex(ValueError, code):
            self.aggregate(self.plan, directory, target)
        self.assertFalse((target / 'artifact-build.json').exists())
        self.assertFalse((target / 'release.sealed.json').exists())
        self.assertEqual(boundary.calls, [])

    def test_failed_build_creates_no_result_and_incomplete_attempt_cannot_seal(self):
        directory = self.results(); result = directory / 'api.json'; result.unlink()
        boundary = HostBoundary(self.plan, fail_build=True)
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), self.subprocesses(boundary):
            with self.assertRaisesRegex(RuntimeError, 'COMMAND_FAILED_DOCKER'):
                h.build(self.plan, 'api', result)
        self.assertFalse(result.exists())
        self.assertFalse(any(argv[:2] == ['docker', 'push'] for argv, _ in boundary.calls))
        self.assert_aggregate_rejected(directory, 'RESULT_COUNT_MISMATCH')

    def test_successful_seal_has_no_production_authorization(self):
        directory = self.results(); target = self.root / 'sealed'; boundary = HostBoundary(self.plan)
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), self.subprocesses(boundary):
            self.aggregate(self.plan, directory, target)
        receipt = json.loads((target / 'artifact-build.json').read_text())
        self.assertTrue(receipt['artifactsVerified'])
        for flag in ('ready', 'prepared', 'productionActivated'):
            self.assertIs(receipt[flag], False)
        self.assertEqual(receipt['attemptId'], self.plan['attemptId'])
        self.assertEqual(receipt['stage'], 'hosted-artifact-build')
        self.assertEqual(receipt['planSha256'], self.plan['_planSha256'])
        self.assertEqual(receipt['manifestSha256'], hashlib.sha256((target / 'release.json').read_bytes()).hexdigest())
        self.assertEqual(receipt['sealSha256'], hashlib.sha256((target / 'release.sealed.json').read_bytes()).hexdigest())
        self.assertEqual(receipt['controlToolSha256'], hashlib.sha256(Path(h.__file__).read_bytes()).hexdigest())
        self.assertEqual(receipt['canonicalControlSha256'], self.control_sha)
        self.assertEqual(receipt['canonicalNodeSha256'], hashlib.sha256(self.node.read_bytes()).hexdigest())
        for field in ('release', 'platform', 'registryPrefix', 'sourceRevision'):
            self.assertEqual(receipt[field], self.plan[field])
        ttl = (datetime.fromisoformat(receipt['expiresAt']) - datetime.fromisoformat(receipt['issuedAt'])).total_seconds()
        self.assertGreater(ttl, 0)
        self.assertLessEqual(ttl, 3600)
        self.assertEqual(receipt['clockSource'], 'runner-system-clock-unattested')
        manifest = json.loads((target / 'release.json').read_text())
        self.assertEqual(set(manifest['images']), set(h.SERVICES) | {'redis'})
        self.assertEqual(sum(argv[:3] == ['docker', 'image', 'inspect'] for argv, _ in boundary.calls), 6)

    def test_registry_readback_mismatch_prevents_receipt_and_seal(self):
        directory = self.results(); target = self.root / 'sealed'
        boundary = HostBoundary(self.plan, registry_digest='c' * 64)
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), self.subprocesses(boundary):
            with self.assertRaisesRegex(ValueError, 'REGISTRY_DIGEST_MISMATCH'):
                self.aggregate(self.plan, directory, target)
        self.assertFalse((target / 'artifact-build.json').exists())
        self.assertFalse((target / 'release.sealed.json').exists())

    def test_image_source_mismatch_prevents_seal(self):
        directory = self.results(); target = self.root / 'sealed'
        boundary = HostBoundary(self.plan, revision='c' * 40)
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), self.subprocesses(boundary):
            with self.assertRaisesRegex(ValueError, 'IMAGE_REVISION_MISMATCH'):
                self.aggregate(self.plan, directory, target)
        self.assertFalse((target / 'artifact-build.json').exists())
        self.assertFalse((target / 'release.sealed.json').exists())

    def test_successful_build_credentials_only_on_login_stdin(self):
        output = self.root / 'api.json'; boundary = HostBoundary(self.plan)
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), self.subprocesses(boundary):
            h.build(self.plan, 'api', output)
        result = json.loads(output.read_text())
        self.assertEqual(result['attemptId'], self.plan['attemptId'])
        docker_calls = [(argv, kwargs) for argv, kwargs in boundary.calls if argv[0] == 'docker']
        builds = [argv for argv, _ in docker_calls if argv[:3] == ['docker', 'buildx', 'build']]
        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0][builds[0].index('--label') + 1], h.BUILD_IDENTITY_LABEL + '=' + h.build_identity(self.plan))
        logins = [(argv, kwargs) for argv, kwargs in docker_calls if argv[1] == 'login']
        self.assertEqual(len(logins), 1)
        self.assertEqual(logins[0][1]['input'], 'synthetic-secret')
        for argv, kwargs in docker_calls:
            self.assertNotIn('synthetic-secret', ' '.join(argv))
            self.assertNotIn('ACR_TOKEN', kwargs['env'])
            self.assertNotIn('ACR_USERNAME', kwargs['env'])
        config = Path(logins[0][1]['env']['DOCKER_CONFIG'])
        self.assertFalse(config.exists())

    def test_cross_plan_same_source_and_attempt_never_seals(self):
        directory = self.results()
        path = directory / 'api.json'
        value = json.loads(path.read_text()); value['planSha256'] = 'e' * 64
        path.write_text(json.dumps(value))
        self.assert_aggregate_rejected(directory, 'RESULT_PLAN_MISMATCH')

    def test_changed_release_or_base_images_cannot_mix_same_attempt(self):
        for change in ('release', 'baseImages'):
            with self.subTest(change=change):
                directory = self.root / change; directory.mkdir()
                changed = copy.deepcopy(self.plan)
                if change == 'release':
                    changed['release'] = '2026.10.8-cn.1'
                else:
                    changed['baseImages']['node'] = 'base.example/library/node@sha256:' + 'e' * 64
                changed_path = self.root / (change + '-plan.json')
                changed_path.write_text(json.dumps({k: v for k, v in changed.items() if not k.startswith('_')} | {'services': list(h.SERVICES)}))
                with self.subprocesses(HostBoundary(changed)):
                    changed_plan = h.load_plan(changed_path)
                for service, spec in h.SERVICES.items():
                    value = {k: self.plan[k] for k in ('sourceRevision', 'attemptId', 'platform')}
                    value.update(service=service, image=self.plan['registryPrefix'] + '/' + spec[0] + '@sha256:' + DIGEST, planSha256=self.plan['_planSha256'])
                    (directory / (service + '.json')).write_text(json.dumps(value))
                target = self.root / (change + '-sealed')
                boundary = HostBoundary(changed_plan)
                with self.subprocesses(boundary), self.assertRaisesRegex(ValueError, 'RESULT_PLAN_MISMATCH'):
                    self.aggregate(changed_plan, directory, target)
                self.assertEqual(boundary.calls, [])
                self.assertFalse((target / 'artifact-build.json').exists())

    def test_load_plan_hashes_exact_bytes(self):
        path = self.root / 'plan.json'
        data = {k: v for k, v in self.plan.items() if not k.startswith('_')} | {'services': list(h.SERVICES)}
        path.write_text(json.dumps(data, indent=3) + '\n')
        with self.subprocesses(HostBoundary(self.plan)):
            loaded = h.load_plan(path)
        self.assertEqual(loaded['_planSha256'], hashlib.sha256(path.read_bytes()).hexdigest())

    def test_external_registry_probe_is_rejected(self):
        value = fixture(); value['registryProbeImage'] = value['baseImages']['redis']
        with self.assertRaisesRegex(ValueError, 'TARGET_REGISTRY_PROBE_REQUIRED'):
            h.validate_input(value)

    def test_failed_target_auth_probe_never_builds_or_seals(self):
        boundary = HostBoundary(self.plan)
        def fail_probe(argv, **kwargs):
            if argv[:4] == ['docker', 'buildx', 'imagetools', 'inspect'] and argv[-1] == self.plan['registryProbeImage']:
                boundary.calls.append((argv, kwargs))
                return subprocess.CompletedProcess(argv, 1, '', 'synthetic auth denied')
            return boundary(argv, **kwargs)
        output = self.root / 'api.json'
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), patch.object(h.subprocess, 'run', side_effect=fail_probe):
            with self.assertRaisesRegex(RuntimeError, 'COMMAND_FAILED_DOCKER'):
                h.build(self.plan, 'api', output)
        self.assertFalse(output.exists())
        self.assertFalse(any(argv[:3] == ['docker', 'buildx', 'build'] for argv, _ in boundary.calls))

    def test_target_probe_digest_mismatch_never_seals(self):
        directory = self.results(); target = self.root / 'sealed'; boundary = HostBoundary(self.plan)
        def mismatch(argv, **kwargs):
            if argv[:4] == ['docker', 'buildx', 'imagetools', 'inspect'] and argv[-1] == self.plan['registryProbeImage']:
                return subprocess.CompletedProcess(argv, 0, 'Digest: sha256:' + 'c' * 64 + '\n', '')
            return boundary(argv, **kwargs)
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), patch.object(h.subprocess, 'run', side_effect=mismatch):
            with self.assertRaisesRegex(ValueError, 'TARGET_REGISTRY_PROBE_MISMATCH'):
                self.aggregate(self.plan, directory, target)
        self.assertFalse((target / 'artifact-build.json').exists())
        self.assertFalse((target / 'release.sealed.json').exists())

    def test_canonical_validator_failure_never_publishes_success_receipt(self):
        directory = self.results(); target = self.root / 'sealed'; boundary = HostBoundary(self.plan)
        def reject_validation(argv, **kwargs):
            if Path(argv[0]).name == 'node' and len(argv) > 4 and argv[4] == 'validate':
                return subprocess.CompletedProcess(argv, 1, '', 'synthetic canonical reject')
            return boundary(argv, **kwargs)
        with patch.dict(h.os.environ, {'ACR_USERNAME': 'synthetic-user', 'ACR_TOKEN': 'synthetic-secret'}), patch.object(h.subprocess, 'run', side_effect=reject_validation):
            with self.assertRaisesRegex(RuntimeError, 'COMMAND_FAILED_NODE'):
                self.aggregate(self.plan, directory, target)
        self.assertFalse((target / 'artifact-build.json').exists())

    def test_independent_control_hash_mismatch_rejects_before_registry(self):
        directory = self.results(); target = self.root / 'sealed'; boundary = HostBoundary(self.plan)
        with self.subprocesses(boundary), self.assertRaisesRegex(ValueError, 'CONTROL_CONFIGURATION_HASH_MISMATCH'):
            h.aggregate(self.plan, directory, target, self.control_config, 'e' * 64)
        self.assertEqual(boundary.calls, [])
        self.assertFalse((target / 'artifact-build.json').exists())

    def test_modified_control_node_or_source_rejects_before_registry(self):
        directory = self.results()
        for index, path in enumerate([self.node, self.control_root / sorted(control.REQUIRED_SOURCE)[0]]):
            with self.subTest(path=path.name):
                original = path.read_bytes(); path.write_bytes(original + b'modified')
                boundary = HostBoundary(self.plan); target = self.root / ('sealed-' + str(index))
                with self.subprocesses(boundary), self.assertRaises(ValueError):
                    self.aggregate(self.plan, directory, target)
                self.assertEqual(boundary.calls, [])
                self.assertFalse((target / 'artifact-build.json').exists())
                path.write_bytes(original)

    def test_missing_control_dependency_rejects_before_registry(self):
        directory = self.results(); target = self.root / 'sealed'; boundary = HostBoundary(self.plan)
        (self.control_root / 'node_modules/tsx/package.json').unlink()
        with self.subprocesses(boundary), self.assertRaisesRegex(ValueError, 'CONTROL_FILE_MISSING'):
            self.aggregate(self.plan, directory, target)
        self.assertEqual(boundary.calls, [])
        self.assertFalse((target / 'artifact-build.json').exists())

    def test_canonical_process_uses_snapshot_and_strips_ambient_node_configuration(self):
        directory = self.results(); target = self.root / 'sealed'; boundary = HostBoundary(self.plan)
        polluted = dict(ACR_USERNAME='synthetic-user', ACR_TOKEN='synthetic-secret', NODE_OPTIONS='--require /unreviewed/inject.js', NODE_PATH='/unreviewed/deps', TSX_TSCONFIG_PATH='/unreviewed/tsconfig.json', ESBUILD_BINARY_PATH='/unreviewed/esbuild')
        with patch.dict(h.os.environ, polluted), self.subprocesses(boundary):
            self.aggregate(self.plan, directory, target)
        nodes = [(argv, kw) for argv, kw in boundary.calls if Path(argv[0]).name == 'node']
        self.assertEqual(len(nodes), 3)
        for argv, kw in nodes:
            self.assertNotEqual(argv[0], str(self.node))
            self.assertNotEqual(kw['cwd'], str(self.control_root))
            for key in ('NODE_OPTIONS', 'TSX_TSCONFIG_PATH', 'ESBUILD_BINARY_PATH', 'ACR_TOKEN', 'ACR_USERNAME'):
                self.assertNotIn(key, kw['env'])
            self.assertEqual(kw['env']['NODE_PATH'], '')
        self.assertFalse(Path(nodes[0][0][0]).exists())

    def test_portable_control_snapshot_resolves_relative_to_configuration(self):
        node = self.control_root / 'tools/node/bin/node'; node.parent.mkdir(parents=True)
        node.write_bytes(self.node.read_bytes())
        value = json.loads(self.control_config.read_text())
        value.update(nodeExecutable='tools/node/bin/node', checkoutDirectory='.')
        config = self.control_root / 'portable-control.json'; config.write_text(json.dumps(value))
        expected = hashlib.sha256(config.read_bytes()).hexdigest()
        with control.canonical_snapshot(config, expected) as snapshot:
            self.assertEqual(Path(snapshot['nodeExecutable']).read_bytes(), node.read_bytes())
            self.assertEqual((Path(snapshot['directory']) / 'node_modules/tsx/package.json').read_bytes(), (self.control_root / 'node_modules/tsx/package.json').read_bytes())
            self.assertEqual(snapshot['configurationSha256'], expected)

    def test_relative_control_path_traversal_rejects_even_with_matching_configuration_hash(self):
        value = json.loads(self.control_config.read_text())
        for field, unsafe in [('nodeExecutable', '../node'), ('checkoutDirectory', '../control'), ('nodeExecutable', 'tools/../node')]:
            with self.subTest(field=field, path=unsafe):
                changed = value | {field: unsafe}
                self.control_config.write_text(json.dumps(changed))
                expected = hashlib.sha256(self.control_config.read_bytes()).hexdigest()
                with self.assertRaises(ValueError):
                    with control.canonical_snapshot(self.control_config, expected):
                        self.fail('unsafe relative path admitted')


if __name__ == '__main__':
    unittest.main()
