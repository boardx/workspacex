"""Archive bridge uses the real pinned Node22 canonical CLIs; Docker is synthetic.

These offline fixtures prove local byte binding, not live registry immutability,
cloud authority, or production readiness.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import stat
import time
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


fixture = module('archive_canonical_fixture', ROOT / 'tests/test_canonical_cli.py')
fixture.REPO = ROOT
bridge = module('archive_import_real_cli', ROOT / '.harness/scripts/vm/import-cn-image-archives.py')
common = module('archive_common_real_cli', ROOT / 'scripts/cn_image_archive.py')
# Existing integration fixtures support a frozen, complete dependency tree. The
# environment locations are configurable; absence fails rather than skips tests.
fixture.NODE = Path(os.environ.get('CN_ARCHIVE_TEST_NODE', '/tmp/wsx-toolchain/node-v22.20.0-linux-x64/bin/node'))
fixture.RUNTIME = Path(os.environ.get('CN_ARCHIVE_TEST_RUNTIME', '/tmp/wsx-canonical-runtime'))


class ArchiveCanonicalIntegration(unittest.TestCase):
    def setUp(self):
        self.assertTrue(fixture.NODE.is_file(), 'Prepare the official Node22 fixture or set CN_ARCHIVE_TEST_NODE')
        self.assertTrue((fixture.RUNTIME / 'node_modules/zod/package.json').is_file(),
                        'Prepare frozen dependencies or set CN_ARCHIVE_TEST_RUNTIME')
        fixture.CanonicalIntegration.setUp(self)
        self.work = self.root / 'archive-work'
        self.work.mkdir(mode=0o700)
        self.published = self.root / 'archive-published'
        self.published.mkdir(mode=0o700)
        self.root.chmod(0o700)
        self.build_input = {
            'schemaVersion': 1, 'release': self.plan['release'],
            'sourceRevision': fixture.SHA, 'platform': 'linux/amd64',
            'images': {service: {'image': common.PREFIX + '/' + repository + '@sha256:' + fixture.DIGEST}
                       for service, repository in common.REPOSITORIES.items()},
        }
        self.build_input['images']['redis'] = {'image': common.PREFIX + '/base-redis@sha256:' + fixture.DIGEST}
        # Bypass only the adapter constructor's Docker plugin installation; Node
        # subprocesses and the original hash-checked canonical closure are real.
        self.adapter = bridge.Commands.__new__(bridge.Commands)
        self.adapter.work = self.work
        self.adapter.deadline = time.monotonic() + 120
        expiry = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat().replace("+00:00", "Z")
        self.adapter.archive_expiry = expiry
        self.adapter.c = common
        self.adapter.canonical = fixture.h.control
        self.adapter.canonical_path = self.control_path
        self.adapter.plan = {
            'expiresAt': expiry,
            'immutableEvidence': {'observedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')},
            'canonicalConfigurationSha256': self.control_sha256,
            'archiveSetSha256': 'd' * 64,
            'buildPlan': {'attemptId': 'archive-real-cli-1'},
        }
        self.adapter.env = dict(self.env)
        self.adapter.env.pop('ACR_USERNAME', None)
        self.adapter.env.pop('ACR_TOKEN', None)
        self.output = self.published / fixture.SHA / 'archive-real-cli-1'
        self.addCleanup(patch.stopall)
        patch.object(bridge, 'PUBLISHED_ROOT', self.published, create=True).start()

    def publish(self):
        # Only ownership is synthetic: this nonroot development environment cannot
        # create root-owned fixtures. Modes, file types, links and dirfd operations
        # remain real; this grants no production root or cloud authority.
        original = os.fstat
        def fixture_root(fd):
            value = original(fd)
            fields = list(value)
            if value.st_uid == os.getuid() and value.st_gid == os.getgid():
                fields[4] = fields[5] = 0
            return os.stat_result(fields)
        with patch.object(bridge.os, 'fstat', fixture_root):
            return self.adapter.canonical_publish(self.build_input)

    def canonical_validate(self):
        return fixture.CanonicalIntegration.canonical_command(
            self, 'release-candidate-cli.ts', 'validate', self.output / 'release.json',
            self.output / 'release.sealed.json', fixture.SHA)

    def test_expired_immutability_observation_rejected_while_approvals_remain_valid(self):
        self.adapter.plan['immutableEvidence']['observedAt'] = (
            datetime.now(timezone.utc) - timedelta(minutes=61)).isoformat().replace('+00:00', 'Z')
        with self.assertRaisesRegex(ValueError, 'IMMUTABILITY_EVIDENCE_EXPIRED'):
            self.adapter.check_validity()
        self.assertFalse(self.output.exists())

    def test_missing_immutability_observation_rejected(self):
        del self.adapter.plan['immutableEvidence']['observedAt']
        with self.assertRaises((ValueError, KeyError)):
            self.adapter.check_validity()
        self.assertFalse(self.output.exists())

    def test_missing_immutability_evidence_rejected(self):
        del self.adapter.plan['immutableEvidence']
        with self.assertRaises((ValueError, KeyError)):
            self.adapter.check_validity()
        self.assertFalse(self.output.exists())

    def test_atomic_noreplace_preserves_existing_empty_directory(self):
        parent = self.root / 'atomic-boundary'
        parent.mkdir(mode=0o700)
        pending = parent / 'pending'
        pending.mkdir(mode=0o700)
        (pending / 'published.json').write_text('fixture pending receipt')
        existing = parent / 'attempt'
        existing.mkdir(mode=0o700)
        original_inode = existing.stat().st_ino
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            with self.assertRaisesRegex(ValueError, 'PUBLISHED_RECEIPT_CONCURRENT_COLLISION'):
                bridge.atomic_no_replace(fd, 'pending', 'attempt')
        finally:
            os.close(fd)
        self.assertEqual(existing.stat().st_ino, original_inode)
        self.assertEqual(list(existing.iterdir()), [])
        self.assertEqual((pending / 'published.json').read_text(), 'fixture pending receipt')

    def test_real_manifest_and_seal_bind_actual_registry_digest_bytes(self):
        receipt = self.publish()
        manifest = (self.output / 'release.json').read_bytes()
        seal_raw = (self.output / 'release.sealed.json').read_bytes()
        seal = json.loads(seal_raw)
        self.assertEqual(set(json.loads(manifest)['images']), set(common.REPOSITORIES) | {'redis'})
        self.assertEqual(seal['manifestSha256'], hashlib.sha256(manifest).hexdigest())
        self.assertEqual(receipt['manifestSha256'], seal['manifestSha256'])
        self.assertEqual(receipt['sealSha256'], hashlib.sha256(seal_raw).hexdigest())
        self.assertEqual(receipt['archiveSetSha256'], 'd' * 64)
        for key in ('ready', 'prepared', 'productionActivated'):
            self.assertIs(receipt[key], False)
        result = self.canonical_validate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for name in ('release.json', 'release.sealed.json', 'published.json'):
            self.assertEqual((self.output / name).stat().st_mode & 0o777, 0o600)

    def test_complete_retry_preserves_original_manifest_and_seal_bytes(self):
        first = self.publish()
        before = {path.name: path.read_bytes() for path in self.output.iterdir()}
        self.assertEqual(self.publish(), first)
        self.assertEqual({path.name: path.read_bytes() for path in self.output.iterdir()}, before)

    def test_changed_manifest_is_rejected_by_original_node_validator_and_retry(self):
        self.publish()
        path = self.output / 'release.json'
        path.write_bytes(path.read_bytes() + b'\n')
        result = self.canonical_validate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('RELEASE_CANDIDATE_MANIFEST_MISMATCH', result.stderr)
        with self.assertRaises(ValueError):
            self.publish()

    def test_rebound_receipt_cannot_authorize_changed_manifest_bytes(self):
        self.publish()
        path = self.output / 'release.json'
        path.write_bytes(path.read_bytes() + b'\n')
        receipt_path = self.output / 'published.json'
        receipt = json.loads(receipt_path.read_text())
        receipt['manifestSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        receipt_path.write_bytes(common.json_bytes(receipt))
        with self.assertRaises(ValueError):
            self.publish()

    def test_rebound_receipt_cannot_authorize_invalid_original_seal(self):
        self.publish()
        seal_path = self.output / 'release.sealed.json'
        seal = json.loads(seal_path.read_text())
        seal['sealedAt'] = '2026-10-07T12:00:00+01:00'
        seal_path.write_bytes(common.json_bytes(seal))
        receipt_path = self.output / 'published.json'
        receipt = json.loads(receipt_path.read_text())
        receipt['sealSha256'] = hashlib.sha256(seal_path.read_bytes()).hexdigest()
        receipt_path.write_bytes(common.json_bytes(receipt))
        with self.assertRaises(ValueError):
            self.publish()

    def test_failed_pending_file_fsync_cleans_only_own_pending_files(self):
        original = os.fsync
        def fail_pending_file(fd):
            path = Path('/proc/self/fd/' + str(fd)).resolve()
            if '.pending-' in str(path) and stat.S_ISREG(os.fstat(fd).st_mode):
                raise OSError('fixture file fsync failure')
            return original(fd)
        sentinel = self.published / 'unrelated-evidence'
        sentinel.write_text('preserve')
        with patch.object(bridge.os, 'fsync', fail_pending_file):
            with self.assertRaises(OSError):
                self.publish()
        self.assertFalse(self.output.exists())
        self.assertEqual(sentinel.read_text(), 'preserve')
        self.assertEqual(list((self.published / fixture.SHA).iterdir()), [])

    def test_missing_service_is_rejected_without_published_receipt(self):
        del self.build_input['images']['redis']
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse(self.output.exists())

    def test_control_source_drift_is_rejected_before_publication(self):
        source = self.control_root / 'packages/cloud-deploy/src/release-candidate.ts'
        source.write_bytes(source.read_bytes() + b'\n// fixture drift\n')
        with self.assertRaisesRegex(ValueError, 'CONTROL_FILE_HASH_MISMATCH'):
            self.publish()
        self.assertFalse(self.output.exists())

    def test_partial_existing_receipt_is_rejected_without_completion(self):
        self.output.mkdir(parents=True, mode=0o700)
        (self.output / 'release.json').write_text('{}')
        before = (self.output / 'release.json').read_bytes()
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual((self.output / 'release.json').read_bytes(), before)
        self.assertFalse((self.output / 'published.json').exists())

    def test_nonroot_output_is_rejected_without_ownership_fixture(self):
        if os.getuid() == 0:
            self.skipTest('Nonroot ownership negative case requires a nonroot development process')
        with self.assertRaisesRegex(ValueError, 'PUBLISHED_PARENT_TRUST'):
            self.adapter.canonical_publish(self.build_input)
        self.assertFalse(self.output.exists())

    def test_post_rename_parent_fsync_failure_does_not_delete_completed_output(self):
        original = os.fsync
        def fail_parent(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode) and Path('/proc/self/fd/' + str(fd)).resolve() == self.published / fixture.SHA:
                raise OSError('fixture parent fsync failure')
            return original(fd)
        with patch.object(bridge.os, 'fsync', fail_parent):
            with self.assertRaises(OSError):
                self.publish()
        self.assertEqual(set(path.name for path in self.output.iterdir()),
                         {'release.json', 'release.sealed.json', 'published.json'})
        result = self.canonical_validate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.publish()['ready'], False)

    def test_symlinked_output_parent_is_rejected_without_external_writes(self):
        outside = self.root / 'outside'
        outside.mkdir(mode=0o700)
        (self.published / fixture.SHA).symlink_to(outside, target_is_directory=True)
        with self.assertRaises((ValueError, OSError)):
            self.publish()
        self.assertEqual(list(outside.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
