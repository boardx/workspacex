"""Connection-only recovery uses a single deadline; no model or tool is replayed."""
import asyncio

import httpx
import pytest
from langchain_core.messages import HumanMessage

from deep_agent_service import run_control
from test_run_control import CALLBACK, response, value


@pytest.mark.parametrize('asynchronous', [False, True])
def test_multiple_connection_refusals_recover_same_checkpoint_ack(monkeypatch, asynchronous):
    monkeypatch.setattr(run_control, 'get_config', lambda: {'configurable': {'run_control_callback': CALLBACK}})
    calls = []
    def post(url, **kwargs):
        calls.append(kwargs['json'].copy())
        if len(calls) <= 2:
            raise httpx.ConnectError('synthetic connection refusal')
        return response([value('next')])
    async def apost(self, url, **kwargs):
        return post(url, **kwargs)
    monkeypatch.setattr(run_control.httpx, 'post', post)
    monkeypatch.setattr(run_control.httpx.AsyncClient, 'post', apost)
    state = {'messages': [HumanMessage('checkpointed', id='interjection:old')]}
    result = asyncio.run(run_control.apoll_interjections(state)) if asynchronous else run_control.poll_interjections(state)
    assert result == [value('next')]
    assert calls == [{'orgId': 'org-a', 'acknowledgedIds': ['old']}] * 3


@pytest.mark.parametrize('asynchronous', [False, True])
@pytest.mark.parametrize('failure', [httpx.ConnectError, httpx.ConnectTimeout])
def test_permanent_failure_stops_at_one_deadline_with_clamped_attempts(monkeypatch, asynchronous, failure):
    monkeypatch.setattr(run_control, 'get_config', lambda: {'configurable': {'run_control_callback': CALLBACK}})
    now = [0.0]
    calls, waits = [], []
    def sleep(delay):
        waits.append(delay)
        now[0] += delay
    async def asleep(delay):
        sleep(delay)
    def post(url, **kwargs):
        calls.append((now[0], kwargs['timeout']))
        if failure is httpx.ConnectTimeout:
            now[0] += kwargs['timeout']
        raise failure('synthetic refused')
    async def apost(self, url, **kwargs):
        return post(url, **kwargs)
    monkeypatch.setattr(run_control, '_monotonic', lambda: now[0])
    monkeypatch.setattr(run_control, '_sleep', sleep)
    monkeypatch.setattr(run_control, '_asleep', asleep)
    monkeypatch.setattr(run_control.httpx, 'post', post)
    monkeypatch.setattr(run_control.httpx.AsyncClient, 'post', apost)
    with pytest.raises(failure):
        if asynchronous:
            asyncio.run(run_control.apoll_interjections({'messages': []}))
        else:
            run_control.poll_interjections({'messages': []})
    budget = run_control.CONTROL_CONNECT_RECOVERY_SECONDS
    assert now[0] == pytest.approx(budget)
    assert len(calls) > 2
    assert all(0 < timeout <= min(5, budget - started) for started, timeout in calls)
    assert all(0 < delay <= 0.5 for delay in waits)


def test_async_cancellation_stops_reconnecting_immediately(monkeypatch):
    monkeypatch.setattr(run_control, 'get_config', lambda: {'configurable': {'run_control_callback': CALLBACK}})
    calls = []
    entered = asyncio.Event()
    async def post(self, url, **kwargs):
        calls.append(1)
        raise httpx.ConnectError('synthetic refused')
    async def sleep(delay):
        entered.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(run_control.httpx.AsyncClient, 'post', post)
    monkeypatch.setattr(run_control, '_asleep', sleep)
    async def exercise():
        task = asyncio.create_task(run_control.apoll_interjections({'messages': []}))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(exercise())
    assert calls == [1]


@pytest.mark.parametrize('asynchronous', [False, True])
@pytest.mark.parametrize('control', [None, 'pause', 'cancel'])
def test_callback_recovery_continues_graph_without_replaying_completed_tool(monkeypatch, asynchronous, control):
    from typing import TypedDict
    from langgraph.graph import START, END, StateGraph
    from langgraph.checkpoint.memory import InMemorySaver
    class State(TypedDict):
        completed: int
    calls, tools = [], []
    requested = [control]
    def post(*args, **kwargs):
        calls.append(kwargs['json'].copy())
        if len(calls) <= 2:
            raise httpx.ConnectError('synthetic refused')
        return httpx.Response(200, json={'interjections': [], 'pauseRequested': requested[0] == 'pause', 'cancelRequested': requested[0] == 'cancel'}, request=httpx.Request('POST', 'http://gateway/poll'))
    async def apost(self, url, **kwargs):
        return post(url, **kwargs)
    async def asleep(delay):
        pass
    monkeypatch.setattr(run_control.httpx, 'post', post)
    monkeypatch.setattr(run_control.httpx.AsyncClient, 'post', apost)
    monkeypatch.setattr(run_control, '_sleep', lambda delay: None)
    monkeypatch.setattr(run_control, '_asleep', asleep)
    def tool(state):
        tools.append('committed')
        return {'completed': state['completed'] + 1}
    def boundary(state):
        run_control.poll_interjections(state, pause_at_boundary=True)
        return state
    async def aboundary(state):
        await run_control.apoll_interjections(state, pause_at_boundary=True)
        return state
    builder = StateGraph(State)
    builder.add_node('tool', tool)
    builder.add_node('boundary', aboundary if asynchronous else boundary)
    builder.add_edge(START, 'tool')
    builder.add_edge('tool', 'boundary')
    builder.add_edge('boundary', END)
    graph = builder.compile(checkpointer=InMemorySaver())
    config = {'configurable': {'thread_id': 'reconnect', 'run_control_callback': CALLBACK}}
    result = asyncio.run(graph.ainvoke({'completed': 0}, config)) if asynchronous else graph.invoke({'completed': 0}, config)
    assert result['completed'] == 1
    assert tools == ['committed']
    assert len(calls) == 3
    assert calls[0] == calls[1] == calls[2]
    if control:
        from langgraph.types import Command
        assert result['__interrupt__'][0].value == {'kind': 'user_' + control}
        requested[0] = None
        resumed = asyncio.run(graph.ainvoke(Command(resume=True), config)) if asynchronous else graph.invoke(Command(resume=True), config)
        assert '__interrupt__' not in resumed
        assert resumed['completed'] == 1
        assert tools == ['committed']
    else:
        assert '__interrupt__' not in result


@pytest.mark.parametrize('asynchronous', [False, True])
def test_invalid_callback_body_is_not_retried(monkeypatch, asynchronous):
    monkeypatch.setattr(run_control, 'get_config', lambda: {'configurable': {'run_control_callback': CALLBACK}})
    calls = []
    def post(*args, **kwargs):
        calls.append(1)
        return httpx.Response(200, json={'interjections': 'invalid'}, request=httpx.Request('POST', 'http://gateway/poll'))
    async def apost(self, *args, **kwargs):
        return post(*args, **kwargs)
    monkeypatch.setattr(run_control.httpx, 'post', post)
    monkeypatch.setattr(run_control.httpx.AsyncClient, 'post', apost)
    with pytest.raises(ValueError):
        if asynchronous:
            asyncio.run(run_control.apoll_interjections({'messages': []}))
        else:
            run_control.poll_interjections({'messages': []})
    assert calls == [1]


@pytest.mark.parametrize('asynchronous', [False, True])
def test_late_success_response_never_allows_execution_past_deadline(monkeypatch, asynchronous):
    monkeypatch.setattr(run_control, 'get_config', lambda: {'configurable': {'run_control_callback': CALLBACK}})
    now = [0.0]
    calls = []
    def post(*args, **kwargs):
        calls.append(1)
        now[0] = run_control.CONTROL_CONNECT_RECOVERY_SECONDS + 1
        return response()
    async def apost(self, *args, **kwargs):
        return post(*args, **kwargs)
    monkeypatch.setattr(run_control, '_monotonic', lambda: now[0])
    monkeypatch.setattr(run_control.httpx, 'post', post)
    monkeypatch.setattr(run_control.httpx.AsyncClient, 'post', apost)
    with pytest.raises(httpx.ReadTimeout):
        if asynchronous:
            asyncio.run(run_control.apoll_interjections({'messages': []}))
        else:
            run_control.poll_interjections({'messages': []})
    assert calls == [1]


def test_later_inflight_timeout_is_not_replaced_by_an_older_connect_error(monkeypatch):
    monkeypatch.setattr(run_control, 'get_config', lambda: {'configurable': {'run_control_callback': CALLBACK}})
    monkeypatch.setattr(run_control, 'CONTROL_CONNECT_RECOVERY_SECONDS', 0.05)
    monkeypatch.setattr(run_control, '_CONTROL_CONNECT_BACKOFF_SECONDS', 0.005)
    calls = []
    async def post(self, *args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError('old refused connection')
        await asyncio.Event().wait()  # connected, now waiting for a response
    monkeypatch.setattr(run_control.httpx.AsyncClient, 'post', post)
    with pytest.raises(TimeoutError):
        asyncio.run(run_control.apoll_interjections({'messages': []}))
    assert len(calls) == 2
