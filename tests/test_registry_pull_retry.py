"""Only idempotent pulls may retry explicit transient transport errors."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]

def module():
    spec=importlib.util.spec_from_file_location('retry_registry',ROOT/'scripts/registry-images.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

class PullRetry(unittest.TestCase):
    def test_pull_recovers_after_connection_resets(self):
        m=module();bad=subprocess.CompletedProcess([],1,'','failed to fetch oauth token: connection reset by peer')
        good=subprocess.CompletedProcess([],0,'pulled','')
        with patch.object(m.subprocess,'run',side_effect=[bad,bad,good]) as execute,patch('time.sleep'):
            self.assertEqual('pulled',m.run(['docker','pull','registry/team/api:123-1'],retry_transient=True))
            self.assertEqual(3,execute.call_count)

    def test_permanent_failures_do_not_retry(self):
        for message in ['manifest unknown','unauthorized: authentication required','denied: access forbidden']:
            with self.subTest(message=message):
                m=module()
                with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'',message)) as execute,patch('time.sleep'):
                    with self.assertRaisesRegex(ValueError,'COMMAND_FAILED_DOCKER'):m.run(['docker','pull','ref'],retry_transient=True)
                    self.assertEqual(1,execute.call_count)

    def test_retries_are_bounded_and_do_not_include_writes(self):
        for command,retry,count in [(['docker','pull','ref'],True,3),(['docker','push','ref'],False,1)]:
            m=module()
            with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'','connection reset by peer')) as execute,patch('time.sleep'):
                with self.assertRaisesRegex(ValueError,'COMMAND_FAILED_DOCKER'):m.run(command,retry_transient=retry)
                self.assertEqual(count,execute.call_count)

    def test_non_pull_cannot_opt_in(self):
        m=module()
        with patch.object(m.subprocess,'run') as execute:
            with self.assertRaisesRegex(ValueError,'RETRY_REQUIRES_PULL'):m.run(['docker','push','ref'],retry_transient=True)
            execute.assert_not_called()

if __name__=='__main__':unittest.main()
