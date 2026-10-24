import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('admission', Path(__file__).parents[1]/'scripts/cn-image-admission.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class LedgerAdmission(unittest.TestCase):
    def result(self, rows):
        return dict(status='COMPLETE', readOnly=True, count=len(rows), ledger=rows)
    def test_exact_full_ledger(self):
        m.check_ledger(self.result([dict(name='a.sql', checksum='a')]), {'a.sql':'a'})
    def test_count_alone_is_not_identity(self):
        with self.assertRaisesRegex(m.Rejected, 'DRIFT'):
            m.check_ledger(self.result([dict(name='b.sql', checksum='a')]), {'a.sql':'a'})
    def test_duplicate_rows_rejected(self):
        with self.assertRaisesRegex(m.Rejected, 'DUPLICATE'):
            m.check_ledger(self.result([dict(name='a', checksum='x')]*2), {'a':'x','b':'y'})
    def test_wrong_checksum_rejected(self):
        with self.assertRaisesRegex(m.Rejected, 'DRIFT'):
            m.check_ledger(self.result([dict(name='a', checksum='z')]), {'a':'x'})
    def test_truncated_rows_rejected(self):
        with self.assertRaisesRegex(m.Rejected, 'COUNT'):
            m.check_ledger(dict(status='COMPLETE',readOnly=True,count=2,ledger=[]), {'a':'x','b':'y'})
    def test_unproven_read_only_rejected(self):
        with self.assertRaisesRegex(m.Rejected, 'REJECTED'):
            m.check_ledger(dict(status='COMPLETE',count=0,ledger=[]), {})

if __name__ == '__main__':
    unittest.main()
