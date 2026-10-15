"""Exact local fixture owner contracts; Docker responses below are explicit fixtures."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import sys
import time
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('six_infra',ROOT/'scripts/cn-release-six-infra.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class SixInfra(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.o=m.Owner.__new__(m.Owner);self.o.directory=Path(self.tmp.name);self.o.token='a'*32;self.o.project='wsx-six-'+'b'*16;self.o.docker='/fixture/docker'
  self.o.check_directory=lambda:None
  self.o.owner=dict(ownerToken=self.o.token,runId='123',roundId='round-01',sourceCommit='c'*40,project=self.o.project,dbName='wsx_'+'d'*20)
  self.o.records={r:dict(imageId='sha256:'+str(i)*64,port=32000+i,containerName=self.o.project+'-'+r,command=['postgres','-c','listen_addresses=127.0.0.1','-c','shared_preload_libraries=age','-p',str(32000+i)]if r=='postgres'else['redis-server','--bind','127.0.0.1','--port',str(32000+i),'--save','','--appendonly','no'])for i,r in enumerate(m.ROLES,1)}
  self.ids={r:str(i)*64 for i,r in enumerate(m.ROLES,1)};self.records={};self.live={};self.calls=[]
  self.o.read=lambda name:self.records.get(name)
 def value(self,role):
  r=self.o.records[role];lim=m.LIMITS[role]
  return dict(Id=self.ids[role],Image=r['imageId'],Name='/'+r['containerName'],Labels={'cn-six-fixture':self.o.token,'cn-six-project':self.o.project,'cn-six-role':role},Cmd=r['command'],HostConfig=dict(NetworkMode='host',Binds=[],PortBindings={},Privileged=False,Tmpfs=lim['tmpfs'],Memory=lim['memory'],ShmSize=lim['shm']),Mounts=[{'Type':'tmpfs'}],State={'Running':True})
 def cli(self,args,**kwargs):
  self.calls.append(args)
  if args[1]=='image':
   role=next(r for r in m.ROLES if self.o.records[r]['imageId']==args[-1]);return json.dumps({'Id':args[-1],'Config':{'Volumes':{p:{}for p in m.LIMITS[role]['tmpfs']}}})
  if args[1]=='create':
   role='postgres'if 'POSTGRES_USER=postgres'in args else 'redis';self.live[self.ids[role]]=role;return self.ids[role]
  if args[1]=='inspect':return json.dumps(self.value(self.live[args[-1]]))
  if args[1]=='start':return args[-1]
  if args[1]=='ps':return '\n'.join(self.live)
  if args[1]=='rm':del self.live[args[-1]];return args[-1]
  if args[1]=='exec':
   if 'redis-cli'in args:return 'PONG'
   if 'psql'in args:return self.o.owner['dbName']+'|age'
   return ''
  raise AssertionError(args)
 def persist(self,directory,name,value):
  self.assertNotIn(name,self.records);self.records[name]=copy.deepcopy(value)
 def test_start_preserves_age_loopback_and_never_builds_or_pulls(self):
  with patch.object(m,'command',self.cli),patch.object(m,'durable',self.persist):receipt=self.o.start();cleanup=self.o.close()
  self.assertTrue(cleanup['verified']);self.assertEqual(len(cleanup['removedContainerIds']),2)
  self.assertEqual(receipt['postgres']['command'],['postgres','-c','listen_addresses=127.0.0.1','-c','shared_preload_libraries=age','-p','32001'])
  self.assertEqual(self.o.environment['PGHOST'],'127.0.0.1');self.assertEqual(self.o.environment['PGDATABASE'],receipt['dbName'])
  for cmd in [c for c in self.calls if c[1]=='create']:
   self.assertEqual(cmd[cmd.index('--pull')+1],'never');self.assertEqual(cmd[cmd.index('--network')+1],'host');self.assertIn('--tmpfs',cmd);self.assertNotIn('--volume',cmd)
  for cmd in [c for c in self.calls if 'createdb'in c or 'psql'in c]:self.assertIn('PGPASSWORD=postgres_dev',cmd)
  self.assertFalse(any(c[1]in ('build','pull','compose','network','volume')for c in self.calls))
 def test_actual_sql_readback_without_age_blocks_receipt(self):
  def missing(args,**kwargs):
   if 'psql'in args:return self.o.owner['dbName']+'|'
   return self.cli(args)
  with patch.object(m,'command',missing),patch.object(m,'durable',self.persist),self.assertRaisesRegex(RuntimeError,'DATABASE_READBACK'):self.o.start()
  self.assertNotIn('infra-receipt.json',self.records)
 def test_missing_age_wrong_image_or_volume_rejects_inspect(self):
  base=self.value('postgres')
  for change in ('age','image','volume','bind','network'):
   v=copy.deepcopy(base)
   if change=='age':v['Cmd']=['postgres','-c','listen_addresses=127.0.0.1','-p','32001']
   if change=='image':v['Image']='sha256:'+'e'*64
   if change in ('volume','bind'):v['Mounts']=[{'Type':change}]
   if change=='network':v['HostConfig']['NetworkMode']='bridge'
   with patch.object(m,'command',return_value=json.dumps(v)),self.assertRaises(RuntimeError):self.o.inspect(self.ids['postgres'],'postgres')
 def test_lost_create_receipt_can_cleanup_exact_object_but_never_verify(self):
  role='postgres';self.records[role+'-create-intent.json']=dict(ownerToken=self.o.token,role=role,**self.o.records[role]);self.live[self.ids[role]]=role
  with patch.object(m,'command',self.cli),patch.object(m,'durable',self.persist):result=self.o.close()
  self.assertFalse(result['verified']);self.assertTrue(result['unacknowledgedCreate']);self.assertFalse(self.live)
 def test_wrong_binding_or_daemon_unknown_never_deletes(self):
  self.records['postgres-create-intent.json']=dict(ownerToken=self.o.token,role='postgres',**self.o.records['postgres']);self.live[self.ids['postgres']]='postgres'
  original=self.value
  def wrong(role):v=original(role);v['Labels']['cn-six-fixture']='e'*32;return v
  with patch.object(self,'value',wrong),patch.object(m,'command',self.cli),self.assertRaises(RuntimeError):self.o.close()
  self.assertFalse(any(c[1]=='rm'for c in self.calls))
  with patch.object(m,'command',side_effect=RuntimeError('unknown')),self.assertRaises(RuntimeError):self.o.close()
 def test_real_command_honors_shared_deadline_before_default_ten_seconds(self):
  begin=time.monotonic()
  with self.assertRaises(TimeoutError):m.command([sys.executable,'-I','-B','-c','import time;time.sleep(5)'],deadline=begin+.1)
  self.assertLess(time.monotonic()-begin,2)
 def test_repeated_recovery_does_not_upgrade_lost_receipt(self):
  role='postgres';self.records[role+'-create-intent.json']=dict(ownerToken=self.o.token,role=role,**self.o.records[role]);self.live[self.ids[role]]=role
  with patch.object(m,'command',self.cli),patch.object(m,'durable',self.persist):
   first=self.o.close('recovery-cleanup.json');second=self.o.close('recovery-cleanup.json')
  self.assertFalse(first['verified']);self.assertFalse(second['verified']);self.assertTrue(second['priorRecoveryRetained'])
 def test_extra_image_volume_rejected_before_any_create(self):
  with patch.object(m,'command',return_value=json.dumps({'Id':self.o.records['postgres']['imageId'],'Config':{'Volumes':{'/unexpected':{}}}})),self.assertRaises(RuntimeError):self.o.start()
  self.assertFalse(self.records)
if __name__=='__main__':unittest.main()
