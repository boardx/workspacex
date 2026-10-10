"""Offline adapter checks. No credentials, SDK calls, or cloud writes."""
import copy
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import io
from pathlib import Path
import sys
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cn_candidate_authenticated_oss as m
import cn_image_archive as c
import test_cn_candidate_oss as fixture

class Tests(unittest.TestCase):
    def setUp(self):
        fixture.Tests.setUp(self)
        self.principal = 'acs:ram::'+m.ACCOUNT+':assumed-role/'+m.ROLE+'/fixture'
        self.tr['downloadPrincipal'] = self.principal
        self.tr['uploadPrincipal'] = 'acs:ram::'+m.ACCOUNT+':user/local-oauth'
        start = datetime.now(timezone.utc)-timedelta(seconds=5)
        self.req = dict(kind='cn-candidate-authenticated-transfer-v1', schemaVersion=1,
            accountId=m.ACCOUNT, ecsInstanceId=m.INSTANCE, roleName=m.ROLE, region=m.REGION,
            expectedPrincipal=self.principal, operation='download', issuedAt=start.isoformat(),
            expiresAt=(start+timedelta(seconds=1800)).isoformat(),
            fenceStartsAt=start.isoformat(), fenceExpiresAt=(start+timedelta(seconds=1900)).isoformat(),
            bucketPolicyRawSha256='0'*64, candidatePlanRawSha256=c.sha(self.pr),
            candidateSetRawSha256=c.sha(self.raw), transport=self.tr,
            transferApproval={}, maxSeconds=1200)
        self.policy = c.json_bytes({'Version':'1','Statement':m.required_statements(self.req)})
        self.req['bucketPolicyRawSha256'] = c.sha(self.policy)
        ap = fixture.Tests.approval(self, 'download')
        ap['expiresAt'] = self.req['expiresAt']
        ap['versioningFenceProofSha256'] = m.fence_hash(self.req)
        self.req['transferApproval'] = ap
        self.bucket = N(bucket_name=self.tr['bucket'], endpoint=m.ENDPOINT, timeout=10,
            get_bucket_info=lambda: N(name=self.tr['bucket'],location='oss-cn-shanghai',owner=N(id=m.ACCOUNT)),
            get_bucket_acl=lambda: N(acl='private'), get_bucket_versioning=lambda: N(status=None),
            get_bucket_policy=lambda: N(policy=self.policy,headers={'Date':format_datetime(datetime.now(timezone.utc),usegmt=True)}))
        self.identity = dict(AccountId=m.ACCOUNT,Arn=self.principal,IdentityType='AssumedRoleUser')
    def auth_port(self): return m.AuthenticatedPort(self.bucket, lambda:self.identity, self.req)
    def validate(self):
        raw = c.json_bytes(self.req)
        return m.validate_request(raw,c.sha(raw),'check')
    def test_hash_and_exact_fields(self):
        self.validate()
        raw=c.json_bytes(self.req)
        with self.assertRaises(c.Rejected):m.validate_request(raw,'0'*64,'check')
        self.req['trusted']=True
        with self.assertRaises(c.Rejected):self.validate()
    def test_operation_scope_and_expiry(self):
        for field,value in [('accountId','other'),('ecsInstanceId','other'),('maxSeconds',1201),('expiresAt','2000-01-01T00:00:00Z')]:
            with self.subTest(field=field):
                old=self.req[field];self.req[field]=value
                with self.assertRaises(c.Rejected):self.validate()
                self.req[field]=old
    def test_policy_exact_hash_and_no_weaker_condition(self):
        m.validate_policy(self.policy,self.req)
        for change in ['action','principal','condition']:
            policy=c.decode(self.policy)
            if change=='action':policy['Statement'][0]['Action'].remove('oss:PutBucketVersioning')
            if change=='principal':policy['Statement'][0]['Principal']=['only-a-user']
            if change=='condition':policy['Statement'][0]['Condition']['StringEquals']={'acs:AccessId':'not-everyone'}
            raw=c.json_bytes(policy);req=copy.deepcopy(self.req);req['bucketPolicyRawSha256']=c.sha(raw)
            with self.assertRaises(c.Rejected):m.validate_policy(raw,req)
        with self.assertRaises(c.Rejected):m.validate_policy(self.policy+b' ',self.req)
    def test_fence_not_bound_to_download_credential(self):
        claim=m.fence_hash(self.req)
        changed=copy.deepcopy(self.req);changed['expectedPrincipal']='different'
        self.assertEqual(claim,m.fence_hash(changed))
        self.assertNotIn('AccessId',self.policy.decode())
        self.assertNotIn('PutObject',self.policy.decode())
    def test_signed_identity_and_bucket_observation(self):
        result=self.auth_port().observe()
        self.assertTrue(result['authenticatedSameCredentialIdentity'])
        self.assertFalse(result['remoteCacheImmutable'])
        self.assertFalse(result['productionReady'])
        self.assertNotIn(self.principal,c.json_bytes(result).decode())
        self.identity['Arn']='foreign'
        with self.assertRaises(c.Rejected):self.auth_port().observe()
    def test_versioning_public_acl_owner_fail_closed(self):
        for status in ('Enabled','Suspended',''):
            self.bucket.get_bucket_versioning=lambda:N(status=status)
            with self.assertRaises(c.Rejected):self.auth_port().observe()
        self.bucket.get_bucket_versioning=lambda:N(status=None)
        self.bucket.get_bucket_acl=lambda:N(acl='public-read')
        with self.assertRaises(c.Rejected):self.auth_port().observe()
    def test_signed_server_clock_and_remaining_window(self):
        self.bucket.get_bucket_policy=lambda:N(policy=self.policy,headers={'Date':'Sat, 01 Jan 2000 00:00:00 GMT'})
        with self.assertRaises(c.Rejected):self.auth_port().observe()
        self.bucket.get_bucket_policy=lambda:N(policy=self.policy,headers={})
        with self.assertRaises(KeyError):self.auth_port().observe()
    def test_missing_policy_no_trusted_boolean(self):
        self.bucket.get_bucket_policy=lambda:N(policy=b'{}',headers={})
        with self.assertRaises(c.Rejected):self.auth_port().observe()
    def test_ecs_never_uploads_or_foreign_get(self):
        with self.assertRaises(c.Rejected):self.auth_port().put('a',io.BytesIO(b'x'),1,lambda:None)
        with self.assertRaises(c.Rejected):self.auth_port().get('foreign','')
    def test_invalid_original_bytes_before_credentials(self):
        raw=c.json_bytes(self.req)
        with patch.object(m,'ecs_port') as factory:
            with self.assertRaises(c.Rejected):m.execute_from_ecs('check',raw,c.sha(raw),self.pr+b'x',self.raw)
            factory.assert_not_called()
    def test_real_caller_check_has_no_transfer(self):
        raw=c.json_bytes(self.req)
        with patch.object(m,'ecs_port',return_value=self.auth_port()), patch.object(m.CandidateTransfer,'download') as download:
            result=m.execute_from_ecs('check',raw,c.sha(raw),self.pr,self.raw)
            self.assertEqual(result['cloudWrites'],0)
            self.assertFalse(result['transferStarted']);download.assert_not_called()
    def test_provider_exception_redaction(self):
        raw=c.json_bytes(self.req)
        with patch.object(m,'ecs_port',side_effect=RuntimeError('secret-token')):
            with self.assertRaises(c.Rejected) as error:m.execute_from_ecs('check',raw,c.sha(raw),self.pr,self.raw)
            self.assertEqual(str(error.exception),'AUTHENTICATED_TRANSFER_REJECTED')
    def test_network_pin_rejects_redirect_proxy_foreign_host_and_write(self):
        calls=[];session=N(request=lambda *a,**k:calls.append((a,k)),send=lambda *a,**k:calls.append((a,k)))
        m.pin_session(session,'fixture.oss-cn-shanghai.aliyuncs.com',{'GET'})
        session.request('GET','https://fixture.oss-cn-shanghai.aliyuncs.com/x')
        self.assertFalse(session.trust_env)
        self.assertFalse(calls[0][1]['allow_redirects']);self.assertTrue(calls[0][1]['verify'])
        self.assertEqual(calls[0][1]['proxies'],{})
        for method,url in [('PUT','https://fixture.oss-cn-shanghai.aliyuncs.com/x'),('GET','http://fixture.oss-cn-shanghai.aliyuncs.com/x'),('GET','https://evil.example/x')]:
            with self.assertRaises(c.Rejected):session.request(method,url)
        self.assertEqual(len(calls),1)

    def test_factory_uses_one_existing_role_snapshot_for_both_clients(self):
        import types
        modules={}
        def module(name,**attrs):
            obj=types.ModuleType(name)
            for key,value in attrs.items():setattr(obj,key,value)
            modules[name]=obj
            return obj
        captures={}
        credential=N(access_key_id='fixture-id',access_key_secret='fixture-secret',security_token='fixture-token')
        def config(**kw):captures['config']=kw;return kw
        def client(conf):return N(get_credential=lambda:credential)
        def auth(*values):captures['ossCredential']=values;return values
        def sts_credential(*values):captures['stsCredential']=values;return values
        def acs(**kw):
            captures['stsOptions']=kw
            return N(session=N(request=lambda *a,**k:None,send=lambda *a,**k:None),do_action_with_exception=lambda req:c.json_bytes(self.identity))
        def bucket(*args,**kw):captures['bucketArgs']=args;captures['bucketOptions']=kw;return self.bucket
        class Request:
            def set_protocol_type(self,value):captures['protocol']=value
            def set_endpoint(self,value):captures['domain']=value
            def set_method(self,value):captures['method']=value
            def set_accept_format(self,value):captures['format']=value
        module('oss2',StsAuth=auth,Session=lambda:N(session=N(request=lambda *a,**k:None,send=lambda *a,**k:None)),Bucket=bucket)
        module('alibabacloud_credentials');module('alibabacloud_credentials.client',Client=client)
        module('alibabacloud_credentials.models',Config=config)
        module('aliyunsdkcore');module('aliyunsdkcore.client',AcsClient=acs)
        module('aliyunsdkcore.auth');module('aliyunsdkcore.auth.credentials',StsTokenCredential=sts_credential)
        for name in ['aliyunsdksts','aliyunsdksts.request','aliyunsdksts.request.v20150401']:module(name)
        module('aliyunsdksts.request.v20150401.GetCallerIdentityRequest',GetCallerIdentityRequest=Request)
        with patch.dict(sys.modules,modules),patch.object(m,'verify_host'):
            result=m.ecs_port(self.req).observe()
        self.assertTrue(result['authenticatedSameCredentialIdentity'])
        self.assertEqual(captures['ossCredential'],captures['stsCredential'])
        self.assertEqual(captures['config']['type'],'ecs_ram_role')
        self.assertEqual(captures['config']['role_name'],m.ROLE)
        self.assertTrue(captures['config']['disable_imds_v1'])
        self.assertFalse(captures['stsOptions']['auto_retry'])
        self.assertTrue(captures['stsOptions']['verify'])
        self.assertEqual(captures['domain'],'sts.cn-shanghai.aliyuncs.com')
        self.assertEqual(captures['protocol'],'https')
        self.assertEqual(captures['bucketArgs'][1],m.ENDPOINT)

if __name__=='__main__':unittest.main()
