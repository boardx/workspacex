"""Real uploaded PNG → upstream read_file → image-capable fake model."""
import asyncio
import base64
import random
import struct
import zlib

import pytest
from langchain_core.messages import AIMessage
from pydantic import Field

from deep_agent_service.native_graph import create_native_graph
from native_sandbox_fixture import FakeAuthority
from native_sandbox_fixture import real_native_session
from test_native_graph import ScriptedModel


def png_bytes(width):
    def chunk(kind, payload):
        return struct.pack('!I', len(payload)) + kind + payload + struct.pack('!I', zlib.crc32(kind + payload))
    rng = random.Random(20260907)
    pixels = b''.join(b'\0' + rng.randbytes(width * 3) for _ in range(width))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, width, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b''))


class ImageRecordingModel(ScriptedModel):
    observed: list = Field(default_factory=list)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.observed.append(messages)
        return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


@pytest.mark.parametrize('asynchronous', [False, True])
@pytest.mark.parametrize('width', [16, 160])
def test_uploaded_png_reaches_image_capable_model(width, asynchronous):
    payload = png_bytes(width)
    if width == 160:
        assert 64 * 1024 < len(payload) < 500 * 1024
    model = ImageRecordingModel(profile={'image_inputs': True}, messages=iter([
        AIMessage(content='', tool_calls=[{'id': 'png', 'name': 'read_file', 'args': {'file_path': '/workspace/screenshot.png'}}]),
        AIMessage(content='Image received'),
    ]))
    with real_native_session([]) as (adapter, _):
        assert adapter.upload_files([('/workspace/screenshot.png', payload)])[0].error is None
        read = asyncio.run(adapter.aread('/workspace/screenshot.png')) if asynchronous else adapter.read('/workspace/screenshot.png')
        assert read.error is None
        graph = create_native_graph(model, sandbox=adapter, pinned_skills=[], tool_authority=FakeAuthority(), interrupt_on={})
        graph.invoke({'messages': [{'role': 'user', 'content': 'Read the uploaded image.'}]},
                     config={'configurable': {'disable_task_auto_classify': True}})
    blocks = [block for messages in model.observed for message in messages
              if isinstance(message.content, list) for block in message.content
              if isinstance(block, dict) and block.get('type') in ('image', 'image_url')]
    assert blocks, f'The model never received image content: {model.observed[-1]}'
    assert any(base64.b64encode(payload).decode() in str(block) for block in blocks)


@pytest.mark.parametrize('asynchronous', [False, True])
def test_read_error_and_capture_cleanup(asynchronous):
    with real_native_session([]) as (adapter, _):
        for path in ('/workspace/missing.png', '/workspace/oversize.png'):
            if 'oversize' in path:
                assert adapter.upload_files([(path, b'\x89PNG' + bytes(501 * 1024))])[0].error is None
            result = asyncio.run(adapter.aread(path)) if asynchronous else adapter.read(path)
            assert result.error
        listing = adapter.execute("find /workspace -name '.native-read-*'")
        assert listing.exit_code == 0 and listing.output == ''


@pytest.mark.parametrize('failure', ['truncated', 'exit', 'unknown_exit', 'download', 'invalid_json'])
def test_capture_failure_never_succeeds_and_cleans(monkeypatch, failure):
    from deepagents.backends.protocol import ExecuteResponse, ExecuteOffloadResult, FileDownloadResponse
    from deep_agent_service.sandbox_backend import _ReadCaptureSandbox
    from test_sandbox_backend import sandbox, result
    calls = []
    def handle(request):
        import json
        calls.append(json.loads(request.content)['command'])
        return result(request, output='')
    adapter = sandbox(handle)
    captured = ExecuteOffloadResult(offloaded=failure == 'download', response=ExecuteResponse(
        output='invalid', exit_code=None if failure == 'unknown_exit' else (2 if failure == 'exit' else 0), truncated=failure == 'truncated'))
    monkeypatch.setattr(_ReadCaptureSandbox, 'execute_with_offload', lambda *a, **kw: captured)
    monkeypatch.setattr(adapter, 'download_files', lambda paths: [FileDownloadResponse(path=paths[0], error='file_not_found')])
    assert adapter.read('/workspace/x').error
    assert len(calls) == 1 and calls[0].startswith('rm -f -- /workspace/.native-read-')
    assert calls[0].endswith('.json.ec')


def test_capture_mode_is_scoped_and_unknown_upstream_fails_closed(monkeypatch):
    from deep_agent_service import sandbox_backend as module
    from test_sandbox_backend import sandbox
    adapter = sandbox(lambda _: pytest.fail('must not execute'))
    assert adapter.enable_capture_offload is False
    assert module._ReadCaptureSandbox.enable_capture_offload is True
    monkeypatch.setattr(module.inspect, 'getsource', lambda _: 'changed upstream')
    with pytest.raises(module.SandboxTransportError, match='helpers changed'):
        adapter.read('/workspace/x')
