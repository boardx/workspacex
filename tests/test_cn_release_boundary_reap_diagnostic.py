"""Local diagnostics/fixture-shape regressions, never Linux execution evidence."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch,Mock
from types import SimpleNamespace
import io
import contextlib

SOURCE = Path(__file__).with_name('cn_release_boundary_reap_linux.py')
spec = importlib.util.spec_from_file_location('reap_diagnostic', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReapDiagnostic(unittest.TestCase):
    def test_large_secret_text_is_only_hashed(self):
        raw = b'password=do-not-output token=hidden https://secret.invalid/' * 2000
        value = m.child_diagnostic('child-exit', 1, raw, raw)
        encoded = json.dumps(value)
        self.assertLessEqual(len(encoded.encode()), 8192)
        for secret in ('do-not-output', 'hidden', 'secret.invalid', 'password='):
            self.assertNotIn(secret, encoded)
        self.assertEqual(value['stdout']['bytes'], len(raw))
        self.assertEqual(value['stdout']['sha256'], hashlib.sha256(raw).hexdigest())

    def test_allowlisted_reason_and_owned_process_facts_survive(self):
        out = json.dumps({'workerFailure': {'group': 100, 'expectedChild': 101,
            'adoptedChildren': [101], 'states': ['Z'], 'reason': 'TIMEOUT', 'exitCode': -9,
            'extra': 'secret-not-exported'}}).encode()
        value = m.child_diagnostic('child-exit', 1, out, b'RuntimeError: ADOPTED_MEMBER_NOT_OWNED_ZOMBIE\n')
        self.assertEqual(value['reasonCodes'], ['ADOPTED_MEMBER_NOT_OWNED_ZOMBIE'])
        self.assertEqual(value['workerFacts']['states'], ['Z'])
        self.assertNotIn('secret-not-exported', json.dumps(value))

    def test_unknown_stage_and_reason_do_not_escape(self):
        value = m.child_diagnostic('secret-stage', 1, b'not json', b'RuntimeError: PRIVATE_SECRET\n')
        self.assertEqual(value['stage'], 'unknown')
        self.assertEqual(value['reasonCodes'], [])
        self.assertEqual(value['workerFacts'], {})

    def test_fixed_source_frame_and_errno_without_traceback_text(self):
        raw = b'  File "/secret/path/cn_release_boundary_reap_linux.py", line 77, in worker\nPermissionError: [Errno 13] secret filename\n'
        value = m.child_diagnostic('child-exit', 1, stderr=raw)
        self.assertEqual(value['sourceFrames'], [{'file': 'cn_release_boundary_reap_linux.py', 'line': 77}])
        self.assertEqual(value['errorTypes'], ['PermissionError'])
        self.assertEqual(value['errno'], [13])
        self.assertNotIn('secret', json.dumps(value))

    def test_malformed_worker_objects_do_not_mask_failure(self):
        for value in ([], None, 'secret', {'workerFailure': []}, {'workerFailure': None}):
            self.assertEqual(m.child_diagnostic('child-exit', 1, json.dumps(value).encode())['workerFacts'], {})

    def test_invalid_process_facts_do_not_escape(self):
        out = json.dumps({'workerFailure': {'group': True, 'expectedChild': 'secret',
            'adoptedChildren': ['secret'], 'states': ['secret'], 'reason': 'secret'}}).encode()
        self.assertEqual(m.child_diagnostic('child-json', 0, out)['workerFacts'], {})

    def test_counterexample_requires_real_child_handshake_and_retained_parent(self):
        tree = ast.parse(SOURCE.read_text())
        worker = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'worker')
        raw = m.stopped_action()
        self.assertIn(b'--stopped-child "$$" &\nwait "$!"\n',raw)
        self.assertNotIn(b'\\nwait', raw)
        text = SOURCE.read_text()
        self.assertIn("adopted == [expected_child]", text)
        self.assertIn("not entry.alive(group)", text)
        self.assertIn("not entry.alive(new_group)", text)

    def test_foreign_parent_group_session_and_reused_ticks_are_rejected(self):
        value=dict(pid=101,state='S',ppid=1,group=101,session=101,ticks=42)
        m.validate_parent(value,101,102)
        for patch in ({'pid':103},{'group':103},{'session':103},{'ticks':0}):
            with self.assertRaisesRegex(RuntimeError,'STOP_PARENT_IDENTITY'):
                m.validate_parent({**value,**patch},101,102)
        with self.assertRaisesRegex(RuntimeError,'STOP_PARENT_IDENTITY'):m.validate_parent(value,101,101)
        m.same_parent(value,{**value,'state':'T'})
        with self.assertRaisesRegex(RuntimeError,'STOP_PARENT_CHANGED'):m.same_parent(value,{**value,'ticks':43})

    def test_reused_parent_instance_never_receives_stop(self):
        parent=dict(pid=101,state='S',ppid=100,group=101,session=101,ticks=42)
        child=dict(pid=102,state='R',ppid=101,group=101,session=101,ticks=43)
        with patch.object(m.os,'getpid',return_value=102),patch.object(m.os,'getppid',return_value=101),patch.object(m,'process_identity',side_effect=[parent,child,{**parent,'ticks':99}]),patch.object(m.os,'pidfd_open',return_value=55,create=True),patch.object(m.os,'close')as close,patch.object(m.signal,'pidfd_send_signal',create=True)as stop:
            with self.assertRaisesRegex(RuntimeError,'STOP_PARENT_CHANGED'):m.stopped_child(101)
            stop.assert_not_called();close.assert_called_once_with(55)

    def test_main_runs_three_independent_workers_and_closes_domain_once(self):
        domain=Mock();domain.close.return_value={'verified':True}
        children=[SimpleNamespace(returncode=0,stdout=Mock(),stderr=Mock(),communicate=Mock(return_value=(b'{"verified":true}',b'')))for _ in range(3)]
        domain.spawn.side_effect=children
        def load(module):module.Domain=lambda:domain
        spec=SimpleNamespace(loader=SimpleNamespace(exec_module=load))
        with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.object(m.importlib.util,'spec_from_file_location',return_value=spec),patch.object(m.importlib.util,'module_from_spec',return_value=SimpleNamespace()),contextlib.redirect_stdout(io.StringIO())as out:
            self.assertEqual(m.main(),0)
        result=json.loads(out.getvalue());self.assertEqual(result['roundCount'],3);self.assertEqual(len(result['rounds']),3);self.assertTrue(all(r['verified']for r in result['rounds']))
        self.assertEqual(domain.spawn.call_count,3);domain.close.assert_called_once_with(children[-1])
        for child in children:child.communicate.assert_called_once_with(timeout=15)

    def test_failed_second_worker_cannot_skip_to_green(self):
        domain=Mock();domain.close.return_value={'verified':True}
        children=[SimpleNamespace(returncode=0,stdout=Mock(),stderr=Mock(),communicate=Mock(return_value=(json.dumps({'verified':v}).encode(),b'')))for v in (True,False,True)]
        domain.spawn.side_effect=children
        spec=SimpleNamespace(loader=SimpleNamespace(exec_module=lambda module:setattr(module,'Domain',lambda:domain)))
        with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.object(m.importlib.util,'spec_from_file_location',return_value=spec),patch.object(m.importlib.util,'module_from_spec',return_value=SimpleNamespace()):
            with self.assertRaisesRegex(RuntimeError,'COUNTEREXAMPLE_UNVERIFIED'):m.main()
        self.assertEqual(domain.spawn.call_count,2);domain.close.assert_called_once_with(children[1])


if __name__ == '__main__':
    unittest.main()
