import json
import ssl
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, call, patch

import httpcore
import httpx
import openai

from deep_agent_service.error_diagnostics import MAX_CAUSE_NODES, log_private_run_failure, private_error_diagnostic


SECRET = "sk-private-key prompt password=https://private.invalid?token=private"
RUN_ID = "11111111-1111-4111-8111-111111111111"


class RecordingLogger:
    def __init__(self): self.lines = []
    def warning(self, message): self.lines.append(message)


class ErrorDiagnosticTests(unittest.TestCase):
    def test_real_library_cause_chain_retains_only_fixed_classes_and_numeric_ssl_facts(self):
        tls = ssl.SSLCertVerificationError(1, SECRET)
        tls.verify_code, tls.verify_message = 19, SECRET
        core = httpcore.ConnectError(SECRET)
        core.__cause__ = tls
        transport = httpx.ConnectError(SECRET, request=httpx.Request("GET", "https://private.invalid", headers={"Authorization": SECRET}))
        transport.__context__ = core
        sdk = openai.APIConnectionError(message=SECRET, request=httpx.Request("GET", "https://private.invalid"))
        sdk.__cause__ = transport
        logger = RecordingLogger()
        self.assertTrue(log_private_run_failure(logger, sdk, RUN_ID))
        self.assertEqual(json.loads(logger.lines[0]), {"event": "native_run_failure_diagnostic", "native_run_id": RUN_ID, "causes": [
            {"class": "APIConnectionError"}, {"class": "ConnectError"}, {"class": "ConnectError"},
            {"class": "SSLCertVerificationError", "errno": 1, "ssl_verify_code": 19},
        ], "cycle_detected": False, "truncated": False})
        for private in [SECRET, "private.invalid", "Authorization", "verify_message", "password", "token", "prompt"]:
            self.assertNotIn(private, logger.lines[0])

    def test_unknown_and_forged_same_named_classes_export_only_unknown_without_hooks_or_text(self):
        for kind in [type(SECRET, (Exception,), {}), type("APIConnectionError", (Exception,), {}), type("HTTPStatusError", (Exception,), {"status_code": 429})]:
            with self.subTest(kind_label="untrusted"):
                result = private_error_diagnostic(kind(SECRET))
                self.assertEqual(result["causes"], [{"class": "UnknownError"}])
                self.assertNotIn(SECRET, json.dumps(result))
        class NeverInspectText(Exception):
            def __str__(self): raise AssertionError("must not read exception text")
            def __repr__(self): raise AssertionError("must not read exception text")
            @property
            def status_code(self): raise AssertionError("must not inspect unknown properties")
        self.assertEqual(private_error_diagnostic(NeverInspectText(SECRET))["causes"], [{"class": "UnknownError"}])
        class UntrustedClass(type):
            def __hash__(cls): raise AssertionError("must not hash an unknown exception type")
            def __eq__(cls, _other): raise AssertionError("must not compare an unknown exception type")
        class UnknownWithHooks(Exception, metaclass=UntrustedClass):
            pass
        self.assertEqual(private_error_diagnostic(UnknownWithHooks(SECRET))["causes"], [{"class": "UnknownError"}])

    def test_cycle_and_depth_bounds_are_finite_without_reading_exception_text(self):
        first, second = RuntimeError(SECRET), ValueError(SECRET)
        first.__cause__, second.__context__ = second, first
        self.assertEqual(private_error_diagnostic(first), {"causes": [{"class": "RuntimeError"}, {"class": "ValueError"}], "cycle_detected": True, "truncated": False})
        errors = [RuntimeError(SECRET) for _ in range(20)]
        for index in range(len(errors)-1): errors[index].__cause__ = errors[index+1]
        bounded = private_error_diagnostic(errors[0])
        self.assertEqual(len(bounded["causes"]), MAX_CAUSE_NODES)
        self.assertEqual(MAX_CAUSE_NODES, 6)
        self.assertTrue(bounded["truncated"])
        self.assertFalse(bounded["cycle_detected"])

    def test_both_cause_and_suppressed_context_branches_read_once_and_shared_node_is_not_cycle(self):
        error = RuntimeError(SECRET)
        error.__context__, error.__cause__ = ValueError(SECRET), TypeError(SECRET)
        error.__suppress_context__ = True
        shared = ssl.SSLCertVerificationError(1, SECRET)
        shared.verify_code = 19
        error.__cause__.__context__, error.__context__.__cause__ = shared, shared
        graph = private_error_diagnostic(error)
        self.assertEqual([row["class"] for row in graph["causes"]], ["RuntimeError", "TypeError", "ValueError", "SSLCertVerificationError"])
        self.assertFalse(graph["cycle_detected"])
        shared.__context__ = error
        self.assertTrue(private_error_diagnostic(error)["cycle_detected"])

    def test_two_branch_graph_total_nodes_bounded_not_six_per_branch(self):
        root, pending = RuntimeError(SECRET), []
        pending.append(root)
        for _ in range(5):
            children = []
            for error in pending:
                error.__cause__, error.__context__ = ValueError(SECRET), TypeError(SECRET)
                children.extend((error.__cause__, error.__context__))
            pending = children
        graph = private_error_diagnostic(root)
        self.assertEqual(len(graph["causes"]), 6)
        self.assertTrue(graph["truncated"])
        self.assertFalse(graph["cycle_detected"])

    def test_real_http_error_types_keep_only_status_100_through_599(self):
        request = httpx.Request("GET", "https://private.invalid?token=hidden", headers={"Authorization": SECRET})
        for status in [100, 429, 599]:
            with self.subTest(status=status):
                response = httpx.Response(status, request=request, headers={"secret": SECRET}, text=SECRET)
                error = httpx.HTTPStatusError(SECRET, request=request, response=response)
                self.assertEqual(private_error_diagnostic(error)["causes"], [{"class": "HTTPStatusError", "http_status": status}])
                sdk = openai.APIStatusError(SECRET, response=response, body={"secret": SECRET})
                self.assertEqual(private_error_diagnostic(sdk)["causes"], [{"class": "APIStatusError", "http_status": status}])
        for invalid in [0, 99, 600, True, 10**100, "429", SECRET]:
            sdk = openai.APIStatusError(SECRET, response=httpx.Response(500, request=request), body={})
            sdk.status_code = invalid
            self.assertEqual(private_error_diagnostic(sdk)["causes"], [{"class": "APIStatusError"}])

    def test_bool_huge_noninteger_and_integer_subclass_codes_are_not_logged(self):
        class DerivedInt(int): pass
        for invalid in [True, 65536, -65536, 10**100, "19", 19.0, DerivedInt(19), SECRET]:
            error = ssl.SSLCertVerificationError(1, SECRET)
            error.errno, error.verify_code = invalid, invalid
            self.assertEqual(private_error_diagnostic(error)["causes"], [{"class": "SSLCertVerificationError"}])
        for errno in [-65535, -3, 0, 1, 65535]:
            error = OSError()
            error.errno = errno
            facts = private_error_diagnostic(error)["causes"][0]
            self.assertEqual(facts["errno"], errno)
        error = ssl.SSLCertVerificationError(1, SECRET)
        error.verify_code = -1
        self.assertNotIn("ssl_verify_code", private_error_diagnostic(error)["causes"][0])

    def test_invalid_run_identifier_omitted_and_failing_sink_never_masks_error(self):
        logger = RecordingLogger()
        self.assertTrue(log_private_run_failure(logger, ValueError(SECRET), SECRET))
        self.assertNotIn("native_run_id", json.loads(logger.lines[0]))
        self.assertNotIn(SECRET, logger.lines[0])
        class BrokenLogger:
            def warning(self, _message): raise RuntimeError(SECRET)
        self.assertFalse(log_private_run_failure(BrokenLogger(), ValueError(SECRET), RUN_ID))

    def test_logging_control_signals_propagate_instead_of_being_swallowed(self):
        import asyncio
        for control in [KeyboardInterrupt(), SystemExit(), asyncio.CancelledError()]:
            class StoppingLogger:
                def warning(self, _message): raise control
            with self.assertRaises(type(control)):
                log_private_run_failure(StoppingLogger(), ValueError(SECRET), RUN_ID)


class RuntimeDiagnosticBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_in_memory_asgi_poll_and_sse_keep_old_public_error_without_diagnostic_fields(self):
        import asyncio
        from deep_agent_service.http_app import create_app
        from deep_agent_service.self_hosted_runtime import Runtime

        tls = ssl.SSLCertVerificationError(1, SECRET)
        tls.verify_code = 19
        wrapped = RuntimeError(SECRET)
        wrapped.__context__ = tls
        class FailedGraph:
            async def astream(self, *_args, **_kwargs):
                raise wrapped
                yield

        # Only the existing handlers' record/read seam; no database, sockets or startup warmers.
        rows, events = {}, []
        def create_run(thread_id, run_id, _request):
            rows[run_id] = {"thread_id": thread_id, "run_id": run_id, "status": "pending", "error": None}
        def update_run(run_id, status, error=None):
            rows[run_id].update(status=status, error=error)
        def read_run(thread_id, run_id):
            row = rows.get(run_id)
            return row if row and row["thread_id"] == thread_id else None
        def append_event(_run_id, event, data):
            events.append({"sequence": len(events)+1, "event": event, "data": data})
        ledger = SimpleNamespace(get_thread=AsyncMock(return_value={"thread_id": "private-log-test"}),
            create_run=AsyncMock(side_effect=create_run), update_run=AsyncMock(side_effect=update_run),
            get_run=AsyncMock(side_effect=read_run), append_event=AsyncMock(side_effect=append_event),
            events=AsyncMock(side_effect=lambda _run_id, after=0: [row for row in events if row["sequence"] > after]))
        runtime = Runtime(ledger, lambda *_: FailedGraph())
        app = create_app(runtime)
        # Bypass lifespan: it manages real receipt replay/provider warmers, outside this unit boundary.
        app.state.runtime = runtime
        try:
            with self.assertLogs("deep_agent_service.self_hosted_runtime", level="WARNING") as logged:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://in-memory-runtime") as client:
                    created = await client.post("/threads/private-log-test/runs", json={"input": {}})
                    self.assertEqual(created.status_code, 200)
                    run_id = created.json()["run_id"]
                    await asyncio.gather(*list(runtime.tasks.values()))
                    run = await client.get(f"/threads/private-log-test/runs/{run_id}")
                    self.assertEqual(run.status_code, 200)
                    self.assertEqual(run.json(), {"thread_id": "private-log-test", "run_id": run_id, "status": "error", "error": "RuntimeError"})
                    stream = await client.get(f"/threads/private-log-test/runs/{run_id}/stream")
                    self.assertEqual(stream.status_code, 200)
                    self.assertEqual(stream.text, 'id: 1\nevent: metadata\ndata: {"status": "error"}\n\n')
                    self.assertEqual(events, [{"sequence": 1, "event": "metadata", "data": {"status": "error"}}])
                    for private in [SECRET, "native_run_failure_diagnostic", "ssl_verify_code", "causes"]:
                        self.assertNotIn(private, run.text + stream.text)
            self.assertEqual(json.loads(logged.records[0].getMessage()), {
                "event": "native_run_failure_diagnostic", "native_run_id": run_id,
                "causes": [{"class": "RuntimeError"}, {"class": "SSLCertVerificationError", "errno": 1, "ssl_verify_code": 19}],
                "cycle_detected": False, "truncated": False})
            self.assertNotIn(SECRET, "\n".join(logged.output))
        finally:
            await runtime.stop()

    async def test_actual_execute_error_and_metadata_remain_unchanged_with_private_context_log(self):
        from deep_agent_service.self_hosted_runtime import Runtime, public_run_error
        tls = ssl.SSLCertVerificationError(1, SECRET)
        tls.verify_code = 19
        error = RuntimeError(SECRET)
        error.__context__ = tls
        class FailedGraph:
            async def astream(self, *_args, **_kwargs):
                raise error
                yield
        ledger = SimpleNamespace(update_run=AsyncMock(), append_event=AsyncMock())
        runtime = Runtime(ledger, lambda *_: FailedGraph())
        with self.assertLogs("deep_agent_service.self_hosted_runtime", level="WARNING") as logged:
            await runtime._execute(RUN_ID, {"input": {}}, FailedGraph(), {})
        self.assertEqual(ledger.update_run.await_args_list, [call(RUN_ID, "running"), call(RUN_ID, "error", "RuntimeError")])
        self.assertEqual(ledger.append_event.await_args_list, [call(RUN_ID, "metadata", {"status": "error"})])
        self.assertEqual(public_run_error(ledger.update_run.await_args_list[-1].args[2]), "RuntimeError")
        self.assertNotIn(SECRET, "\n".join(logged.output))
        payload = json.loads(logged.records[0].getMessage())
        self.assertEqual(payload["causes"], [{"class": "RuntimeError"}, {"class": "SSLCertVerificationError", "errno": 1, "ssl_verify_code": 19}])
        self.assertEqual(payload["native_run_id"], RUN_ID)

    async def test_actual_execute_still_persists_original_error_when_diagnostic_sink_raises(self):
        from deep_agent_service.self_hosted_runtime import Runtime
        class FailedGraph:
            async def astream(self, *_args, **_kwargs):
                raise ValueError(SECRET)
                yield
        ledger = SimpleNamespace(update_run=AsyncMock(), append_event=AsyncMock())
        runtime = Runtime(ledger, lambda *_: FailedGraph())
        with patch("logging.Logger.warning", side_effect=RuntimeError(SECRET)):
            await runtime._execute(RUN_ID, {"input": {}}, FailedGraph(), {})
        self.assertEqual(ledger.update_run.await_args_list[-1], call(RUN_ID, "error", "ValueError"))
        self.assertEqual(ledger.append_event.await_args_list, [call(RUN_ID, "metadata", {"status": "error"})])


if __name__ == "__main__":
    unittest.main()
