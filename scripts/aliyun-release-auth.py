#!/usr/bin/env python3
"""Fail-closed release authentication; credential values never become artifacts."""
import argparse
import base64
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ISSUER = 'https://token.actions.githubusercontent.com'


class AuthError(Exception):
    pass


def required(env, name):
    value = env.get(name, '')
    if not value or any(c in value for c in '\r\n\x00'):
        raise AuthError('INVALID_OR_MISSING_' + name)
    return value


def validate_config(env):
    edition = required(env, 'ACR_EDITION')
    if edition not in ('personal', 'enterprise'):
        raise AuthError('INVALID_ACR_EDITION')
    if required(env, 'ACR_REGION') != 'cn-hongkong':
        raise AuthError('INVALID_ACR_REGION')
    host = required(env, 'ACR_REGISTRY')
    # Alibaba-owned Hong Kong hostname only: never send credentials to arbitrary targets.
    valid_host = (host == 'registry.cn-hongkong.aliyuncs.com' or re.fullmatch(r'crpi-[a-z0-9]+\.cn-hongkong\.personal\.cr\.aliyuncs\.com', host)) if edition == 'personal' else re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*\.cn-hongkong\.cr\.aliyuncs\.com', host)
    if not valid_host:
        raise AuthError('INVALID_ACR_REGISTRY')
    prefix = required(env, 'ACR_REGISTRY_PREFIX')
    if not re.fullmatch(re.escape(host) + r'/[a-z0-9]+(?:[._-][a-z0-9]+)*', prefix):
        raise AuthError('ACR_REGISTRY_PREFIX_MISMATCH')
    if edition == 'enterprise' and not re.fullmatch(r'cri-[a-zA-Z0-9]+', required(env, 'ACR_INSTANCE_ID')):
        raise AuthError('INVALID_ACR_INSTANCE_ID')
    return edition


def validate_claims(token, env, now=None):
    # This is an additional claim gate, not signature authentication; Alibaba STS
    # remains the cryptographic verifier through the official credentials action.
    try:
        parts = token.split('.')
        if len(parts) != 3:
            raise ValueError()
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
        audience = required(env, 'ALIYUN_OIDC_AUDIENCE')
        subject = required(env, 'ALIYUN_OIDC_SUBJECT')
        clock = time.time() if now is None else now
        if audience != 'sts.aliyuncs.com' or claims.get('iss') != ISSUER:
            raise ValueError()
        if claims.get('aud') != audience or claims.get('sub') != subject:
            raise ValueError()
        if not isinstance(claims.get('exp'), (int, float)) or claims['exp'] <= clock:
            raise ValueError()
        if not isinstance(claims.get('nbf'), (int, float)) or claims['nbf'] > clock:
            raise ValueError()
    except AuthError:
        raise
    except Exception:
        raise AuthError('OIDC_CLAIMS_REJECTED') from None


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AuthError('OIDC_REDIRECT_REJECTED')


def verify_oidc(env, opener=None):
    if opener is None:
        opener = urllib.request.build_opener(NoRedirect()).open
    required(env, 'ALIYUN_OIDC_SUBJECT')
    for name, kind in (('ALIYUN_ROLE_ARN', 'role'), ('ALIYUN_OIDC_PROVIDER_ARN', 'oidc-provider')):
        if not re.fullmatch(r'acs:ram::[0-9]+:' + kind + r'/[A-Za-z0-9._/-]+', required(env, name)):
            raise AuthError('INVALID_' + name)
    audience = required(env, 'ALIYUN_OIDC_AUDIENCE')
    url = required(env, 'ACTIONS_ID_TOKEN_REQUEST_URL')
    parsed = urllib.parse.urlsplit(url)
    try:
        safe_endpoint = parsed.scheme == 'https' and parsed.hostname == 'pipelines.actions.githubusercontent.com' and not parsed.username and not parsed.password and parsed.port in (None, 443)
    except ValueError:
        safe_endpoint = False
    if not safe_endpoint:
        raise AuthError('OIDC_REQUEST_ENDPOINT_REJECTED')
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = [(k, v) for k, v in query if k != 'audience'] + [('audience', audience)]
    url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + required(env, 'ACTIONS_ID_TOKEN_REQUEST_TOKEN')})
    try:
        with opener(req, timeout=30) as response:
            payload = response.read(262145)
        if len(payload) > 262144:
            raise ValueError()
        token = json.loads(payload)['value']
    except Exception:
        raise AuthError('OIDC_REQUEST_FAILED') from None
    validate_claims(token, env)


def export_acr(env, runner=subprocess.run):
    edition = validate_config(env)
    destination = required(env, 'GITHUB_ENV')
    temporary = pathlib.Path(required(env, 'RUNNER_TEMP')).resolve()
    target = pathlib.Path(destination)
    if not target.is_absolute() or target.is_symlink() or not target.resolve().is_relative_to(temporary):
        raise AuthError('GITHUB_ENV_PATH_REJECTED')
    if edition == 'personal':
        username, password = required(env, 'ACR_USERNAME'), required(env, 'ACR_PASSWORD')
    else:
        for key in ('ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN'):
            required(env, key)
        try:
            result = runner(['aliyun', 'cr', 'GetAuthorizationToken', '--RegionId', 'cn-hongkong', '--InstanceId', env['ACR_INSTANCE_ID']], capture_output=True, text=True, timeout=60, check=False)
            if result.returncode:
                raise ValueError()
            payload = json.loads(result.stdout)
            if not isinstance(payload.get('ExpireTime'), (int, float)) or payload['ExpireTime'] <= time.time() * 1000 + 60000:
                raise ValueError()
            username = required(payload, 'TempUsername')
            password = required(payload, 'AuthorizationToken')
        except Exception:
            raise AuthError('ACR_TOKEN_REQUEST_FAILED') from None
    # Reject control characters before emitting workflow commands / environment file.
    for value in (username, password):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise AuthError('CREDENTIAL_FORMAT_REJECTED')
    for value in (username, password):
        print('::add-mask::' + value.replace('%', '%25'))
    try:
        with open(destination, 'a', encoding='utf-8') as handle:
            handle.write('ACR_USERNAME=' + username + '\nACR_TOKEN=' + password + '\n')
    except OSError:
        raise AuthError('GITHUB_ENV_WRITE_FAILED') from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['validate-config', 'verify-oidc', 'export-acr'])
    args = parser.parse_args()
    try:
        if args.command == 'validate-config':
            validate_config(os.environ)
        elif args.command == 'verify-oidc':
            verify_oidc(os.environ)
        else:
            export_acr(os.environ)
    except AuthError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
