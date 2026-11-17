"""API image defaults follow admitted release flavor, without runtime/config writes."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'a' * 40
PRIVATE = 'DUMMY_PRIVATE_API_ENV_NEVER_EMIT'
AUTO, MISSING = object(), object()


def module():
    spec = importlib.util.spec_from_file_location('api_flavor_registry', ROOT / 'scripts/registry-images.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class ApiFlavor(unittest.TestCase):
    def execute(self, enabled='1', environment=AUTO, extra=None, tag=None):
        m = module()
        tag = m.release_tag(SOURCE, '123', '1', enabled == '1') if tag is None else tag
        calls, image_env = [], []

        def cli(args, **kwargs):
            calls.append((args, kwargs))
            status, out, error = 0, '', ''
            if args == ['git', 'rev-parse', 'HEAD']:
                out = SOURCE
            elif args[:3] == ['docker', 'manifest', 'inspect']:
                status, error = 1, 'manifest unknown'
            elif args[:3] == ['docker', 'buildx', 'build']:
                image_env[:] = [item for item in args if item.partition('=')[0] in m.API_AIDT_FLAGS]
                Path(args[args.index('--metadata-file') + 1]).write_text(json.dumps({
                    'containerimage.config.digest': 'sha256:' + 'c' * 64,
                    'containerimage.digest': 'sha256:' + 'd' * 64}))
            elif args[:2] == ['docker', 'pull']:
                pass
            elif args[:3] == ['docker', 'image', 'inspect']:
                config = {'Labels': {'org.opencontainers.image.revision': SOURCE,
                                     'io.boardx.workspacex.release-tag': tag}}
                if environment is not MISSING:
                    config['Env'] = image_env + ['OTHER=' + PRIVATE] if environment is AUTO else environment
                out = json.dumps([{'Os': 'linux', 'Architecture': 'amd64', 'Id': 'sha256:' + 'c' * 64,
                                   'RepoDigests': ['registry.example/team/api@sha256:' + 'd' * 64], 'Config': config}])
            else:
                raise AssertionError('unexpected command')
            return subprocess.CompletedProcess(args, status, out, error)

        env = {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'AIDT_RELEASE_ENABLED': enabled,
               'TARGET_ENVIRONMENT': 'devapp', 'NODE_IMAGE': 'example/node@sha256:' + 'b' * 64,
               **(extra or {})}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'result.json'
            stdout, stderr = io.StringIO(), io.StringIO()
            error = None
            with patch.dict(os.environ, env, clear=True), patch.object(m.subprocess, 'run', side_effect=cli), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                try:
                    m.build('api', 'registry.example/team', tag, str(output), SOURCE)
                except Exception as caught:
                    error = caught
            result = json.loads(output.read_text()) if output.exists() else None
            self.assertNotIn(PRIVATE, stdout.getvalue() + stderr.getvalue() + json.dumps(result))
        return m, calls, result, error

    def test_admitted_api_cli_defaults_are_verified_before_unchanged_receipt(self):
        for enabled in ('0', '1'):
            m, calls, result, error = self.execute(enabled)
            self.assertIsNone(error)
            self.assertEqual(set(result), {'service', 'sourceRevision', 'tag', 'image', 'imageId'})
            self.assertEqual(result['sourceRevision'], SOURCE)
            exports = [args for args, _ in calls if args[:3] == ['docker', 'buildx', 'build']]
            self.assertEqual(len(exports), 1)
            for name in m.API_AIDT_FLAGS:
                self.assertEqual([arg for arg in exports[0] if arg.startswith(name + '=')], [name + '=' + enabled])
            self.assertFalse(any(arg.startswith('NEXT_PUBLIC_ENABLE_') for arg in exports[0]))
            self.assertFalse(any(args[:2] == ['docker', 'push'] for args, _ in calls))

    def test_ordinary_build_ignores_host_runtime_flag_values_and_accepts_legacy_missing(self):
        m, calls, _, error = self.execute('0', extra={'ENABLE_AIDT_MODULE': '1', 'ENABLE_PROJECT_MEMBER_CHAT': '1'})
        self.assertIsNone(error)
        args = next(args for args, _ in calls if args[:3] == ['docker', 'buildx', 'build'])
        self.assertTrue(all(name + '=0' in args and name + '=1' not in args for name in m.API_AIDT_FLAGS))
        for environment in (MISSING, None, [], ['ENABLE_AIDT_MODULE=0'], ['ENABLE_PROJECT_MEMBER_CHAT=0']):
            _, _, result, error = self.execute('0', environment=environment)
            self.assertIsNone(error)
            self.assertIsNotNone(result)

    def test_enabled_requires_both_single_exact_one_and_never_writes_on_bad_image_env(self):
        valid = ['ENABLE_AIDT_MODULE=1', 'ENABLE_PROJECT_MEMBER_CHAT=1']
        for environment in (MISSING, None, [], valid[:1], valid[1:],
                            ['ENABLE_AIDT_MODULE=0', valid[1]], [valid[0], 'ENABLE_PROJECT_MEMBER_CHAT=0'],
                            ['ENABLE_AIDT_MODULE=true', valid[1]], valid + [valid[0]],
                            valid + ['ENABLE_AIDT_MODULE=0'], 'PRIVATE=' + PRIVATE, [{'private': PRIVATE}]):
            _, _, result, error = self.execute('1', environment=environment)
            self.assertIsNone(result)
            self.assertEqual(str(error), 'API_IMAGE_FLAGS_MISMATCH')

    def test_ordinary_rejects_enabled_duplicate_invalid_or_malformed_image_flags(self):
        for environment in (['ENABLE_AIDT_MODULE=1'], ['ENABLE_PROJECT_MEMBER_CHAT=true'],
                            ['ENABLE_AIDT_MODULE=0', 'ENABLE_AIDT_MODULE=0'], ['ENABLE_AIDT_MODULE'],
                            ['ENABLE_AIDT_MODULE=' + PRIVATE], {'private': PRIVATE}, [False]):
            _, _, result, error = self.execute('0', environment=environment)
            self.assertIsNone(result)
            self.assertEqual(str(error), 'API_IMAGE_FLAGS_MISMATCH')

    def test_wrong_target_flavor_tag_or_public_flag_never_reaches_docker(self):
        marked = module().release_tag(SOURCE, '123', '1', True)
        for enabled, extra, tag, code in (('1', {'TARGET_ENVIRONMENT': 'cn'}, marked, 'AIDT_REQUIRES_DEVAPP'),
                                         ('1', {'TARGET_ENVIRONMENT': 'us'}, marked, 'AIDT_REQUIRES_DEVAPP'),
                                         ('1', {}, '123-1', 'AIDT_TAG_FLAVOR_MISMATCH'),
                                         ('0', {}, marked, 'AIDT_TAG_FLAVOR_MISMATCH'),
                                         ('1', {'NEXT_PUBLIC_ENABLE_AIDT': '1', 'NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT': '1'}, marked, 'AIDT_WEB_BUILD_ONLY')):
            _, calls, result, error = self.execute(enabled, extra=extra, tag=tag)
            self.assertEqual(str(error), code)
            self.assertIsNone(result)
            self.assertEqual(calls, [])

    def test_legacy_resolve_without_expected_flags_keeps_existing_behavior(self):
        m = module()
        row = {'Os': 'linux', 'Architecture': 'amd64', 'Id': 'sha256:' + 'c' * 64,
               'RepoDigests': ['registry.example/team/api@sha256:' + 'd' * 64],
               'Config': {'Env': ['ENABLE_AIDT_MODULE=' + PRIVATE], 'Labels': {
                   'org.opencontainers.image.revision': SOURCE, 'io.boardx.workspacex.release-tag': '123-1'}}}
        with patch.object(m, 'run', return_value=json.dumps([row])):
            observed = m.resolve('docker', 'registry.example/team', '123-1', 'api', pull=False)
        self.assertEqual(observed['imageId'], row['Id'])
        self.assertNotIn(PRIVATE, json.dumps(observed))

    def test_dockerfile_runtime_defaults_and_actual_boolean_validation_shell(self):
        body = (ROOT / 'deploy/aliyun/images/api.Dockerfile').read_text().split('FROM sources AS runtime\n', 1)[1]
        for name in module().API_AIDT_FLAGS:
            self.assertIn('ARG ' + name + '=0', body)
            self.assertIn(name + '=${' + name + '}', body)
        start = body.index('RUN case ')
        end = body.index('\nENV ENABLE_AIDT_MODULE=', start)
        guard = body[start + 4:end].replace('\\\n', '')
        for first in ('0', '1'):
            for second in ('0', '1'):
                result = subprocess.run(['/bin/sh', '-c', guard], env={'ENABLE_AIDT_MODULE': first, 'ENABLE_PROJECT_MEMBER_CHAT': second}, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0)
        for name in module().API_AIDT_FLAGS:
            for invalid in ('', 'true', 'false', '2', PRIVATE):
                values = {flag: '0' for flag in module().API_AIDT_FLAGS}
                result = subprocess.run(['/bin/sh', '-c', guard], env={**values, name: invalid}, capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(PRIVATE, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
