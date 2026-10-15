"""Fixed release delegation through real acquire/canonical fixture generation."""
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import test_cn_release_continuation_acquire as fixture
spec=importlib.util.spec_from_file_location('delegation',ROOT/'scripts/cn-release-acquire-delegation.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)

class DelegationTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):fixture.AcquireTests.setUpClass()
 @classmethod
 def tearDownClass(cls):fixture.AcquireTests.tearDownClass()
 def setUp(self):
  self.f=fixture.AcquireTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
  consume=copy.deepcopy(self.f.r);self.f.publication_inputs();publication=copy.deepcopy(self.f.r)
  self.release=dict(schemaVersion=1,kind='cn-fixed-release-approval-v1',target=d.TARGET.copy(),identity=dict(sourceRevision=consume['sourceRevision'],baselineRevision='c'*40,controlRevision=consume['controlRevision'],publicationAttemptId=consume['attemptId'],attemptId='runtime-attempt',requestedAt=consume['requestedAt'],deadlineAt=consume['deadlineAt']),issuedAt=consume['requestedAt'],expiresAt=consume['deadlineAt'],codeFiles={n:d.sha((ROOT/n).read_bytes()) for n in d.CODE},acquire={'requests':{'consume':consume,'publication':publication},'templateFiles':{n:d.sha((fixture.m.TEMPLATES/n).read_bytes()) for n in d.TEMPLATES},'consumeEntryCode':{'observerSha256':d.sha(b'fixture observer'),'verifierSha256':d.sha(self.verifier())}})
 @staticmethod
 def verifier():return b"import json\ndef verify(raw,manifest,previous,mode):\n v=json.loads(raw)\n return {'externalWritesTerminal':v.get('externalWritesTerminal') is True} if mode=='terminal' else v.get('promotedToExactPublisherInbox') is True\n"
 def completion(self,live,reconcile=False):
  from unittest.mock import patch
  import os
  out=self.f.root/'delegated-consume';params=(out/'parameters.json').read_bytes();prior=(out/'delegation.json').read_bytes()
  identity=self.release['identity'];manifest={k:identity[k] for k in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt')}
  manifest.update(schemaVersion=1,scope='runtime-only-reviewed-continuation',stage='consume',previousReceiptSha256=None,issuedAt=self.release['issuedAt'],expiresAt=self.release['expiresAt'],timeoutSeconds=30,actionSha256=d.sha(json.loads(params)['CommandContent'].encode()),observerSha256=d.sha(b'fixture observer'),verifierSha256=d.sha(self.verifier()),authorizationEvidenceSha256=d.sha(b'{}'))
  manifest_raw=d.encode(manifest);terminal=d.encode({'externalWritesTerminal':True})
  receipt={**manifest,'requestSha256':d.sha(manifest_raw),'mode':'advance','withinTotalBudget':True,'evidenceSha256':d.sha(live),'terminalObservationSha256':d.sha(terminal),'finishedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
  if reconcile:
   terminal=d.encode({'runtimeReceiptSha256':d.sha(live),'requestSha256':d.sha(d.encode(self.release['acquire']['requests']['consume']))});live=terminal;receipt.update(mode='reconcile',evidenceSha256=d.sha(live),terminalObservationSha256=d.sha(terminal))
  admission=d.encode({'kind':'cn-entry-admission-v1',**{k:manifest[k] for k in ('verifierSha256','observerSha256','authorizationEvidenceSha256')},**{k:receipt[k] for k in ('requestSha256','evidenceSha256','terminalObservationSha256')}})
  receipt['admissionSha256']=d.sha(admission)
  chain={'manifest':manifest_raw,'receipt':d.encode(receipt),'evidence':live,'terminalObservation':terminal,'parameters':params,'delegation':prior}
  entry=d.load_entry(ROOT);entry.REQUESTS=self.f.root/'packages';entry.STATE=self.f.root/'entry-state';entry.OWNER=os.getuid();entry.directory=lambda path:None
  package=entry.REQUESTS/d.sha(manifest_raw);package.mkdir(parents=True)
  for n,raw in {'manifest.json':manifest_raw,'action.sh':json.loads(params)['CommandContent'].encode(),'observe.sh':b'fixture observer','verify.py':self.verifier(),'authorization.json':b'{}'}.items():
   (package/n).write_bytes(raw);(package/n).chmod(0o600)
  journal=entry.STATE/identity['attemptId'];journal.mkdir(parents=True)
  for n,key in (('receipt','receipt'),('evidence','evidence'),('terminal-observation','terminalObservation')):
   path=journal/('00-consume.'+n+'.json');path.write_bytes(chain[key]);path.chmod(0o600)
  for name,raw in {'admission':admission,'intent':d.encode({'requestSha256':receipt['requestSha256']}),'process':d.encode({'requestSha256':receipt['requestSha256']})}.items():
   path=journal/('00-consume.'+name+'.json');path.write_bytes(raw);path.chmod(0o600)
  patcher=patch.object(d,'load_entry',return_value=entry);patcher.start();self.addCleanup(patcher.stop)
  return chain
 def inputs(self,phase):return {n:self.f.inputs[n] for n in self.release['acquire']['requests'][phase]['inputs']}
 def receipt(self):
  request=self.release['acquire']['requests']['consume']
  return d.encode(dict(kind='cn-hk-consumed-revalidated-bundle-v1',root=str(d.receipt_path(self.release).parent),bundle='/var/lib/workspacex-cn/candidate-inbox/'+request['sourceRevision']+'/'+request['attemptId'],sourceRevision=request['sourceRevision'],controlRevision=request['controlRevision'],originalZipsPreserved=True,proofGenerated=False,promotedToExactPublisherInbox=True,publicationExecuted=False,productionReady=False,cloudWrites=0,proofSha256=request['inputs']['proof'],policySha256=request['inputs']['policy'],finishedAt=dt.datetime.now(dt.timezone.utc).isoformat(),expiresAt=request['deadlineAt'],images=json.loads(self.f.inputs['set'])['images'],storageAdmission={'admitted':True}))
 def derive(self,phase='consume',receipt=None,chain=None):return d.derive(d.encode(self.release),phase,self.inputs(phase),ROOT,self.f.repo,self.f.root/('delegated-'+phase),receipt,consume_completion=chain)
 def test_once_release_derives_real_consume_then_ordered_publication(self):
  consume=self.derive();self.assertEqual([x['operation'] for x in consume['actions']],['consume']);self.assertIsNone(consume['runtimeReceiptSha256'])
  live=self.receipt();publication=self.derive('publication',live,self.completion(live));self.assertEqual(publication['runtimeReceiptSha256'],d.sha(live));self.assertEqual([x['operation'] for x in publication['actions']][-3:],['stage-assemble','check-plan','publish'])
  out=self.f.root/'delegated-publication';self.assertEqual((out/'consume-runtime-receipt.json').read_bytes(),live)
  for action in publication['actions']:
   raw=(out/action['parameters']).read_bytes();self.assertEqual(d.sha(raw),action['parametersSha256']);self.assertEqual(d.sha(json.loads(raw)['CommandContent'].encode()),action['commandSha256'])
  self.assertFalse(publication['retryAllowed']);self.assertEqual(publication['cloudCalls'],0)
 def test_reconcile_history_allows_publication_without_rerunning_old_live(self):
  from unittest.mock import patch
  self.derive();live=self.receipt();chain=self.completion(live,reconcile=True);entry=d.load_entry(ROOT)
  with patch.object(entry,'verify',side_effect=AssertionError('OLD_LIVE_MUST_NOT_RERUN')):
   result=self.derive('publication',live,chain)
  self.assertEqual(result['runtimeReceiptSha256'],d.sha(live))
 def test_reconcile_wrong_physical_receipt_hash_rejected(self):
  self.derive();live=self.receipt();chain=self.completion(live,reconcile=True)
  value=json.loads(chain['evidence']);value['runtimeReceiptSha256']='0'*64;chain['evidence']=chain['terminalObservation']=d.encode(value)
  receipt=json.loads(chain['receipt']);receipt['evidenceSha256']=receipt['terminalObservationSha256']=d.sha(chain['evidence']);chain['receipt']=d.encode(receipt)
  with self.assertRaisesRegex(ValueError,'CONSUME_PHYSICAL_RECEIPT_CHANGED'):self.derive('publication',live,chain)
 def test_publication_requires_live_receipt(self):
  with self.assertRaisesRegex(ValueError,'LIVE_CONSUME_RECEIPT_REQUIRED'):self.derive('publication')
 def test_wrong_receipt_identity_path_images_or_hash_rejected(self):
  base=json.loads(self.receipt())
  for key,value in (('sourceRevision','e'*40),('bundle','/tmp/runner'),('images',{}),('proofSha256','0'*64),('promotedToExactPublisherInbox',False)):
   with self.subTest(key=key):
    changed={**base,key:value}
    with self.assertRaises(ValueError):self.derive('publication',d.encode(changed))
 def test_physical_receipt_without_normal_entry_completion_rejected(self):
  with self.assertRaisesRegex(ValueError,'NORMAL_CONSUME_COMPLETION_REQUIRED'):self.derive('publication',self.receipt())
 def test_real_entry_verifier_rejects_false_terminal_even_with_updated_hashes(self):
  self.derive();live=self.receipt();chain=self.completion(live);entry=d.load_entry(ROOT)
  chain['terminalObservation']=d.encode({'externalWritesTerminal':False});receipt=json.loads(chain['receipt']);receipt['terminalObservationSha256']=d.sha(chain['terminalObservation']);chain['receipt']=d.encode(receipt)
  journal=entry.STATE/self.release['identity']['attemptId'];(journal/'00-consume.terminal-observation.json').write_bytes(chain['terminalObservation']);(journal/'00-consume.receipt.json').write_bytes(chain['receipt'])
  with self.assertRaisesRegex(Exception,'HISTORICAL_ADMISSION_CHANGED'):self.derive('publication',live,chain)
 def test_changed_requested_deadline_cannot_delegate(self):
  self.release['acquire']['requests']['publication']['deadlineAt']=(self.f.now+dt.timedelta(minutes=26)).isoformat()
  with self.assertRaisesRegex(ValueError,'ACQUIRE_RELEASE_IDENTITY'):self.derive()
 def test_changed_template_code_and_input_rejected(self):
  original=copy.deepcopy(self.release)
  self.release['codeFiles']['scripts/cn-release-continuation-acquire.py']='0'*64
  with self.assertRaisesRegex(ValueError,'CODE_HASH'):self.derive()
  self.release=copy.deepcopy(original);self.release['acquire']['templateFiles']['consumer.py']='0'*64
  with self.assertRaisesRegex(ValueError,'TEMPLATE_CODE_BINDING'):self.derive()
  self.release=original;self.f.inputs['proof']+=b' '
  with self.assertRaisesRegex(ValueError,'INPUT_HASH'):self.derive()
 def test_no_repeat_after_generation(self):
  self.derive()
  with self.assertRaisesRegex(ValueError,'GENERATION_EXISTS_RECONCILE_NO_RETRY'):self.derive()
 def test_no_runner_command_path_phase_or_approval_arguments(self):
  for args in (['a'*64,'--phase','publication'],['--approval','/tmp/x'],['../../tmp/x']):
   result=subprocess.run([sys.executable,'-I','-B',str(ROOT/'scripts/cn-release-acquire-delegation.py'),*args],capture_output=True,text=True)
   self.assertNotEqual(result.returncode,0);self.assertIn('ONLY_RELEASE_SHA_ACCEPTED',result.stderr)
 def test_input_alias_and_proof_swap_between_phases_rejected(self):
  self.release['acquire']['requests']['publication']['inputs']['proof']='0'*64
  with self.assertRaisesRegex(ValueError,'ACQUIRE_ORIGINAL_BYTES'):self.derive()
 def test_expired_live_receipt_rejected(self):
  receipt=json.loads(self.receipt());receipt['expiresAt']='2000-01-01T00:00:00Z'
  with self.assertRaisesRegex(ValueError,'CONSUME_RECEIPT_TIME'):self.derive('publication',d.encode(receipt))

if __name__=='__main__':unittest.main()
