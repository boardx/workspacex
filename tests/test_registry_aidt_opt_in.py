"""AIDT release opt-in: real CLI planning and generated Docker commands, no registry I/O."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
FLAGS = ('NEXT_PUBLIC_ENABLE_AIDT', 'NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT')
SOURCE = 'b' * 40


def module():
    spec = importlib.util.spec_from_file_location('aidt_registry', ROOT / 'scripts/registry-images.py')
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


class AidtRelease(unittest.TestCase):
    def plan(self, extra):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'output'
            env = {'PATH': os.defpath, 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                   'GITHUB_REF_TYPE': 'branch', 'GITHUB_REF_NAME': 'develop',
                   'TARGET_ENVIRONMENT': 'auto', 'GITHUB_RUN_ID': '123',
                   'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_OUTPUT': str(output), **extra}
            result = subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/registry-images.py'),
                                     'plan', '--source', SOURCE], env=env, capture_output=True, text=True)
            values = dict(line.split('=', 1) for line in output.read_text().splitlines()) if output.exists() else {}
            return result, values

    def test_defaults_off_and_devapp_explicit_opt_in(self):
        for target in ('devapp', 'cn', 'us'):
            result, values = self.plan({'TARGET_ENVIRONMENT': target})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(values['aidt_web_enabled'], '0')
        for branch, target in (('develop', 'auto'), ('feature/aidt', 'devapp'), ('main', 'devapp')):
            result, values = self.plan({'ENABLE_AIDT': 'true', 'GITHUB_REF_NAME': branch,
                                        'TARGET_ENVIRONMENT': target})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(values['aidt_web_enabled'], '1')
            self.assertEqual(values['target'], 'devapp')
            self.assertEqual(values['tag'], '123-' + module().AIDT_ATTEMPT_PREFIX + '1')

    def test_reserved_tags_cannot_promote_to_production_with_opt_in_off(self):
        m = module()
        for tag in ('123-' + m.AIDT_ATTEMPT_PREFIX + '1', SOURCE + '-123-' + m.AIDT_ATTEMPT_PREFIX + '1'):
            for target in ('cn', 'us'):
                for value in ('false', 'true'):
                    for build_only in ('false', 'true'):
                        result, values = self.plan({'EXISTING_TAG': tag, 'TARGET_ENVIRONMENT': target,
                                                    'ENABLE_AIDT': value, 'BUILD_ONLY': build_only})
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('AIDT_TAG_REQUIRES_DEVAPP', result.stderr)
                        self.assertEqual(values, {})
            result, values = self.plan({'EXISTING_TAG': tag, 'ENABLE_AIDT': 'false'})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(values['tag'], tag)
            self.assertEqual(values['build'], 'false')
        # The namespace belongs to the final attempt component, never the run ID.
        for target in ('cn', 'us'):
            result, values = self.plan({'EXISTING_TAG': m.AIDT_ATTEMPT_PREFIX + '1-2', 'TARGET_ENVIRONMENT': target})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(values['build'], 'false')
        with self.assertRaisesRegex(ValueError, 'RESERVED_AIDT_ATTEMPT'):
            m.release_tag(SOURCE, '123', m.AIDT_ATTEMPT_PREFIX + '1')

    def test_normal_alias_of_marked_image_fails_existing_release_label_binding(self):
        m = module()
        marked = '123-' + m.AIDT_ATTEMPT_PREFIX + '1'
        row = {'Os': 'linux', 'Architecture': 'amd64', 'Id': 'sha256:' + 'c' * 64,
               'RepoDigests': ['registry.example/team/web@sha256:' + 'd' * 64],
               'Config': {'Labels': {'org.opencontainers.image.revision': SOURCE,
                                     'io.boardx.workspacex.release-tag': marked}}}
        with patch.object(m, 'run', return_value=json.dumps([row])):
            with self.assertRaisesRegex(ValueError, 'IMAGE_BUILD_IDENTITY'):
                m.resolve('docker', 'registry.example/team', '123-1', 'web', False)

    def test_rejects_non_devapp_after_target_resolution(self):
        for branch, target in (('develop', 'cn'), ('develop', 'us'), ('main', 'auto'), ('main-us', 'auto')):
            for build_only in ('true', 'false'):
                result, values = self.plan({'ENABLE_AIDT': 'true', 'TARGET_ENVIRONMENT': target,
                                            'GITHUB_REF_NAME': branch, 'BUILD_ONLY': build_only})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('AIDT_REQUIRES_DEVAPP', result.stderr)
                self.assertEqual(values, {})

    def test_invalid_boolean_and_unattested_reuse_reject_before_any_outputs(self):
        for value in ('', '1', '0', 'True', 'FALSE', 'true\n', 'yes', '$(id)'):
            result, values = self.plan({'ENABLE_AIDT': value})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('INVALID_AIDT_BOOLEAN', result.stderr)
            self.assertEqual(values, {})
        for build_only in ('true', 'false'):
            result, values = self.plan({'ENABLE_AIDT': 'true', 'EXISTING_TAG': '123-1', 'BUILD_ONLY': build_only})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('AIDT_REQUIRES_NEW_TAG', result.stderr)
            self.assertEqual(values, {})
        result, values = self.plan({'ENABLE_AIDT': 'false', 'EXISTING_TAG': '123-1'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(values['build'], 'false')

    def test_opt_in_does_not_admit_automatic_events_or_tag_refs(self):
        for extra in ({'GITHUB_EVENT_NAME': 'push'}, {'GITHUB_EVENT_NAME': 'pull_request'},
                      {'GITHUB_EVENT_NAME': 'workflow_call'}, {'GITHUB_REF_TYPE': 'tag'}):
            result, values = self.plan({'ENABLE_AIDT': 'true', **extra})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('RELEASE_EVENT_NOT_ALLOWED', result.stderr)
            self.assertEqual(values, {})

    def test_build_generates_only_web_flags_and_keeps_other_images_default(self):
        m = module()
        for role in m.SERVICES:
            for enabled in ('0', '1'):
                with self.subTest(role=role, enabled=enabled), tempfile.TemporaryDirectory() as temp:
                    repository = 'registry.example/team/' + m.SERVICES[role][0]
                    tag = m.release_tag(SOURCE, '123', '1', enabled == '1')
                    commands = []

                    def execute(args, **kwargs):
                        commands.append(args)
                        stdout, stderr, status = '', '', 0
                        if args == ['git', 'rev-parse', 'HEAD']:
                            stdout = SOURCE
                        elif args[:3] == ['docker', 'manifest', 'inspect']:
                            status, stderr = 1, 'manifest unknown'
                        elif args[:3] == ['docker', 'buildx', 'build']:
                            Path(args[args.index('--metadata-file') + 1]).write_text(json.dumps({
                                'containerimage.config.digest': 'sha256:' + 'c' * 64,
                                'containerimage.digest': 'sha256:' + 'd' * 64,
                            }))
                        elif args[:3] == ['docker', 'image', 'inspect']:
                            stdout = json.dumps([{'Os': 'linux', 'Architecture': 'amd64',
                                'Id': 'sha256:' + 'c' * 64, 'RepoDigests': [repository + '@sha256:' + 'd' * 64],
                                'Config': {'Labels': {'org.opencontainers.image.revision': SOURCE,
                                    'io.boardx.workspacex.release-tag': tag}}}])
                        return subprocess.CompletedProcess(args, status, stdout, stderr)

                    env = {'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
                           'TARGET_ENVIRONMENT': 'devapp', 'AIDT_RELEASE_ENABLED': enabled,
                           **{name: enabled if role == 'web' else '0' for name in FLAGS},
                           **{name: 'example/base@sha256:' + 'a' * 64
                              for name in ('NODE_IMAGE', 'PYTHON_IMAGE', 'PGVECTOR_IMAGE')}}
                    with patch.dict(os.environ, env, clear=True), patch.object(m.subprocess, 'run', side_effect=execute):
                        m.build(role, 'registry.example/team', tag, str(Path(temp) / 'result.json'), SOURCE)
                    builds = [args for args in commands if args[:3] == ['docker', 'buildx', 'build']]
                    self.assertEqual(len(builds), 1)
                    args = builds[0]
                    self.assertIn('--output=type=registry,oci-mediatypes=false', args)
                    self.assertIn('--provenance=false', args)
                    self.assertNotIn('--load', args)
                    self.assertFalse(any(command[:2] == ['docker', 'push'] for command in commands))
                    for name in FLAGS:
                        matches = [arg for arg in args if arg.startswith(name + '=')]
                        self.assertEqual(matches, [name + '=' + enabled] if role == 'web' else [])
                    self.assertFalse(any(arg.startswith(('ENABLE_AIDT_MODULE=', 'ENABLE_PROJECT_MEMBER_CHAT=')) for arg in args))

    def test_invalid_build_flags_fail_before_git_docker_or_output(self):
        m = module()
        cases = [({'NEXT_PUBLIC_ENABLE_AIDT': value}, 'INVALID_AIDT_BUILD_FLAG')
                 for value in ('true', '', '2', '1\n', '$(id)')]
        cases += [({FLAGS[0]: '1', FLAGS[1]: '0'}, 'AIDT_BUILD_FLAGS_MISMATCH')]
        for target in ('cn', 'us', ''):
            cases.append(({**{name: '1' for name in FLAGS}, 'TARGET_ENVIRONMENT': target}, 'AIDT_REQUIRES_DEVAPP'))
        for extra, code in cases:
            with self.subTest(extra=extra), patch.dict(os.environ, extra, clear=True), patch.object(m.subprocess, 'run') as execute:
                with self.assertRaisesRegex(ValueError, code):
                    m.build('web', 'registry.example/team', '123-1', '/never-written', SOURCE)
                execute.assert_not_called()
        with patch.dict(os.environ, {**{name: '1' for name in FLAGS}, 'TARGET_ENVIRONMENT': 'devapp'}, clear=True), patch.object(m.subprocess, 'run') as execute:
            with self.assertRaisesRegex(ValueError, 'AIDT_WEB_BUILD_ONLY'):
                m.build('api', 'registry.example/team', '123-1', '/never-written', SOURCE)
            execute.assert_not_called()
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(m.aidt_web_build_args('web'), [arg for name in FLAGS for arg in ('--build-arg', name + '=0')])

    def test_marked_producer_requires_consistent_release_flags_and_exact_run_attempt(self):
        m = module()
        marked = m.release_tag(SOURCE, '123', '1', True)
        for enabled, tag in (('0', marked), ('1', '123-1')):
            env = {'AIDT_RELEASE_ENABLED': enabled, 'TARGET_ENVIRONMENT': 'devapp',
                   **{name: enabled for name in FLAGS}}
            with patch.dict(os.environ, env, clear=True), patch.object(m.subprocess, 'run') as execute:
                with self.assertRaisesRegex(ValueError, 'AIDT_TAG_FLAVOR_MISMATCH'):
                    m.build('web', 'registry.example/team', tag, '/never-written', SOURCE)
                execute.assert_not_called()
        env = {'AIDT_RELEASE_ENABLED': '1', 'TARGET_ENVIRONMENT': 'devapp',
               'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '2',
               **{name: '1' for name in FLAGS}, 'NODE_IMAGE': 'example/base@sha256:' + 'a' * 64}
        with patch.dict(os.environ, env, clear=True), patch.object(m, 'run', return_value=SOURCE), patch.object(m.subprocess, 'run') as execute:
            with self.assertRaisesRegex(ValueError, 'RERUN_ALL_JOBS_REQUIRED'):
                m.build('web', 'registry.example/team', marked, '/never-written', SOURCE)
            execute.assert_not_called()
        for role in ('api', 'web'):
            with patch.dict(os.environ, {'AIDT_RELEASE_ENABLED': '1', 'TARGET_ENVIRONMENT': 'cn'}, clear=True), patch.object(m.subprocess, 'run') as execute:
                with self.assertRaisesRegex(ValueError, 'AIDT_REQUIRES_DEVAPP'):
                    m.build(role, 'registry.example/team', marked, '/never-written', SOURCE)
                execute.assert_not_called()

    def test_workflow_and_dockerfile_preserve_default_off_handoff(self):
        workflow = (ROOT / '.github/workflows/image-release.yml').read_text()
        self.assertEqual(workflow.count('      enable_aidt:\n'), 2)
        self.assertEqual(workflow.count('        type: boolean\n        default: false'), 1)
        self.assertIn('ENABLE_AIDT: ${{ inputs.enable_aidt }}', workflow)
        self.assertIn('aidt_web_enabled: ${{ steps.plan.outputs.aidt_web_enabled }}', workflow)
        self.assertIn('AIDT_RELEASE_ENABLED: ${{ needs.plan.outputs.aidt_web_enabled }}', workflow)
        for name in FLAGS:
            self.assertIn(name + ": ${{ matrix.service == 'web' && needs.plan.outputs.aidt_web_enabled || '0' }}", workflow)
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref_type == 'branch'", workflow)
        dockerfile = (ROOT / 'deploy/aliyun/images/web.Dockerfile').read_text()
        builder, runtime = dockerfile.split('FROM ${NODE_IMAGE} AS runtime')
        for name in FLAGS:
            self.assertIn('ARG ' + name + '=0', builder)
            self.assertLess(builder.index(name + '=${' + name + '}'), builder.index('pnpm --filter web build'))
            self.assertNotIn(name, runtime)


if __name__ == '__main__':
    unittest.main()
