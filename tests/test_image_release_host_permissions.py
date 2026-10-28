import errno
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host_permissions', Path(__file__).resolve().parents[1] / 'scripts/image-release-host-permissions.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class Permissions(unittest.TestCase):
    def test_denied_path_reports_resource_error_without_raw_exception(self):
        with patch.object(probe.os, 'lstat', side_effect=PermissionError(errno.EACCES, 'sensitive raw error')):
            result = probe.metadata('/fixed/path')
        self.assertEqual(result, {'status': 'PermissionError', 'errno': errno.EACCES})

    def test_socket_permission_failure_is_attributed_and_never_mutates(self):
        with patch.object(probe.DockerHTTP, 'request', side_effect=PermissionError(errno.EACCES, 'raw socket error')) as request:
            result = probe.containers()
        self.assertEqual(result['resource'], '/run/docker.sock')
        self.assertEqual(result['errno'], errno.EACCES)
        request.assert_called_once_with('GET', '/containers/json')

    def test_unrelated_sudo_policy_and_errors_are_not_disclosed(self):
        result = type('Result', (), {'returncode': 0, 'stdout': '/usr/local/bin/workspacex-cn-deploy sensitive-policy-text'})()
        with patch.object(probe, 'metadata', return_value={'status': 'PRESENT'}), patch.object(probe, 'containers', return_value={}), patch.object(probe.subprocess, 'run', return_value=result):
            report = probe.collect()
        self.assertTrue(report['sudo']['entryMentioned']['/usr/local/bin/workspacex-cn-deploy'])
        self.assertNotIn('sensitive-policy-text', json.dumps(report))
        self.assertFalse(report['changesMade'])

if __name__ == '__main__':
    unittest.main()
