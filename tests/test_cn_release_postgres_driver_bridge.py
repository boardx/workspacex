"""Core seam tests; synthetic phase output is not real PostgreSQL evidence."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('pgbridge_entry',ROOT/'.harness/scripts/vm/cn-release-advance.py')
e=importlib.util.module_from_spec(s);s.loader.exec_module(e)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='wsx-pg-entry-',dir=ROOT)
        self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        for name in ('requests','state'):(self.root/name).mkdir(mode=0o700)
        for name,value in [('OWNER',os.getuid()),('CGROUP_BASE',None),('REQUESTS',self.root/'requests'),('STATE',self.root/'state')]:
            p=patch.object(e,name,value);p.start();self.addCleanup(p.stop)
        now=e.now();self.identity=dict(sourceRevision='a'*40,baselineRevision='b'*40,controlRevision='c'*40,
            attemptId='fixture-test',requestedAt=now.isoformat(),deadlineAt=(now+dt.timedelta(minutes=5)).isoformat())
        self.t=e.IsolatedPostgresTransport(self.root,self.identity)

    def package(self,stage='init',previous=None,scope=e.PG_SCOPE,action=None):
        action=action or b'printf "{\\"verified\\":true}\\n"\n'
        files={'action.sh':action,'observe.sh':b'printf "{\\"verified\\":true}\\n"\n','authorization.json':b'{}',
          'verify.py':b'import json\ndef verify(raw,m,p,mode):\n assert json.loads(raw)=={"verified":True}\n return {"externalWritesTerminal":True} if mode=="terminal" else True\n'}
        m=dict(schemaVersion=1,**self.identity,scope=scope,stage=stage,previousReceiptSha256=previous,
            issuedAt=self.identity['requestedAt'],expiresAt=self.identity['deadlineAt'],timeoutSeconds=3)
        for name,key in [('action.sh','actionSha256'),('observe.sh','observerSha256'),('verify.py','verifierSha256'),('authorization.json','authorizationEvidenceSha256')]:m[key]=e.digest(files[name])
        raw=e.encode(m);h=e.digest(raw);folder=self.root/'requests'/h;folder.mkdir(mode=0o700)
        for name,data in {**files,'manifest.json':raw}.items():e.create(folder/name,data)
        return h

    def test_production_rejects_each_fixture_phase(self):
        for phase in e.PG_PHASES:
            h=self.package(phase)
            with self.assertRaisesRegex(e.Rejected,'SCOPE_INVALID'):e.entry('status',h,'fixture-test')

    def test_fixture_rejects_production_scope_and_wrong_identity(self):
        h=self.package('consume',scope='runtime-only-reviewed-continuation')
        with self.assertRaisesRegex(e.Rejected,'SCOPE_INVALID'):self.t.entry('status',h,'fixture-test')
        h=self.package();self.t.identity['sourceRevision']='d'*40
        with self.assertRaisesRegex(e.Rejected,'FIXTURE_IDENTITY_CHANGED'):self.t.entry('status',h,'fixture-test')

    def test_actual_core_once_receipt_and_no_replay(self):
        marker=self.root/'marker';h=self.package(action=('printf x >> '+str(marker)+'\nprintf "{\\"verified\\":true}\\n"\n').encode())
        first=self.t.entry('advance',h,'fixture-test');second=self.t.entry('advance',h,'fixture-test')
        self.assertEqual(first['receiptSha256'],second['receiptSha256']);self.assertEqual(marker.read_bytes(),b'x')
        raw=e.read(self.root/'state/fixture-test/00-init.receipt.json')
        self.assertEqual(e.decode(raw)['scope'],e.PG_SCOPE)
        self.assertFalse(e.decode(raw)['productionAcceptanceClaimedByTransport'])

    def test_unknown_no_retry_then_readonly_reconcile(self):
        h=self.package(action=b'exit 17\n')
        with self.assertRaisesRegex(e.Rejected,'EXECUTION_UNCERTAIN'):self.t.entry('advance',h,'fixture-test')
        self.assertEqual(self.t.entry('status',h,'fixture-test')['status'],'UNCERTAIN')
        with self.assertRaisesRegex(e.Rejected,'UNCERTAIN_RECONCILE_NO_RETRY'):self.t.entry('advance',h,'fixture-test')
        self.assertEqual(self.t.entry('reconcile',h,'fixture-test')['status'],'COMPLETED')

    def test_root_and_recovery_rejected(self):
        with self.assertRaises(e.Rejected):e.IsolatedPostgresTransport(Path('/var/lib/workspacex-cn'),self.identity)
        with self.assertRaisesRegex(e.Rejected,'FIXTURE_RECOVERY_FORBIDDEN'):self.t.entry('recover','a'*64,'fixture-test')

    def test_phase_order_bound_to_prior_raw_receipt(self):
        h=self.package('backup',previous='a'*64)
        with self.assertRaises(FileNotFoundError):self.t.entry('advance',h,'fixture-test')
        self.assertFalse((self.root/'state/fixture-test/01-backup.intent.json').exists())

class PhaseVerifierTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('fixture_bridge',ROOT/'tests/fixtures/cn-postgres-lifecycle/driver_bridge.py')
        self.bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.bridge)
        self.value=dict(kind='isolated-pg-phase-receipt-v1',scope='fixture-only',phase='backup',verified=True,terminal=True,
            epoch='12345678-1234-4234-8234-123456789abc',sequence=2,previousPhaseSha256='a'*64,seed=19,
            expectedFaultScenario=False,journalRecords=[])
        self.code=self.bridge.verifier_source(2,'a'*64,self.value['epoch'],19)

    def test_valid_exact_phase(self):
        e.verify(self.code,e.encode(self.value),{'stage':'backup'},None,'terminal')

    def test_seed_epoch_previous_phase_fault_tampering(self):
        for key,value in [('seed',20),('epoch','0'*36),('previousPhaseSha256','b'*64),('phase','restore'),('sequence',3),('expectedFaultScenario',True)]:
            with self.subTest(key=key),self.assertRaises(AssertionError):
                e.verify(self.code,e.encode({**self.value,key:value}),{'stage':'backup'},None,'advance')

    def test_journal_original_bytes_tampering(self):
        value={**self.value,'journalRecords':[dict(rawBase64='e30=',sha256='c'*64)]}
        with self.assertRaises(AssertionError):e.verify(self.code,e.encode(value),{'stage':'backup'},None,'advance')

if __name__=='__main__':unittest.main()
