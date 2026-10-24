import urllib.request
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('consumer', ROOT/'scripts/deploy-registry-images.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class Response:
    def __init__(self, value): self.value = value
    def read(self, *args): return self.value

class EcsAuthentication(unittest.TestCase):
    def setUp(self):
        self.policy = {'region':'cn-shanghai','instanceId':'cri-test123','roleName':'PullOnlyRole','ecsInstanceId':'i-devapp123'}
        self.host = 'example-registry.cn-shanghai.cr.aliyuncs.com'
        self.calls = []
    def opener(self, request, timeout):
        self.calls.append(request)
        url = request.full_url
        if url.endswith('/api/token'): return Response(b'imds-token')
        if url.endswith('/instance-id'): return Response(b'i-devapp123')
        if 'security-credentials' in url:
            return Response(json.dumps({'Code':'Success','AccessKeyId':'test-ak','AccessKeySecret':'test-secret','SecurityToken':'test-sts'}).encode())
        return Response(json.dumps({'IsSuccess':True,'TempUsername':'temp-user','AuthorizationToken':'private-password','ExpireTime':self.expiry}).encode())
    def login(self, argv, **kwargs):
        self.assertNotIn('private-password', ' '.join(argv))
        self.assertEqual(kwargs['input'], 'private-password')
        self.directory = Path(argv[2])
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        (self.directory/'config.json').write_text('{}')
        return subprocess.CompletedProcess(argv, 0, '', '')
    def test_fresh_imdsv2_login_is_private_and_removed_on_failure(self):
        self.expiry = int((time.time()+3600)*1000)
        with patch.object(urllib.request, 'build_opener') as builder, patch.object(m.subprocess,'run',side_effect=self.login):
            builder.return_value.open.side_effect = self.opener
            with self.assertRaisesRegex(RuntimeError, 'deployment failure'):
                with m.ecs_docker_config(self.policy, '/usr/bin/docker', self.host) as directory:
                    self.assertEqual(Path(directory), self.directory)
                    raise RuntimeError('deployment failure')
        self.assertFalse(self.directory.exists())
        self.assertEqual(self.calls[0].method, 'PUT')
        self.assertTrue(all(r.get_header('X-aliyun-ecs-metadata-token')=='imds-token' for r in self.calls[1:-1]))
        self.assertEqual(self.calls[-1].full_url, 'https://cr.cn-shanghai.aliyuncs.com/')
        self.assertIn(b'Signature=', self.calls[-1].data)
    def test_expiring_token_never_logs_in(self):
        self.expiry = int((time.time()+100)*1000)
        with patch.object(urllib.request,'build_opener') as builder, patch.object(m.subprocess,'run') as login:
            builder.return_value.open.side_effect = self.opener
            with self.assertRaisesRegex(ValueError, 'ECS_ACR_AUTH_FAILED'):
                with m.ecs_docker_config(self.policy, '/usr/bin/docker', self.host): pass
            login.assert_not_called()
    def test_foreign_registry_is_rejected_before_metadata_access(self):
        with patch.object(urllib.request,'build_opener') as builder:
            with self.assertRaisesRegex(ValueError, 'ECS_ACR_REGISTRY_MISMATCH'):
                with m.ecs_docker_config(self.policy, '/usr/bin/docker', 'attacker.example'): pass
            builder.assert_not_called()
    def test_wrong_ecs_instance_never_uses_registry_credentials(self):
        self.policy['ecsInstanceId'] = 'i-other123'
        self.expiry = int((time.time()+3600)*1000)
        with patch.object(urllib.request,'build_opener') as builder, patch.object(m.subprocess,'run') as login:
            builder.return_value.open.side_effect = self.opener
            with self.assertRaisesRegex(ValueError, '^ECS_ACR_AUTH_FAILED$'):
                with m.ecs_docker_config(self.policy, '/usr/bin/docker', self.host): pass
            login.assert_not_called()
        self.assertEqual(len(self.calls), 2)
    def test_login_failure_is_redacted_and_removes_private_directory(self):
        self.expiry = int((time.time()+3600)*1000)
        def failed_login(argv, **kwargs):
            self.directory = Path(argv[2])
            return subprocess.CompletedProcess(argv, 1, '', 'private-password')
        with patch.object(urllib.request,'build_opener') as builder, patch.object(m.subprocess,'run',side_effect=failed_login):
            builder.return_value.open.side_effect = self.opener
            with self.assertRaisesRegex(ValueError, '^ECS_ACR_LOGIN_FAILED$'):
                with m.ecs_docker_config(self.policy, '/usr/bin/docker', self.host): pass
        self.assertFalse(self.directory.exists())
    def test_redirect_cannot_forward_metadata_or_signed_credentials(self):
        with self.assertRaisesRegex(ValueError, '^ECS_ACR_AUTH_FAILED$'):
            m.NoAuthRedirect().redirect_request(None, None, 302, 'redirect', {}, 'https://attacker.example')
    def test_credentials_are_not_in_error(self):
        with patch.object(urllib.request,'build_opener') as builder:
            builder.return_value.open.side_effect = RuntimeError('private-password')
            with self.assertRaisesRegex(ValueError, '^ECS_ACR_AUTH_FAILED$'):
                with m.ecs_docker_config(self.policy, '/usr/bin/docker', self.host): pass

if __name__=='__main__': unittest.main()
