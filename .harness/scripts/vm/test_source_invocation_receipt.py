import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import source_invocation_receipt as m
import test_isolated_conservation_evidence_producer as fixture


class InvocationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir='/workspace')
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.output = self.root / 'output'
        self.output.mkdir(mode=0o700)
        sample = fixture.CollectionTests()
        sample.setUp()
        # Convert in-memory mock refs into actual private files. This executes the
        # real offline source collector, never the replay/SQL operations.
        def materialize(value):
            if type(value) is dict:
                if set(value) == {'path', 'sha256'} and value['path'] in sample.bytes:
                    raw = sample.bytes[value['path']]
                    return self.put(materialize(json.loads(raw)))
                return {k: materialize(v) for k, v in value.items()}
            if type(value) is list:
                return [materialize(v) for v in value]
            return value
        self.n = 0
        self.input = self.put(materialize(sample.payload))
        self.binding = {'providerBindingSha256': 'f' * 64}
        self.closure = {}
        for name in m.MODULES:
            path = self.root / (name + '.py')
            path.write_bytes((Path(m.__file__).parent / (name + '.py')).read_bytes())
            mode = 0o700
            path.chmod(mode)
            self.closure[name] = m.reference(path, mode)
        executable = self.root / 'python'
        shutil.copyfile(Path('/usr/bin/python3').resolve(), executable)
        executable.chmod(0o755)
        self.executable = m.reference(executable, 0o755)
        self.source_pin = self.closure['source_invocation_receipt']['sha256']
        self.exe_pin = self.executable['sha256']

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, value):
        self.n += 1
        path = self.root / ('input-' + str(self.n) + '.json')
        path.write_bytes(json.dumps(value, sort_keys=True).encode())
        path.chmod(0o600)
        return m.reference(path)

    def run_source(self, **kwargs):
        return m.invoke('conservation', self.binding, 'local-source', self.input,
                        self.output, self.source_pin, self.exe_pin, self.closure, self.executable, local_fixture_root=self.root, **kwargs)

    def test_actual_child_proc_source_and_raw_output_binding(self):
        result = self.run_source()
        receipt = result['receipt']
        self.assertEqual(set(receipt), {'schemaVersion', 'kind', 'binding', 'producerId', 'source', 'executable', 'pid', 'processStart', 'startedAt', 'endedAt', 'namespaces', 'providerBindingSha256', 'inputs', 'output', 'exitCode', 'ownedChildrenJoined'})
        self.assertEqual(receipt['source'], self.closure['source_invocation_receipt'])
        self.assertIn(self.closure['isolated_conservation_evidence_producer'], receipt['inputs'])
        self.assertEqual(receipt['executable']['sha256'], self.exe_pin)
        self.assertGreater(receipt['pid'], 1)
        self.assertTrue(receipt['processStart'].isdigit())
        self.assertTrue(all(v.isdigit() for v in receipt['namespaces'].values()))
        self.assertFalse(Path('/proc', str(receipt['pid'])).exists())
        self.assertTrue(receipt['ownedChildrenJoined'])
        self.assertEqual(receipt['exitCode'], 0)
        self.assertLessEqual(receipt['startedAt'], receipt['endedAt'])
        self.assertEqual(m.reference(result['output']['path']), receipt['output'])
        self.assertEqual(json.loads(m.read_reference(result['invocation'])), receipt)
        output = json.loads(m.read_reference(result['output']))
        self.assertTrue(output['collectionVerified'])
        self.assertFalse(output['qualified'])
        self.assertFalse(output['prepared'])
        with self.assertRaisesRegex(ValueError, 'OUTPUT_EXISTS'):
            self.run_source()

    def test_pins_unsupported_and_input_tamper_before_spawn(self):
        with patch.object(m.subprocess, 'Popen') as spawn:
            for operation, src, exe in [('unknown', self.source_pin, self.exe_pin), ('conservation', '0' * 64, self.exe_pin), ('conservation', self.source_pin, '0' * 64)]:
                with self.assertRaises(ValueError):
                    m.invoke(operation, self.binding, 'local-source', self.input, self.output, src, exe, self.closure, self.executable, local_fixture_root=self.root)
            Path(self.input['path']).write_text('{}')
            with self.assertRaisesRegex(ValueError, 'INPUT_HASH'):
                self.run_source()
            spawn.assert_not_called()

    def test_actual_source_failure_is_joined_no_receipt(self):
        self.input = self.put({'binding': {}})
        children = []
        original = subprocess.Popen
        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            return child
        with patch.object(m.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaisesRegex(ValueError, 'SOURCE_FAILED'):
                self.run_source()
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].returncode)
        self.assertFalse(list(self.output.iterdir()))

    def test_leader_exit_term_defiant_grandchild_is_actually_joined(self):
        m.enable_subreaper()
        ready_read, ready_write = os.pipe()
        code = """import os,signal,sys
pid=os.fork()
if pid:
 os._exit(0)
signal.signal(signal.SIGTERM,signal.SIG_IGN)
os.write(int(sys.argv[1]),(str(os.getpid())+'\\n').encode())
os.close(int(sys.argv[1]))
while True:signal.pause()
"""
        child = subprocess.Popen([self.executable['path'], '-I', '-c', code, str(ready_write)],
                                 pass_fds=(ready_write,), start_new_session=True)
        os.close(ready_write)
        try:
            grandchild = int(os.read(ready_read, 32).strip())
            child.wait(timeout=2)
            self.assertTrue(Path('/proc', str(grandchild)).exists())
            m.stop_join(child)
            self.assertFalse(Path('/proc', str(grandchild)).exists())
            with self.assertRaises(ChildProcessError):
                os.waitpid(grandchild, os.WNOHANG)
        finally:
            m.stop_join(child)
            os.close(ready_read)

    def test_exact_modes_and_transitive_module_pin_fail_before_spawn(self):
        module = self.closure['isolated_rehearsal']
        with patch.object(m.subprocess, 'Popen') as spawn:
            Path(module['path']).chmod(0o644)
            with self.assertRaisesRegex(ValueError, 'FILE_TRUST'):
                self.run_source()
            Path(module['path']).chmod(0o700)
            Path(module['path']).write_text('raise RuntimeError("foreign module")')
            with self.assertRaisesRegex(ValueError, 'MODULE_PIN'):
                self.run_source()
            spawn.assert_not_called()

    def test_owner_uid_and_gid_rejected_before_spawn(self):
        original = os.fstat
        for field in (4, 5):
            def foreign(fd):
                values = list(original(fd))
                values[field] = 99999
                return os.stat_result(values)
            with self.subTest(field=field), patch.object(m.os, 'fstat', side_effect=foreign), patch.object(m.subprocess, 'Popen') as spawn:
                with self.assertRaisesRegex(ValueError, 'FILE_TRUST'):
                    self.run_source()
                spawn.assert_not_called()

    def test_isolated_fd_import_ignores_hostile_cwd_module(self):
        hostile = self.output / 'isolated_rehearsal.py'
        hostile.write_text('raise RuntimeError("ambient module loaded")')
        hostile.chmod(0o600)
        original = subprocess.Popen
        def spawn(*args, **kwargs):
            return original(*args, cwd=self.output, **kwargs)
        with patch.object(m.subprocess, 'Popen', side_effect=spawn):
            result = self.run_source()
        self.assertEqual(result['receipt']['exitCode'], 0)
        self.assertIn(self.closure['isolated_rehearsal'], result['receipt']['inputs'])

    def test_timeout_joins_owned_child(self):
        children = []
        original = subprocess.Popen
        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            children.append(child)
            os.kill(child.pid, signal.SIGSTOP)
            return child
        with patch.object(m.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaisesRegex(ValueError, 'WORKER_START'):
                self.run_source(timeout_seconds=.05)
        self.assertIsNotNone(children[0].returncode)
        self.assertFalse(Path('/proc', str(children[0].pid)).exists())
        self.assertFalse(list(self.output.iterdir()))


if __name__ == '__main__':
    unittest.main()
