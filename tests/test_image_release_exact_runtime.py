"""Exact release metadata through the existing bounded Docker GET reader."""
import copy
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'e' * 40
TAG = '44015992148-90000000000000000001'
PRIVATE = 'DUMMY_PRIVATE_LABEL_ENV_PATH_NEVER_EMIT'
SELECTORS = {'TARGET_ENVIRONMENT': 'devapp', 'AIDT_RELEASE_SOURCE': SOURCE, 'AIDT_RELEASE_TAG': TAG}
IDS = {'api': 'a' * 64, 'web': 'b' * 64, 'agent': 'c' * 64, 'sandbox': 'd' * 64, 'sandbox-sessions': '1' * 64}


def module():
    spec = importlib.util.spec_from_file_location('exact_release_probe', ROOT / 'scripts/image-release-host-permissions.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def row(role, service=None):
    return {'Id': IDS[role], 'ImageID': 'sha256:' + IDS[role], 'Names': ['/' + PRIVATE],
            'Labels': {'com.docker.compose.project': PRIVATE, 'com.docker.compose.service': service or role,
                       'org.opencontainers.image.revision': SOURCE, 'io.boardx.workspacex.release-tag': TAG,
                       'com.docker.compose.project.config_files': '/' + PRIVATE, 'private': PRIVATE}}


def detail(item, environment=None):
    if environment is None:
        environment = ['PRIVATE=' + PRIVATE]
        if item['Labels']['com.docker.compose.service'] == 'api':
            environment += ['ENABLE_AIDT_MODULE=1', 'ENABLE_PROJECT_MEMBER_CHAT=true']
        if item['Labels']['com.docker.compose.service'] == 'web':
            environment += ['WORKSPACEX_DEPLOYMENT_MARKER=' + 'f' * 40]
    return {'Id': item['Id'], 'Image': item['ImageID'], 'State': {'Running': True},
            'Config': {'Labels': copy.deepcopy(item['Labels']), 'Env': environment, 'private': PRIVATE},
            'Mounts': [{'Source': '/' + PRIVATE}]}


class ExactRelease(unittest.TestCase):
    def run_http(self, rows, *, changed=None):
        m = module()
        responses = [(rows, 200)]
        for role in ('api', 'web', 'agent', 'sandbox', 'sandbox-sessions'):
            item = next((r for r in rows if isinstance(r, dict) and r.get('Id') == IDS[role]), None)
            if item:
                body = detail(item)
                if changed:
                    changed(role, body)
                responses.append((body, 200))
        connections = []
        for body, status in responses:
            connection = Mock()
            connection.getresponse.return_value.status = status
            connection.getresponse.return_value.read.return_value = json.dumps(body).encode()
            connections.append(connection)
        with patch.dict(os.environ, SELECTORS, clear=True), patch.object(m, 'DockerHTTP', side_effect=connections) as factory:
            result = m.aidt_exact_release()
        used = connections[:factory.call_count]
        for connection in used:
            connection.close.assert_called_once_with()
            connection.getresponse.return_value.read.assert_called_once_with(m.DOCKER_READ_LIMIT + 1)
        calls = [connection.request.call_args.args for connection in used]
        self.assertNotIn(PRIVATE, json.dumps(result))
        self.assertTrue(all(method == 'GET' for method, _ in calls))
        return result, calls

    def test_exact_selectors_find_nonlegacy_project_and_emit_only_rebound_role_identity(self):
        rows = [row('api'), row('web'), row('agent', 'deep-agent'), row('sandbox', 'skill-sandbox')]
        result, calls = self.run_http(rows)
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(calls, [('GET', '/containers/json')] + [('GET', '/containers/' + IDS[role] + '/json') for role in ('api', 'web', 'agent', 'sandbox')])
        self.assertEqual(result['api'], {'status': 'OBSERVED', 'aidtModule': 'enabled', 'memberChat': 'enabled'})
        self.assertEqual(result['web']['marker'], {'state': 'observed', 'value': 'f' * 40})
        self.assertEqual([r['role'] for r in result['containers']], ['api', 'web', 'agent', 'sandbox'])
        for observed in result['containers']:
            self.assertEqual(set(observed), {'role', 'service', 'imageId', 'sourceRevision', 'tag'})
            self.assertEqual(observed['sourceRevision'], SOURCE)
            self.assertEqual(observed['tag'], TAG)
            self.assertEqual(observed['imageId'], 'sha256:' + IDS[observed['role']])
        for forbidden in ('Names', 'Mounts', 'Config', 'Env', 'Labels', 'project', 'PRIVATE='):
            self.assertNotIn(forbidden, json.dumps(result))

    def test_invalid_partial_or_nondevapp_selectors_never_open_docker_connection(self):
        m = module()
        for changes in ({'AIDT_RELEASE_SOURCE': ''}, {'AIDT_RELEASE_SOURCE': PRIVATE},
                        {'AIDT_RELEASE_TAG': ''}, {'AIDT_RELEASE_TAG': 'latest'}, {'AIDT_RELEASE_TAG': TAG + '\n'},
                        {'AIDT_RELEASE_TAG': 'a' * 40 + '-123-1'}, {'TARGET_ENVIRONMENT': 'cn'}):
            with self.subTest(fields=list(changes)), patch.dict(os.environ, {**SELECTORS, **changes}, clear=True), patch.object(m, 'DockerHTTP') as docker:
                result = m.aidt_exact_release()
            docker.assert_not_called()
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertEqual(result['reason'], 'INVALID_SELECTORS')
            self.assertEqual(result['api']['aidtModule'], 'unknown')
            self.assertNotIn(PRIVATE, json.dumps(result))

    def test_source_only_tag_only_and_foreign_mixed_containers_are_never_inspected(self):
        rows = [row(role) for role in ('api', 'web', 'agent', 'sandbox')]
        source_only = row('api')
        source_only['Id'] = '2' * 64
        source_only['Labels']['io.boardx.workspacex.release-tag'] = '123-2'
        tag_only = row('api')
        tag_only['Id'] = '3' * 64
        tag_only['Labels']['org.opencontainers.image.revision'] = '4' * 40
        foreign = row('api', PRIVATE)
        foreign['Id'] = '5' * 64
        foreign['Labels']['org.opencontainers.image.revision'] = '6' * 40
        result, calls = self.run_http([source_only, tag_only, foreign] + rows)
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(len(calls), 5)
        self.assertFalse(any('/' + char * 64 + '/' in path for _, path in calls for char in ('2', '3', '5')))

    def test_unknown_duplicate_or_missing_mandatory_roles_return_unknown_before_inspect(self):
        base = [row(role) for role in ('api', 'web', 'agent', 'sandbox')]
        duplicate = row('agent', 'deep-agent')
        duplicate['Id'] = '7' * 64
        for rows, reason in (([], 'MISSING_REQUIRED_ROLES'), (base[:-1], 'MISSING_REQUIRED_ROLES'),
                             (base + [row('sandbox-sessions', PRIVATE)], 'UNKNOWN_ROLE'),
                             (base + [duplicate], 'DUPLICATE_ROLE')):
            result, calls = self.run_http(rows)
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertEqual(result['reason'], reason)
            self.assertEqual(calls, [('GET', '/containers/json')])
            self.assertEqual(result['api']['memberChat'], 'unknown')

    def test_optional_sessions_are_bound_without_becoming_a_mandatory_role(self):
        result, calls = self.run_http([row(role) for role in IDS])
        self.assertEqual(result['status'], 'OBSERVED')
        self.assertEqual(result['containers'][-1]['role'], 'sandbox-sessions')
        self.assertEqual(len(calls), 6)

    def test_invalid_or_duplicated_ids_and_invalid_list_images_never_form_inspect_paths(self):
        for field, value, reason in (('Id', '../' + PRIVATE, 'INVALID_CONTAINER_ID'),
                                     ('ImageID', PRIVATE, 'INVALID_IMAGE_ID'), ('Id', IDS['web'], 'DUPLICATE_CONTAINER')):
            rows = [row(role) for role in ('api', 'web', 'agent', 'sandbox')]
            rows[0][field] = value
            result, calls = self.run_http(rows)
            self.assertEqual(result['reason'], reason)
            self.assertEqual(calls, [('GET', '/containers/json')])

    def test_inspect_rebinds_id_image_source_tag_project_exact_service_and_running_state(self):
        mutations = [lambda d: d.update(Id='9' * 64), lambda d: d.update(Image='sha256:' + '9' * 64),
                     lambda d: d['Config']['Labels'].update({'org.opencontainers.image.revision': '9' * 40}),
                     lambda d: d['Config']['Labels'].update({'io.boardx.workspacex.release-tag': '123-2'}),
                     lambda d: d['Config']['Labels'].update({'com.docker.compose.project': 'changed'}),
                     lambda d: d['Config']['Labels'].update({'com.docker.compose.service': 'changed'}),
                     lambda d: d['State'].update(Running=False), lambda d: d['State'].update(Running=1)]
        for mutate in mutations:
            def change(role, d):
                if role == 'api': mutate(d)
            result, calls = self.run_http([row(role) for role in ('api', 'web', 'agent', 'sandbox')], changed=change)
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertEqual(result['containers'], [])
            self.assertEqual(result['api']['aidtModule'], 'unknown')
            self.assertEqual(len(calls), 2)

    def test_environment_projection_retains_states_without_printing_untrusted_values(self):
        for suffixes, expected in (([], 'unset'), (['=0'], 'disabled'), (['=true'], 'enabled'),
                                   (['=' + PRIVATE], 'invalid'), (['=1', '=false'], 'duplicate')):
            def change(role, d):
                if role == 'api':
                    d['Config']['Env'] = [name + suffix for name in ('ENABLE_AIDT_MODULE', 'ENABLE_PROJECT_MEMBER_CHAT') for suffix in suffixes]
                if role == 'web': d['Config']['Env'] = ['WORKSPACEX_DEPLOYMENT_MARKER=' + PRIVATE]
            result, _ = self.run_http([row(role) for role in ('api', 'web', 'agent', 'sandbox')], changed=change)
            self.assertEqual(result['api']['aidtModule'], expected)
            self.assertEqual(result['api']['memberChat'], expected)
            self.assertEqual(result['web']['marker'], {'state': 'invalid'})

    def test_paused_restarting_or_dead_after_api_read_never_emits_partial_flags(self):
        for state in ('Paused', 'Restarting', 'Dead'):
            def change(role, d):
                if role == 'web': d['State'][state] = True
            result, calls = self.run_http([row(role) for role in ('api', 'web', 'agent', 'sandbox')], changed=change)
            self.assertEqual(len(calls), 3)
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertEqual(result['reason'], 'CONTAINER_NOT_RUNNING')
            self.assertEqual(result['containers'], [])
            self.assertEqual(result['api'], {'status': 'UNKNOWN', 'aidtModule': 'unknown', 'memberChat': 'unknown'})
            self.assertEqual(result['web'], {'status': 'UNKNOWN', 'marker': {'state': 'unknown'}})

    def test_bad_env_and_bounded_reader_failures_remain_unknown_without_raw_error(self):
        def change(role, d):
            if role == 'api': d['Config']['Env'] = [{'private': PRIVATE}]
        result, _ = self.run_http([row(role) for role in ('api', 'web', 'agent', 'sandbox')], changed=change)
        self.assertEqual(result['reason'], 'INVALID_ENVIRONMENT')
        m = module()
        for error in (m.DockerReadError('OUTPUT_BOUND'), m.DockerReadError(PRIVATE), PermissionError(PRIVATE)):
            with patch.dict(os.environ, SELECTORS, clear=True), patch.object(m, 'docker_json', side_effect=error):
                result = m.aidt_exact_release()
            self.assertEqual(result['status'], 'UNKNOWN')
            self.assertNotIn(PRIVATE, json.dumps(result))

    def test_collect_preserves_legacy_field_and_only_adds_exact_projection_for_devapp_hints(self):
        m = module()
        for target, hints, expected in (('devapp', {}, False), ('cn', SELECTORS, False),
                                         ('devapp', {'AIDT_RELEASE_SOURCE': SOURCE}, True), ('devapp', SELECTORS, True)):
            with patch.dict(os.environ, {**hints, 'TARGET_ENVIRONMENT': target}, clear=True), \
                 patch.object(m, 'metadata', return_value={}), patch.object(m, 'containers', return_value={}), \
                 patch.object(m, 'aidt_readiness', return_value={'legacy': 'unchanged'}) as legacy, \
                 patch.object(m, 'aidt_exact_release', return_value={'status': 'UNKNOWN'}) as exact, \
                 patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='')):
                result = m.collect()
            self.assertEqual('aidtExactRelease' in result, expected)
            self.assertEqual(exact.call_count, int(expected))
            self.assertEqual(legacy.call_count, int(target == 'devapp' and not expected))
            if target == 'devapp' and expected:
                self.assertEqual(result['aidtReadiness']['status'], 'UNKNOWN')
                self.assertEqual(result['aidtReadiness']['api']['reason'], 'EXACT_RELEASE_SELECTED')
            elif target == 'devapp':
                self.assertEqual(result['aidtReadiness'], {'legacy': 'unchanged'})
            self.assertFalse(result['changesMade'])

    def test_collect_invalid_or_unmatched_hints_never_fall_back_to_legacy_config_inspection(self):
        m = module()
        mismatched = row('api')
        mismatched['Labels']['io.boardx.workspacex.release-tag'] = '123-2'
        for hint, rows, expected_lists in (({'AIDT_RELEASE_SOURCE': PRIVATE}, [], 0),
                                          (SELECTORS, [mismatched], 1)):
            connection = Mock()
            connection.getresponse.return_value.status = 200
            connection.getresponse.return_value.read.return_value = json.dumps(rows).encode()
            with patch.dict(os.environ, {**hint, 'TARGET_ENVIRONMENT': 'devapp'}, clear=True), \
                 patch.object(m, 'metadata', return_value={}), patch.object(m, 'containers', return_value={}), \
                 patch.object(m, 'aidt_readiness') as legacy, patch.object(m, 'DockerHTTP', return_value=connection) as docker, \
                 patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='')):
                result = m.collect()
            legacy.assert_not_called()
            self.assertEqual(docker.call_count, expected_lists)
            if expected_lists:
                connection.request.assert_called_once_with('GET', '/containers/json')
            self.assertEqual(result['aidtReadiness']['api']['reason'], 'EXACT_RELEASE_SELECTED')
            self.assertEqual(result['aidtExactRelease']['status'], 'UNKNOWN')
            self.assertEqual(result['aidtExactRelease']['api']['aidtModule'], 'unknown')
            self.assertNotIn(PRIVATE, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
