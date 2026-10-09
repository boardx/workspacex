"""Deterministic Docker adapter: no network, registry or image build."""
import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from test_cn_image_archive import archive, plan, c, e, ROOT


class Commands:
    def __init__(self, build):
        self.plan = build; self.calls = []; self.fail = None
    def __call__(self, argv, cwd=None):
        self.calls.append(argv)
        if self.fail == argv[:2]: raise c.Rejected('INJECTED_COMMAND_FAILURE')
        if argv[:2] == ['git', 'rev-parse']:
            return (self.plan['controlRevision'] if Path(cwd) == ROOT else self.plan['sourceRevision']).encode()
        if argv[:2] == ['git', 'show']:
            return (ROOT / argv[2].split(':', 1)[1]).read_bytes()
        if argv[:2] == ['git', 'archive']:
            with tarfile.open(argv[4], 'w'): pass
        if argv[:3] == ['docker', 'image', 'save']:
            service = next(s for s in c.REPOSITORIES if c.staging_tag(self.plan, s) == argv[-1])
            archive(Path(argv[4]), self.plan, service)
        return b''


class SplitTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'fragments'; self.root.mkdir(); self.output=self.root.parent/(self.root.name+'-collected'); self.build = plan(); self.command = Commands(self.build)
    def fragments(self):
        for service in c.REPOSITORIES:
            e.produce_service(self.build, self.root / 'source', self.root / service, service, self.command)
    def collect(self):
        return e.collect(self.build, self.root, self.root.parent / (self.root.name + '-collected'), command=self.command)
    def fragment(self, service='api'):
        return self.root / service / 'archive-fragment.json'
    def mutate(self, fn, service='api'):
        path = self.fragment(service); value = c.decode(path.read_bytes()); fn(value)
        path.write_bytes(c.json_bytes(value))
    def test_single_exports_and_canonical_collection_without_copy(self):
        self.fragments()
        original = {s: (self.root / s / (s + '.tar')).stat().st_ino for s in c.REPOSITORIES}
        fragments = [c.decode(self.fragment(s).read_bytes()) for s in c.REPOSITORIES]
        value = self.collect()
        self.assertEqual(value['producedAt'], min(f['producedAt'] for f in fragments))
        self.assertEqual(value['expiresAt'], min(f['expiresAt'] for f in fragments))
        raw = (self.output / 'archive-set.json').read_bytes()
        pinned = {s: self.output / (s + '.tar') for s in c.REPOSITORIES}
        _, total = c.validate_set(self.root, raw, c.sha(raw), self.build, pinned_paths=pinned)
        self.assertGreater(total, 0)
        self.assertEqual(len(list(self.output.glob('*.tar'))), 5)
        self.assertEqual(original, {s: pinned[s].stat().st_ino for s in c.REPOSITORIES})
        self.assertEqual(len([a for a in self.command.calls if a[:3] == ['docker', 'buildx', 'build']]), 5)
        self.assertFalse(any('push' in a or 'login' in a or 'prune' in a for a in self.command.calls))
    def test_collected_bundle_consumed_by_real_oss_snapshot_upload(self):
        # Existing Transfer.upload performs the actual pinned-file snapshot and
        # validates it before the in-memory Port receives any bytes.
        from test_cn_archive_oss import TransferTests
        self.fragments(); value=self.collect()
        consumer=TransferTests(methodName='test_transfer_complete_retry_and_receipt_last')
        consumer.root=self.output; consumer.build=self.build
        consumer.value=lambda: value
        transfer=consumer.setup_transfer()
        result=transfer.upload(self.output)
        self.assertEqual(len(consumer.port.puts),6)
        self.assertTrue(consumer.port.puts[-1].endswith('/archive-set.json'))
        self.assertFalse(result['productionActivated'])
        for service in c.REPOSITORIES:
            path=self.output/(service+'.tar')
            self.assertEqual(path.stat().st_nlink,1)
            key=consumer.approved['objects'][service+'.tar']['key']
            self.assertEqual(consumer.port.objects[key],path.read_bytes())
        # Retry uses exact readback and adds no writes to the mocked remote.
        transfer.upload(self.output)
        self.assertEqual(len(consumer.port.puts),6)

    def test_single_capacity_uses_archive_not_total(self):
        free = 4 * self.build['maxArchiveBytes'] + self.build['storageMarginBytes']
        with patch.object(e.shutil, 'disk_usage', return_value=shutil._ntuple_diskusage(free, 0, free)):
            e.produce_service(self.build, self.root/'source', self.root/'api', 'api', self.command)
            with self.assertRaisesRegex(c.Rejected, 'EXPORT_CAPACITY'):
                e.produce(self.build, self.root/'source', self.root/'legacy', self.command)
    def test_capacity_shortfall_before_build(self):
        with patch.object(e.shutil, 'disk_usage', return_value=shutil._ntuple_diskusage(1, 0, 1)):
            with self.assertRaisesRegex(c.Rejected, 'EXPORT_CAPACITY'):
                e.produce_service(self.build, self.root/'source', self.root/'api', 'api', self.command)
        self.assertFalse((self.root/'api').exists())
        self.assertFalse(any(a[0] == 'docker' for a in self.command.calls))
    def test_missing_extra_and_symlink_service(self):
        for damage in ('missing', 'extra', 'symlink'):
            with self.subTest(damage=damage):
                self.fragments()
                if damage == 'missing': shutil.rmtree(self.root/'api')
                elif damage == 'extra': (self.root/'unknown').mkdir()
                else:
                    shutil.rmtree(self.root/'api'); (self.root/'api').symlink_to(self.root/'web', target_is_directory=True)
                with self.assertRaises((c.Rejected, FileNotFoundError)): self.collect()
                for path in self.root.iterdir():
                    if path.is_symlink(): path.unlink()
                    elif path.is_dir(): shutil.rmtree(path)
                self.assertFalse((self.output/'archive-set.json').exists())
    def test_fragment_identity_fields_privilege_and_expiry(self):
        mutations = [lambda v: v.update(sourceRevision='c'*40), lambda v: v.update(controlRevision='c'*40),
            lambda v: v.update(attemptId='other'), lambda v: v.update(planSha256='f'*64),
            lambda v: v.update(ready=True), lambda v: v.update(extra='field'),
            lambda v: v.update(images={}), lambda v: v.update(expiresAt=v['producedAt']),
            lambda v: v.update(producedAt=(datetime.now(timezone.utc)-timedelta(hours=2)).isoformat(),
                               expiresAt=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()),
            lambda v: v.update(expiresAt=(datetime.now(timezone.utc)+timedelta(hours=2)).isoformat())]
        self.fragments(); original = self.fragment().read_bytes()
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.fragment().write_bytes(original); self.mutate(mutation)
                with self.assertRaises(c.Rejected): self.collect()
                self.assertFalse((self.output/'archive-set.json').exists())
    def test_mixed_plan_tamper_and_duplicate_json(self):
        self.fragments(); path = self.root/'api'/'build-plan.json'; original=path.read_bytes()
        bad=copy.deepcopy(self.build); bad['attemptId']='foreign'; path.write_bytes(c.json_bytes(bad))
        with self.assertRaisesRegex(c.Rejected, 'COLLECT_PLAN_MISMATCH'): self.collect()
        path.write_bytes(original); path=self.fragment(); original=path.read_bytes()
        path.write_bytes(b'{"schemaVersion":1,"schemaVersion":1}')
        with self.assertRaisesRegex(c.Rejected, 'DUPLICATE_JSON_KEY'): self.collect()
        path.write_bytes(original); archive_path=self.root/'api'/'api.tar'
        with archive_path.open('ab') as stream: stream.write(b'tamper')
        with self.assertRaisesRegex(c.Rejected, 'ARCHIVE_CONTENT_MISMATCH'): self.collect()
    def test_symlink_archive_and_fragment(self):
        self.fragments()
        for name in ('api.tar', 'archive-fragment.json'):
            path=self.root/'api'/name; original=path.read_bytes(); path.unlink(); path.symlink_to(self.root/'web'/name.replace('api.tar','web.tar'))
            with self.subTest(name=name), self.assertRaisesRegex(c.Rejected, 'COLLECT_SYMLINK'): self.collect()
            path.unlink(); path.write_bytes(original)
    def test_total_budget_not_per_service_budget(self):
        self.build['maxArchiveBytes']=30000; self.build['maxTotalBytes']=30000
        self.fragments()
        with self.assertRaisesRegex(c.Rejected, 'ARCHIVE_TOTAL_LIMIT'): self.collect()
        self.assertFalse((self.output/'archive-set.json').exists())
    def test_control_gate_and_main_ancestry_still_required(self):
        self.command.fail=['git','merge-base']
        with self.assertRaises(c.Rejected): e.produce_service(self.build,self.root/'source',self.root/'api','api',self.command)
        self.assertFalse(any(a[0]=='docker' for a in self.command.calls))
        self.command.fail=None; self.fragments(); self.command.fail=['git','rev-parse']
        with self.assertRaises(c.Rejected): self.collect()
        self.assertFalse((self.output/'archive-set.json').exists())
    def test_fragment_extra_file_and_no_overwrite(self):
        self.fragments(); (self.root/'api'/'extra').write_text('no')
        with self.assertRaisesRegex(c.Rejected, 'COLLECT_FRAGMENT_FILES'): self.collect()
        (self.root/'api'/'extra').unlink(); self.collect(); raw=(self.output/'archive-set.json').read_bytes()
        with self.assertRaisesRegex(c.Rejected, 'COLLECT_OUTPUT_EXISTS'): self.collect()
        self.assertEqual(raw,(self.output/'archive-set.json').read_bytes())
    def test_build_failure_removes_only_owned_output(self):
        self.command.fail=['docker','buildx']; sentinel=self.root/'keep';sentinel.write_text('keep')
        with self.assertRaises(c.Rejected):e.produce_service(self.build,self.root/'source',self.root/'api','api',self.command)
        self.assertFalse((self.root/'api').exists());self.assertEqual(sentinel.read_text(),'keep')
    def test_move_failure_restores_archives_without_receipt(self):
        self.fragments(); original=e.os.rename; calls=[]
        def fail_once(source, target):
            calls.append((source,target))
            if len(calls)==3: raise OSError('INJECTED_MOVE_FAILURE')
            return original(source,target)
        with patch.object(e.os,'rename',side_effect=fail_once):
            with self.assertRaisesRegex(OSError,'INJECTED_MOVE_FAILURE'): self.collect()
        self.assertFalse(self.output.exists())
        self.assertTrue(all((self.root/s/(s+'.tar')).is_file() for s in c.REPOSITORIES))
    def test_raw_plan_hash_cli_required_and_matching(self):
        raw=c.json_bytes(self.build); path=self.root/'plan.json';path.write_bytes(raw)
        base=['export','--plan',str(path),'--source',str(self.root/'source'),'--output',str(self.root/'api'),'--service','api']
        with patch.object(e.signal,'signal'),patch.object(e.signal,'alarm'),patch.object(e,'produce') as producer:
            for suffix,code in (([], 'PLAN_RAW_HASH_REQUIRED'), (['--plan-sha256','f'*64], 'PLAN_RAW_HASH_MISMATCH')):
                with patch.object(e.sys,'argv',base+suffix):
                    with self.assertRaisesRegex(c.Rejected,code):e.main()
            producer.assert_not_called()
            with patch.object(e.sys,'argv',base+['--plan-sha256',c.sha(raw)]):e.main()
            producer.assert_called_once()
    def test_collector_canonical_plan_bytes_required(self):
        self.fragments();path=self.root/'api'/'build-plan.json'
        path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(c.Rejected,'COLLECT_PLAN_MISMATCH'):self.collect()

    def test_legacy_retains_complete_five_set(self):
        output=self.root/'legacy';value=e.produce(self.build,self.root/'source',output,self.command)
        raw=(output/'archive-set.json').read_bytes();c.validate_set(output,raw,c.sha(raw),self.build)
        self.assertEqual(set(value['images']),set(c.REPOSITORIES))


if __name__ == '__main__': unittest.main()
