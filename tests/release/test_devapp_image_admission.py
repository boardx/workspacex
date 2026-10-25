import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('admission',Path(__file__).resolve().parents[2]/'scripts/devapp-image-admission.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class LedgerAdmissionTest(unittest.TestCase):
    def test_preserves_known_environment_specific_history(self):
        expected={'current':'a'*64,'old-checksum-exception':'b'*64,'removed-historical-file':'c'*64}
        a.check_ledger(dict(expected),expected)

    def test_drift_missing_and_unreviewed_entries_rejected(self):
        expected={'current':'a'*64,'old-checksum-exception':'b'*64}
        for actual in [{'current':'a'*64},{**expected,'current':'c'*64},{**expected,'unreviewed':'d'*64}]:
            with self.subTest(actual=actual),self.assertRaises(ValueError):a.check_ledger(actual,expected)

if __name__=='__main__':unittest.main()
