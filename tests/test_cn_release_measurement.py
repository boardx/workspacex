"""Original-format timing fixtures and real local durable executor; no cloud calls."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('measurement', ROOT/'scripts/cn-release-measurement.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
START = dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc)


def stamp(seconds):
    return (START+dt.timedelta(seconds=seconds)).isoformat()


class MeasurementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.identity = dict(sourceRevision='a'*40, baselineRevision='b'*40, controlRevision='c'*40,
                             attemptId='one', scope='runtime-only-reviewed-continuation',
                             requestedAt=stamp(100), deadlineAt=stamp(1900))
        self.write('identity.json', self.identity)

    def write(self, name, value):
        (self.root/name).write_text(json.dumps(value, sort_keys=True)+'\n')

    def chain(self, count=None):
        previous = None
        for i, stage in enumerate(m.entry.STAGES[:count]):
            prefix = '%02d-%s' % (i, stage)
            intent = dict(stage=stage, requestSha256=str(i%10)*64, previousReceiptSha256=previous,
                          createdAt=stamp(110+i*20))
            receipt = dict(self.identity, stage=stage, requestSha256=intent['requestSha256'],
                           previousReceiptSha256=previous, mode='advance', finishedAt=stamp(120+i*20),
                           elapsedSeconds=20+i*20, withinTotalBudget=True)
            for key, suffix in [('evidenceSha256', '.evidence.json'),
                                ('terminalObservationSha256', '.terminal-observation.json'),
                                ('admissionSha256', '.admission.json')]:
                self.write(prefix+suffix, {'fixture': True})
                receipt[key] = m.digest((self.root/(prefix+suffix)).read_bytes())
            self.write(prefix+'.intent.json', intent)
            self.write(prefix+'.receipt.json', receipt)
            previous = m.digest((self.root/(prefix+'.receipt.json')).read_bytes())

    def report(self, **updates):
        options = dict(github_accepted_at=stamp(10), user_requested_at=stamp(0), observed_at=stamp(1000))
        options.update(updates)
        return m.report(self.root, **options)

    def mutate(self, name, **updates):
        data = json.loads((self.root/name).read_text()); data.update(updates); self.write(name, data)

    def test_complete_transport_never_claims_production_or_thirty_minute_success(self):
        self.chain()
        value = self.report()
        self.assertTrue(value['completeTransportChain'])
        self.assertFalse(value['productionAccepted'])
        self.assertFalse(value['thirtyMinuteProductionProven'])
        self.assertEqual(value['performanceVerdict'], 'UNVERIFIED')
        self.assertEqual(value['githubToTransportSeconds'], 430)
        self.assertEqual(value['userToTransportSeconds'], 440)
        self.assertTrue(value['totalIsLowerBound'])

    def test_empty_and_partial_attempts_are_lower_bounds(self):
        for count in (0, 2):
            self.chain(count)
            value = self.report()
            self.assertFalse(value['completeTransportChain'])
            self.assertEqual(value['githubToTransportSeconds'], 990)
            self.assertEqual(len(value['missingStages']), len(m.entry.STAGES)-count)

    def test_approval_queue_overlap_not_double_counted_or_subtracted_from_total(self):
        self.chain(1)
        value = self.report(waits=[dict(kind='queue', startedAt=stamp(10), finishedAt=stamp(80)),
                                  dict(kind='approval', startedAt=stamp(50), finishedAt=stamp(110))])
        self.assertEqual(value['queueAnnotationSeconds'], 70)
        self.assertEqual(value['approvalAnnotationSeconds'], 60)
        self.assertEqual(value['waitAnnotationUnionSeconds'], 100)
        self.assertEqual(value['executionOrWaitUnionSeconds'], 110)
        self.assertEqual(value['unclassifiedGapSeconds'], 880)
        self.assertEqual(value['githubToTransportSeconds'], 990)

    def test_parallel_interval_union(self):
        self.assertEqual(m.union_seconds([(START, START+dt.timedelta(seconds=20)),
                                         (START+dt.timedelta(seconds=5), START+dt.timedelta(seconds=10))]), 20)

    def test_over_budget_is_failure_and_clock_is_not_reset(self):
        self.chain(1)
        value = m.report(self.root, github_accepted_at=stamp(10), user_requested_at=stamp(0), observed_at=stamp(2000))
        self.assertEqual(value['performanceVerdict'], 'FAIL')
        self.assertEqual(value['githubToTransportSeconds'], 1990)

    def test_chain_and_request_and_identity_tamper_rejected(self):
        self.chain(2)
        name = '01-publication-stage.receipt.json'; original = (self.root/name).read_bytes()
        for updates in [dict(previousReceiptSha256='f'*64), dict(requestSha256='f'*64),
                        dict(sourceRevision='f'*40), dict(stage='observe'), dict(mode='skipped')]:
            with self.subTest(updates=updates):
                (self.root/name).write_bytes(original); self.mutate(name, **updates)
                with self.assertRaises(m.Rejected): self.report()

    def test_original_evidence_bytes_required(self):
        self.chain(1)
        (self.root/'00-consume.evidence.json').write_bytes(b'{}')
        with self.assertRaisesRegex(m.Rejected, 'EVIDENCE_CHANGED'): self.report()

    def test_gap_cannot_hide_skipped_stage(self):
        self.chain(2); (self.root/'00-consume.receipt.json').unlink()
        with self.assertRaisesRegex(m.Rejected, 'RECEIPT_AFTER_GAP'): self.report()

    def test_lost_receipt_remains_uncertain_without_replay(self):
        self.chain(1); (self.root/'00-consume.receipt.json').unlink()
        value = self.report()
        self.assertEqual(value['uncertainStages'], ['consume'])
        self.assertFalse(value['completeTransportChain'])
        self.assertFalse(value['productionAccepted'])

    def test_recovery_scope_cannot_attest_normal_release(self):
        self.mutate('identity.json', scope='runtime-only-reviewed-recovery')
        with self.assertRaisesRegex(m.Rejected, 'IDENTITY_SCOPE'): self.report()

    def test_time_reversal_future_and_elapsed_tamper(self):
        self.chain(1); name = '00-consume.receipt.json'; original = (self.root/name).read_bytes()
        for changes in [dict(finishedAt=stamp(109)), dict(finishedAt=stamp(1001)),
                        dict(elapsedSeconds=1), dict(withinTotalBudget=False)]:
            (self.root/name).write_bytes(original); self.mutate(name, **changes)
            with self.assertRaises(m.Rejected): self.report()

    def test_non_utc_and_new_clock_origin_fail(self):
        for timestamp in ['2026-10-18T00:00:00', '2026-10-18T01:00:00+01:00', 'no']:
            with self.subTest(timestamp=timestamp), self.assertRaises(m.Rejected): m.instant(timestamp)
        with self.assertRaises(m.Rejected): self.report(github_accepted_at=stamp(101))

    def test_symlink_hardlink_and_oversize_rejected(self):
        p = self.root/'identity.json'; original = p.read_bytes(); p.unlink()
        other = self.root/'other'; other.write_bytes(original); p.symlink_to(other)
        with self.assertRaises(OSError): self.report()
        p.unlink(); os.link(other, p)
        with self.assertRaises(m.Rejected): self.report()
        p.unlink(); p.write_bytes(b' '*65537)
        with self.assertRaises(m.Rejected): self.report()

    def test_duplicate_identity_keys_rejected(self):
        (self.root/'identity.json').write_text('{"attemptId":"one","attemptId":"two"}')
        with self.assertRaises(m.Rejected): self.report()

    def test_deep_json_cli_returns_fixed_rejection(self):
        (self.root/'identity.json').write_bytes(b'['*1100+b']'*1100)
        result = subprocess.run([sys.executable, '-B', str(ROOT/'scripts/cn-release-measurement.py'),
            '--attempt-dir', str(self.root), '--github-accepted-at', stamp(10),
            '--user-requested-at', stamp(0)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr, '')
        self.assertEqual(json.loads(result.stdout)['error'], 'MEASUREMENT_REJECTED')

    def test_non_object_receipt_and_intent_cli_fail_with_only_fixed_json(self):
        self.chain(1)
        for suffix in ['receipt', 'intent']:
            path = self.root/('00-consume.'+suffix+'.json'); raw = path.read_bytes()
            for invalid in [[], None, 12, True, 'scalar']:
                with self.subTest(suffix=suffix, invalid=invalid):
                    path.write_text(json.dumps(invalid))
                    with self.assertRaisesRegex(m.Rejected, 'RECEIPT_INTENT_OBJECT'): self.report()
                    result = subprocess.run([sys.executable, '-B', str(ROOT/'scripts/cn-release-measurement.py'),
                        '--attempt-dir', str(self.root), '--github-accepted-at', stamp(10),
                        '--user-requested-at', stamp(0)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertEqual(result.stderr, '')
                    self.assertEqual(json.loads(result.stdout), {'kind':'cn-release-measurement-v1',
                        'error':'MEASUREMENT_REJECTED', 'productionAccepted':False})
            path.write_bytes(raw)

    def test_cli_never_returns_success_or_raw_error(self):
        result = subprocess.run([sys.executable, '-B', str(ROOT/'scripts/cn-release-measurement.py'),
                                 '--attempt-dir', str(self.root), '--github-accepted-at', stamp(10),
                                 '--user-requested-at', stamp(0)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        value = json.loads(result.stdout)
        self.assertFalse(value['productionAccepted'])
        self.assertEqual(result.stderr, '')

    def test_actual_durable_executor_receipt_is_consumed_without_reexecution(self):
        import test_cn_release_entry as native
        case = native.EntryTests(methodName='test_verifier_cannot_complete_normal_release_after_original_deadline')
        case.setUp()
        try:
            # Cloud sandbox '/' can be uid65534. Only this disposable subtree is
            # the fixture authority; production directory() remains unchanged.
            def fixture_directory(path):
                self.assertTrue(path == case.root or case.root in path.parents)
                self.assertTrue(path.is_dir())
                self.assertEqual(path.stat().st_uid, os.getuid())
                self.assertFalse(path.stat().st_mode & 0o022)
            with patch.object(native.e, 'directory', fixture_directory):
                request = case.package(); result = case.advance(request)
            self.assertEqual(result['status'], 'COMPLETED')
            root = case.state/'test-one'
            identity = json.loads((root/'identity.json').read_text())
            value = m.report(root, github_accepted_at=identity['requestedAt'], user_requested_at=identity['requestedAt'])
            self.assertEqual(value['stages'][0]['receiptSha256'], result['receiptSha256'])
            self.assertEqual(len(value['stages']), 1)
            self.assertFalse(value['productionAccepted'])
        finally:
            case.doCleanups()


if __name__ == '__main__':
    unittest.main()
