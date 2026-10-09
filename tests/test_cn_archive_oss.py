import copy
import io
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import cn_archive_oss as t
import test_cn_image_archive as fixtures


class Missing(Exception):
    pass


class Response(io.BytesIO):
    headers = {}


class Port:
    def __init__(self): self.objects = {}; self.puts = []; self.fail = None
    def bind(self, approved, operation):
        if self.fail == 'principal': raise t.c.Rejected('SDK_TARGET_IDENTITY')
    def get(self, key, version):
        if key not in self.objects: raise Missing()
        raw = self.objects[key]
        if self.fail == 'corrupt': raw += b'x'
        return Response(raw)
    def put(self, key, stream, size, check):
        check(); self.puts.append(key)
        if self.fail == 'interrupt': raise RuntimeError('interrupted')
        if key in self.objects: raise RuntimeError('forbid overwrite')
        self.objects[key] = stream.read()
        if self.fail == 'lost-ack': raise RuntimeError('lost acknowledgement')
    @staticmethod
    def missing(error): return isinstance(error, Missing)


class TransferTests(unittest.TestCase):
    setUp = fixtures.ArchiveTests.setUp
    value = fixtures.ArchiveTests.value
    # Reuse archive builders, not inherited test methods.
    def setup_transfer(self):
        self.raw = t.c.json_bytes(self.value()); (self.root / 'archive-set.json').write_bytes(self.raw)
        prefix = 'cn-image-archives/' + self.build['sourceRevision'] + '/' + self.build['attemptId'] + '/'
        self.approved = dict(kind='approved-oss-staging-v1', bucket='approved-bucket', region='cn-shanghai',
            endpoint='https://oss-cn-shanghai.aliyuncs.com', prefix=prefix, uploadPrincipal='u', downloadPrincipal='d', objects={})
        for name in ['archive-set.json'] + [s + '.tar' for s in t.c.REPOSITORIES]:
            self.approved['objects'][name] = dict(key=prefix + name, versionId='', sha256=t.c.sha((self.root / name).read_bytes()))
        self.port = Port()
        self.authorization = dict(schemaVersion=1, transferAuthorized=True, sourceRevision=self.build['sourceRevision'],
            controlRevision=self.build['controlRevision'], attemptId=self.build['attemptId'], archiveSetSha256=t.c.sha(self.raw),
            transportSha256=t.c.sha(t.c.json_bytes(self.approved)), operation='upload', versioningFenceProofSha256='f'*64,
            observedAt=self.value()['producedAt'], expiresAt=self.value()['expiresAt'])
        return t.Transfer(self.port, self.build, self.approved, self.raw, t.c.sha(self.raw), self.authorization)

    def test_transfer_complete_retry_and_receipt_last(self):
        transfer = self.setup_transfer(); result = transfer.upload(self.root)
        self.assertTrue(self.port.puts[-1].endswith('archive-set.json')); self.assertFalse(result['productionActivated'])
        transfer.upload(self.root); self.assertEqual(len(self.port.puts), 6)

    def test_transfer_lost_ack_readback_no_second_put(self):
        transfer = self.setup_transfer(); self.port.fail = 'lost-ack'; transfer.upload(self.root)
        self.assertEqual(len(self.port.puts), 6)

    def test_transfer_interruption_has_no_completion(self):
        transfer = self.setup_transfer(); self.port.fail = 'interrupt'
        with self.assertRaises(Missing): transfer.upload(self.root)
        self.assertFalse(any(k.endswith('archive-set.json') for k in self.port.objects))

    def test_transfer_collision_before_any_put(self):
        transfer = self.setup_transfer()
        last = self.approved['objects']['postgres.tar']['key']; self.port.objects[last] = b'foreign'
        with self.assertRaises(ValueError): transfer.upload(self.root)
        self.assertEqual(self.port.puts, [])

    def test_transfer_symlink_and_hardlink_no_put(self):
        for link in ('symlink', 'hardlink'):
            transfer = self.setup_transfer(); original = (self.root / 'api.tar').read_bytes()
            saved = self.root / 'saved'; saved.write_bytes(original); (self.root / 'api.tar').unlink()
            if link == 'symlink': (self.root / 'api.tar').symlink_to(saved)
            else: os.link(saved, self.root / 'api.tar')
            with self.assertRaises((ValueError, OSError)): transfer.upload(self.root)
            self.assertEqual(self.port.puts, [])
            (self.root / 'api.tar').unlink(); saved.unlink(); (self.root / 'api.tar').write_bytes(original)

    def test_transfer_bad_version_path_hash(self):
        self.setup_transfer()
        for field, value in [('versionId', 'foreign'), ('key', self.approved['prefix'] + '../outside'), ('sha256', 'f'*64)]:
            approved = copy.deepcopy(self.approved); approved['objects']['api.tar'][field] = value
            with self.assertRaises(ValueError): t.Transfer(self.port, self.build, approved, self.raw, t.c.sha(self.raw), self.authorization)

    def test_transfer_download_atomic_collision_corruption(self):
        transfer = self.setup_transfer(); transfer.upload(self.root)
        parent = self.root / 'downloads'; parent.mkdir(mode=0o700)
        transfer.approval['operation'] = 'download'
        transfer.download(parent, 'complete')
        self.assertEqual(set(os.listdir(parent / 'complete')), set(self.approved['objects']))
        self.assertEqual((parent / 'complete' / 'api.tar').stat().st_mode & 0o777, 0o600)
        with self.assertRaises(ValueError): transfer.download(parent, 'complete')
        self.port.fail = 'corrupt'
        with self.assertRaises(ValueError): transfer.download(parent, 'broken')
        self.assertEqual(os.listdir(parent), ['complete'])

    def test_transfer_wrong_principal_deadline_and_ttl(self):
        transfer = self.setup_transfer(); self.port.fail = 'principal'
        with self.assertRaises(ValueError): transfer.upload(self.root)
        self.port.fail = None; transfer.deadline = 0
        with self.assertRaises(ValueError): transfer.upload(self.root)
        self.assertEqual(self.port.puts, [])

    def test_sdk_private_no_overwrite_headers_for_simple_and_multipart(self):
        import types
        from unittest.mock import patch
        class Bucket:
            calls = []
            def put_object(self, key, stream, headers): self.calls.append(('simple', headers)); stream.read()
            def init_multipart_upload(self, key, headers):
                self.calls.append(('init', headers)); return types.SimpleNamespace(upload_id='owned')
            def upload_part(self, key, upload, number, stream):
                self.calls.append(('part', number, len(stream.read()))); return types.SimpleNamespace(etag='transport-only')
            def complete_multipart_upload(self, key, upload, parts, headers): self.calls.append(('complete', headers))
        bucket = Bucket(); port = t.OssSdkPort(bucket, 'u', 'cn-shanghai')
        port.put('key', io.BytesIO(b'x'), 1, lambda: None)
        fake_models = types.ModuleType('oss2.models'); fake_models.PartInfo = lambda number, etag: (number, etag)
        with patch.dict(sys.modules, {'oss2.models': fake_models}):
            raw = b'x' * (t.PART + 1)
            port.put('key2', io.BytesIO(raw), len(raw), lambda: None)
        for kind, *values in bucket.calls:
            if kind in ('simple', 'init', 'complete'):
                self.assertEqual(values[0], {'x-oss-forbid-overwrite': 'true', 'x-oss-object-acl': 'private'})
        self.assertEqual([call for call in bucket.calls if call[0] == 'part'], [('part', 1, t.PART), ('part', 2, 1)])

    def test_sdk_disabled_versioning_and_identity(self):
        class Bucket:
            bucket_name = 'approved-bucket'; endpoint = 'https://oss-cn-shanghai.aliyuncs.com'
            version = None
            timeout = 5
            def get_bucket_versioning(self): return type('Version', (), {'status': self.version})()
        self.setup_transfer(); bucket = Bucket(); port = t.OssSdkPort(bucket, 'u', 'cn-shanghai')
        port.bind(self.approved, 'upload')
        bucket.version = 'Enabled'
        with self.assertRaises(ValueError): port.bind(self.approved, 'upload')
        bucket.version = None
        with self.assertRaises(ValueError): port.bind(self.approved, 'download')


if __name__ == '__main__': unittest.main()
