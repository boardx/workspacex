"""Offline fixed-endpoint and RPC v1 signing regression tests."""
import base64
import hashlib
import hmac
import io
import os
from pathlib import Path
import sys
import unittest
import urllib.parse
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import isolated_rehearsal_aliyun as adapter


class EndpointTests(unittest.TestCase):
    def test_fixed_private_endpoints_preserve_signed_rpc_request(self):
        cases = (
            ('rds', 'DescribeDBInstanceAttribute', 'rds-vpc.cn-shanghai.aliyuncs.com', '2014-08-15'),
            ('ram', 'GetRole', 'ram.vpc-proxy.aliyuncs.com', '2015-05-01'),
            ('oos', 'ListExecutions', 'oos.cn-shanghai.aliyuncs.com', '2019-06-01'),
        )
        creds = dict(AccessKeyId='fixture-id', AccessKeySecret='fixture-secret', SecurityToken='fixture-token')
        for service, action, host, version in cases:
            with self.subTest(service=service), patch.dict(os.environ, {
                'ALIBABA_CLOUD_ENDPOINT': 'https://untrusted.invalid/',
                'RDS_ENDPOINT': 'https://rds.cn-shanghai.aliyuncs.com/',
                'RAM_ENDPOINT': 'https://ram.aliyuncs.com/',
            }), patch.object(adapter.urllib.request, 'urlopen', return_value=io.BytesIO(b'{"RequestId":"fixture"}')) as opened:
                self.assertEqual(adapter.rpc(service, action, {'RegionId': 'cn-shanghai'}, creds), {'RequestId': 'fixture'})
                request = opened.call_args.args[0]
                self.assertEqual(request.full_url, 'https://' + host + '/')
                self.assertEqual(request.host, host)
                self.assertEqual(request.get_method(), 'POST')
                self.assertEqual(opened.call_args.kwargs, {'timeout': 30})
                query = dict(urllib.parse.parse_qsl(request.data.decode()))
                signature = query.pop('Signature')
                self.assertEqual(query['Action'], action)
                self.assertEqual(query['Version'], version)
                self.assertEqual(query['SecurityToken'], 'fixture-token')
                # Aliyun RPC v1 signs method/path/query, not a separate Host.
                # The request URL/Host above must be the same TLS destination.
                encode = lambda value: urllib.parse.quote(str(value), safe='~')
                canonical = '&'.join(encode(k)+'='+encode(v) for k, v in sorted(query.items()))
                expected = base64.b64encode(hmac.new(b'fixture-secret&', ('POST&%2F&'+encode(canonical)).encode(), hashlib.sha1).digest()).decode()
                self.assertEqual(signature, expected)

    def test_arbitrary_service_and_disallowed_action_never_reach_network(self):
        for service, action in (('https://untrusted.invalid', 'GetRole'), ('rds', 'CreateDBInstance'), ('ram', 'CreateAccessKey')):
            with self.subTest(service=service, action=action), patch.object(adapter.urllib.request, 'urlopen') as opened:
                with self.assertRaisesRegex(ValueError, '^RPC_ACTION$'):
                    adapter.rpc(service, action, {}, {})
                opened.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
