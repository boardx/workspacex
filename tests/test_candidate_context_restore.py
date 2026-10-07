"""Actual context method, simulated command boundary; no production filesystem calls."""
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
IMPORTER=(ROOT/'.harness/scripts/vm/import-hosted-cn-artifacts.py') if (ROOT/'.harness/scripts/vm/import-hosted-cn-artifacts.py').exists() else ROOT/'patches/.harness/scripts/vm/import-hosted-cn-artifacts.py'
spec=importlib.util.spec_from_file_location('actual_importer',IMPORTER)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CandidateContextRestore(unittest.TestCase):
 def fixture(self,fail_restore_dependencies=False):
  temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
  ops=m.InstalledOperations.__new__(m.InstalledOperations)
  ops.marker=Path(temporary.name)/'marker.json'
  identity={'sourceRevision':'a'*40,'release':'2026.10.7-cn.1','attemptId':'gha-1-1'}
  marker={'schemaVersion':1,'stage':'hosted-protected-artifact-import','state':'pending',**identity,'prepared':False,'productionActivated':False}
  events=[];state={'head':'b'*40,'ref':'refs/heads/main','installs':0}
  def command(argv,cwd=None,accepted=(0,),environment=None):
   events.append((list(argv),cwd,environment))
   if argv[0]=='/usr/bin/git':
    args=argv[3:]
    if args[:2]==['remote','get-url']:return '/opt/workspacex-cn/release-origin-cache.git'
    if args[:2]==['status','--porcelain']:return ''
    if args[:2]==['rev-parse','HEAD']:return state['head']
    if args[:2]==['symbolic-ref','-q']:return state['ref']
    if args[0]=='checkout':
     if '--detach' in args:state.update(head=identity['sourceRevision'],ref='')
     else:state.update(head='b'*40,ref='refs/heads/main')
    return ''
   if argv[0]=='/usr/bin/corepack':
    state['installs']+=1
    if state['installs']==2 and fail_restore_dependencies:raise ValueError('offline baseline graph unavailable')
   return ''
  ops.command=command
  def write_once(path,data,mode,gid=0):Path(path).write_bytes(data)
  ops.write_once=write_once
  ops.complete=lambda value:ops.marker.write_text(json.dumps(value))
  return ops,identity,marker,events,state
 def run_context(self,ops,identity,marker,events):
  original=m.Path.lstat
  def lstat(path,*args,**kwargs):
   if str(path)=='/opt/workspacex-cn/repository':return SimpleNamespace(st_mode=stat.S_IFDIR|0o700,st_uid=0)
   return original(path,*args,**kwargs)
  with patch.object(m.Path,'lstat',lstat):
   with ops.candidate_context(identity,marker):events.append(('body',None,None))
 def test_actual_context_restores_baseline_checkout_then_offline_frozen_dependency_graph(self):
  ops,identity,marker,events,state=self.fixture();self.run_context(ops,identity,marker,events)
  installs=[(i,event) for i,event in enumerate(events) if isinstance(event[0],list) and event[0][0]=='/usr/bin/corepack']
  self.assertEqual(len(installs),2)
  self.assertEqual(installs[0][1][0],installs[1][1][0])
  self.assertEqual(installs[1][1][0][-4:],['install','--offline','--frozen-lockfile','--ignore-scripts'])
  self.assertEqual(installs[1][1][2],{'COREPACK_ENABLE_NETWORK':'0'})
  restore=[i for i,event in enumerate(events) if isinstance(event[0],list) and event[0][-3:]==['checkout','--quiet','main']]
  self.assertEqual(len(restore),1);self.assertGreater(installs[1][0],restore[0])
  self.assertEqual(state['head'],'b'*40);self.assertEqual(state['ref'],'refs/heads/main');self.assertFalse(ops.marker.exists())
 def test_actual_context_failed_baseline_graph_restore_retains_reconciliation_marker(self):
  ops,identity,marker,events,state=self.fixture(True)
  with self.assertRaisesRegex(ValueError,'CANDIDATE_BASELINE_RESTORE_FAILED'):self.run_context(ops,identity,marker,events)
  self.assertEqual(state['installs'],2)
  receipt=json.loads(ops.marker.read_text());self.assertEqual(receipt['state'],'candidate-context-reconciliation-required')
  self.assertIs(receipt['prepared'],False)
  with self.assertRaisesRegex(ValueError,'HOSTED_IMPORT_NOT_COMPLETE'):m.verify_marker(receipt,b'{}',b'{}',identity['sourceRevision'],identity['attemptId'])

if __name__=='__main__':unittest.main()
