"""Real private filesystem, original status function, synthetic Docker/helper outputs."""
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
REPO=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('state',REPO/'scripts/cn-release-business-state.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class LiveState(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name);self.base.chmod(0o700)
  self.etc=self.base/'etc';self.var=self.base/'var';self.repo=self.base/'repo'
  for name,value in [('ETC',self.etc),('VAR',self.var),('ROOT',self.repo)]:p=patch.object(m,name,value);p.start();self.addCleanup(p.stop)
  self.reader=m.Reader(os.getuid(),self.base);self.now=dt.datetime.now(dt.timezone.utc)
  self.identity=dict(sourceRevision='a'*40,baselineRevision='b'*40,controlRevision='c'*40,attemptId='fixture',publicationAttemptId='published',requestedAt=(self.now-dt.timedelta(seconds=5)).isoformat(),deadlineAt=(self.now+dt.timedelta(minutes=5)).isoformat())
  self.release='d'*64;self.root=self.var/'runtime'/'upgrade-fixture';self.hold={'schemaVersion':1,'state':'held','generation':'e'*32,'identity':{'sourceRevision':'a'*40,'baselineRevision':'b'*40,'migrationPlanSha256':'9'*64,'attemptId':'fixture'}}
  template=(REPO/m.TEMPLATE).read_bytes();self.put(self.repo/m.TEMPLATE,template)
  self.a={'identity':self.identity,'runtimeStage':{'remoteRoot':str(self.root)},'business':{'testDataScopeSha256':'f'*64},'codeFiles':{m.TEMPLATE:m.sha(template)}}
  self.prepared={'profile':{'holdHelperSha256':'1'*64,'pythonPath':'/usr/bin/python3.12'},'plan':{'deploymentMarker':'fixture'}}
  config=self.base/'compose.json';self.put(config,b'{}');services=['api','web','agent','worker','gateway']
  b={k:v for k,v in self.identity.items()if k!='publicationAttemptId'};b.update(draft=False,hold=self.hold,holdHelperSha256='1'*64,composeFiles=[{'path':str(config),'sha256':m.sha(b'{}')}],envFiles=[],workingDir='/fixture',candidateImages={s:'fixture:'+s for s in services},expectedContainers={'/workspacex-cn-'+s+'-1':{'id':'old-'+s}for s in services})
  self.binding=b;self.binding_raw=m.enc(b);self.put(self.root/'binding.json',self.binding_raw);self.put(self.var/'release-generated'/self.release/'runtime'/'switch'/'binding.json',self.binding_raw)
  switch=m.enc(dict(exactFiveRunning=True,holdRetained=True,businessAcceptancePassed=False));self.put(self.root/'switch-result.json',switch);self.put(self.root/'switch-intent.json',m.enc(dict(bindingSha256=m.sha(self.binding_raw),holdGeneration=self.hold['generation'])))
  self.xs=[]
  for service in services:self.xs.append({'Name':'/workspacex-cn-'+service+'-1','Id':'new-'+service,'Config':{'Image':'fixture:'+service,'Labels':{'com.docker.compose.service':service,'com.docker.compose.project':'workspacex-cn','com.docker.compose.project.working_dir':'/fixture','com.docker.compose.project.config_files':str(config)+','+str(self.root/'switch-images.json')}},'State':{'Running':True,'Restarting':False,'Status':'running','Health':{'Status':'healthy'}},'RestartCount':0})
  self.state=self.var/'continuation'/'fixture';held=m.enc({'actual':'held health'});self.put(self.state/'14-acceptance.evidence.json',held);previous=m.enc({'evidenceSha256':m.sha(held)});self.put(self.state/'14-acceptance.receipt.json',previous)
  self.w={**{'identity':self.identity,'releaseSha256':self.release,'testDataScopeSha256':'f'*64,'bindingSha256':m.sha(self.binding_raw),'switchReceiptSha256':m.sha(switch),'holdGeneration':'e'*32,'heldHealthSha256':m.sha(held),'holdRawSha256':'2'*64,'userAuthorizationEvidenceSha256':'3'*64}}
  wraw=m.enc(self.w);wsha=m.sha(wraw);self.put(self.etc/'writer-resume-approvals'/'by-release'/(self.release+'.json'),m.enc({'approvalSha256':wsha}));self.put(self.etc/'writer-resume-approvals'/(wsha+'.json'),wraw)
  material=self.var/'release-generated'/self.release/'terminal'/'writer-resume';params=m.enc({'ContentEncoding':'PlainText','CommandContent':'fixed reviewed clear\n'});self.put(material/'parameters.json',params)
  provenance=dict(kind='cn-writer-resume-materialization-v1',releaseSha256=self.release,writerApprovalSha256=wsha,testDataScopeSha256='f'*64,identity=self.identity,files={'parameters.json':m.sha(params)},inputHashes={k:self.w[wkey]for k,wkey in [('binding','bindingSha256'),('switchReceipt','switchReceiptSha256'),('status','heldHealthSha256'),('hold','holdRawSha256'),('testDataScope','testDataScopeSha256'),('userAuthorization','userAuthorizationEvidenceSha256')]});self.put(material/'writer-resume-provenance.json',m.enc(provenance))
  clear=m.enc(dict(kind='f0eb-hold-cleared-v1',actualHoldCleared=True,businessAcceptancePassed=False,generation='e'*32,identity=self.hold['identity'],bindingSha256=m.sha(self.binding_raw),statusSha256=m.sha(held)))
  terminal=m.enc({'actual':'clear-readback'});manifest={k:v for k,v in self.identity.items()if k!='publicationAttemptId'};manifest.update(stage='clear-hold',previousReceiptSha256=m.sha(previous),authorizationEvidenceSha256=self.release,actionSha256=m.sha(b'fixed reviewed clear\n'),observerSha256=m.sha(b'observe'),verifierSha256=m.sha(b'verify'))
  mr=m.enc(manifest);request=m.sha(mr);rq=self.etc/'continuation-requests'/request
  self.put(rq/'manifest.json',mr);self.put(rq/'action.sh',b'fixed reviewed clear\n');self.put(rq/'observe.sh',b'observe');self.put(rq/'verify.py',b'verify');self.put(rq/'authorization.json',b'release')
  # A release hash is immutable; fixture reader provides only this unrelated
  # root approval raw hash seam, all runtime/receipt files use actual hashes.
  original=self.reader.pinned
  self.reader.pinned=lambda p,h,*args,**kw: b'release' if p==rq/'authorization.json' and h==self.release else original(p,h,*args,**kw)
  receipt={k:v for k,v in self.identity.items()if k!='publicationAttemptId'};receipt.update(stage='clear-hold',mode='advance',previousReceiptSha256=m.sha(previous),evidenceSha256=m.sha(clear),terminalObservationSha256=m.sha(terminal),requestSha256=request)
  for name,raw in [('receipt',m.enc(receipt)),('evidence',clear),('terminal-observation',terminal)]:self.put(self.state/('15-clear-hold.'+name+'.json'),raw)
 def put(self,p,raw):p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);p.write_bytes(raw);p.chmod(0o600)
 def call(self,argv):return m.enc(self.xs)if 'inspect'in argv else m.enc({**self.hold,'state':'cleared'})
 def run_state(self,**kw):return m.read_public(self.a,self.release,self.prepared,reader=self.reader,call=self.call,now=self.now,**kw)
 def test_actual_files_and_canonical_exact_five(self):
  state,envelope=self.run_state();self.assertTrue(state['runtimeHealthy']);self.assertEqual(state['holdGeneration'],'e'*32);self.assertEqual(m.sha(envelope['raw'].encode()),envelope['approvalSha256'])
 def test_held_or_foreign_generation_rejected(self):
  with self.assertRaisesRegex(ValueError,'LIVE_CLEAR_HOLD'):m.read_public(self.a,self.release,self.prepared,reader=self.reader,call=lambda argv:m.enc(self.hold),now=self.now)
 def test_canonical_unhealthy_or_duplicate_service_rejected(self):
  self.xs[0]['State']['Health']['Status']='unhealthy'
  with self.assertRaises(AssertionError):self.run_state()
 def test_changed_config_rejected(self):
  self.put(Path(self.binding['composeFiles'][0]['path']),b'changed')
  with self.assertRaisesRegex(ValueError,'FILE_PIN'):self.run_state()
 def test_missing_or_changed_receipt_fails(self):
  self.put(self.state/'15-clear-hold.evidence.json',b'{}')
  with self.assertRaisesRegex(ValueError,'CLEAR_RECEIPT_LINK'):self.run_state()
 def test_expired_read_only_reconciliation_does_not_extend_action(self):
  self.now+=dt.timedelta(minutes=10)
  with self.assertRaisesRegex(ValueError,'RELEASE_DEADLINE'):self.run_state()
  self.assertTrue(self.run_state(read_only=True)[0]['runtimeHealthy'])
if __name__=='__main__':unittest.main()
