import importlib.util
import hashlib
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('plan',Path(__file__).parents[1]/'scripts/cn-schema-migration-plan.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Components(unittest.TestCase):
 def test_lossless_and_distinct(self):
  for name,ranges in m.RANGES.items():
   start,end=ranges[0];raw=('CREATE TABLE demo(id int);\n'+start+' payload '+end+'\nGRANT SELECT ON demo TO app_rw;').encode()
   v=m.components(name,raw,m.digest(raw))
   self.assertEqual(''.join(c['sql'] for c in v['components']).encode(),raw)
   self.assertEqual([c['kind'] for c in v['components']],['schema','manual-data','schema'])
   schema=''.join(c['sql'] for c in v['components'] if c['kind']=='schema')
   self.assertNotIn('payload',schema)
 def test_checksum_drift(self):
  with self.assertRaisesRegex(ValueError,'CHECKSUM'):m.components('x',b'SELECT 1;','0'*64)
 def test_range_ambiguity(self):
  name=next(iter(m.RANGES));start,end=m.RANGES[name][0];raw=(start+end+start+end).encode()
  with self.assertRaisesRegex(ValueError,'RANGE'):m.components(name,raw,m.digest(raw))
 def test_function_body_preserved(self):
  raw=b'CREATE FUNCTION x() RETURNS void AS $$ BEGIN INSERT INTO t VALUES(1); END $$ LANGUAGE plpgsql;'
  self.assertEqual(m.components('pure.sql',raw,m.digest(raw))['components'][0]['sql'].encode(),raw)
if __name__=='__main__':unittest.main()
