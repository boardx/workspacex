"""Real local artifact inputs; canonical process stub grants no production authority."""
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import canonical_control as control
VERIFIER = ROOT / 'scripts/verify-hosted-handoff.py'
SHA = 'a' * 40
DIGEST = 'b' * 64
SERVICES = {'api': 'api', 'web': 'web', 'agent': 'deep-agent', 'sandbox': 'skill-sandbox', 'postgres': 'postgres-age', 'redis': 'redis'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


class HostedHandoffContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT)
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.sealed = self.root / 'sealed'; self.sealed.mkdir()
        self.output = self.root / 'evidence.json'
        self.plan_path = self.root / 'plan.json'
        self.expected_path = self.root / 'expected.json'
        spec = importlib.util.spec_from_file_location('handoff_verifier', VERIFIER)
        self.verifier = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.verifier)
        registry = 'reviewed.cn-hongkong.cr.aliyuncs.com/workspacex'
        self.identity = dict(sourceRevision=SHA, release='2026.10.7-cn.1', attemptId='gha-123-1', platform='linux/amd64', registryPrefix=registry, acrRegion='cn-hongkong', acrInstanceId='cri-fixture123')
        self.plan = dict(schemaVersion=1, **self.identity,
            registryProbeImage=registry + '/probe@sha256:' + DIGEST,
            baseImages={key: 'base.example/library/' + key + '@sha256:' + DIGEST for key in ('node', 'python', 'postgres', 'redis')},
            services=['api', 'web', 'agent', 'sandbox', 'postgres'])
        write(self.plan_path, self.plan)
        images = {key: {'image': registry + '/' + repository + '@sha256:' + DIGEST} for key, repository in SERVICES.items()}
        images['redis'] = {'image': self.plan['baseImages']['redis']}
        self.manifest = dict(schemaVersion=1, release=self.identity['release'], sourceRevision=SHA, platform='linux/amd64', images=images)
        write(self.sealed / 'build-input.json', self.manifest)
        write(self.sealed / 'release.json', self.manifest)
        now = datetime.now(timezone.utc)
        self.seal = dict(schemaVersion=1, status='sealed', sourceRevision=SHA, manifestSha256=digest(self.sealed / 'release.json'), sealedAt=now.isoformat())
        write(self.sealed / 'release.sealed.json', self.seal)
        self.receipt = dict(schemaVersion=1, receiptKind='hosted-artifact-build-draft-v1', stage='hosted-artifact-build', **self.identity,
            manifestSha256=digest(self.sealed / 'release.json'), sealSha256=digest(self.sealed / 'release.sealed.json'),
            planSha256=digest(self.plan_path), controlToolSha256=digest(ROOT / 'scripts/hosted-release.py'),
            issuedAt=now.isoformat(), expiresAt=(now + timedelta(hours=1)).isoformat(), clockSource='runner-system-clock-unattested',
            services=list(SERVICES), artifactsVerified=True, ready=False, prepared=False, productionActivated=False)
        self.save_receipt()
        self.prepare_expected()

    def save_receipt(self):
        write(self.sealed / 'artifact-build.json', self.receipt)

    def prepare_expected(self):
        """Synthetic canonical executable; hashes and all handoff inputs are real."""
        checkout = self.root / 'control'; sources = checkout / 'packages/cloud-deploy/src'
        sources.mkdir(parents=True)
        package = checkout / 'package.json'; package.write_text('{"type":"module"}\n')
        hashes = {}
        for relative in control.REQUIRED_SOURCE | {'node_modules/tsx/package.json', 'node_modules/zod/package.json'}:
            path = checkout / relative; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('synthetic canonical process boundary\n')
            hashes[relative] = digest(path)
        self.modules_fixture = checkout / 'node_modules/tsx/package.json'
        node = self.root / 'node'; node.write_text('#!/bin/sh\nexit 0\n'); node.chmod(0o700)
        self.node = node
        self.control_config = self.root / 'control.json'
        self.control_value = dict(schemaVersion=1, nodeExecutable=str(node), nodeSha256=digest(node), checkoutDirectory=str(checkout), fileSha256=hashes)
        write(self.control_config, self.control_value)
        self.control_sha = digest(self.control_config)
        self.expected = self.identity | {
            'expectedPythonToolHash': digest(ROOT / 'scripts/hosted-release.py'),
            'expectedCanonicalControlSha256': self.control_sha,
            'expectedCanonicalVerifierHash': digest(ROOT / 'scripts/canonical_control.py')}
        write(self.expected_path, self.expected)
        self.receipt.update(canonicalControlSha256=self.control_sha, canonicalNodeSha256=digest(node), canonicalVerifierSha256=digest(ROOT / 'scripts/canonical_control.py'))
        self.save_receipt()

    def invoke(self):
        return subprocess.run([sys.executable, '-B', str(VERIFIER), '--plan', str(self.plan_path), '--sealed-dir', str(self.sealed), '--expected', str(self.expected_path), '--output', str(self.output), '--control', str(self.control_config), '--control-sha256', self.control_sha], capture_output=True, text=True)

    def rejects(self):
        result = self.invoke()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.output.exists())

    def rebind_manifest(self):
        write(self.sealed / 'build-input.json', self.manifest)
        write(self.sealed / 'release.json', self.manifest)
        self.seal['manifestSha256'] = digest(self.sealed / 'release.json')
        write(self.sealed / 'release.sealed.json', self.seal)
        self.receipt['manifestSha256'] = digest(self.sealed / 'release.json')
        self.receipt['sealSha256'] = digest(self.sealed / 'release.sealed.json')
        self.save_receipt()

    def test_valid_artifact_handoff_grants_no_production_authority(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = json.loads(self.output.read_text())
        self.assertIs(evidence['handoffValidated'], True)
        self.assertIs(evidence['prepared'], False)
        self.assertIs(evidence['productionActivated'], False)

    def test_identity_mix_is_rejected(self):
        for field, bad in [('sourceRevision', 'c' * 40), ('attemptId', 'gha-123-2'), ('release', '2026.10.8-cn.1'), ('platform', 'linux/arm64')]:
            with self.subTest(field=field):
                original = self.receipt[field]; self.receipt[field] = bad; self.save_receipt()
                self.rejects(); self.receipt[field] = original

    def test_artifact_byte_tampering_is_rejected(self):
        for name in ('release.json', 'release.sealed.json'):
            with self.subTest(file=name):
                path = self.sealed / name; original = path.read_bytes(); path.write_bytes(original + b' ')
                self.rejects(); path.write_bytes(original)
        original = self.plan_path.read_bytes(); self.plan_path.write_bytes(original + b' ')
        self.rejects(); self.plan_path.write_bytes(original)

    def test_expired_and_overlong_receipts_are_rejected(self):
        now = datetime.now(timezone.utc)
        for issued, expiry in [(now - timedelta(hours=2), now - timedelta(hours=1)), (now, now + timedelta(seconds=3601))]:
            self.receipt.update(issuedAt=issued.isoformat(), expiresAt=expiry.isoformat()); self.save_receipt(); self.rejects()

    def test_forged_production_flags_are_rejected(self):
        for flag in ('ready', 'prepared', 'productionActivated'):
            with self.subTest(flag=flag):
                self.receipt[flag] = True; self.save_receipt(); self.rejects(); self.receipt[flag] = False

    def test_missing_or_duplicate_service_is_rejected(self):
        original = self.receipt['services']
        for services in [original[:-1], original + ['api']]:
            self.receipt['services'] = services; self.save_receipt(); self.rejects()

    def test_unreviewed_producer_tool_hash_is_rejected(self):
        self.receipt['controlToolSha256'] = 'e' * 64; self.save_receipt(); self.rejects()

    def test_foreign_namespace_with_rebound_hashes_is_rejected(self):
        self.manifest['images']['api']['image'] = 'foreign.example/ns/api@sha256:' + DIGEST
        self.rebind_manifest(); self.rejects()

    def test_foreign_postgres_namespace_with_rebound_hashes_is_rejected(self):
        self.manifest['images']['postgres']['image'] = 'foreign.example/ns/postgres-age@sha256:' + DIGEST
        self.rebind_manifest(); self.rejects()

    def test_manifest_version_mix_with_rebound_hashes_is_rejected(self):
        self.manifest['sourceRevision'] = 'c' * 40
        self.rebind_manifest(); self.rejects()

    def test_missing_manifest_service_with_rebound_hashes_is_rejected(self):
        del self.manifest['images']['sandbox']
        self.rebind_manifest(); self.rejects()

    def test_duplicate_json_service_key_is_rejected(self):
        path = self.sealed / 'release.json'
        text = path.read_text()
        text = text.replace('"api": {', '"web": {', 1)
        path.write_text(text)
        self.rejects()

    def test_control_dependency_and_node_byte_drift_is_rejected(self):
        for path in [self.node, self.modules_fixture]:
            with self.subTest(path=path.name):
                original = path.read_bytes(); path.write_bytes(original + b'changed')
                self.rejects(); path.write_bytes(original)

    def test_failed_canonical_process_creates_no_success_evidence(self):
        node = self.node
        node.write_text('#!/bin/sh\nexit 1\n')
        self.control_value['nodeSha256'] = digest(node)
        write(self.control_config, self.control_value)
        self.control_sha = digest(self.control_config)
        self.expected['expectedCanonicalControlSha256'] = self.control_sha
        write(self.expected_path, self.expected)
        self.receipt.update(canonicalControlSha256=self.control_sha, canonicalNodeSha256=digest(node))
        self.save_receipt()
        self.rejects()

    def invoke_stage(self, destination):
        return subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/stage-hosted-handoff.py'), '--plan', str(self.plan_path), '--sealed-dir', str(self.sealed), '--expected', str(self.expected_path), '--control', str(self.control_config), '--control-sha256', self.control_sha, '--staging-dir', str(destination)], capture_output=True, text=True)

    def test_offline_staging_publishes_only_three_files_without_production_authority(self):
        destination = self.root / 'staged'
        result = self.invoke_stage(destination)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual({path.name for path in destination.iterdir()}, {'release.json', 'release.sealed.json', 'offline-import.json'})
        for name in ('release.json', 'release.sealed.json'):
            self.assertEqual((destination / name).read_bytes(), (self.sealed / name).read_bytes())
        imported = json.loads((destination / 'offline-import.json').read_text())
        for flag in ('prepared', 'productionActivated', 'cloudVerified', 'productionInstallAuthorized'):
            self.assertIs(imported[flag], False)

    def test_offline_staging_rejects_tamper_before_destination_exists(self):
        destination = self.root / 'staged'
        path = self.sealed / 'release.json'; path.write_bytes(path.read_bytes() + b' ')
        result = self.invoke_stage(destination)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(destination.exists())
        self.assertFalse(list(self.root.glob('.offline-import-*')))

    def test_offline_staging_rejects_expired_or_mixed_attempt_before_writes(self):
        for label in ('expired', 'mixed'):
            with self.subTest(label=label):
                if label == 'expired':
                    now = datetime.now(timezone.utc)
                    self.receipt.update(issuedAt=(now-timedelta(hours=2)).isoformat(), expiresAt=(now-timedelta(hours=1)).isoformat())
                else:
                    self.receipt['attemptId'] = 'other-attempt'
                self.save_receipt()
                destination = self.root / label
                result = self.invoke_stage(destination)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(destination.exists())

    def test_offline_staging_never_overwrites_existing_destination(self):
        destination = self.root / 'staged'; destination.mkdir()
        sentinel = destination / 'existing'; sentinel.write_bytes(b'preserve')
        result = self.invoke_stage(destination)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sentinel.read_bytes(), b'preserve')
        self.assertEqual({path.name for path in destination.iterdir()}, {'existing'})

    def test_partial_offline_copy_failure_publishes_no_directory_or_import_marker(self):
        spec = importlib.util.spec_from_file_location('stage_handoff_test', ROOT / 'scripts/stage-hosted-handoff.py')
        adapter = importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)
        destination = self.root / 'staged'; original = Path.open
        def fail_second_copy(path, mode='r', *args, **kwargs):
            if path.name == 'release.sealed.json' and mode == 'xb':
                raise OSError('synthetic second payload write failure')
            return original(path, mode, *args, **kwargs)
        with patch.object(Path, 'open', fail_second_copy), self.assertRaises(OSError):
            adapter.stage(self.plan_path, self.sealed, self.expected_path, self.control_config, self.control_sha, destination)
        self.assertFalse(destination.exists())
        self.assertFalse(list(self.root.glob('.offline-import-*')))

    def protected_fixture(self, failure=None):
        spec = importlib.util.spec_from_file_location('protected_import_test', ROOT / '.harness/scripts/vm/import-hosted-cn-artifacts.py')
        importer = importlib.util.module_from_spec(spec); spec.loader.exec_module(importer)
        fixture = self
        class FileOperations:
            def __init__(ops):
                ops.root = fixture.root / 'protected-files'; ops.root.mkdir()
                ops.events = []
                ops.collected = []
            @contextmanager
            def lock(ops):
                ops.events.append('lock'); yield
            def admit_maintenance(ops): ops.events.append('admit')
            @contextmanager
            def candidate_context(ops, identity, marker):
                ops.events.append('candidate-enter')
                try: yield
                finally:
                    ops.events.append('candidate-restore')
                    if failure == 'restore':
                        write(ops.root / 'marker.json', marker | {'state': 'candidate-context-reconciliation-required'})
                        raise OSError('synthetic candidate restoration failure')
            def validate(ops, identity):
                ops.events.append('validate')
                evidence = fixture.verifier.verify(fixture.plan_path, fixture.sealed, fixture.expected_path, control_path=fixture.control_config, control_sha256=fixture.control_sha)
                return evidence, (fixture.sealed / 'release.json').read_bytes(), (fixture.sealed / 'release.sealed.json').read_bytes()
            def preflight(ops, phase, identity, collect=False):
                ops.events.append(phase)
                if collect: ops.collected.append(phase)
                if failure == phase: raise ValueError('synthetic live gate rejected')
            def begin(ops, marker):
                ops.events.append('begin'); write(ops.root / 'marker.json', marker)
            def publish(ops, kind, data):
                ops.events.append(kind)
                if failure == kind: raise OSError('synthetic payload write failure')
                (ops.root / (kind + '.json')).write_bytes(data)
            def verify_published(ops, marker):
                ops.events.append('verify_published')
                fixture.assertEqual(importer.sha((ops.root / 'manifest.json').read_bytes()), marker['manifestSha256'])
                fixture.assertEqual(importer.sha((ops.root / 'seal.json').read_bytes()), marker['sealSha256'])
            def complete(ops, marker):
                ops.events.append('complete'); write(ops.root / 'marker.json', marker)
        return importer, FileOperations()

    def test_protected_import_partial_write_keeps_pending_guard_blocks_prepare(self):
        importer, ops = self.protected_fixture('seal')
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        with self.assertRaises(OSError): importer.transact(identity, ops)
        marker = json.loads((ops.root / 'marker.json').read_text())
        self.assertEqual(marker['state'], 'pending')
        self.assertTrue((ops.root / 'manifest.json').exists())
        self.assertFalse((ops.root / 'seal.json').exists())
        with self.assertRaisesRegex(ValueError, 'HOSTED_IMPORT_NOT_COMPLETE'):
            importer.verify_marker(marker, (ops.root / 'manifest.json').read_bytes(), b'', SHA, self.identity['attemptId'])
        self.assertNotIn('preactivate', ops.events)
        self.assertNotIn('complete', ops.events)

    def test_protected_import_live_preactivate_failure_keeps_guard_blocked(self):
        importer, ops = self.protected_fixture('preactivate')
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        with self.assertRaises(ValueError): importer.transact(identity, ops)
        marker = json.loads((ops.root / 'marker.json').read_text())
        with self.assertRaisesRegex(ValueError, 'HOSTED_IMPORT_NOT_COMPLETE'):
            importer.verify_marker(marker, (ops.root / 'manifest.json').read_bytes(), (ops.root / 'seal.json').read_bytes(), SHA, self.identity['attemptId'])
        self.assertNotIn('complete', ops.events)

    def test_protected_import_rejects_tamper_before_pending_or_payload_write(self):
        path = self.sealed / 'release.json'; path.write_bytes(path.read_bytes() + b' ')
        importer, ops = self.protected_fixture()
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        with self.assertRaises(ValueError): importer.transact(identity, ops)
        self.assertEqual(list(ops.root.iterdir()), [])
        self.assertNotIn('begin', ops.events)

    def test_protected_import_rejects_expired_receipt_before_any_write(self):
        now = datetime.now(timezone.utc)
        self.receipt.update(issuedAt=(now-timedelta(hours=2)).isoformat(), expiresAt=(now-timedelta(hours=1)).isoformat())
        self.save_receipt()
        importer, ops = self.protected_fixture()
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        with self.assertRaises(ValueError): importer.transact(identity, ops)
        self.assertEqual(list(ops.root.iterdir()), [])
        self.assertNotIn('begin', ops.events)

    def test_protected_import_rejects_mixed_release_before_any_write(self):
        self.receipt['release'] = '2026.10.8-cn.1'; self.save_receipt()
        importer, ops = self.protected_fixture()
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        with self.assertRaises(ValueError): importer.transact(identity, ops)
        self.assertEqual(list(ops.root.iterdir()), [])
        self.assertNotIn('begin', ops.events)

    def test_protected_import_success_guard_accepts_exact_bytes_but_not_mixed_attempt_or_changed_bytes(self):
        importer, ops = self.protected_fixture()
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        marker = importer.transact(identity, ops)
        manifest = (ops.root / 'manifest.json').read_bytes(); seal = (ops.root / 'seal.json').read_bytes()
        importer.verify_marker(marker, manifest, seal, SHA, self.identity['attemptId'])
        self.assertEqual(ops.events, ['lock', 'admit', 'validate', 'candidate-enter', 'prebuild', 'validate', 'begin', 'manifest', 'seal', 'verify_published', 'preactivate', 'candidate-restore', 'complete'])
        self.assertEqual(ops.collected, [])
        for altered, attempt in [(manifest + b' ', self.identity['attemptId']), (manifest, 'other-attempt')]:
            with self.assertRaises(ValueError): importer.verify_marker(marker, altered, seal, SHA, attempt)
        self.assertIs(marker['prepared'], False)
        self.assertIs(marker['productionActivated'], False)

    def test_protected_import_context_restoration_failure_leaves_reconciliation_guard_blocked(self):
        importer, ops = self.protected_fixture('restore')
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        with self.assertRaises(OSError): importer.transact(identity, ops)
        marker = json.loads((ops.root / 'marker.json').read_text())
        self.assertEqual(marker['state'], 'candidate-context-reconciliation-required')
        self.assertNotIn('complete', ops.events)
        with self.assertRaisesRegex(ValueError, 'HOSTED_IMPORT_NOT_COMPLETE'):
            importer.verify_marker(marker, (ops.root / 'manifest.json').read_bytes(), (ops.root / 'seal.json').read_bytes(), SHA, self.identity['attemptId'])

    def test_protected_prebuild_collects_once_without_artifact_publication(self):
        importer, ops = self.protected_fixture()
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        importer.prebuild(identity, ops)
        self.assertEqual(ops.collected, ['prebuild'])
        self.assertEqual(ops.events, ['lock', 'admit', 'candidate-enter', 'prebuild', 'candidate-restore'])
        self.assertEqual(list(ops.root.iterdir()), [])

    def test_protected_import_expired_original_prebuild_is_not_recollected(self):
        importer, ops = self.protected_fixture('prebuild')
        identity = {key: self.identity[key] for key in ('sourceRevision', 'release', 'attemptId')}
        with self.assertRaises(ValueError): importer.transact(identity, ops)
        self.assertEqual(ops.collected, [])
        self.assertNotIn('begin', ops.events)
        self.assertEqual(list(ops.root.iterdir()), [])


class FrozenPromotionContracts(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('dispatch_test', ROOT / 'scripts/dispatch-frozen-promotion.py')
        self.dispatcher = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.dispatcher)
        self.baseline = 'd' * 40; self.attempt = 'gha-123-1'
        self.tag = f'cn-prepared-{SHA}-{self.attempt}'
        self.calls = []
        self.responses = [
            {'object': {'sha': self.baseline}},
            {'object': {'type': 'tag', 'sha': 'e' * 40}},
            {'tag': self.tag, 'object': {'type': 'commit', 'sha': SHA}, 'message': json.dumps(dict(releaseSourceSha=SHA, expectedMainCnSha=self.baseline, attemptId=self.attempt))}, None]

    def github_fixture(self, argv, payload=None):
        self.calls.append((argv, payload))
        return self.responses[len(self.calls)-1]

    def run_dispatch(self, mode='full-release', **changed):
        values = dict(mode=mode, repository='boardx/workspacex', source=SHA, baseline=self.baseline, attempt=self.attempt, tag=self.tag)
        values.update(changed)
        return self.dispatcher.dispatch(**values, call=self.github_fixture)

    def assert_no_post(self):
        self.assertFalse(any('--method' in args for args, _ in self.calls))

    def test_artifact_only_has_zero_github_or_promotion_calls(self):
        result = self.run_dispatch('artifact-only')
        self.assertIs(result['dispatched'], False)
        self.assertEqual(self.calls, [])

    def test_full_release_dispatch_uses_only_validated_immutable_tag(self):
        result = self.run_dispatch()
        self.assertIs(result['dispatched'], True)
        self.assertEqual(len(self.calls), 4)
        args, payload = self.calls[-1]
        self.assertEqual(args[:2], ['--method', 'POST'])
        self.assertEqual(payload['ref'], self.tag)
        self.assertEqual(payload['inputs'], dict(release_sha=SHA, expected_main_cn_sha=self.baseline, release_attempt_id=self.attempt))

    def test_changed_live_baseline_blocks_before_tag_read_or_dispatch(self):
        self.responses[0]['object']['sha'] = 'f' * 40
        with self.assertRaisesRegex(ValueError, 'BASELINE_CHANGED_BEFORE_DISPATCH'):
            self.run_dispatch()
        self.assertEqual(len(self.calls), 1); self.assert_no_post()

    def test_unannotated_wrong_source_or_binding_blocks_dispatch(self):
        for mutation in ('lightweight', 'source', 'tag', 'baseline-binding', 'attempt-binding'):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation == 'lightweight': self.responses[1]['object']['type'] = 'commit'
                elif mutation == 'source': self.responses[2]['object']['sha'] = 'f' * 40
                elif mutation == 'tag': self.responses[2]['tag'] = 'moving-main'
                else:
                    binding = json.loads(self.responses[2]['message'])
                    binding['expectedMainCnSha' if mutation == 'baseline-binding' else 'attemptId'] = 'wrong'
                    self.responses[2]['message'] = json.dumps(binding)
                with self.assertRaises(ValueError): self.run_dispatch()
                self.assert_no_post()

    def test_mutable_or_mismatched_tag_rejected_without_github_call(self):
        with self.assertRaisesRegex(ValueError, 'INVALID_FROZEN_TAG'):
            self.run_dispatch(tag='main')
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
