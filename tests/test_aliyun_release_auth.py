import base64
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import time
import types
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('auth', pathlib.Path(__file__).resolve().parents[1] / 'scripts/aliyun-release-auth.py')
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)


def config(edition='enterprise'):
    return dict(ACR_EDITION=edition, ACR_REGION='cn-hongkong', ACR_REGISTRY=('registry.cn-hongkong.aliyuncs.com' if edition=='personal' else 'reviewed.cn-hongkong.cr.aliyuncs.com'), ACR_REGISTRY_PREFIX=('registry.cn-hongkong.aliyuncs.com/workspacex' if edition=='personal' else 'reviewed.cn-hongkong.cr.aliyuncs.com/workspacex'), ACR_INSTANCE_ID='cri-example', ALIYUN_OIDC_AUDIENCE='sts.aliyuncs.com', ALIYUN_OIDC_SUBJECT='repo:owner/repo:environment:production-cn-build', ALIYUN_ROLE_ARN='acs:ram::123:role/release', ALIYUN_OIDC_PROVIDER_ARN='acs:ram::123:oidc-provider/github', ACTIONS_ID_TOKEN_REQUEST_URL='https://pipelines.actions.githubusercontent.com/token?audience=wrong', ACTIONS_ID_TOKEN_REQUEST_TOKEN='request-secret', ALIBABA_CLOUD_ACCESS_KEY_ID='mock-id', ALIBABA_CLOUD_ACCESS_KEY_SECRET='mock-secret', ALIBABA_CLOUD_SECURITY_TOKEN='mock-session')


def token(**changes):
    claims = dict(iss=auth.ISSUER, aud='sts.aliyuncs.com', sub=config()['ALIYUN_OIDC_SUBJECT'], exp=200, nbf=10)
    claims.update(changes)
    return 'header.' + base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=') + '.signature'


class AuthTests(unittest.TestCase):
    def test_required_configuration(self):
        for key in ('ACR_EDITION', 'ACR_REGION', 'ACR_REGISTRY', 'ACR_INSTANCE_ID'):
            env=config(); env.pop(key)
            with self.subTest(key=key), self.assertRaises(auth.AuthError): auth.validate_config(env)

    def test_region_host_edition_rejected(self):
        for key,value in [('ACR_REGION','cn-shanghai'),('ACR_REGISTRY','evil.example'),('ACR_REGISTRY','https://reviewed.cn-hongkong.cr.aliyuncs.com'),('ACR_EDITION','guess'),('ACR_INSTANCE_ID','wrong')]:
            env=config(); env[key]=value
            with self.subTest(key=key), self.assertRaises(auth.AuthError): auth.validate_config(env)

    def test_exact_claims(self):
        auth.validate_claims(token(), config(), now=100)
        for changes in [dict(sub='repo:owner/repo:ref:refs/heads/main'),dict(aud='other'),dict(iss='evil'),dict(exp=100),dict(nbf=101),dict(exp='200')]:
            with self.subTest(changes=changes), self.assertRaises(auth.AuthError): auth.validate_claims(token(**changes),config(),now=100)

    def test_immutable_subject_supported(self):
        env=config(); env['ALIYUN_OIDC_SUBJECT']='repo:owner/repo:repository_id:123:environment:production-cn-build'
        auth.validate_claims(token(sub=env['ALIYUN_OIDC_SUBJECT']),env,now=100)

    def test_request_endpoint_rejected_without_request(self):
        opener=Mock(); env=config(); env['ACTIONS_ID_TOKEN_REQUEST_URL']='https://evil.example/token'
        with self.assertRaises(auth.AuthError): auth.verify_oidc(env,opener)
        opener.assert_not_called()

    def test_request_failure_redacted(self):
        opener=Mock(side_effect=RuntimeError('secret-token'))
        with self.assertRaisesRegex(auth.AuthError,'^OIDC_REQUEST_FAILED$'): auth.verify_oidc(config(),opener)

    def test_role_provider_required(self):
        for key in ('ALIYUN_ROLE_ARN','ALIYUN_OIDC_PROVIDER_ARN'):
            env=config(); env[key]='wrong'; opener=Mock()
            with self.subTest(key=key), self.assertRaises(auth.AuthError): auth.verify_oidc(env,opener)
            opener.assert_not_called()

    def test_personal_never_calls_api(self):
        env=config('personal'); env.update(ACR_USERNAME='personal-user',ACR_PASSWORD='personal%password')
        runner=Mock()
        with tempfile.TemporaryDirectory() as directory:
            env['GITHUB_ENV']=directory+'/env'; env['RUNNER_TEMP']=directory; out=io.StringIO()
            with contextlib.redirect_stdout(out): auth.export_acr(env,runner)
            self.assertEqual(pathlib.Path(env['GITHUB_ENV']).read_text(),'ACR_USERNAME=personal-user\nACR_TOKEN=personal%password\n')
            self.assertIn('::add-mask::personal%25password',out.getvalue())
        runner.assert_not_called()

    def test_enterprise_sts_required(self):
        env=config(); env['GITHUB_ENV']='/tmp/unused'; env['RUNNER_TEMP']='/tmp'; env.pop('ALIBABA_CLOUD_SECURITY_TOKEN'); runner=Mock()
        with self.assertRaises(auth.AuthError): auth.export_acr(env,runner)
        runner.assert_not_called()

    def test_enterprise_export(self):
        runner=Mock(return_value=types.SimpleNamespace(returncode=0,stdout=json.dumps(dict(TempUsername='temporary-user',AuthorizationToken='temporary-token',ExpireTime=(time.time()+300)*1000))))
        with tempfile.TemporaryDirectory() as directory:
            env=config(); env['GITHUB_ENV']=directory+'/env'; env['RUNNER_TEMP']=directory
            with contextlib.redirect_stdout(io.StringIO()): auth.export_acr(env,runner)
            self.assertIn('ACR_TOKEN=temporary-token',pathlib.Path(env['GITHUB_ENV']).read_text())
        self.assertEqual(runner.call_args.args[0],['aliyun','cr','GetAuthorizationToken','--RegionId','cn-hongkong','--InstanceId','cri-example'])

    def test_enterprise_failure_and_expiry_redacted(self):
        for result in [types.SimpleNamespace(returncode=1,stdout='secret',stderr='secret'),types.SimpleNamespace(returncode=0,stdout='secret'),types.SimpleNamespace(returncode=0,stdout=json.dumps(dict(TempUsername='u',AuthorizationToken='secret',ExpireTime=1)))]:
            env=config(); env['GITHUB_ENV']='/tmp/unused'; env['RUNNER_TEMP']='/tmp'
            with self.subTest(result=result),self.assertRaisesRegex(auth.AuthError,'^ACR_TOKEN_REQUEST_FAILED$'): auth.export_acr(env,Mock(return_value=result))

    def test_edition_specific_hosts(self):
        for edition, host, accepted in [('personal','registry.cn-hongkong.aliyuncs.com',True),('personal','crpi-reviewed.cn-hongkong.personal.cr.aliyuncs.com',True),('personal','reviewed.cn-hongkong.cr.aliyuncs.com',False),('enterprise','registry.cn-hongkong.aliyuncs.com',False),('enterprise','crpi-reviewed.cn-hongkong.personal.cr.aliyuncs.com',False),('enterprise','evil.nested.cn-hongkong.cr.aliyuncs.com',False),('personal','registry.cn-shanghai.aliyuncs.com',False)]:
            env=config(edition); env['ACR_REGISTRY']=host; env['ACR_REGISTRY_PREFIX']=host+'/workspacex'
            with self.subTest(edition=edition,host=host):
                if accepted: auth.validate_config(env)
                else:
                    with self.assertRaises(auth.AuthError): auth.validate_config(env)

    def test_registry_prefix_mismatch(self):
        env=config(); env['ACR_REGISTRY_PREFIX']='evil.cn-hongkong.cr.aliyuncs.com/workspacex'
        with self.assertRaisesRegex(auth.AuthError, 'ACR_REGISTRY_PREFIX_MISMATCH'): auth.validate_config(env)

    def test_redirects_rejected(self):
        with self.assertRaisesRegex(auth.AuthError, 'OIDC_REDIRECT_REJECTED'):
            auth.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://evil.example')

    def test_environment_path_rejected(self):
        env=config('personal'); env.update(ACR_USERNAME='u',ACR_PASSWORD='p',GITHUB_ENV='/outside/env',RUNNER_TEMP='/tmp')
        with self.assertRaisesRegex(auth.AuthError,'GITHUB_ENV_PATH_REJECTED'): auth.export_acr(env,Mock())

    def test_newline_injection_rejected_before_output(self):
        env=config('personal'); env.update(ACR_USERNAME='user',ACR_PASSWORD='secret\n::warning::injected',GITHUB_ENV='/tmp/unused',RUNNER_TEMP='/tmp')
        out=io.StringIO()
        with contextlib.redirect_stdout(out), self.assertRaises(auth.AuthError): auth.export_acr(env,Mock())
        self.assertEqual(out.getvalue(),'')


if __name__ == '__main__': unittest.main()
