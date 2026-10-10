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

class CacheObservationTests(unittest.TestCase):
    def setUp(self):
        self.f=ObserveTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.f.cli.check=lambda:None
        self.f.cli._run=lambda *a,**k:self.fail('cache must never read bucket policy')
        self.port=n.NativeCachePort(self.f.cli,self.f.request)
    def test_cache_never_reads_policy_or_claims_atomic_fence(self):
        with patch.object(n,'provider_clock',side_effect=AssertionError('no fence clock needed')):
            result=self.port.observe()
        self.assertFalse(result['remoteCacheImmutable']);self.assertFalse(result['atomicVersionFence'])
        self.assertFalse(result['bucketPolicyRead']);self.assertEqual(result['versioning'],'Disabled')
    def test_observed_version_failure_is_sticky(self):
        self.f.responses['get-bucket-versioning']={'Status':'Enabled'}
        with self.assertRaisesRegex(n.c.Rejected,'VERSIONING_MUST_BE_DISABLED'):self.port.observe()
        self.f.responses['get-bucket-versioning']={}
        with self.assertRaisesRegex(n.c.Rejected,'NATIVE_CACHE_OBSERVATION_FAILED'):self.port.observe()
    def test_authentication_failure_is_sticky(self):
        self.f.responses['get-bucket-acl']['Owner']['ID']='wrong'
        with self.assertRaises(n.c.Rejected):self.port.observe()
        self.f.responses['get-bucket-acl']['Owner']['ID']=n.ACCOUNT
        with self.assertRaisesRegex(n.c.Rejected,'NATIVE_CACHE_OBSERVATION_FAILED'):self.port.observe()

class CacheExecuteTests(unittest.TestCase):
    def setUp(self):
        self.f=fixture.Tests();self.f.setUp();self.addCleanup(self.f.doCleanups)
        f=self.f;f.tr.update(kind='approved-candidate-oss-untrusted-cache-v1',bucket=n.BUCKET,
            uploadPrincipal='acs:ram::'+n.ACCOUNT+':root',deliveryId='0123456789abcdef0123456789abcdef')
        f.tr['prefix']+='deliveries/'+f.tr['deliveryId']+'/'
        for name,item in f.tr['objects'].items():
            item.update(key=f.tr['prefix']+name,bytes=(f.bundle/name).stat().st_size)
        approval=f.approval();approval.pop('versioningFenceProofSha256')
        approval.update(kind='cn-candidate-untrusted-cache-approval-v1',schemaVersion=1)
        now=datetime.now(timezone.utc)
        self.r=dict(kind='cn-candidate-native-untrusted-cache-upload-v1',schemaVersion=1,accountId=n.ACCOUNT,
            expectedPrincipal=f.tr['uploadPrincipal'],issuedAt=(now-timedelta(seconds=10)).isoformat(),
            expiresAt=(now+timedelta(minutes=40)).isoformat(),candidatePlanRawSha256=n.c.sha(f.pr),
            candidateSetRawSha256=n.c.sha(f.raw),transport=f.tr,transferApproval=approval,maxSeconds=120)
        self.objects={};self.puts=[];self.lost=False;self.version_changed=False
        outer=self
        class Cli:
            def __init__(self,seconds):self.deadline=time.monotonic()+seconds
            def check(self):pass
            def identity(self):return {'AccountId':n.ACCOUNT,'Arn':f.tr['uploadPrincipal'],'IdentityType':'Account'}
            def api(self,op,bucket):
                if op=='get-bucket-info':return {'Bucket':{'Name':n.BUCKET,'Location':'oss-cn-shanghai','Owner':{'ID':n.ACCOUNT}}}
                if op=='get-bucket-acl':return {'Owner':{'ID':n.ACCOUNT},'AccessControlList':{'Grant':'private'}}
                if op=='get-bucket-versioning':return {'Status':'Enabled'} if outer.version_changed and outer.puts else {}
                raise AssertionError('untrusted cache must not query policy')
            def _args(self,args):return args
            def _run(self,args,limit=262144,target=None,put_outcome=False):
                if args[0]=='api' and args[1]=='put-object':
                    assert put_outcome and '--forbid-overwrite' in args
                    key=args[args.index('--key')+1];outer.puts.append(key)
                    raw=Path(args[args.index('--body')+1][7:]).read_bytes()
                    outer.objects.setdefault(key,raw)
                    if outer.lost:raise n.NativeCommandOutcomeUnknown()
                    return b'{}'
                if args[0]=='cat':
                    key=args[1].split('/',3)[3];raw=outer.objects[key]
                    n.c.require(len(raw)<=limit,'CLI_OUTPUT_LIMIT');target.write(raw);return b''
                raise AssertionError('unexpected command')
        self.cli=Cli
    def execute(self,operation='upload'):
        raw=n.c.json_bytes(self.r)
        with patch.object(n,'NativeCli',self.cli):
            return n.execute_cache(operation,raw,n.c.sha(raw),self.f.pr,self.f.raw,self.f.bundle,
                revalidation_raw=getattr(self,'proof_raw',None),revalidation_policy_raw=getattr(self,'proof_policy_raw',None))
    def test_real_tar_cache_upload_exact_original_bytes(self):
        result=self.execute()
        self.assertEqual(len(self.puts),7);self.assertEqual(len(set(self.puts)),7)
        self.assertEqual(self.objects[self.f.tr['prefix']+n.PLAN],self.f.pr)
        self.assertEqual(self.objects[self.f.tr['prefix']+n.SET],self.f.raw)
        self.assertFalse(result['bucketPolicyRead']);self.assertFalse(result['remoteCacheImmutable'])
        self.assertEqual(result['transfer']['expiresAt'],self.f.v['expiresAt'])
    def test_lost_ack_readback_no_second_put(self):
        self.lost=True;self.execute();self.assertEqual(len(self.puts),7)
    def test_version_change_after_put_stops_without_marker(self):
        self.version_changed=True
        with self.assertRaisesRegex(n.c.Rejected,'NATIVE_CACHE_UPLOAD_REJECTED'):self.execute()
        self.assertEqual(len(self.puts),1);self.assertNotIn(self.f.tr['prefix']+n.SET,self.objects)
    def test_check_is_read_only(self):
        result=self.execute('check');self.assertFalse(result['transferStarted']);self.assertEqual(self.puts,[])
    def test_real_revalidation_upload_keeps_expired_original_receipt(self):
        import test_cn_candidate_revalidation as rvfixture
        rv=rvfixture.RevalidationTests();rv.setUp();self.addCleanup(rv.doCleanups)
        self.proof_raw=rv.produce();self.proof_policy_raw=rv.policy_raw
        f=self.f;f.pr=rv.plan_raw;f.raw=rv.raw;f.build=rv.plan;f.v=rv.receipt;f.bundle=rv.work/'bundle'
        for name,item in f.tr['objects'].items():
            item.update(bytes=(f.bundle/name).stat().st_size,sha256=n.c.sha((f.bundle/name).read_bytes()))
        ap=f.approval();ap.pop('versioningFenceProofSha256')
        ap.update(kind='cn-candidate-untrusted-cache-approval-v1',schemaVersion=1,revalidationRawSha256=n.c.sha(self.proof_raw))
        self.r.update(candidatePlanRawSha256=n.c.sha(f.pr),candidateSetRawSha256=n.c.sha(f.raw),
            transferApproval=ap,revalidationRawSha256=n.c.sha(self.proof_raw),revalidationPolicyRawSha256=n.c.sha(rv.policy_raw))
        result=self.execute();self.assertEqual(len(self.puts),7)
        self.assertEqual(self.objects[f.tr['prefix']+n.SET],rv.raw)
        self.assertEqual(result['transfer']['expiresAt'],rv.receipt['expiresAt'])

    def test_strict_field_smuggling_rejected(self):
        self.r['bucketPolicyRawSha256']='f'*64
        with self.assertRaises(n.c.Rejected):self.execute()
        self.assertEqual(self.puts,[])
    def test_foreign_delivery_prefix_rejected_before_auth(self):
        self.r['transport']['prefix']='foreign/'
        with patch.object(n,'NativeCli',side_effect=AssertionError('must not authenticate')):
            raw=n.c.json_bytes(self.r)
            with self.assertRaises(n.c.Rejected):n.execute_cache('upload',raw,n.c.sha(raw),self.f.pr,self.f.raw,self.f.bundle)
        self.assertEqual(self.puts,[])

if __name__=='__main__':unittest.main()
