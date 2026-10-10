"""Offline untrusted-cache contracts, real five Docker-save tar fixtures."""
import copy
import io
import sys
from pathlib import Path
from types import SimpleNamespace as N
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cn_candidate_oss as core
import cn_candidate_authenticated_oss as auth
import cn_image_archive as c
import test_cn_candidate_oss as fixture
import test_cn_candidate_authenticated_oss as auth_fixture


def cache_transport(owner):
    owner.tr['kind']='approved-candidate-oss-untrusted-cache-v1'
    owner.tr['deliveryId']='0123456789abcdef0123456789abcdef'
    owner.tr['prefix'] += 'deliveries/'+owner.tr['deliveryId']+'/'
    for name,item in owner.tr['objects'].items():
        item.update(key=owner.tr['prefix']+name,bytes=(owner.bundle/name).stat().st_size)


def cache_approval(owner, operation='upload'):
    value=fixture.Tests.approval(owner,operation)
    value.pop('versioningFenceProofSha256')
    value.update(schemaVersion=1,kind='cn-candidate-untrusted-cache-approval-v1')
    return value


class CacheTests(unittest.TestCase):
    def setUp(self):
        fixture.Tests.setUp(self)
        cache_transport(self)
        self.port.observe_cache_version=Mock(return_value='Disabled')
    def transfer(self,operation='upload',approval=None):
        return core.UntrustedCacheTransfer(self.port,self.pr,c.sha(self.pr),self.raw,c.sha(self.raw),
                                          self.tr,approval or cache_approval(self,operation))
    def test_real_full_tar_upload_seven_original_bytes(self):
        result=self.transfer().upload(self.bundle)
        self.assertEqual(len([x for x in self.port.calls if x[0]=='put']),7)
        self.assertEqual(self.port.objects[self.tr['prefix']+core.PLAN],self.pr)
        self.assertEqual(result['attemptId'],self.build['attemptId'])
        self.assertEqual(result['expiresAt'],self.v['expiresAt'])
        self.assertFalse(result['remoteCacheImmutable'])
        self.assertNotIn('versioningFenceProofSha256',result)
    def test_unknown_dispatched_put_recovers_only_by_get(self):
        put=self.port.put
        def lost(*args):
            put(*args)
            raise core.UnknownPutOutcome()
        self.port.put=lost
        self.transfer().upload(self.bundle)
        self.assertEqual(len([x for x in self.port.calls if x[0]=='put']),7)
    def test_generic_failure_cannot_be_hidden_by_matching_cache(self):
        put=self.port.put
        def rejected(*args):
            put(*args)
            raise c.Rejected('IDENTITY_OBSERVATION_FAILED')
        self.port.put=rejected
        with self.assertRaisesRegex(c.Rejected,'IDENTITY_OBSERVATION_FAILED'):
            self.transfer().upload(self.bundle)
        self.assertEqual(len([x for x in self.port.calls if x[0]=='put']),1)
        self.assertNotIn(self.tr['prefix']+core.SET,self.port.objects)
    def test_bad_tar_rejected_before_network(self):
        with (self.bundle/'web.tar').open('ab') as f:f.write(b'bad')
        with self.assertRaises(c.Rejected):self.transfer().upload(self.bundle)
        self.assertEqual(self.port.calls,[])
        self.port.observe_cache_version.assert_not_called()
    def test_seven_keys_sizes_hashes_delivery_and_attempt_are_exact(self):
        initial=copy.deepcopy(self.tr)
        for change in (
            lambda t:t.update(deliveryId='x'*32),
            lambda t:t.update(prefix='foreign/'),
            lambda t:t['objects']['api.tar'].update(bytes=True),
            lambda t:t['objects']['api.tar'].update(sha256='0'*64),
            lambda t:t['objects']['api.tar'].update(versionId='foreign'),
            lambda t:t['objects']['api.tar'].update(key=t['prefix']+'foreign.tar'),
            lambda t:t['objects'].pop('web.tar'),
        ):
            self.tr=copy.deepcopy(initial);change(self.tr)
            with self.assertRaises(c.Rejected):self.transfer()
        self.assertEqual(self.port.calls,[])
    def test_bytes_rejects_equal_float_and_boolean_types(self):
        original=self.tr['objects']['api.tar']['bytes']
        for value in (float(original),True,False):
            self.tr['objects']['api.tar']['bytes']=value
            with self.assertRaisesRegex(c.Rejected,'TRANSPORT_OBJECT_BINDING'):self.transfer()
        self.tr['objects']['api.tar']['bytes']=original
        self.transfer()

    def test_no_dummy_fence_or_strict_approval(self):
        approval=cache_approval(self);approval['versioningFenceProofSha256']='f'*64
        with self.assertRaises(c.Rejected):self.transfer(approval=approval)
        with self.assertRaises(c.Rejected):
            core.CandidateTransfer(self.port,self.pr,c.sha(self.pr),self.raw,c.sha(self.raw),self.tr,cache_approval(self))
    def test_default_old_receipt_expiry_still_rejected(self):
        value=c.decode(self.raw);value['expiresAt']='2000-01-01T00:00:00Z';self.raw=c.json_bytes(value)
        with self.assertRaises(c.Rejected):self.transfer()
    def test_changed_version_stops_before_put(self):
        self.port.observe_cache_version.return_value='Enabled'
        with self.assertRaises(c.Rejected):self.transfer().upload(self.bundle)
        self.assertFalse(any(x[0]=='put' for x in self.port.calls))
    def test_download_corruption_never_publishes(self):
        self.port.objects={self.tr['prefix']+p.name:p.read_bytes() for p in self.bundle.iterdir()}
        self.port.objects[self.tr['prefix']+'web.tar']=b'bad'
        parent=self.root/'download';parent.mkdir(mode=0o700)
        with self.assertRaises(c.Rejected):self.transfer('download').download(parent,'attempt')
        self.assertEqual(list(parent.iterdir()),[])
    @unittest.skipUnless(sys.platform=='linux','Linux NOREPLACE and proc FD contract')
    def test_linux_download_full_validation_and_noreplace(self):
        self.port.objects={self.tr['prefix']+p.name:p.read_bytes() for p in self.bundle.iterdir()}
        parent=self.root/'download';parent.mkdir(mode=0o700)
        self.transfer('download').download(parent,'attempt')
        with self.assertRaises(c.Rejected):self.transfer('download').download(parent,'attempt')
        self.assertEqual((parent/'attempt'/core.PLAN).read_bytes(),self.pr)


class CacheAuthenticationTests(unittest.TestCase):
    def setUp(self):
        auth_fixture.Tests.setUp(self)
        cache_transport(self)
        self.req.update(kind=auth.CACHE_REQUEST_KIND,transport=self.tr)
        for field in ('bucketPolicyRawSha256','fenceStartsAt','fenceExpiresAt'):self.req.pop(field)
        approval=cache_approval(self,'download');approval['expiresAt']=self.req['expiresAt']
        self.req['transferApproval']=approval
        self.bucket.get_bucket_policy=Mock(side_effect=AssertionError('POLICY_MUST_NOT_BE_READ'))
    def cache_port(self):return auth.UntrustedCacheAuthenticatedPort(self.bucket,lambda:self.identity,self.req)
    def validate(self):
        raw=c.json_bytes(self.req)
        return auth.validate_request(raw,c.sha(raw),'check')
    def test_no_policy_read_real_caller_check(self):
        self.validate();raw=c.json_bytes(self.req)
        with patch.object(auth,'ecs_port',return_value=self.cache_port()):
            result=auth.execute_from_ecs('check',raw,c.sha(raw),self.pr,self.raw)
        self.assertFalse(result['transferStarted'])
        self.assertFalse(result['authentication']['administrativeRaceExcluded'])
        self.bucket.get_bucket_policy.assert_not_called()
    def test_sticky_version_failure_cannot_recover(self):
        port=self.cache_port();port.observe()
        self.bucket.get_bucket_versioning=lambda:N(status='Enabled')
        with self.assertRaises(c.Rejected):port.observe_cache_version()
        self.bucket.get_bucket_versioning=lambda:N(status=None)
        with self.assertRaisesRegex(c.Rejected,'CACHE_OBSERVATION_FAILED'):port.observe()
    def test_sticky_identity_failure(self):
        port=self.cache_port();old=self.identity['Arn'];self.identity['Arn']='foreign'
        with self.assertRaises(c.Rejected):port.observe()
        self.identity['Arn']=old
        with self.assertRaises(c.Rejected):port.observe_cache_version()
    def test_forbidden_policy_or_fence_fields(self):
        for field in ('bucketPolicyRawSha256','fenceStartsAt','fenceExpiresAt'):
            self.req[field]='f'*64
            with self.assertRaises(c.Rejected):self.validate()
            self.req.pop(field)
    def test_no_forged_mapping_before_credential_factory(self):
        self.req['transport']['objects']['api.tar']['bytes']+=1
        self.req['transferApproval']['transportSha256']=c.sha(c.json_bytes(self.tr))
        raw=c.json_bytes(self.req)
        with patch.object(auth,'ecs_port') as factory:
            with self.assertRaises(c.Rejected):auth.execute_from_ecs('check',raw,c.sha(raw),self.pr,self.raw)
            factory.assert_not_called()
    def test_upload_foreign_target_or_hash_rejected(self):
        raw=c.json_bytes(self.req)
        with self.assertRaises(c.Rejected):auth.validate_request(raw,'f'*64,'check')
        with self.assertRaises(c.Rejected):auth.validate_request(raw,c.sha(raw),'upload')
        self.req['ecsInstanceId']='other'
        with self.assertRaises(c.Rejected):self.validate()


class CacheRevalidationTests(unittest.TestCase):
    def setUp(self):
        import test_cn_candidate_revalidation as revalidation_fixture
        self.f = revalidation_fixture.RevalidationTests()
        self.f.setUp(); self.addCleanup(self.f.doCleanups)
        self.cap = self.f.admitted()
        self.build=self.f.plan;self.pr=self.f.plan_raw;self.raw=self.f.raw;self.v=self.f.receipt
        self.bundle=self.f.work/'bundle'
        prefix='cn-image-candidates/'+self.build['sourceRevision']+'/'+self.build['attemptId']+'/'
        self.tr=dict(kind='approved-candidate-oss-staging-v2',bucket='fixture-bucket',region='cn-shanghai',endpoint='https://oss-cn-shanghai.aliyuncs.com',prefix=prefix,uploadPrincipal='u',downloadPrincipal='d',objects={p.name:dict(key=prefix+p.name,versionId='',sha256=c.sha(p.read_bytes())) for p in self.bundle.iterdir()})
        cache_transport(self)
        self.port=fixture.Port();self.port.observe_cache_version=Mock(return_value='Disabled')
    def transfer(self,approval=None,cap=True):
        value=approval or cache_approval(self)
        value['revalidationRawSha256']=self.cap.sha
        return core.UntrustedCacheTransfer(self.port,self.pr,c.sha(self.pr),self.raw,c.sha(self.raw),self.tr,value,
                                           revalidation=self.cap if cap else None)
    def test_expired_original_requires_independently_admitted_proof(self):
        with self.assertRaises(c.Rejected):self.transfer(cap=False)
        result=self.transfer().upload(self.bundle)
        self.assertEqual(result['revalidationRawSha256'],self.cap.sha)
        self.assertEqual(result['expiresAt'],self.v['expiresAt'])
        self.assertEqual(self.port.objects[self.tr['prefix']+core.SET],self.raw)
    def test_proof_does_not_extend_dynamic_authorization_or_its_own_ttl(self):
        value=cache_approval(self);value['expiresAt']='2000-01-01T00:00:00Z'
        with self.assertRaises(c.Rejected):self.transfer(approval=value)
        self.cap._value['expiresAt']='2000-01-01T00:00:00Z'
        with self.assertRaises(c.Rejected):self.transfer()
    def test_proof_does_not_replace_full_tar_readback(self):
        with (self.bundle/'api.tar').open('ab') as f:f.write(b'tampered')
        with self.assertRaises(c.Rejected):self.transfer().upload(self.bundle)
        self.assertEqual(self.port.calls,[])


if __name__=='__main__':unittest.main()
