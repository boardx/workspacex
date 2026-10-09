"""Independent offline OSS transport faults; no SDK auth or real object calls."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import cn_image_archive as c
import cn_archive_oss as oss
spec = importlib.util.spec_from_file_location('oss_independent_archive_fixture', ROOT / 'tests/test_cn_image_archive.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Missing(Exception):
    status = 404
    code = 'NoSuchKey'


class Response(io.BytesIO):
    headers = {}


class Port:
    def __init__(self):
        self.objects = {}; self.calls = []; self.lost_ack = False; self.fail_key = None
    def bind(self, transport, operation):
        self.calls.append(('bind', operation))
    def get(self, key, version):
        self.calls.append(('get', key, version))
        if key not in self.objects: raise Missing()
        return Response(self.objects[key])
    def put(self, key, stream, size, check):
        self.calls.append(('put', key))
        check()
        if key == self.fail_key: raise RuntimeError('fixture disconnected before write')
        self.objects[key] = stream.read()
        if self.lost_ack: raise RuntimeError('fixture lost acknowledgement')
    @staticmethod
    def missing(error):
        return isinstance(error, Missing)


class IndependentOssTransfer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bundle = self.root / 'bundle'; self.bundle.mkdir(mode=0o700)
        self.parent = self.root / 'download'; self.parent.mkdir(mode=0o700)
        self.build = fixture.plan(); entries = {}
        for service in c.REPOSITORIES:
            path = self.bundle / (service + '.tar')
            fixture.archive(path, self.build, service)
            size, sha = c.file_digest(path, self.build['maxArchiveBytes'])
            entries[service] = dict(file=path.name, size=size, sha256=sha,
                                    **c.inspect_archive(path, self.build, service))
        now = datetime.now(timezone.utc)
        self.value = {key: self.build[key] for key in ('sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform')}
        self.value.update(schemaVersion=1, receiptKind='cn-image-archive-set-v1',
                          planSha256=c.sha(c.json_bytes(self.build)), producedAt=now.isoformat(),
                          expiresAt=(now + timedelta(minutes=30)).isoformat(), images=entries,
                          ready=False, prepared=False, productionActivated=False)
        self.raw = c.json_bytes(self.value); self.sha = c.sha(self.raw)
        (self.bundle / 'archive-set.json').write_bytes(self.raw)
        prefix = 'cn-image-archives/' + self.build['sourceRevision'] + '/' + self.build['attemptId'] + '/'
        self.transport = dict(kind='approved-oss-staging-v1', bucket='fixture-approved-staging',
                              region='cn-shanghai', endpoint='https://oss-cn-shanghai.aliyuncs.com',
                              prefix=prefix, uploadPrincipal='fixture-upload', downloadPrincipal='fixture-download',
                              objects={name: dict(key=prefix + name, versionId='', sha256=self.sha if name == 'archive-set.json' else entries[name[:-4]]['sha256'])
                                       for name in ['archive-set.json'] + [service + '.tar' for service in c.REPOSITORIES]})
        self.port = Port()
    def approval(self, operation='upload', transport=None, sha=None):
        now = datetime.now(timezone.utc)
        return dict(schemaVersion=1, transferAuthorized=True, operation=operation,
                    versioningFenceProofSha256="f" * 64,
                    sourceRevision=self.build['sourceRevision'], controlRevision=self.build['controlRevision'],
                    attemptId=self.build['attemptId'], archiveSetSha256=sha or self.sha,
                    transportSha256=c.sha(c.json_bytes(transport or self.transport)),
                    observedAt=now.isoformat(), expiresAt=(now + timedelta(minutes=30)).isoformat())
    def transfer(self, operation='upload'):
        return oss.Transfer(self.port, self.build, self.transport, self.raw, self.sha, self.approval(operation))
    def key(self, name):
        return self.transport['objects'][name]['key']
    def puts(self):
        return [call[1] for call in self.port.calls if call[0] == 'put']
    def populate(self):
        self.port.objects = {self.key(path.name): path.read_bytes() for path in self.bundle.iterdir()}

    def test_complete_six_objects_and_manifest_last_then_retry_without_put(self):
        receipt = self.transfer().upload(self.bundle)
        self.assertEqual(len(self.puts()), 6)
        self.assertEqual(self.puts()[-1], self.key('archive-set.json'))
        self.assertEqual(len(receipt['transport']['objects']), 6)
        for flag in ('ready', 'prepared', 'productionActivated'): self.assertIs(receipt[flag], False)
        self.port.calls.clear()
        self.assertEqual(self.transfer().upload(self.bundle), receipt)
        self.assertEqual(self.puts(), [])

    def test_late_manifest_collision_rejected_before_any_put(self):
        self.port.objects[self.key('archive-set.json')] = b'foreign'
        with self.assertRaises(ValueError): self.transfer().upload(self.bundle)
        self.assertEqual(self.puts(), [])

    def test_corrupt_source_last_image_rejected_before_any_put(self):
        path = self.bundle / 'postgres.tar'; path.write_bytes(path.read_bytes() + b'changed')
        with self.assertRaises(ValueError): self.transfer().upload(self.bundle)
        self.assertEqual(self.puts(), [])

    def test_lost_acknowledgement_uses_readback_without_duplicate_put(self):
        self.port.lost_ack = True
        self.transfer().upload(self.bundle)
        self.assertEqual(len(self.puts()), 6)
        self.assertEqual(len(set(self.puts())), 6)

    def test_partial_failure_never_publishes_completion_marker(self):
        self.port.fail_key = self.key('postgres.tar')
        with self.assertRaises(Missing): self.transfer().upload(self.bundle)
        self.assertNotIn(self.key('archive-set.json'), self.port.objects)
        self.assertNotIn(self.key('archive-set.json'), self.puts())

    def test_source_symlink_rejected_without_remote_put(self):
        path = self.bundle / 'api.tar'; outside = self.root / 'outside.tar'
        path.rename(outside); path.symlink_to(outside)
        with self.assertRaises(OSError): self.transfer().upload(self.bundle)
        self.assertEqual(self.puts(), [])

    def test_source_hardlink_rejected_without_remote_put(self):
        os.link(self.bundle / 'api.tar', self.root / 'extra-link')
        with self.assertRaisesRegex(ValueError, 'TRANSFER_FILE_TRUST'): self.transfer().upload(self.bundle)
        self.assertEqual(self.puts(), [])

    def test_success_download_root_private_and_contents_verified(self):
        self.populate(); self.transfer('download').download(self.parent, 'attempt')
        result = self.parent / 'attempt'
        self.assertEqual(result.stat().st_mode & 0o777, 0o700)
        self.assertEqual(len(list(result.iterdir())), 6)
        for path in result.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.read_bytes(), (self.bundle / path.name).read_bytes())

    def test_bad_download_removes_only_pending_and_preserves_existing_evidence(self):
        self.populate(); self.port.objects[self.key('postgres.tar')] = b'foreign'
        sentinel = self.parent / 'unrelated'; sentinel.write_text('preserve')
        with self.assertRaises(ValueError): self.transfer('download').download(self.parent, 'attempt')
        self.assertEqual(list(self.parent.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), 'preserve')

    def test_download_existing_empty_destination_not_replaced(self):
        self.populate(); destination = self.parent / 'attempt'; destination.mkdir(mode=0o700)
        inode = destination.stat().st_ino
        with self.assertRaisesRegex(ValueError, 'DOWNLOAD_DESTINATION_COLLISION'):
            self.transfer('download').download(self.parent, 'attempt')
        self.assertEqual(destination.stat().st_ino, inode)
        self.assertEqual(list(destination.iterdir()), [])
        self.assertEqual(list(self.parent.iterdir()), [destination])

    def test_download_syncs_pending_directory_before_atomic_publication(self):
        self.populate(); original = os.fsync; pending_synced = []
        def observe(fd):
            path = Path('/proc/self/fd/' + str(fd)).resolve()
            if path.parent == self.parent and path.name.startswith('.pending-') and path.is_dir():
                pending_synced.append(path.name)
            if path == self.parent:
                self.assertTrue(pending_synced, 'Pending directory entries must be durable before rename')
            return original(fd)
        with patch.object(oss.os, 'fsync', observe):
            self.transfer('download').download(self.parent, 'attempt')
        self.assertEqual(len(pending_synced), 1)

    def test_download_post_rename_fsync_fault_preserves_completed_result(self):
        self.populate(); original = os.fsync
        def fail_parent(fd):
            if Path('/proc/self/fd/' + str(fd)).resolve() == self.parent:
                raise OSError('fixture parent fsync')
            return original(fd)
        with patch.object(oss.os, 'fsync', fail_parent), self.assertRaises(OSError):
            self.transfer('download').download(self.parent, 'attempt')
        self.assertEqual(len(list((self.parent / 'attempt').iterdir())), 6)
        self.assertFalse(any(path.name.startswith('.pending-') for path in self.parent.iterdir()))

    def test_remote_version_rejected_and_response_closed(self):
        response = Response(self.raw); response.headers = {'x-oss-version-id': 'unexpected-version'}
        with patch.object(self.port, 'get', return_value=response), self.assertRaisesRegex(ValueError, 'REMOTE_VERSION_MISMATCH'):
            self.transfer().readback('archive-set.json')
        self.assertTrue(response.closed)

    def test_exact_approved_key_and_empty_version_required(self):
        for mutation in ('key', 'version', 'objects', 'endpoint'):
            transport = copy.deepcopy(self.transport)
            if mutation == 'key': transport['objects']['api.tar']['key'] = transport['prefix'] + 'foreign.tar'
            elif mutation == 'version': transport['objects']['api.tar']['versionId'] = 'version'
            elif mutation == 'objects': del transport['objects']['api.tar']
            else: transport['endpoint'] = 'https://foreign.example'
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                oss.Transfer(self.port, self.build, transport, self.raw, self.sha, self.approval(transport=transport))
        self.assertEqual(self.port.calls, [])

    def test_oversized_or_invalid_size_metadata_rejected_before_remote_read(self):
        for size in (0, -1, True, '10240', self.build['maxArchiveBytes'] + 1):
            value = copy.deepcopy(self.value); value['images']['api']['size'] = size
            raw = c.json_bytes(value); sha = c.sha(raw)
            transport = copy.deepcopy(self.transport); transport['objects']['archive-set.json']['sha256'] = sha
            with self.subTest(size=size), self.assertRaises(ValueError):
                oss.Transfer(self.port, self.build, transport, raw, sha,
                             self.approval('download', transport=transport, sha=sha))
        self.assertEqual(self.port.calls, [])

    def test_download_symlink_in_ancestor_rejected_without_destination_write(self):
        self.populate()
        alias = self.root / 'alias'; alias.symlink_to(self.parent, target_is_directory=True)
        nested = self.parent / 'nested'; nested.mkdir(mode=0o700)
        with self.assertRaises(OSError):
            self.transfer('download').download(alias / 'nested', 'attempt')
        self.assertEqual(list(nested.iterdir()), [])

    def test_operation_approval_cannot_be_reused_for_other_direction(self):
        with self.assertRaisesRegex(ValueError, 'TRANSFER_OPERATION_UNAPPROVED'):
            self.transfer('upload').download(self.parent, 'attempt')
        self.assertEqual(self.port.calls, [])

    def test_transport_approval_hash_and_authorization_fail_closed(self):
        for field, value in (('transferAuthorized', False), ('transportSha256', 'f' * 64),
                             ('archiveSetSha256', 'f' * 64), ('sourceRevision', 'c' * 40)):
            approval = self.approval(); approval[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'TRANSFER_APPROVAL_REQUIRED'):
                oss.Transfer(self.port, self.build, self.transport, self.raw, self.sha, approval)
        self.assertEqual(self.port.calls, [])

    def test_blocked_port_aborted_by_hard_deadline(self):
        transfer = self.transfer(); transfer.deadline = time.monotonic() + 0.05
        def blocked(*_):
            try: time.sleep(1)
            except Exception: time.sleep(1)  # Model SDK retry handlers swallowing Exception.
        start = time.monotonic()
        with patch.object(self.port, 'bind', side_effect=blocked), self.assertRaisesRegex(ValueError, 'TRANSFER_DEADLINE'):
            transfer.upload(self.bundle)
        self.assertLess(time.monotonic() - start, 0.5)
        self.assertEqual(self.puts(), [])

    def test_external_approval_or_transport_mutation_does_not_change_bound_transfer(self):
        approval = self.approval(); transport = copy.deepcopy(self.transport)
        transfer = oss.Transfer(self.port, self.build, transport, self.raw, self.sha, approval)
        approval['operation'] = 'download'; transport['objects']['api.tar']['key'] = 'foreign'
        transfer.upload(self.bundle)
        self.assertIn(self.key('api.tar'), self.port.objects)
        self.assertNotIn('foreign', self.port.objects)

    def test_missing_or_invalid_versioning_fence_proof_rejected_before_network(self):
        for proof in (None, '', False, 'x' * 64, 'f' * 63):
            approval = self.approval()
            if proof is None: del approval['versioningFenceProofSha256']
            else: approval['versioningFenceProofSha256'] = proof
            with self.subTest(proof=proof), self.assertRaises(ValueError):
                oss.Transfer(self.port, self.build, self.transport, self.raw, self.sha, approval)
        self.assertEqual(self.port.calls, [])

    def test_deadline_exhaustion_rejected_without_put(self):
        transfer = self.transfer(); transfer.deadline = 0
        with self.assertRaisesRegex(ValueError, 'TRANSFER_DEADLINE'): transfer.upload(self.bundle)
        self.assertEqual(self.puts(), [])


class IndependentSdkIdentity(unittest.TestCase):
    def test_provider_target_principal_and_versioning_verified_before_get_put(self):
        class Bucket:
            bucket_name = 'fixture-approved-staging'
            endpoint = 'https://oss-cn-shanghai.aliyuncs.com'
            timeout = 5
            def get_bucket_versioning(self): return type('Versioning', (), {'status': None})()
        transport = dict(bucket=Bucket.bucket_name, endpoint=Bucket.endpoint, region='cn-shanghai',
                         uploadPrincipal='fixture-upload', downloadPrincipal='fixture-download')
        bucket = Bucket(); port = oss.OssSdkPort(bucket, 'fixture-upload', 'cn-shanghai')
        port.bind(transport, 'upload')
        with self.assertRaisesRegex(ValueError, 'SDK_TARGET_IDENTITY'): port.bind(transport, 'download')
        for status in ('Enabled', 'Suspended', ''):
            with patch.object(bucket, 'get_bucket_versioning', return_value=type('Versioning', (), {'status': status})()):
                with self.assertRaisesRegex(ValueError, 'VERSIONING_MUST_BE_DISABLED'): port.bind(transport, 'upload')


if __name__ == '__main__': unittest.main()
