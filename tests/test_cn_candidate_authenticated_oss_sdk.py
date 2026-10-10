"""Required fixed-SDK offline contract check; not a cloud authentication test.

Run only in the isolated dependency environment documented next to the caller.
Socket creation is rejected. Real SDK serialization/signing/parsing are exercised.
"""
import importlib.metadata
import io
from pathlib import Path
import socket
import sys
from types import SimpleNamespace as N
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_cn_candidate_authenticated_oss as fixture
import cn_candidate_authenticated_oss as m
import cn_image_archive as c
import oss2
import requests
from alibabacloud_credentials.client import Client
from alibabacloud_credentials.models import Config
from aliyunsdkcore.vendored.requests import Session as StsSession, Response as StsResponse

class Tests(unittest.TestCase):
    def test_fixed_sdk_real_signing_session_and_result_contract(self):
        for name,version in {'oss2':'2.19.1','alibabacloud-credentials':'0.3.6',
                             'aliyun-python-sdk-core':'2.16.0','aliyun-python-sdk-sts':'3.1.2'}.items():
            self.assertEqual(importlib.metadata.version(name),version)
        self.assertTrue(Config(disable_imds_v1=True).disable_imds_v1)
        f=fixture.Tests();f.setUp();self.addCleanup(f.doCleanups)
        captured=[]
        def send(session,request,**kwargs):
            self.assertFalse(kwargs['allow_redirects']);self.assertTrue(kwargs['verify'])
            self.assertEqual(kwargs['proxies'],{});captured.append(request)
            if request.url.startswith('https://sts.'):
                self.assertEqual(request.method,'POST')
                result=StsResponse();raw=c.json_bytes(f.identity)
            else:
                self.assertEqual(request.method,'GET');self.assertIn('Authorization',request.headers)
                result=requests.Response()
                if '?bucketInfo' in request.url:
                    raw=('<BucketInfo><Bucket><CreationDate>2026-01-01T00:00:00Z</CreationDate><StorageClass>Standard</StorageClass><ExtranetEndpoint>oss-cn-shanghai.aliyuncs.com</ExtranetEndpoint><IntranetEndpoint>oss-cn-shanghai-internal.aliyuncs.com</IntranetEndpoint><AccessControlList><Grant>private</Grant></AccessControlList><Name>'+f.tr['bucket']+'</Name><Location>oss-cn-shanghai</Location><Owner><ID>'+m.ACCOUNT+'</ID><DisplayName>fixture</DisplayName></Owner></Bucket></BucketInfo>').encode()
                elif '?acl' in request.url:raw=b'<AccessControlPolicy><Owner><ID>fixture</ID><DisplayName>fixture</DisplayName></Owner><AccessControlList><Grant>private</Grant></AccessControlList></AccessControlPolicy>'
                elif '?versioning' in request.url:raw=b'<VersioningConfiguration></VersioningConfiguration>'
                elif '?policy' in request.url:raw=f.policy
                else:raise AssertionError('unexpected offline request')
            result.status_code=200;result._content=raw;result.raw=io.BytesIO(raw)
            result.headers['date']=f.bucket.get_bucket_policy().headers['Date']
            result.headers['x-oss-request-id']='fixture';result.headers['Content-Length']=str(len(raw))
            return result
        snapshot=N(access_key_id='fixture-id',access_key_secret='fixture-secret',security_token='fixture-token')
        with patch.object(socket.socket,'connect',side_effect=AssertionError('network forbidden')), \
             patch.object(Client,'get_credential',return_value=snapshot),patch.object(m,'verify_host'), \
             patch.object(StsSession,'send',send),patch.object(requests.Session,'send',send):
            port=m.ecs_port(f.req)
            observed=port.observe()
        self.assertTrue(observed['authenticatedSameCredentialIdentity'])
        self.assertFalse(observed['remoteCacheImmutable'])
        self.assertEqual(len(captured),5)

if __name__=='__main__':unittest.main()
