import io
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import cn_candidate_native_cli as n


class NativeCliTests(unittest.TestCase):
    def cli(self):
        cli = object.__new__(n.NativeCli)
        cli.home = Path.home(); cli.cli = Path(sys.executable)
        cli.deadline = time.monotonic() + 10
        cli.check = lambda: None
        return cli

    def test_stdout_bounded_and_stderr_never_returned(self):
        with self.assertRaisesRegex(n.c.Rejected, 'CLI_OUTPUT_LIMIT'):
            self.cli()._run(['-c', 'print("x"*10000)'], limit=10)
        self.assertEqual(self.cli()._run(['-c', 'import sys; sys.stderr.write("SECRET"); print("ok")']), b'ok\n')

    def test_error_redacted(self):
        with self.assertRaisesRegex(n.c.Rejected, '^CLI_COMMAND_FAILED$'):
            self.cli()._run(['-c', 'import sys; sys.stderr.write("SECRET"); sys.exit(1)'])

    def test_deadline_kills_process(self):
        cli = self.cli(); cli.deadline = time.monotonic() + .1
        start = time.monotonic()
        with self.assertRaisesRegex(n.c.Rejected, 'CLI_DEADLINE'):
            cli._run(['-c', 'import time; time.sleep(10)'])
        self.assertLess(time.monotonic()-start, 2)

    def test_environment_excludes_credentials_and_proxy(self):
        with patch.dict(os.environ, {'OSS_ACCESS_KEY_SECRET': 'secret', 'HTTPS_PROXY': 'bad', 'ALIBABA_CLOUD_CONFIG_DIR': '/evil'}):
            output = self.cli()._run(['-c', 'import os,json; print(json.dumps(sorted(os.environ)))'])
        self.assertNotIn(b'OSS_ACCESS', output)
        self.assertNotIn(b'HTTPS_PROXY', output)
        self.assertNotIn(b'ALIBABA_CLOUD_CONFIG', output)

    def test_schema_does_not_return_values(self):
        self.assertEqual(n.schema({'Policy': 'secret', 'Headers': {'Date': 'secret'}}),
                         {'Policy': 'str', 'Headers': {'Date': 'str'}})

    def test_no_generic_mutation_api(self):
        with self.assertRaisesRegex(n.c.Rejected, 'CLI_API_NOT_ALLOWED'):
            self.cli().api('delete-object', 'bucket', 'key')

    def test_files_reject_symlinks_and_writable(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'file'; p.write_bytes(b'ok'); p.chmod(0o600)
            self.assertEqual(n.trusted_bytes(p, 5), b'ok')
            q = Path(tmp)/'link'; q.symlink_to(p)
            with self.assertRaises(OSError): n.trusted_bytes(q, 5)
            p.chmod(0o666)
            with self.assertRaisesRegex(n.c.Rejected, 'CLI_FILE_TRUST'): n.trusted_bytes(p, 5)

    def test_update_cache_fail_closed(self):
        cli = object.__new__(n.NativeCli)
        cli.cli = 'cli'; cli.oss = 'oss'; cli.cache = 'cache'
        cli.deadline = time.monotonic() + 100
        with patch.object(n, 'CLI_SHA', n.c.sha(b'cli')), patch.object(n, 'OSS_SHA', n.c.sha(b'oss')):
            for age in (86400, -100, 86300):
                with patch.object(n, 'trusted_bytes', side_effect=[b'cli', b'oss', str(int(time.time()-age)).encode()]):
                    with self.assertRaisesRegex(n.c.Rejected, 'CLI_AUTO_UPDATE_FORBIDDEN'): cli.check()
            with patch.object(n, 'trusted_bytes', side_effect=[b'cli', b'oss', str(int(time.time()-100)).encode()]):
                cli.check()

    def test_pin_mismatch_blocks(self):
        cli = object.__new__(n.NativeCli); cli.cli='cli'; cli.oss='oss'; cli.deadline=time.monotonic()+1
        with patch.object(n, 'trusted_bytes', return_value=b'changed'):
            with self.assertRaisesRegex(n.c.Rejected, 'CLI_BINARY_HASH'): cli.check()

    def test_put_outcome_only_after_process_started(self):
        cli=self.cli();cli.check=lambda:(_ for _ in ()).throw(n.c.Rejected('PRECHECK'))
        with self.assertRaisesRegex(n.c.Rejected,'^PRECHECK$'):
            cli._run(['-c','pass'],put_outcome=True)
        with patch.object(n.subprocess,'Popen',side_effect=OSError('spawn failed')):
            with self.assertRaises(OSError):self.cli()._run(['-c','pass'],put_outcome=True)
        with self.assertRaises(n.NativeCommandOutcomeUnknown):
            self.cli()._run(['-c','import sys; sys.exit(1)'],put_outcome=True)

    def test_stream_to_target(self):
        target=io.BytesIO()
        self.assertEqual(self.cli()._run(['-c', 'print("data",end="")'], limit=4, target=target), b'')
        self.assertEqual(target.getvalue(), b'data')

if __name__ == '__main__': unittest.main()
