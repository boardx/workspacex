"""Cross-language HTTP race: state polling must not remount an executing session.

Run with SESSION_RACE_TSX=/absolute/path/to/tsx after sandbox JS dependencies are installed.
The real SessionManager and HTTP handler enforce BUSY; only its OS process is held.
"""
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
from contextlib import asynccontextmanager

import httpx
import pytest

from deep_agent_service.http_app import create_app
from deep_agent_service.self_hosted_runtime import Runtime
from deep_agent_service.sandbox_backend import HttpSessionSandbox
from deep_agent_service.native_factory import native_config_key
from test_self_hosted_runtime import MemoryLedger, FakeGraph

@pytest.fixture
def anyio_backend(): return 'asyncio'

@pytest.mark.anyio
async def test_running_state_does_not_contend_with_real_session_execution():
    tsx = os.environ.get('SESSION_RACE_TSX')
    if not tsx:
        pytest.skip('SESSION_RACE_TSX opts into the real TypeScript session HTTP boundary')
    process = subprocess.Popen([tsx, str(Path(__file__).with_name('session_state_race_server.mts'))], stdout=subprocess.PIPE, text=True)
    assert process.stdout is not None
    try:
        port = json.loads(process.stdout.readline())['port']
        base = f'http://127.0.0.1:{port}'
        with httpx.Client(base_url=base, timeout=10) as client:
            created = client.post('/sessions', json={'skills':[{'path':'/skills/test/SKILL.md','contentBase64':base64.b64encode(b'test').decode()}]})
            created.raise_for_status(); session = created.json()
            adapter = HttpSessionSandbox(session['sessionId'], session['token'], client)
            outcome = []
            class ExecutingGraph(FakeGraph):
                async def astream(self, payload, config, stream_mode):
                    outcome.append(await asyncio.to_thread(adapter.execute, 'hold'))
                    for event in (): yield event
            graph = ExecutingGraph()
            @asynccontextmanager
            async def loader(*_):
                # Same mounted-package validation performed by create_native_graph.
                with httpx.Client(base_url=base, timeout=10) as other_client:
                    other = HttpSessionSandbox(session['sessionId'], session['token'], other_client)
                    files = await asyncio.to_thread(other.download_files, ['/skills/test/SKILL.md'])
                    if files[0].error:
                        raise ValueError('Mounted skill package does not match the trusted pin')
                    yield graph
            runtime = Runtime(MemoryLedger(), loader)
            app = create_app(runtime)
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://runtime') as api:
                    await api.post('/threads', json={'thread_id':'race'})
                    await api.post('/threads/race/runs', json={'input':{}, 'config':{'configurable':{native_config_key():{'bindingId':'12345678-1234-4234-8234-123456789012','profile':'native-v1','policy':'native-v1'}}}})
                    for _ in range(200):
                        if (await asyncio.to_thread(client.get, '/probe')).json()['busy']: break
                        await asyncio.sleep(.01)
                    else: pytest.fail('execution did not enter the real session busy slot')
                    try:
                        state = await api.get('/threads/race/state')
                        conflicts = (await asyncio.to_thread(client.get, '/probe')).json()['conflicts']
                        assert state.status_code == 200 and conflicts == 0, f'state={state.status_code}, actual HTTP 409 responses={conflicts}'
                        assert state.json()['values'] == graph.values
                    finally:
                        await asyncio.to_thread(client.post, '/release')
                        await asyncio.gather(*list(runtime.tasks.values()))
            assert outcome[0].exit_code == 0
            destroyed = client.delete('/sessions/'+session['sessionId'], headers={'Authorization':'Bearer '+session['token']})
            assert destroyed.status_code == 200
    finally:
        process.terminate()
        process.wait(timeout=10)
