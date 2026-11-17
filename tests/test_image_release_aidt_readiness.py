"""GET-only DevApp metadata projection; no Docker, host policy or database access."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('aidt_host_readiness', Path(__file__).resolve().parents[1] / 'scripts/image-release-host-permissions.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
IDENTIFIER = 'a' * 64
SOURCE = 'b' * 40
SECRET = 'DUMMY_SYNTHETIC_PRIVATE_ENV_VALUE_NEVER_EMIT'


def container(project='workspacex-devapp', service='api', identifier=IDENTIFIER):
    return {'Id': identifier, 'Names': ['/private-container-name'], 'Labels': {
        'com.docker.compose.project': project, 'com.docker.compose.service': service,
        'com.docker.compose.project.config_files': '/private/path',
        'org.opencontainers.image.revision': SOURCE, 'secret': SECRET}}


def detail(env=None):
    return {'Id': IDENTIFIER, 'State': {'Running': True},
            'Config': {'Env': env, 'Labels': container()['Labels'], 'secret': SECRET}}


class Readiness(unittest.TestCase):
    def run_http(self, responses):
        connections = []
        for body, status in responses:
            connection = Mock()
            response = Mock(status=status)
            response.read.return_value = body if isinstance(body, bytes) else json.dumps(body).encode()
            connection.getresponse.return_value = response
            connections.append(connection)
        with patch.object(probe, 'DockerHTTP', side_effect=connections):
            result = probe.aidt_readiness()
        for connection in connections:
            connection.close.assert_called_once_with()
            connection.getresponse.return_value.read.assert_called_once_with(probe.DOCKER_READ_LIMIT + 1)
        return result, [connection.request.call_args.args for connection in connections]

    def test_only_gets_unique_devapp_api_and_projects_safe_metadata(self):
        rows = [container(), container('workspacex-cn'), container('other-project'),
                container('workspacex', 'postgres')]
        result, requests = self.run_http([(rows, 200), (detail([
            'ENABLE_AIDT_MODULE=1', 'ENABLE_PROJECT_MEMBER_CHAT=true',
            'DATABASE_PASSWORD=' + SECRET, 'OTHER=' + SECRET]), 200)])
        self.assertEqual(requests, [('GET', '/containers/json'), ('GET', '/containers/' + IDENTIFIER + '/json')])
        self.assertEqual(result['api'], {'status': 'OBSERVED', 'aidtModule': 'enabled', 'memberChat': 'enabled'})
        self.assertEqual(len(result['containers']), 2)
        self.assertEqual({row['project'] for row in result['containers']}, {'workspacex-devapp', 'workspacex'})
        self.assertNotIn('workspacex-cn', json.dumps(result))
        self.assertNotIn('other-project', json.dumps(result))
        self.assertEqual(set(result['containers'][0]), {'project', 'service', 'sourceRevision'})
        text = json.dumps(result)
        for forbidden in (SECRET, 'DATABASE_PASSWORD', 'OTHER', 'Config', 'Env', '/private', 'Names'):
            self.assertNotIn(forbidden, text)

    def test_flag_states_do_not_echo_values(self):
        cases = [([], 'unset'), (['=0'], 'disabled'), (['=false'], 'disabled'),
                 (['=1'], 'enabled'), (['=true'], 'enabled'),
                 (['=' + SECRET], 'invalid'), (['=TRUE'], 'invalid'),
                 (['='], 'invalid'), ([''], 'invalid'), (['=1', '=false'], 'duplicate')]
        for suffixes, expected in cases:
            with self.subTest(expected=expected, suffixes=suffixes):
                env = [name + suffix for name in probe.API_FLAGS for suffix in suffixes]
                result, _ = self.run_http([([container()], 200), (detail(env), 200)])
                self.assertEqual(result['api']['aidtModule'], expected)
                self.assertEqual(result['api']['memberChat'], expected)
                self.assertNotIn(SECRET, json.dumps(result))

    def test_no_candidate_or_ambiguity_never_inspects_container_config(self):
        for rows in ([], [container('workspacex-cn')], [container('other-project')],
                     [container(), container('devapp', identifier='c' * 64)]):
            with self.subTest(rows=len(rows)):
                result, requests = self.run_http([(rows, 200)])
                self.assertEqual(result['api'], {'status': 'UNKNOWN', 'reason': 'NO_UNIQUE_API'})
                self.assertEqual(requests, [('GET', '/containers/json')])
                if len(rows) < 2:
                    self.assertEqual(result['containers'], [])

    def test_invalid_container_id_cannot_become_a_request_path(self):
        result, requests = self.run_http([([container(identifier='../' + SECRET)], 200)])
        self.assertEqual(result['api']['reason'], 'INVALID_API_ID')
        self.assertEqual(requests, [('GET', '/containers/json')])
        self.assertNotIn(SECRET, json.dumps(result))

    def test_scans_past_output_limit_to_detect_ambiguous_api(self):
        rows = [container()] + [container('workspacex', 'worker') for _ in range(21)] + [container('devapp')]
        result, requests = self.run_http([(rows, 200)])
        self.assertEqual(len(result['containers']), 20)
        self.assertTrue(result['truncated'])
        self.assertEqual(result['api']['reason'], 'NO_UNIQUE_API')
        self.assertEqual(len(requests), 1)

    def test_unvalidated_labels_and_revision_are_not_emitted(self):
        row = container(project='/private/' + SECRET, service='../../' + SECRET)
        row['Labels']['org.opencontainers.image.revision'] = SECRET
        result, _ = self.run_http([([row], 200)])
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertEqual(result['containers'], [])

    def test_api_identity_race_stopped_or_malformed_environment_stays_unknown(self):
        changed = detail([])
        changed['Config']['Labels'] = container('workspacex-cn')['Labels']
        stopped = detail([])
        stopped['State']['Running'] = False
        for value, reason in ((changed, 'API_BINDING_CHANGED'), (stopped, 'API_NOT_RUNNING'),
                              (detail([{'password': SECRET}]), 'INVALID_ENVIRONMENT')):
            with self.subTest(reason=reason):
                result, _ = self.run_http([([container()], 200), (value, 200)])
                self.assertEqual(result['api'], {'status': 'UNKNOWN', 'reason': reason})
                self.assertNotIn(SECRET, json.dumps(result))

    def test_bounded_response_and_http_failure_are_safe(self):
        for raw, status, reason in ((b'x' * (probe.DOCKER_READ_LIMIT + 1), 200, 'OUTPUT_BOUND'),
                                    (b'{invalid:' + SECRET.encode(), 200, 'READ_UNAVAILABLE')):
            result, _ = self.run_http([(raw, status)])
            self.assertEqual(result['api']['reason'], reason)
            self.assertNotIn(SECRET, json.dumps(result))
        connection = Mock()
        connection.getresponse.return_value.status = 403
        with patch.object(probe, 'DockerHTTP', return_value=connection):
            result = probe.aidt_readiness()
        self.assertEqual(result['api']['reason'], 'HTTP_REJECTED')
        connection.getresponse.return_value.read.assert_not_called()
        connection.close.assert_called_once()

    def test_read_errors_do_not_emit_raw_exception_text(self):
        for error in (PermissionError(SECRET), probe.DockerReadError(SECRET)):
            with patch.object(probe, 'docker_json', side_effect=error):
                result = probe.aidt_readiness()
            self.assertNotIn(SECRET, json.dumps(result))
            self.assertEqual(result['api']['reason'], 'READ_UNAVAILABLE')

    def test_reader_refuses_other_paths_without_opening_connection(self):
        with patch.object(probe, 'DockerHTTP') as connection:
            for path in ('/containers/' + IDENTIFIER + '/exec', '/images/json', '/containers/../json'):
                with self.assertRaises(probe.DockerReadError):
                    probe.docker_json(path)
            connection.assert_not_called()

    def test_collect_adds_optional_field_only_for_exact_devapp_target(self):
        for target in (None, '', 'cn', 'us', 'DEVAPP', 'devapp'):
            env = {} if target is None else {'TARGET_ENVIRONMENT': target}
            with self.subTest(target=target), patch.dict(probe.os.environ, env, clear=True), \
                 patch.object(probe, 'metadata', return_value={}), patch.object(probe, 'containers', return_value={}), \
                 patch.object(probe.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='')), \
                 patch.object(probe, 'aidt_readiness', return_value={'status': 'UNKNOWN'}) as readiness:
                result = probe.collect()
            self.assertEqual('aidtReadiness' in result, target == 'devapp')
            self.assertEqual(readiness.call_count, 1 if target == 'devapp' else 0)
            self.assertFalse(result['changesMade'])


if __name__ == '__main__':
    unittest.main()
