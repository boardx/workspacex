"""Actual router/journal/derived approval/binder/stage generators; provider receipts
are explicit fixtures, so this is not a production mutation or full cloud E2E."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def module(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=module('runtime_router',ROOT/'scripts/cn-release-stage-router.py')
bf=module('binding_fixture',ROOT/'tests/test_cn_release_continuation_bind.py')
j=module('journal',ROOT/'scripts/cn-release-continuation-journal.py')
class RuntimeRouterTests(unittest.TestCase):
 def setUp(self):
  self.fixture=bf.ReviewedPackageIntegration();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
  self.outputs=self.root/'generated';self.outputs.mkdir();self.inputs=self.root/'inputs';self.inputs.mkdir();self.state=self.root/'state';self.state.mkdir();self.requests=self.root/'requests';self.requests.mkdir()
  identity={k:self.fixture.request[k] for k in ('sourceRevision','baselineRevision','controlRevision','publicationAttemptId','attemptId','requestedAt','deadlineAt')}
  names=set(r.MODULES.values())|{'scripts/cn-release-stage-contract.py','scripts/cn-release-generated-commands.py','scripts/cn-release-derived-approval.py','scripts/cn-release-continuation-bind.py'}
  self.a={'kind':'cn-fixed-release-approval-v1','identity':identity,'target':j.TARGET,'issuedAt':self.fixture.approval['issuedAt'],'expiresAt':self.fixture.approval['expiresAt'],'codeFiles':{n:r.e.digest((ROOT/n).read_bytes()) for n in names}}
  static={k:self.fixture.inputs[k] for k in ('authorization','template','migrationDiff')}
  self.a['runtime']={'templateFiles':self.fixture.approval['packageFiles'],'staticInputHashes':{n:r.e.digest(v) for n,v in static.items()},'stageVerifierSha256':{},'stageObserverSha256':{}}
  self.a['runtimeStage']={'remoteRoot':'/var/lib/workspacex-cn/runtime/upgrade-f0eb-fixture','templateSha256':r.e.digest((ROOT/'.harness/scripts/vm/cn-runtime-continuation/stage-phase.py').read_bytes())}
  real_read=r.e.read
  def read(p,*args):
   p=Path(p)
   if ROOT in p.parents:return p.read_bytes()  # installed code ownership is separately covered
   try:return real_read(p,*args)
   except Exception as error:raise AssertionError(str(p)+' mode='+oct(p.stat().st_mode)) from error
  for p in (patch.object(r,'OUTPUTS',self.outputs),patch.object(r,'INPUTS',self.inputs),patch.object(r.e,'STATE',self.state),patch.object(r.e,'REQUESTS',self.requests),patch.object(r.e,'OWNER',os.getuid()),patch.object(r.e,'directory',lambda p:None),patch.object(r.e,'read',read)):
   p.start();self.addCleanup(p.stop)
  provisional=r.Router(r.e.digest(r.e.encode(self.a)),self.a,r.e.encode(self.a))
  for stage in r.e.STAGES:
   observer,verifier=provisional.contract(stage);self.a['runtime']['stageVerifierSha256'][stage]=r.e.digest(verifier);self.a['runtime']['stageObserverSha256'][stage]=r.e.digest(observer)
  self.raw=r.e.encode(self.a);self.release=r.e.digest(self.raw);self.router=r.Router(self.release,self.a,self.raw);self.router.base.mkdir()
  folder=self.inputs/self.release;folder.mkdir()
  for name,raw in static.items():r.e.create(folder/(name+'.json'),raw)
  self.attempt=self.state/identity['attemptId'];self.attempt.mkdir()
  r.e.create(self.state/'entry.lock',b'');r.e.create(self.state/'active-attempt.json',r.e.encode(identity['attemptId']))
  r.e.create(self.attempt/'identity.json',r.e.encode({k:v for k,v in identity.items() if k!='publicationAttemptId'}|{'scope':'runtime-only-reviewed-continuation'}))
 def put(self,path,raw):
  path.write_bytes(raw);path.chmod(0o600)
 def chain(self,end):
  previous=None;ident={k:v for k,v in self.a['identity'].items() if k!='publicationAttemptId'}
  for index,stage in enumerate(r.e.STAGES[:end+1]):
   observer,verifier=self.router.contract(stage);evidence=r.e.encode({'stage':stage});terminal=evidence
   for name,s in j.STAGE_INPUTS.items():
    if s!=stage or name not in self.fixture.inputs:continue
    evidence=self.fixture.inputs[name];terminal=evidence
    if name=='publication':terminal=r.e.encode({'kind':'cn-publication-readonly-observation-v1','phase':'publish','publishedReceiptSha256':r.e.digest(evidence)});evidence=b'CN_CANDIDATE_PUBLISHED='+evidence+b'\n'
   m=dict(schemaVersion=1,**ident,scope='runtime-only-reviewed-continuation',stage=stage,previousReceiptSha256=previous,issuedAt=self.a['issuedAt'],expiresAt=self.a['expiresAt'],timeoutSeconds=120,actionSha256=r.e.digest(b'fixture action'),observerSha256=r.e.digest(observer),verifierSha256=r.e.digest(verifier),authorizationEvidenceSha256=self.release)
   raw=r.e.encode(m);request=r.e.digest(raw);package=self.requests/request;package.mkdir(exist_ok=True)
   for name,value in {'manifest.json':raw,'action.sh':b'fixture action','observe.sh':observer,'verify.py':verifier,'authorization.json':self.raw}.items():self.put(package/name,value)
   witness=r.e.encode({'kind':'cn-entry-admission-v1','requestSha256':request,'verifierSha256':m['verifierSha256'],'observerSha256':m['observerSha256'],'authorizationEvidenceSha256':self.release,'evidenceSha256':r.e.digest(evidence),'terminalObservationSha256':r.e.digest(terminal)})
   receipt=dict(schemaVersion=1,**ident,scope=m['scope'],stage=stage,requestSha256=request,previousReceiptSha256=previous,evidenceSha256=r.e.digest(evidence),terminalObservationSha256=r.e.digest(terminal),admissionSha256=r.e.digest(witness),mode='advance',finishedAt=(r.e.instant(ident['requestedAt'])+dt.timedelta(milliseconds=index+1)).isoformat())
   rawreceipt=r.e.encode(receipt);prefix=self.attempt/('%02d-%s'%(index,stage))
   for suffix,value in {'receipt':rawreceipt,'evidence':evidence,'terminal-observation':terminal,'admission':witness,'intent':r.e.encode({'requestSha256':request}),'process':r.e.encode({'requestSha256':request,'pid':999999999})}.items():self.put(Path(str(prefix)+'.'+suffix+'.json'),value)
   previous=r.e.digest(rawreceipt)
 def test_four_real_runtime_router_generators_from_original_receipt_chain(self):
  for phase,end in (('hold',3),('stop',5),('backup',8),('switch',11)):
   self.fixture.advance_inputs(phase);self.chain(end)
   # Physical publication file is the only external host read seam here; its
   # raw bytes still pass the original journal's independent observation link.
   with patch.object(self.router,'publication_input',return_value=self.fixture.inputs['publication']):
    action,timeout=self.router.action(phase+'-stage')
   self.assertLessEqual(len(action),18000);self.assertGreater(timeout,0)
   folder=self.router.base/'runtime'/phase
   b=r.e.decode((folder/'binding.json').read_bytes())
   self.assertEqual(b['sourceRevision'],self.a['identity']['sourceRevision'])
   self.assertEqual(b['attemptId'],self.a['identity']['attemptId'])
   observer,_=self.router.contract(phase+'-stage');ctx=self.router.prepare_context(phase+'-stage',action,observer)
   self.assertEqual(ctx['bindingSha256'],r.e.digest((folder/'binding.json').read_bytes()))
   self.assertEqual(ctx['phase'],phase)
   self.assertEqual(ctx['expectedOldBindingSha256'],None if phase=='hold' else r.e.digest((self.router.base/'runtime'/('hold' if phase=='stop' else 'stop' if phase=='backup' else 'backup')/'binding.json').read_bytes()))

if __name__=='__main__':unittest.main()
