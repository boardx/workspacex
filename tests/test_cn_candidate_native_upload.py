"""Native boundary regressions; all provider calls mocked, no cloud writes."""
from datetime import datetime, timedelta, timezone
import copy
import io
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import test_cn_candidate_oss as fixture
import cn_candidate_native_upload as n


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.f=fixture.Tests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.writes=[];self.reads=[];self.objects={};self.unknown=False;self.bad=False
        outer=self
        class Port:
            def bind(self,t,op): pass
            def put(self,key,stream,size,check):
                check();outer.writes.append(key);outer.objects.setdefault(key,stream.read())
                if outer.unknown: raise RuntimeError('redacted')
            def readback(self,key,size,sha,check):
                check();outer.reads.append(key);raw=outer.objects[key]
                n.c.require(not outer.bad and len(raw)==size and n.c.sha(raw)==sha,'REMOTE_CONTENT_MISMATCH')
        self.port=Port()
    def transfer(self):
        f=self.f
        return n.NativeUpload(self.port,f.pr,n.c.sha(f.pr),f.raw,n.c.sha(f.raw),f.tr,f.approval())
    def test_unknown_ack_only_readback_once_put(self):
        self.unknown=True;r=self.transfer().upload(self.f.bundle)
        self.assertEqual(len(self.writes),7);self.assertEqual(len(set(self.writes)),7)
        self.assertEqual(self.writes,self.reads);self.assertTrue(self.writes[-1].endswith('candidate-set.json'))
        self.assertFalse(r['productionReady'])
    def test_corrupt_readback_stops_before_marker_no_retry(self):
        self.bad=True;self.unknown=True
        with self.assertRaisesRegex(n.c.Rejected,'REMOTE_CONTENT_MISMATCH'):self.transfer().upload(self.f.bundle)
        self.assertEqual(len(self.writes),1);self.assertEqual(len(self.reads),1)
    def test_all_files_verified_before_first_network(self):
        (self.f.bundle/'web.tar').write_bytes(b'tamper')
        with self.assertRaises(n.c.Rejected):self.transfer().upload(self.f.bundle)
        self.assertEqual(self.writes,[])
    def test_expiry_before_credentials(self):
        self.f.v['expiresAt']='2000-01-01T00:00:00Z';self.f.raw=n.c.json_bytes(self.f.v)
        with self.assertRaises(n.c.Rejected):self.transfer()
        self.assertEqual(self.writes,[])


class ObserveTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime.now(timezone.utc)
        self.request={'expectedPrincipal':'acs:ram::'+n.ACCOUNT+':root','transport':{},
                      'fenceStartsAt':(self.now-timedelta(seconds=30)).isoformat(),
                      'fenceExpiresAt':(self.now+timedelta(seconds=500)).isoformat()}
        self.responses={'get-bucket-info':{'Bucket':{'Name':n.BUCKET,'Location':'oss-cn-shanghai','Owner':{'ID':n.ACCOUNT}}},
            'get-bucket-acl':{'Owner':{'ID':n.ACCOUNT},'AccessControlList':{'Grant':'private'}},
            'get-bucket-versioning':{'+@xmlns':'provider'}}
        outer=self
        class Cli:
            deadline=time.monotonic()+100
            def identity(self):return {'AccountId':n.ACCOUNT,'Arn':outer.request['expectedPrincipal'],'IdentityType':'Account'}
            def api(self,op,bucket):return outer.responses[op]
            def _args(self,args):return args
            def _run(self,args,limit):return b'raw-policy'
        self.cli=Cli();self.port=n.NativePort(self.cli,self.request)
        shared=types.SimpleNamespace(validate_policy=lambda raw,r:n.c.require(raw==b'raw-policy','HASH'))
        self.patcher=patch.dict(sys.modules,{'cn_candidate_authenticated_oss':shared});self.patcher.start();self.addCleanup(self.patcher.stop)
    def test_tls_dates_separate_authenticated_policy(self):
        with patch.object(n,'provider_clock',side_effect=[self.now,self.now+timedelta(seconds=1)]):
            out=self.port.observe()
        self.assertEqual(out['providerClockMethod'],'fixed-endpoint-tls-head')
        self.assertTrue(out['authenticatedPolicyObserved'])
    def test_backward_or_slow_provider_window_rejected(self):
        for seconds in (-1,31):
            with patch.object(n,'provider_clock',side_effect=[self.now,self.now+timedelta(seconds=seconds)]):
                with self.assertRaisesRegex(n.c.Rejected,'NATIVE_PROVIDER_CLOCK_WINDOW'):self.port.observe()
    def test_suspended_enabled_versioning_rejected(self):
        for state in ('Suspended','Enabled','Disabled',None):
            self.responses['get-bucket-versioning']={'Status':state}
            with patch.object(n,'provider_clock',return_value=self.now):
                with self.assertRaisesRegex(n.c.Rejected,'VERSIONING_MUST_BE_DISABLED'):self.port.observe()
    def test_wrong_owner_rejected(self):
        self.responses['get-bucket-info']['Bucket']['Owner']['ID']='wrong'
        with patch.object(n,'provider_clock',return_value=self.now):
            with self.assertRaisesRegex(n.c.Rejected,'NATIVE_BUCKET_IDENTITY'):self.port.observe()
    def test_provider_remaining_budget(self):
        self.port.request['fenceExpiresAt']=(self.now+timedelta(seconds=100)).isoformat()
        with patch.object(n,'provider_clock',return_value=self.now):
            with self.assertRaisesRegex(n.c.Rejected,'NATIVE_PROVIDER_CLOCK_WINDOW'):self.port.observe()
    def test_put_is_one_api_with_no_retry_or_overwrite(self):
        calls=[];self.port.observe=lambda:None
        self.cli._run=lambda args:calls.append(args)
        self.port.transport={'objects':{'x':{'key':'fixed/key'}}}
        import tempfile
        with tempfile.NamedTemporaryFile() as f:
            f.write(b'abc');f.flush();self.port.put('fixed/key',f,3,lambda:None)
        self.assertEqual(len(calls),1)
        self.assertIn('--forbid-overwrite',calls[0]);self.assertEqual(calls[0][1],'put-object')

if __name__=='__main__':unittest.main()
