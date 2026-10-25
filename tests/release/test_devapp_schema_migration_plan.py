import hashlib
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('plan', ROOT/'scripts/devapp-schema-migration-plan.py')
plan = importlib.util.module_from_spec(spec); spec.loader.exec_module(plan)

class DevappPlanTest(unittest.TestCase):
    def fixture(self):
        files = {p.name: p.read_bytes() for p in (ROOT/'apps/api/migrations').glob('*.sql')}
        target = {n: hashlib.sha256(b).hexdigest() for n, b in files.items()}
        baseline = {n: h for n, h in target.items() if n not in plan.PENDING}
        ledger = dict(baseline)
        for n in plan.HISTORICAL_DRIFT:
            ledger[n] = hashlib.sha256(('historical:'+n).encode()).hexdigest()
        ledger[next(iter(plan.EXTRA))] = 'f'*64
        return {'source': plan.SOURCE, 'readOnly': True, 'ledger': ledger, 'baselineSchema': baseline, 'targetSchema': target}, files

    def test_lossless_components_preserve_history_and_defer_singleton(self):
        observed, files = self.fixture()
        result = plan.build(observed, files.__getitem__)
        self.assertEqual(432, len(result['expectedLedger']))
        self.assertTrue(all(result['expectedLedger'][n] == h for n,h in observed['ledger'].items()))
        manual = []
        for migration in result['migrations']:
            self.assertEqual(files[migration['name']], ''.join(c['sql'] for c in migration['components']).encode())
            manual += [c for c in migration['components'] if c['kind'] == 'manual-data']
        self.assertEqual(1, len(manual))
        self.assertEqual('INSERT INTO credit_consumption_settings(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;', manual[0]['sql'])

    def test_unknown_drift_rejected(self):
        observed, files = self.fixture()
        observed['ledger']['0001-kernel-roles.sql'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'UNREVIEWED_HISTORY_DRIFT'):
            plan.build(observed, files.__getitem__)

    def test_modified_pending_bytes_rejected(self):
        observed, files = self.fixture()
        files[next(iter(plan.PENDING))] += b'\n'
        with self.assertRaisesRegex(ValueError, 'SOURCE_CHECKSUM_DRIFT'):
            plan.build(observed, files.__getitem__)

    def test_extra_history_not_silently_removed(self):
        observed, files = self.fixture()
        del observed['ledger'][next(iter(plan.EXTRA))]
        with self.assertRaises(ValueError):
            plan.build(observed, files.__getitem__)

if __name__ == '__main__': unittest.main()
