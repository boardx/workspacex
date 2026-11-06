"""Real root loop/admission routing with isolated durable-entry stand-ins."""
import copy
import importlib.util
from pathlib import Path
from unittest.mock import Mock,patch
import unittest
import tempfile
import test_cn_release_fixed_driver as driver_fixture

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('phase_router',ROOT/'scripts/cn-release-stage-router.py')
router_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(router_module)


class RootPhases(unittest.TestCase):
    def setUp(self):
        self.f=driver_fixture.DriverTests('test_full_order_original_clock_and_prior_hash');self.f.setUp()
        f=self.f;self.safe=False;self.writer=False;self.checkpoints=[]
        f.router.safety_required=lambda:True
        def admission(release,stage):
            if stage in ('switch-stage','switch') and not self.safe:return 'WAITING_FOR_A3_A4_EVIDENCE'
            if stage=='clear-hold' and not self.writer:return 'WAITING_FOR_WRITER_APPROVAL'
        def checkpoint(release,stage,rows):
            self.checkpoints.append((stage,copy.deepcopy(rows)))
            return dict(stage=stage,actualPriorReceipt=rows[-1]['receiptSha256'])
        f.router.admission=admission;f.router.waiting_checkpoint=checkpoint
        f.router.completed_safety=lambda release:dict(actualA3='bound',actualA4='bound')
    def test_actual_driver_three_boundaries_then_same_clock_completion(self):
        f=self.f;first,_=f.run_driver()
        self.assertEqual(first['status'],'WAITING_FOR_A3_A4_EVIDENCE')
        self.assertEqual(len(first['completed']),12)
        self.assertNotIn('switch-stage',f.requests);self.assertNotIn('switch',f.requests)
        self.safe=True;second,_=f.run_driver()
        self.assertEqual(second['status'],'WAITING_FOR_WRITER_APPROVAL');self.assertEqual(len(second['completed']),15)
        self.assertNotIn('clear-hold',f.requests);self.assertNotIn('observe',f.requests)
        self.writer=True;final,_=f.run_driver()
        self.assertEqual(final['status'],'CHAIN_COMPLETED');self.assertIn('safetyEvidence',final)
        self.assertFalse(final['productionAcceptanceClaimedByDriver'])
        self.assertEqual(final['requestedAt'],f.a['identity']['requestedAt'])
        self.assertEqual(final['deadlineAt'],f.a['identity']['deadlineAt'])
        self.assertEqual(len([v for v in f.calls if v[0]=='advance']),17)
        count=len(f.calls);f.run_driver()
        self.assertEqual(len([v for v in f.calls[count:] if v[0]=='advance']),0)
    def test_pre_generated_switch_package_cannot_bypass_missing_a3(self):
        f=self.f;f.requests['switch-stage']='f'*64
        value,_=f.run_driver()
        self.assertEqual(value['status'],'WAITING_FOR_A3_A4_EVIDENCE')
        self.assertFalse(any(mode=='advance' and pin=='f'*64 for mode,pin in f.calls))
        self.assertNotIn('switch',f.requests)
    def test_revocation_after_staging_stops_actual_switch(self):
        f=self.f
        f.router.admission=lambda release,stage:'WAITING_FOR_A3_A4_EVIDENCE' if stage=='switch' else None
        value,_=f.run_driver();self.assertEqual(value['stage'],'switch')
        self.assertEqual(len(value['completed']),13);self.assertNotIn('switch',f.requests)
    def test_readonly_status_does_not_generate_or_approve(self):
        value,_=self.f.run_driver(mode='status');self.assertEqual(value['status'],'NOT_STARTED')
        self.assertEqual(self.f.generated,[]);self.assertEqual(self.checkpoints,[])


class InstalledAdmission(unittest.TestCase):
    def make(self):
        a=dict(identity=dict(sourceRevision='bc3d1254ce05c915801fb73fe6698072730a051c',attemptId='fixture'))
        raw=router_module.e.encode(a);pin=router_module.e.digest(raw)
        return router_module.Router(pin,a,raw),pin
    def test_real_router_waits_then_records_exact_consumed_evidence(self):
        r,pin=self.make();r.safety_evidence=Mock(return_value=None);r.install_record=Mock()
        self.assertEqual(r.admission(pin,'switch-stage'),'WAITING_FOR_A3_A4_EVIDENCE');r.install_record.assert_not_called()
        value={'kind':'fixture-consumed','productionAccepted':False};r.safety_evidence.return_value=value
        self.assertIsNone(r.admission(pin,'switch-stage'))
        r.install_record.assert_called_once_with(r.base/'safety-consumed',{'evidence.json':router_module.e.encode(value)})
        r.safety_evidence.return_value=None
        self.assertEqual(r.admission(pin,'switch'),'WAITING_FOR_A3_A4_EVIDENCE')
    def test_repeated_live_gate_checks_preserve_first_record_and_reject_drift(self):
        r,pin=self.make()
        with tempfile.TemporaryDirectory() as folder:
            r.base=Path(folder)
            original=dict(kind='fixture-consumed',consumedAt='first',approvalSha256='a'*64,productionAccepted=False)
            r.safety_evidence=Mock(return_value=original)
            # Only filesystem protection is substituted; actual immutable writer,
            # duplicate admissions and byte comparisons run here.
            with patch.object(router_module.e,'read',side_effect=lambda path,*args:Path(path).read_bytes()), \
                 patch.object(router_module.e,'directory'),patch.object(router_module.e,'fsync_dir'), \
                 patch.object(router_module.e,'create',side_effect=lambda path,raw:Path(path).write_bytes(raw)):
                self.assertIsNone(r.admission(pin,'switch-stage'))
                raw=(r.base/'safety-consumed/evidence.json').read_bytes()
                r.safety_evidence.return_value={**original,'consumedAt':'second'}
                self.assertIsNone(r.admission(pin,'switch-stage'))
                self.assertIsNone(r.admission(pin,'switch'))
                self.assertEqual((r.base/'safety-consumed/evidence.json').read_bytes(),raw)
                r.safety_evidence.return_value={**original,'approvalSha256':'b'*64}
                with self.assertRaisesRegex(Exception,'SAFETY_RECEIPT_CHANGED'):r.admission(pin,'switch')
                self.assertEqual((r.base/'safety-consumed/evidence.json').read_bytes(),raw)
                r.safety_evidence.return_value=None
                self.assertEqual(r.admission(pin,'switch'),'WAITING_FOR_A3_A4_EVIDENCE')
                self.assertEqual(r.safety_evidence.call_count,5)
    def test_bc_writer_wait_never_materializes_conditional_approval(self):
        r,pin=self.make();r.conditional_writer=Mock(side_effect=AssertionError('must not auto approve'))
        with patch.object(Path,'exists',return_value=False):
            self.assertEqual(r.admission(pin,'clear-hold'),'WAITING_FOR_WRITER_APPROVAL')
        r.conditional_writer.assert_not_called()

if __name__=='__main__':unittest.main()
