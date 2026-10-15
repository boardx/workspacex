import copy, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import test_cn_hk_rebound_bindings as old
class V3(unittest.TestCase):
 def test_new_source_requires_exact_actual_plan(self):
  fixture=old.Rebound()
  with tempfile.TemporaryDirectory()as td:
   p,r,meta,c,gh=fixture.source_fixture(Path(td),source='a'*40)
   p.update(kind='hk-original-artifact-transfer-v3',sourceRevision='a'*40,sourceRunAttempt=1)
   old.u.validate_plan(p)
   with patch.object(old.u,'gh',side_effect=gh):self.assertEqual(old.u.validate_source_run(p),r)
   p['sourceRevision']='b'*40
   with patch.object(old.u,'gh',side_effect=gh),self.assertRaises(ValueError):old.u.validate_source_run(p)
 def test_v2_not_relaxed(self):
  p=old.Rebound().fixture();p['sourceRevision']='a'*40
  with self.assertRaises(ValueError):old.u.validate_plan(p)
 def test_retry_not_allowed(self):
  p=old.Rebound().fixture();p.update(kind='hk-original-artifact-transfer-v3',sourceRevision='a'*40,sourceRunAttempt=2)
  with self.assertRaises(ValueError):old.u.validate_plan(p)
if __name__=='__main__':unittest.main()
