import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('retention',Path(__file__).parents[1]/'scripts/cn-release-mvp-original-retention.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class RetentionGuards(unittest.TestCase):
    def test_fixed_release_hash_before_any_read(self):
        for release in ('../../etc','a'*63,True):
            with self.subTest(release=release),self.assertRaisesRegex(ValueError,'RELEASE_HASH'):
                m.retain(release,reader=lambda _:self.fail('unexpected read'))

    def test_selected_approval_bytes_must_match(self):
        with self.assertRaisesRegex(ValueError,'APPROVAL_HASH'):
            m.retain('a'*64,reader=lambda _:b'{}')

    def test_producer_status_never_invokes_retention(self):
        # Unknown mode is rejected before provider access or filesystem writes.
        with self.assertRaisesRegex(ValueError,'PRODUCER_MODE'):
            m.P.complete('a'*64,'install')


if __name__=='__main__':unittest.main()
