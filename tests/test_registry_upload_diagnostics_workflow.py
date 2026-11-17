"""Execute actual diagnostic workflow guards without Docker, credentials or dispatch."""
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/build-cn-release-artifacts.yml'
TOKEN = re.compile(r"\s*(==|!=|&&|\|\||[!()]|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_.-]*)")


def truth(value):
    return value is not None and value is not False and value != '' and value != 0


def number(value):
    if value is None or value == '':
        return 0
    if isinstance(value, bool):
        return int(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return math.nan


def equal(left, right):
    # GitHub loose equality coerces unlike types to numbers; null/false/'' become 0.
    return left == right if type(left) is type(right) else number(left) == number(right)


class Expression:
    """Narrow parser for real job guards; reject unknown syntax instead of guessing."""
    def __init__(self, source, values):
        source = source.strip()
        if source.startswith('${{') and source.endswith('}}'):
            source = source[3:-2].strip()
        self.tokens = []
        while source:
            match = TOKEN.match(source)
            if not match:
                raise AssertionError('Unsupported workflow expression: ' + source)
            self.tokens.append(match[1])
            source = source[match.end():].lstrip()
        self.at = 0
        self.values = values

    def take(self, token):
        if self.at < len(self.tokens) and self.tokens[self.at] == token:
            self.at += 1
            return True
        return False

    def value(self):
        if self.take('!'):
            return not truth(self.value())
        if self.take('('):
            result = self.or_value()
            if not self.take(')'):
                raise AssertionError('Unclosed workflow expression')
            return result
        token = self.tokens[self.at]
        self.at += 1
        if token.startswith("'"):
            return token[1:-1].replace("''", "'")
        if token in ('true', 'false', 'null'):
            return {'true': True, 'false': False, 'null': None}[token]
        return self.values.get(token)

    def comparison(self):
        left = self.value()
        for operator in ('==', '!='):
            if self.take(operator):
                matched = equal(left, self.value())
                return matched if operator == '==' else not matched
        return left

    def and_value(self):
        left = self.comparison()
        while self.take('&&'):
            right = self.comparison()
            left = right if truth(left) else left
        return left

    def or_value(self):
        left = self.and_value()
        while self.take('||'):
            right = self.and_value()
            left = left if truth(left) else right
        return left

    def evaluate(self):
        result = self.or_value()
        if self.at != len(self.tokens):
            raise AssertionError('Unconsumed workflow expression')
        return result


class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Vendored repository parser: no pip install and no YAML 1.1 `on`→True coercion.
        script = "import {readFileSync} from 'node:fs';import {parse} from './.harness/scripts/vendor/yaml-2.9.0/parser.mjs';console.log(JSON.stringify(parse(readFileSync(process.argv[1],'utf8'))));"
        parsed = subprocess.run(['node', '--input-type=module', '-e', script, str(WORKFLOW)], cwd=ROOT, text=True, capture_output=True, check=True)
        cls.workflow = json.loads(parsed.stdout)
        cls.jobs = cls.workflow['jobs']

    def values(self, inputs=None, event='workflow_dispatch', defaults=True):
        values = {'github.event_name': event}
        if defaults:
            values.update({'inputs.' + key: spec.get('default') for key, spec in self.workflow['on']['workflow_dispatch']['inputs'].items()})
        values.update({'inputs.' + key: value for key, value in (inputs or {}).items()})
        return values

    def selected(self, inputs=None, event='workflow_dispatch', defaults=True):
        values = self.values(inputs, event, defaults)
        active = set()
        def visit(name):
            if name in active:
                return True
            job = self.jobs[name]
            parents = job.get('needs', [])
            if isinstance(parents, str):
                parents = [parents]
            if any(not visit(parent) for parent in parents):
                return False
            if not truth(Expression(job.get('if', 'true'), values).evaluate()):
                return False
            active.add(name)
            return True
        for name in self.jobs:
            visit(name)
        return active

    def validator(self):
        steps = self.jobs['registry-upload-diagnostics']['steps']
        guard = next(step for step in steps if 'SIZED' in step.get('env', {}))
        program = guard['run'].split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
        return steps, guard, program

    def guard_result(self, inputs):
        _, guard, program = self.validator()
        values = self.values(inputs)
        env = os.environ.copy()
        for name, binding in guard['env'].items():
            value = Expression(binding, values).evaluate()
            env[name] = 'true' if value is True else 'false' if value is False else '' if value is None else str(value)
        return subprocess.run([sys.executable, '-I', '-B', '-c', program], cwd=ROOT, env=env, text=True, capture_output=True)

    def test_dispatch_defaults_keep_normal_producer_and_disable_diagnostics(self):
        self.assertEqual(self.selected(), {'validate', 'build', 'seal'})
        inputs = self.workflow['on']['workflow_dispatch']['inputs']
        self.assertIs(inputs['registry_probe_sized']['default'], False)
        self.assertEqual(inputs['registry_probe_existing_tag']['default'], '')
        self.assertEqual(inputs['registry_probe_sized']['type'], 'boolean')

    def test_workflow_call_absent_new_inputs_keep_legacy_producer(self):
        self.assertNotIn('registry_probe_sized', self.workflow['on']['workflow_call']['inputs'])
        self.assertEqual(self.selected({}, 'workflow_call', defaults=False), {'validate', 'build', 'seal'})
        self.assertEqual(self.selected({'registry_probe_sized': None, 'registry_probe_existing_tag': None}, 'workflow_call', False), {'validate', 'build', 'seal'})

    def test_legacy_tiny_shared_and_host_modes_remain_distinct(self):
        self.assertEqual(self.selected({'registry_probe_only': True}), {'registry-probe'})
        self.assertEqual(self.selected({'shared_images_only': True}), {'shared-images'})
        for host in ('cn', 'devapp'):
            self.assertEqual(self.selected({'host_permission_probe': host}), {'host-permission-source', 'host-permissions'})

    def test_new_mode_routes_only_to_diagnostic_even_with_conflicting_inputs(self):
        for probe_only in (False, True):
            for sized, tag in ((True, ''), (False, '123-1'), (True, '123-1')):
                for shared in (False, True):
                    for host in ('off', 'cn', 'devapp'):
                        inputs = {'registry_probe_only': probe_only, 'registry_probe_sized': sized, 'registry_probe_existing_tag': tag, 'shared_images_only': shared, 'host_permission_probe': host}
                        with self.subTest(inputs=inputs):
                            self.assertEqual(self.selected(inputs), {'registry-upload-diagnostics'})

    def test_new_mode_never_runs_from_non_manual_events(self):
        for event in ('pull_request', 'push', 'merge_group', 'workflow_call'):
            self.assertEqual(self.selected({'registry_probe_sized': True, 'registry_probe_existing_tag': '123-1'}, event), set())

    def test_actual_validation_step_accepts_only_explicit_safe_mode(self):
        safe = {'registry_probe_sized': True, 'registry_probe_only': True, 'shared_images_only': False, 'host_permission_probe': 'off', 'registry_probe_existing_tag': '44000938132-90000000000000000001'}
        self.assertEqual(self.guard_result(safe).returncode, 0)
        for delta in ({'registry_probe_sized': False}, {'registry_probe_only': False}, {'shared_images_only': True}, {'host_permission_probe': 'cn'}, {'host_permission_probe': 'devapp'}, {'registry_probe_existing_tag': ''}, {'registry_probe_existing_tag': 'latest'}, {'registry_probe_existing_tag': '123-1\n'}, {'registry_probe_existing_tag': '$(id)'}, {'registry_probe_existing_tag': '123-1;true'}):
            with self.subTest(delta=delta):
                self.assertNotEqual(self.guard_result({**safe, **delta}).returncode, 0)

    def test_validation_precedes_credentials_and_upload_and_always_cleans(self):
        job = self.jobs['registry-upload-diagnostics']
        self.assertEqual(job['runs-on'], 'ubuntu-24.04')
        self.assertNotIn('environment', job)
        self.assertEqual(job['timeout-minutes'], 10)
        steps, guard, _ = self.validator()
        auth = next(step for step in steps if 'ACR_PASSWORD' in step.get('env', {}))
        upload = next(step for step in steps if 'registry-upload-diagnostics.py' in step.get('run', ''))
        self.assertLess(steps.index(guard), steps.index(auth))
        self.assertLess(steps.index(auth), steps.index(upload))
        self.assertEqual(steps[-1]['if'], 'always()')
        self.assertIn('DOCKER_CONFIG', steps[-1]['run'])
        for step in steps:
            self.assertFalse(step.get('continue-on-error', False))
            self.assertNotIn('sudo', step.get('run', ''))
            self.assertNotIn('workspacex-image-release', step.get('run', ''))
        checkout = next(step for step in steps if step.get('uses', '').startswith('actions/checkout@'))
        self.assertIs(checkout['with']['persist-credentials'], False)
        self.assertEqual(checkout['with'].get('ref', '${{ github.sha }}'), '${{ github.sha }}')
        self.assertEqual(set(auth['env']), {'ACR_USERNAME', 'ACR_PASSWORD'})
        self.assertNotIn('ACR_PASSWORD', job['env'])

    def test_job_uses_fixed_payload_and_bounded_receipt_not_application_build(self):
        job = self.jobs['registry-upload-diagnostics']
        steps = job['steps']
        upload = next(step for step in steps if 'registry-upload-diagnostics.py' in step.get('run', ''))
        self.assertIn('--payload-mib 32', upload['run'])
        self.assertEqual(upload['env'], {'EXISTING_TAG': '${{ inputs.registry_probe_existing_tag }}'})
        artifact = next(step for step in steps if step.get('uses', '').startswith('actions/upload-artifact@'))
        self.assertEqual(artifact['if'], 'always()')
        self.assertEqual(artifact['with']['path'], '${{ runner.temp }}/registry-upload-diagnostics.json')
        self.assertEqual(artifact['with']['if-no-files-found'], 'warn')
        self.assertEqual(self.workflow['permissions'], {'contents': 'read'})

    def test_expression_coercion_and_parser_reject_unknown_syntax(self):
        for missing in (None, '', False):
            self.assertTrue(Expression("!inputs.sized && inputs.tag == ''", {'inputs.sized': missing, 'inputs.tag': missing}).evaluate())
        with self.assertRaises(AssertionError):
            Expression('contains(inputs.tag, "x")', {}).evaluate()


if __name__ == '__main__':
    unittest.main()
