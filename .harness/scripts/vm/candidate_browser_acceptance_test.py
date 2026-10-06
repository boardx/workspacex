import copy,datetime,hashlib,json,sys,types,unittest,subprocess
from unittest.mock import patch
import candidate_browser_acceptance as m
class Tests(unittest.TestCase):
 def fixture(self,source_revision=None):
  now=1791133200.0;identity=dict(sourceRevision=source_revision or m.APP,baselineRevision=m.BASE,migrationPlanSha256='a'*64,attemptId='browser');calls=[]
  root='/opt/workspacex-cn/release-tools/'+'f'*40+'/playwright';path=f"/etc/workspacex-cn/maintenance-activation/{identity['sourceRevision']}/browser/browser-plan.json"
  request=dict(playwrightModule=root,browserExecutable='/usr/bin/chromium',audioPath=path.rsplit('/',1)[0]+'/audio.wav',audioSha256='e'*64,deploymentMarker='marker');raw=json.dumps(request).encode()
  binding=dict(identity=identity,browserPlan=dict(path=path,sha256=hashlib.sha256(raw).hexdigest()),nodeBinary=dict(path='/usr/bin/node',sha256='c'*64))
  profile=json.dumps(dict(toolRevision='f'*40,maintenanceBrowserRuntime=dict(playwrightRoot=root,filesSha256={'file':'d'*64},chromiumPath='/usr/bin/chromium',chromiumSha256='a'*64,nodeSha256='c'*64))).encode()
  result=dict(schemaVersion=1,kind='browser-acceptance-completed',identity=identity,deploymentMarker='marker',observedAt=datetime.datetime.fromtimestamp(now,datetime.timezone.utc).isoformat(),ownedAcceptanceRunIds=['run1','run2','run3'],checks={k:True for k in m.JOURNEYS})
  original_path='/etc/workspacex-cn/original-host-plan.json';original_raw=json.dumps(dict(schemaVersion=1,mode='maintenance-all-writer-fence',productionActionsAuthorized=True,identity=identity,toolRevision='f'*40)).encode();original_ref=dict(path=original_path,sha256=hashlib.sha256(original_raw).hexdigest())
  def private(ref,expected=None):
   calls.append(('private',ref));return original_raw if ref==original_path else profile if ref=='/etc/workspacex-cn/trusted-tool-binding.json' else raw if ref==path else b'actual-audio'
  def installed(name):calls.append(('source',name));self.assertEqual(name,'acceptance_source_closure.cjs');return b'module.exports={};'
  def invoke(plan,binary,args,payload):
   calls.append(('invoke',binary));self.assertEqual(plan,{'binaries':{'node':binding['nodeBinary']}});self.assertIn('loadPinnedAcceptanceClosure()',args[1]);self.assertIn('.producer.browserReceipt(',args[1]);self.assertEqual(json.loads(payload)['identity'],identity);self.assertEqual(json.loads(payload)['reviewedHostPlanReference'],original_ref);self.assertNotIn('approvedIdentity',json.loads(payload));self.assertIn('actualTrustedBytes(ref.path,0o600,ref.sha256)',args[1]);return json.dumps(result).encode()
  source=types.SimpleNamespace(private=private,installed_code=installed,invoke=invoke)
  transport=types.SimpleNamespace(plan=dict(identity=identity),host=types.SimpleNamespace(reviewed_plan_ref=original_ref,manifest_sha=original_ref['sha256']),require_lock=lambda:calls.append(('lock',)),_guard=lambda p:self.assertEqual(p,{'identity':identity}))
  return transport,binding,source,result,calls,now
 def test_source_closure_browser_only_runs_once_then_produces_actual_id_receipt(self):
  t,b,s,result,c,n=self.fixture()
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files') as validation:value=m.candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])
  self.assertEqual(value['ownedAcceptanceRunIds'],['run1','run2','run3']);self.assertEqual(c.count(('invoke','node')),1);self.assertEqual(validation.call_count,2)
 def test_runtime_pin_failure_prevents_browser_execution(self):
  t,b,s,result,c,n=self.fixture()
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files',side_effect=RuntimeError('dependency hash')):
   with self.assertRaisesRegex(RuntimeError,'dependency hash'):m.candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])
  self.assertNotIn(('invoke','node'),c)
 def test_passed_flags_cannot_replace_runids_and_stale_or_foreign_receipts(self):
  for mode in ('ids','stale','identity','checks'):
   t,b,s,result,c,n=self.fixture()
   if mode=='ids':result['ownedAcceptanceRunIds']=[]
   elif mode=='stale':result['observedAt']='2026-01-01T00:00:00Z'
   elif mode=='identity':result['identity']=dict(result['identity'],attemptId='foreign')
   else:result['checks']['hello']=1
   with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files'):
    with self.assertRaises(Exception):m.candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])
 def test_publish_only_after_source_execution(self):
  t,b,s,result,c,n=self.fixture();store=types.SimpleNamespace(publish_receipt=lambda identity,lane,value,**kw:dict(path='source-ref',sha256=hashlib.sha256(json.dumps(value).encode()).hexdigest()))
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s,'acceptance_receipt_store':store}),patch.object(m,'_runtime_files'):ref=m.persist_candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])
  self.assertEqual(ref['path'],'source-ref');self.assertIn(('invoke','node'),c)
 def test_a1cb_reuses_actual_pinned_browser_entry(self):
  t,b,s,r,c,n=self.fixture('a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0')
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files'):self.assertEqual(m.candidate_browser_receipt(t,b,lambda:n,expected_identity=copy.deepcopy(t.plan['identity']))['identity'],t.plan['identity'])
 def test_missing_original_authority_rejects_before_browser(self):
  t,b,s,r,c,n=self.fixture();t.host.reviewed_plan_ref=None
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files'):
   with self.assertRaisesRegex(RuntimeError,'ORIGINAL_REF'):m.candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])
  self.assertNotIn(('invoke','node'),c)
 def test_mixed_candidate_rejected_before_invocation(self):
  t,b,s,r,c,n=self.fixture('a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0');approved=copy.deepcopy(t.plan['identity']);b['identity']=dict(b['identity'],sourceRevision='e'*40)
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}):
   with self.assertRaisesRegex(RuntimeError,'IDENTITY'):m.candidate_browser_receipt(t,b,lambda:n,expected_identity=approved)
  self.assertNotIn(('invoke','node'),c)
 def test_same_identity_different_original_raw_plan_rejected_before_execution(self):
  t,b,s,r,c,n=self.fixture();t.host.manifest_sha='d'*64
  # The ref still points to valid approved bytes with the identical identity/tool,
  # but it is not the exact raw HostPlan retained by this transport.
  with patch.dict(sys.modules,{'compiled_maintenance_activation':s}),patch.object(m,'_runtime_files'):
   with self.assertRaisesRegex(RuntimeError,'ORIGINAL_RAW_BINDING'):m.candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])
  self.assertNotIn(('invoke','node'),c)
 def test_installed_cli_executes_original_protected_reference_not_stdin_identity(self):
  for mode in ('valid','wrong-tool','runtime-plan','unapproved','foreign-identity'):
   t,b,source,result,c,n=self.fixture('a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0')
   original=dict(schemaVersion=1,mode='maintenance-all-writer-fence',productionActionsAuthorized=True,identity=copy.deepcopy(t.plan['identity']),toolRevision='f'*40)
   if mode=='wrong-tool':original['toolRevision']='e'*40
   elif mode=='runtime-plan':original['runtimeSourcePlanSha256']='d'*64
   elif mode=='unapproved':original['productionActionsAuthorized']=False
   elif mode=='foreign-identity':original['identity']['sourceRevision']='e'*40
   ref=t.host.reviewed_plan_ref
   # Concrete installed CLI executes in Node; trusted byte reader is deliberately
   # mocked, so this validates caller wiring only, never root metadata or browser.
   prefix="const original="+json.dumps(original)+";const result="+json.dumps(result)+";const ref="+json.dumps(ref)+";const savedRequire=require;require=name=>name.startsWith('/opt/')?{chromium:{}}:savedRequire(name);module.exports={actualTrustedBytes:(path,mode,sha)=>{if(path!==ref.path||mode!==384||sha!==ref.sha256)throw Error('ref');return Buffer.from(JSON.stringify(original))},loadPinnedAcceptanceClosure:()=>({toolRevision:'"+'f'*40+"',producer:{browserReceipt:async(plan,identity,chromium,now,expected)=>{if(JSON.stringify(identity)!==JSON.stringify(expected))throw Error('identity');return result;}}})};"
   source.installed_code=lambda _:prefix.encode()
   def invoke(plan,binary,args,payload):
    run=subprocess.run(['node',*args],input=payload,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
    if run.returncode:raise RuntimeError('CLI_PROTECTED_AUTHORITY_REJECTED '+run.stderr.decode()[-900:])
    return run.stdout
   source.invoke=invoke
   with patch.dict(sys.modules,{'compiled_maintenance_activation':source}),patch.object(m,'_runtime_files'):
    if mode=='valid':self.assertEqual(m.candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])['identity'],t.plan['identity'])
    else:
     with self.assertRaisesRegex(RuntimeError,'CLI_PROTECTED_AUTHORITY_REJECTED'):m.candidate_browser_receipt(t,b,lambda:n,expected_identity=t.plan['identity'])
if __name__=='__main__':unittest.main()
