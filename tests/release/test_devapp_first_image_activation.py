import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('activation',Path(__file__).resolve().parents[2]/'scripts/devapp-first-image-activation.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class RecoveryFenceTest(unittest.TestCase):
    def test_applied_public_load_with_lost_response_forbids_database_rewind(self):
        state={'mayHaveOpened':False};events=[]
        def applied_but_timeout(config):
            self.assertTrue(state['mayHaveOpened'])
            self.assertEqual('public-open-intent.json',events[0][0])
            raise TimeoutError('response lost after applying config')
        with patch.object(a,'save',side_effect=lambda *args:events.append(args)),patch.object(a,'caddy_set',side_effect=applied_but_timeout):
            with self.assertRaises(TimeoutError):a.open_public({'public':True},state)
        self.assertTrue(state['mayHaveOpened'])

    def test_failed_health_keeps_maintenance_fence(self):
        with patch.object(a,'run'),patch.object(a,'health',side_effect=ValueError('not ready')),patch.object(a,'probe') as probe,patch.object(a,'caddy_set') as load:
            with self.assertRaises(ValueError):a.restore_old_services({}, {'maintenance':True},True)
            load.assert_not_called();probe.assert_not_called()

    def test_failed_baseline_browser_keeps_maintenance_fence(self):
        with patch.object(a,'run'),patch.object(a,'health'),patch.object(a,'probe',side_effect=ValueError('login failed')),patch.object(a,'caddy_set') as load:
            with self.assertRaises(ValueError):a.restore_old_services({}, {'maintenance':True},True)
            load.assert_not_called()

    def test_old_services_are_verified_before_public_reopens(self):
        events=[]
        with patch.object(a,'run',side_effect=lambda *x:events.append('start')),patch.object(a,'health',side_effect=lambda:events.append('health')),patch.object(a,'probe',side_effect=lambda **kw:events.append(('browser',kw))),patch.object(a,'caddy_get',side_effect=[{'maintenance':True},{}]),patch.object(a,'caddy_set',side_effect=lambda x:events.append('open')):
            a.restore_old_services({}, {'maintenance':True},True)
        self.assertEqual(['start','start','health',('browser',{'baseline':True}),'open'],events)

    def test_cold_copy_preserves_ownership_and_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            src=Path(root)/'data';src.mkdir();(src/'pg').mkdir();(src/'pg'/'test').write_bytes(b'baseline')
            dst=Path(root)/'backup'
            # No privileged filesystem changes in the test; verify chown calls for all entries.
            with patch.object(a.os,'chown') as chown:a.cold_copy(src,dst)
            self.assertEqual(3,chown.call_count)
            self.assertEqual(a.tree_hash(src),a.tree_hash(dst))

if __name__=='__main__':unittest.main()
