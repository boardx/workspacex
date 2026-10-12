import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('startup_limits',Path(__file__).with_name('cn_release_api_startup_linux.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Limits(unittest.TestCase):
 def test_work_preserves_cleanup_reserve(self):
  self.assertEqual(m.operation_timeout(0,1100,420),10)
  with self.assertRaisesRegex(RuntimeError,'SHARED_DEADLINE'):m.operation_timeout(0,1110,420)
 def test_cleanup_cannot_extend_total(self):
  self.assertEqual(m.operation_timeout(0,1190,60,True),10)
  with self.assertRaisesRegex(RuntimeError,'SHARED_DEADLINE'):m.operation_timeout(0,1200,60,True)
 def test_local_caps_are_not_enlarged(self):
  self.assertEqual(m.operation_timeout(0,0,5),5)
  self.assertEqual(m.operation_timeout(0,0,420),420)
 def test_fixed_routing_preserves_original_cases(self):
  self.assertEqual(len(m.SCENARIOS),6)
  for x in m.SCENARIOS:self.assertEqual(m.scenario_fixture(x).name,'extended.ts'if x.endswith('-extended')else'startup.ts')
  with self.assertRaisesRegex(RuntimeError,'SCENARIO'):m.scenario_fixture('../foreign')
 def test_image_declared_volume_must_be_overridden(self):
  m.validate_image_storage({'Config':{'Env':['PGDATA='+m.PGDATA],'Volumes':{m.PGDATA:{}}}})
  for config in [{'Env':['PGDATA=/foreign']},{'Env':['PGDATA='+m.PGDATA],'Volumes':{'/foreign':{}}}]:
   with self.assertRaises(RuntimeError):m.validate_image_storage({'Config':config})
 def test_live_limits_and_no_implicit_volume(self):
  v={'HostConfig':{'Memory':m.MEMORY_BYTES,'MemorySwap':m.MEMORY_BYTES,'Tmpfs':{m.PGDATA:'rw,size='+str(m.TMPFS_BYTES)}},'Mounts':[{'Type':'tmpfs','Destination':m.PGDATA}]}
  m.validate_container_storage(v)
  import copy
  for change in ['memory','volume','tmpfs']:
   bad=copy.deepcopy(v)
   if change=='memory':bad['HostConfig']['Memory']=0
   elif change=='volume':bad['Mounts'].append({'Type':'volume','Destination':'/extra'})
   else:bad['HostConfig']['Tmpfs']={}
   with self.assertRaises(RuntimeError):m.validate_container_storage(bad)
if __name__=='__main__':unittest.main()
