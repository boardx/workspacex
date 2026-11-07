import importlib.util
import os
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('credit_storage', pathlib.Path(__file__).parents[1] / 'ensure-credit-receipts.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CreditStorageTests(unittest.TestCase):
    def test_private_storage_and_replay_are_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            directory = pathlib.Path(root) / 'receipts'
            module.ensure_storage(str(directory))
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            receipt = directory / 'pending.json'
            receipt.write_text('{"pending":true}')
            module.ensure_storage(str(directory))
            self.assertEqual(receipt.read_text(), '{"pending":true}')
            self.assertEqual(sorted(p.name for p in directory.iterdir()), ['pending.json'])
    def test_rejects_nonprivate_or_symlink_directory(self):
        with tempfile.TemporaryDirectory() as root:
            target = pathlib.Path(root) / 'shared'
            target.mkdir(mode=0o755)
            with self.assertRaises(ValueError):
                module.ensure_storage(str(target))
            target.chmod(0o700)
            linked = pathlib.Path(root) / 'linked'
            linked.symlink_to(target, target_is_directory=True)
            with self.assertRaises(ValueError):
                module.ensure_storage(str(linked))
    def test_requires_absolute_storage(self):
        with self.assertRaises(ValueError):
            module.ensure_storage('relative')

if __name__ == '__main__':
    unittest.main()
