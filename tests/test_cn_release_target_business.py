"""Synthetic fixed-adapter contract tests; these never run BC business journeys."""
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
# The sidecar deliberately admits an immutable historical tool/profile pair.
# Model that installed case file with its exact archived Git blob rather than
# substituting the latest working-tree browser. The production pins stay frozen.
HISTORICAL_CASE = ROOT/'tests/fixtures/cn-maintenance-browser-aa367861.cjs'
spec = importlib.util.spec_from_file_location('target_business', ROOT/'scripts/cn-release-target-business.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SyntheticObserver:
    APPROVALS = Path('/synthetic-approvals')
    def __init__(self):
        self.calls, self.saved = [], {}
        self.approval = {'identity': {'sourceRevision':m.APP_SOURCE,'controlRevision':m.TOOL_REVISION,'attemptId':'synthetic-target'}, 'codeFiles':dict(m.PINS), 'business':{'runtimeProfileSha256':'b'*64}}
        self.approval['codeFiles'][m.SELF] = m.sha((ROOT/m.SELF).read_bytes())
        self.prepared = {'profile':{'toolRevision':m.TOOL_REVISION,'sourcePins':{m.CASE_FILE:m.PINS[m.CASE_FILE]},'filesSha256':{m.CASE_FILE:m.PINS[m.CASE_FILE]}},'plan':{'deploymentMarker':'synthetic-marker','password':'NEVER_OUTPUT_SYNTHETIC_SECRET'},'scope':{'runtimeRevision':m.APP_SOURCE}}
        self.receipt = dict(self.approval['identity'],kind='cn-independent-business-acceptance-v1',mode='observe',runtimeRevision=m.APP_SOURCE,runtimeInventorySha256='c'*64,checks={k:True for k in m.CHECKS},ownedAcceptanceRunIds=['run-a','run-b','run-c'],observedAt='2026-10-15T00:00:00.000Z')
        self.raw = lambda: json.dumps(self.receipt,indent=2).encode()+b'\n'
        self.preflight_count = 0
        self.drift = False
        self.missing_fixture = False
        self.readback_error = False
        self.changed_raw = False
    def private(self,path):
        path=Path(path)
        if path.parent == self.APPROVALS: return b'synthetic-approval'
        if path == ROOT/m.CASE_FILE: return HISTORICAL_CASE.read_bytes()
        if path == ROOT/m.SELF or str(path) in [str(ROOT/k) for k in m.PINS]: return path.read_bytes()
        if path.name == 'receipt.json':
            result=self.raw()
            if self.changed_raw: result=result.replace(b'cccccccc',b'dddddddd')
            return result
        return self.saved[str(path)]
    def validate_approval(self,*args): return copy.deepcopy(self.approval)
    def preflight(self,*args):
        if self.missing_fixture: raise ValueError('NEVER_OUTPUT_SYNTHETIC_SECRET')
        self.preflight_count+=1
        value=copy.deepcopy(self.prepared)
        if self.drift and self.preflight_count>1: value['plan']['deploymentMarker']='drift'
        return value
    def execute(self,a,h,mode):
        self.calls.append(mode)
        if mode=='readback' and self.readback_error: raise ValueError('NEVER_OUTPUT_SYNTHETIC_SECRET')
        return copy.deepcopy(self.receipt)
    def state_module(self,*args): return types.SimpleNamespace(parse=json.loads)
    def save(self,path,body): self.saved[str(path)]=body

class TargetBusiness(unittest.TestCase):
    def setUp(self): self.o=SyntheticObserver()
    def run_target(self,mode='observe'):
        with patch.object(m,'_observer',return_value=self.o): return m.execute('a'*64,mode)
    def blocked(self,code=None,zero=False):
        with self.assertRaises(m.TargetBlocked) as error: self.run_target()
        if code: self.assertEqual(str(error.exception),code)
        self.assertNotIn('NEVER_OUTPUT',str(error.exception))
        self.assertEqual(self.o.saved,{})
        if zero: self.assertEqual(self.o.calls,[])
    def test_original_bytes_and_identity_separation(self):
        raw=self.o.raw(); value=self.run_target()
        self.assertEqual(self.o.calls,['observe','readback'])
        self.assertEqual(value['originalReceiptRawSha256'],m.sha(raw))
        self.assertEqual(self.o.raw(),raw)
        self.assertEqual(value['appSourceSha'],m.APP_SOURCE)
        self.assertEqual(value['toolSha'],m.TOOL_REVISION)
        self.assertFalse(value['liveAtSidecarWriteVerified'])
        self.assertFalse(value['newBusinessPassClaim'])
        self.assertEqual(value['diagnostics'],{'kinds':['identity-binding'],'eventCount':0,'readtapAttached':False,'r01StageAttached':False})
        self.assertNotIn('NEVER_OUTPUT',json.dumps(value))
    def test_readback_never_observes(self):
        self.run_target('readback'); self.assertEqual(self.o.calls,['readback'])
    def test_aa_approval_zero_send(self):
        self.o.approval['identity']['sourceRevision']=m.TOOL_REVISION
        self.blocked('BC_SOURCE_REQUIRED',True)
    def test_missing_wrapper_approval_zero_send(self):
        del self.o.approval['codeFiles'][m.SELF]; self.blocked('WRAPPER_NOT_APPROVED',True)
    def test_bad_tool_or_case_approval_zero_send(self):
        for key in m.PINS:
            with self.subTest(key=key):
                self.o=SyntheticObserver(); self.o.approval['codeFiles'][key]='0'*64
                self.blocked('TOOL_OR_CASE_PIN_CHANGED',True)
    def test_bad_profile_tool_or_case_zero_send(self):
        for field in ['toolRevision','sourcePins','filesSha256']:
            with self.subTest(field=field):
                self.o=SyntheticObserver(); self.o.prepared['profile'][field]='0'*40 if field=='toolRevision' else {m.CASE_FILE:'0'*64}
                self.blocked(zero=True)
    def test_missing_qa_zero_send_and_sanitized(self):
        self.o.missing_fixture=True; self.blocked(zero=True)
    def test_original_live_readback_rejection(self):
        self.o.readback_error=True; self.blocked()
    def test_marker_context_drift(self):
        self.o.drift=True; self.blocked('CONTEXT_DRIFT')
    def test_original_readback_raw_mismatch(self):
        self.o.changed_raw=True; self.blocked('ORIGINAL_READBACK_CHANGED')
    def test_aa_runtime_not_bc(self):
        self.o.receipt['runtimeRevision']=m.TOOL_REVISION; self.blocked('AA_RUNTIME_CANNOT_ATTEST_BC')
    def test_all_six_and_three_owned_ids_required(self):
        for field,value in [('checks',{'login':True}),('ownedAcceptanceRunIds',['run-a']*3),('runtimeInventorySha256','')]:
            with self.subTest(field=field):
                self.o=SyntheticObserver(); self.o.receipt[field]=value; self.blocked()
    def test_sidecar_conflict_fails_closed(self):
        self.run_target(); key=next(iter(self.o.saved)); self.o.saved[key]=b'conflict'
        with patch.object(m,'_observer',return_value=self.o),patch.object(Path,'exists',return_value=True):
            with self.assertRaisesRegex(m.TargetBlocked,'SIDECAR_CHANGED'): m.execute('a'*64,'readback')
        self.assertEqual(self.o.saved[key],b'conflict')
    def test_local_checkout_is_not_trusted_installed_adapter(self):
        with self.assertRaises(m.TargetBlocked): m.execute('a'*64,'observe')
    def test_original_source_pins_match(self):
        for name,pin in m.PINS.items():
            path=HISTORICAL_CASE if name==m.CASE_FILE else ROOT/name
            self.assertEqual(m.sha(path.read_bytes()),pin,name)
    def test_current_browser_cannot_satisfy_historical_tool_profile(self):
        original=self.o.private
        with patch.object(self.o,'private',side_effect=lambda path: (ROOT/m.CASE_FILE).read_bytes() if Path(path)==ROOT/m.CASE_FILE else original(path)):
            self.blocked('TOOL_OR_CASE_PIN_CHANGED',True)

if __name__ == '__main__': unittest.main()
