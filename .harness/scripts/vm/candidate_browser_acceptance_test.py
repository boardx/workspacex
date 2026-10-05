import copy,datetime,hashlib,json,sys,types,unittest
from unittest.mock import patch
import candidate_browser_acceptance as m
class Tests(unittest.TestCase):
 def fixture(self):
  now=1791133200.0;identity=dict(sourceRevision=m.APP,baselineRevision=m.BASE,migrationPlanSha256='a'*64,attemptId='browser');calls=[]
  root='/opt/workspacex-cn/release-tools/'+'f'*40+'/playwright';path=f'/etc/workspacex-cn/maintenance-activation/{m.APP}/browser/browser-plan.json'
  request=dict(playwrightModule=root,browserExecutable='/usr/bin/chromium',audioPath=path.rsplit('/',1)[0]+'/audio.wav',audioSha256='e'*64,deploymentMarker='marker');raw=json.dumps(request).encode()
  binding=dict(identity=identity,browserPlan=dict(path=path,sha256=hashlib.sha256(raw).hexdigest()),nodeBinary=dict(path='/usr/bin/node',sha256='c'*64))
  profile=json.dumps(dict(toolRevision='f'*40,maintenanceBrowserRuntime=dict(playwrightRoot=root,filesSha256={'file':'d'*64},chromiumPath='/usr/bin/chromium',chromiumSha256='a'*64,nodeSha256='c'*64))).encode()
  result=dict(schemaVersion=1,kind='browser-acceptance-completed',identity=identity,deploymentMarker='marker',observedAt=datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat(),ownedAcceptanceRunIds=['run1','run2','run3'],checks={k:True for k in m.JOURNEYS})
  def private(ref,expected=None):
   calls.append(('private',ref));return profile if ref=='/etc/workspacex-cn/trusted-tool-binding.json' else raw if ref==path else b'actual-audio'
  def installed(name):calls.append(('source',name));self.assertEqual(name,'acceptance_source_closure.cjs');return b'module.exports={};'
  def invoke(plan,binary,args,payload):
   calls.append(('invoke',binary));self.assertEqual(plan,{'binaries':{'node':binding['nodeBinary']}});self.assertIn('loadPinnedAcceptanceClosure()',args[1]);self.assertIn('.producer.browserReceipt(',args[1]);self.assertEqual(json.loads(payload)['identity'],identity);return json.dumps(result).encode()
  source=types.SimpleNamespace(private=private,installed_code=installed,invoke=invoke)
  transport=types.SimpleNamespace(plan=dict(identity=identity),require_lock=lambda:calls.append(('lock',)),_guard=lambda p:self.assertEqual(p,{'identity':identity}))
  return transport,binding,source,result,calls,now
 def test_source_closure_browser_only_runs_once_then_produces_actual_id_receipt(self):
  t,b,s,result,c,n=self.fixture()
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files') as validation:value=m.candidate_browser_receipt(t,b,lambda:n)
  self.assertEqual(value['ownedAcceptanceRunIds'],['run1','run2','run3']);self.assertEqual(c.count(('invoke','node')),1);self.assertEqual(validation.call_count,2)
 def test_runtime_pin_failure_prevents_browser_execution(self):
  t,b,s,result,c,n=self.fixture()
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files',side_effect=RuntimeError('dependency hash')):
   with self.assertRaisesRegex(RuntimeError,'dependency hash'):m.candidate_browser_receipt(t,b,lambda:n)
  self.assertNotIn(('invoke','node'),c)
 def test_passed_flags_cannot_replace_runids_and_stale_or_foreign_receipts(self):
  for mode in ('ids','stale','identity','checks'):
   t,b,s,result,c,n=self.fixture()
   if mode=='ids':result['ownedAcceptanceRunIds']=[]
   elif mode=='stale':result['observedAt']='2026-01-01T00:00:00Z'
   elif mode=='identity':result['identity']=dict(result['identity'],attemptId='foreign')
   else:result['checks']['hello']=1
   with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files'):
    with self.assertRaises(Exception):m.candidate_browser_receipt(t,b,lambda:n)
 def test_publish_only_after_source_execution(self):
  t,b,s,result,c,n=self.fixture();store=types.SimpleNamespace(publish_receipt=lambda identity,lane,value:dict(path='source-ref',sha256=hashlib.sha256(json.dumps(value).encode()).hexdigest()))
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s,'acceptance_receipt_store':store}),patch.object(m,'_runtime_files'):ref=m.persist_candidate_browser_receipt(t,b,lambda:n)
  self.assertEqual(ref['path'],'source-ref');self.assertIn(('invoke','node'),c)
if __name__=='__main__':unittest.main()
