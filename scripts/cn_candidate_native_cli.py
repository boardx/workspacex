"""Pinned native Alibaba CLI bridge. Never reads or exports credential files.

The parent CLI owns authentication. No generic command forwarding is exposed.
The version cache is read, never refreshed: an expired cache blocks execution.
"""
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import time

import cn_image_archive as c

CLI_SHA = 'bece291528f5569d56e9d06ad82b067d12b8b51cd37530e726c5912c2a61ff02'
OSS_SHA = '82337ae313183de61fa84f76fc142e88dbd1c2e65ad6818fc7989ff2b30320fd'
READ_APIS = {'get-bucket-info', 'get-bucket-acl', 'get-bucket-versioning', 'get-bucket-policy', 'head-object'}


def trusted_bytes(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        s = os.fstat(fd)
        c.require(stat.S_ISREG(s.st_mode) and s.st_uid in (0, os.geteuid()) and not s.st_mode & 0o022,
                  'CLI_FILE_TRUST')
        value = f.read(limit + 1)
        c.require(len(value) <= limit, 'CLI_FILE_LIMIT')
        return value


class NativeCli:
    def __init__(self, seconds=1200):
        c.require(type(seconds) is int and 0 < seconds <= 1200, 'CLI_DEADLINE')
        self.deadline = time.monotonic() + seconds
        self.home = Path.home()
        self.cli = self.home / '.local/bin/aliyun'
        self.oss = self.home / '.aliyun/ossutil'
        self.cache = self.home / '.aliyun/.ossutil_version_check'
        self.check()

    def check(self):
        remaining = self.deadline - time.monotonic()
        c.require(remaining > 0, 'CLI_DEADLINE')
        for path, expected in ((self.cli, CLI_SHA), (self.oss, OSS_SHA)):
            c.require(hashlib.sha256(trusted_bytes(path, 256 * 1024 * 1024)).hexdigest() == expected,
                      'CLI_BINARY_HASH')
        raw = trusted_bytes(self.cache, 32)
        c.require(raw.strip().isdigit(), 'CLI_UPDATE_CACHE')
        age = time.time() - int(raw)
        c.require(0 <= age and age + remaining + 30 < 86400, 'CLI_AUTO_UPDATE_FORBIDDEN')

    def _run(self, args, limit=262144, target=None, pass_fds=()):
        self.check()
        # Allowlist environment: exclude credential, config-path, proxy and debug overrides.
        env = {k: os.environ[k] for k in ('HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL') if k in os.environ}
        env['HOME'] = str(self.home)
        process = subprocess.Popen([str(self.cli), *args], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                                   start_new_session=True, pass_fds=pass_fds)
        output = bytearray(); total = 0
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ, 'out')
                selector.register(process.stderr, selectors.EVENT_READ, 'err')
                while selector.get_map():
                    remaining = self.deadline - time.monotonic()
                    c.require(remaining > 0, 'CLI_DEADLINE')
                    for key, _ in selector.select(min(remaining, 0.2)):
                        raw = os.read(key.fileobj.fileno(), 65536)
                        if not raw:
                            selector.unregister(key.fileobj); continue
                        if key.data == 'err':
                            # Discard raw diagnostics; never expose credentials or user content.
                            continue
                        total += len(raw)
                        c.require(total <= limit, 'CLI_OUTPUT_LIMIT')
                        if target is None: output.extend(raw)
                        else: target.write(raw)
            code = process.wait(timeout=max(.001, self.deadline-time.monotonic()))
            if code != 0:
                # Do not infer absence from arbitrary free-text diagnostics.
                raise c.Rejected('CLI_COMMAND_FAILED')
            self.check()
            return bytes(output)
        except BaseException:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait()
            raise
        finally:
            process.stdout.close(); process.stderr.close()

    def identity(self):
        return json.loads(self._run(['sts', 'GetCallerIdentity', '--region', 'cn-shanghai']))

    def api(self, operation, bucket, key=None):
        c.require(operation in READ_APIS, 'CLI_API_NOT_ALLOWED')
        return json.loads(self._run(self._args(['api', operation, '--bucket', bucket] +
                                              (['--key', key] if key is not None else []) +
                                              ['--output-format', 'json'])))

    @staticmethod
    def _args(args):
        return ['ossutil', *args, '--endpoint', 'https://oss-cn-shanghai.aliyuncs.com',
                '--region', 'cn-shanghai', '--retry-times', '0', '--connect-timeout', '10',
                '--read-timeout', '10', '--loglevel', 'off', '--language', 'EN']


def schema(value):
    """Return structure only: never arbitrary remote values or policy text."""
    if isinstance(value, dict): return {k: schema(v) for k, v in value.items()}
    if isinstance(value, list): return [schema(value[0])] if value else []
    return type(value).__name__


def probe(bucket):
    c.require(isinstance(bucket, str) and c.re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', bucket),
              'BUCKET_INVALID')
    cli = NativeCli(120)
    identity = cli.identity()
    result = {'kind': 'cn-native-cli-readonly-probe-v1', 'cloudWrite': False,
              'cliSha256': CLI_SHA, 'ossutilSha256': OSS_SHA,
              'identity': {k: identity.get(k) for k in ('AccountId', 'Arn', 'IdentityType')},
              'responses': {}}
    for op in sorted(READ_APIS - {'head-object'}):
        try: result['responses'][op] = schema(cli.api(op, bucket))
        except Exception: result['responses'][op] = {'error': 'CLI_READ_FAILED'}
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Read-only native authentication/schema probe')
    parser.add_argument('--probe-bucket', required=True)
    parser.add_argument('--probe-raw-schema', action='store_true')
    args = parser.parse_args()
    try:
        if args.probe_raw_schema:
            cli = NativeCli(60)
            raw = cli._run(cli._args(['api', 'get-bucket-info', '--bucket', args.probe_bucket, '--output-format', 'raw']))
            text = raw.decode('utf-8')
            import re
            print(json.dumps({'kind': 'cn-native-raw-schema-probe', 'cloudWrite': False, 'bytes': len(raw), 'xml': text.lstrip().startswith('<'), 'json': text.lstrip().startswith('{'), 'httpStatusLine': bool(re.search(r'^HTTP/[0-9.]+ [0-9]{3}', text, re.M)), 'dateHeaders': re.findall(r'^Date: ([A-Za-z0-9,: +\-]+)$', text, re.M)}, sort_keys=True))
        else:
            print(json.dumps(probe(args.probe_bucket), sort_keys=True))
    except Exception:
        print('{"error":"NATIVE_PROBE_FAILED","cloudWrite":false}')
        raise SystemExit(1) from None
