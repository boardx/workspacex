"""ACR authentication: bounded transient recovery, diagnostics, no credential disclosure."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('registry_login', ROOT/'scripts/registry-images.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Login(unittest.TestCase):
    def invoke(self, outcomes):
        env={'ACR_USERNAME':'private-user-value','ACR_PASSWORD':'private-password-value'}
        stderr=io.StringIO()
        with patch.dict(os.environ,env,clear=True), patch.object(m.subprocess,'run',side_effect=outcomes) as command, patch.object(m.time,'sleep') as sleep, contextlib.redirect_stderr(stderr):
            error=None
            try: m.registry_login('registry.example',env['ACR_USERNAME'],env['ACR_PASSWORD'])
            except ValueError as caught: error=str(caught)
        output=stderr.getvalue()
        self.assertNotIn(env['ACR_USERNAME'],output)
        self.assertNotIn(env['ACR_PASSWORD'],output)
        for call in command.call_args_list:
            self.assertNotIn(env['ACR_PASSWORD'],call.args[0])
            self.assertEqual(call.kwargs['input'],env['ACR_PASSWORD'])
        return error,output,command.call_count,sleep.call_count

    def test_transient_failure_then_success(self):
        failure=subprocess.CompletedProcess([],1,'','TLS handshake timeout')
        success=subprocess.CompletedProcess([],0,'Login Succeeded','')
        error,output,calls,sleeps=self.invoke([failure,success])
        self.assertIsNone(error);self.assertEqual(calls,2);self.assertEqual(sleeps,1)
        self.assertIn('TLS handshake timeout',output)

    def test_unauthorized_fails_once_and_redacts(self):
        error,output,calls,sleeps=self.invoke([subprocess.CompletedProcess([],1,'','unauthorized: private-user-value private-password-value https://registry.example/?token=private-token')])
        self.assertEqual(error,'ACR_LOGIN_FAILED');self.assertEqual(calls,1);self.assertEqual(sleeps,0)
        self.assertIn('unauthorized',output);self.assertNotIn('private-token',output)

    def test_transient_failure_is_bounded(self):
        error,output,calls,sleeps=self.invoke([subprocess.CompletedProcess([],1,'','503 Service Unavailable')]*3)
        self.assertEqual(error,'ACR_LOGIN_FAILED');self.assertEqual(calls,3);self.assertEqual(sleeps,2)

    def test_timeout_then_success(self):
        error,output,calls,sleeps=self.invoke([subprocess.TimeoutExpired('docker',60),subprocess.CompletedProcess([],0,'','')])
        self.assertIsNone(error);self.assertEqual(calls,2);self.assertIn('timeout',output)

    def test_permanent_error_wins_over_timeout_word(self):
        error,output,calls,sleeps=self.invoke([subprocess.CompletedProcess([],1,'','unauthorized: token expired; connection timeout')])
        self.assertEqual(error,'ACR_LOGIN_FAILED');self.assertEqual(calls,1)

    def test_unknown_error_is_diagnosed_without_retry(self):
        error,output,calls,sleeps=self.invoke([subprocess.CompletedProcess([],1,'','error saving credentials')])
        self.assertEqual(error,'ACR_LOGIN_FAILED');self.assertIn('error saving credentials',output);self.assertEqual(calls,1)
