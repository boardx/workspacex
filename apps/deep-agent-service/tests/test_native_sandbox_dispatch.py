import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import uuid4

import pytest
from langchain.agents import create_agent
from langchain_core.messages import AIMessage
from langchain_core.tools import tool

from deep_agent_service.native_sandbox_dispatch import NativeSandboxDispatch, SandboxDispatchError
from deep_agent_service.native_tool_authority import NativeToolAuthority, ToolAuthorityError
from native_sandbox_fixture import real_native_session
from test_native_graph import ScriptedModel


def request(name='execute', ident='call'):
    return SimpleNamespace(tool_call={'name':name,'id':ident,'args':{}})


def test_official_graph_serializes_parallel_calls_before_fresh_authority():
    async def scenario():
        active=0;peak=0;events=[]
        @tool
        async def consumer(value:int)->str:
            """Consume the single test session slot."""
            nonlocal active,peak
            active+=1;peak=max(peak,active);events.append(('start',value))
            await asyncio.sleep(.02);events.append(('end',value));active-=1
            return str(value)
        class Authority:
            def check(self,call):raise AssertionError('async only')
            async def acheck(self,call):events.append(('auth',call['args']['value']))
        graph=create_agent(ScriptedModel(messages=iter([AIMessage(content='',tool_calls=[{'name':'consumer','id':str(n),'args':{'value':n}} for n in [1,2]]),AIMessage(content='done')])),tools=[consumer],middleware=[NativeSandboxDispatch(str(uuid4())),NativeToolAuthority(Authority())])
        await graph.ainvoke({'messages':[{'role':'user','content':'both'}]})
        assert peak==1
        order=[value for kind,value in events if kind=='auth']
        assert sorted(order)==[1,2]
        assert events==[(kind,value) for value in order for kind in ['auth','start','end']]
    asyncio.run(scenario())


def test_queue_timeout_capacity_and_cancel_never_dispatch():
    async def scenario():
        gate=NativeSandboxDispatch(str(uuid4()),queue_timeout=.04,max_pending=1)
        entered=asyncio.Event();release=asyncio.Event();calls=[]
        async def holding(req):entered.set();await release.wait();return 'held'
        async def late(req):calls.append(req.tool_call['id']);return 'late'
        first=asyncio.create_task(gate.awrap_tool_call(request(),holding));await entered.wait()
        waiting=asyncio.create_task(gate.awrap_tool_call(request(ident='timeout'),late));await asyncio.sleep(.01)
        with pytest.raises(SandboxDispatchError,match='capacity'):await gate.awrap_tool_call(request(ident='full'),late)
        with pytest.raises(SandboxDispatchError,match='timed out'):await waiting
        canceled=asyncio.create_task(gate.awrap_tool_call(request(ident='canceled'),late));await asyncio.sleep(.01);canceled.cancel()
        with pytest.raises(asyncio.CancelledError):await canceled
        release.set();await first
        assert calls==[]
        assert await gate.awrap_tool_call(request(ident='after'),late)=='late'
        assert calls==['after']
    asyncio.run(scenario())


def test_queued_permission_is_checked_after_release_and_failure_does_not_poison_gate():
    async def scenario():
        gate=NativeSandboxDispatch(str(uuid4()));allowed=True;entered=asyncio.Event();release=asyncio.Event();calls=[]
        class Authority:
            def check(self,call):raise AssertionError()
            async def acheck(self,call):
                if not allowed:raise ToolAuthorityError('revoked')
        authority=NativeToolAuthority(Authority())
        async def holding(req):entered.set();await release.wait()
        async def handler(req):calls.append('dispatched')
        first=asyncio.create_task(gate.awrap_tool_call(request(),holding));await entered.wait()
        queued=asyncio.create_task(gate.awrap_tool_call(request(),lambda req:authority.awrap_tool_call(req,handler)))
        await asyncio.sleep(.01);allowed=False;release.set();await first
        with pytest.raises(ToolAuthorityError):await queued
        assert calls==[]
        allowed=True;await gate.awrap_tool_call(request(),lambda req:authority.awrap_tool_call(req,handler));assert calls==['dispatched']
    asyncio.run(scenario())


def test_active_cancellation_waits_for_handler_settlement_and_control_bypasses_queue():
    async def scenario():
        gate=NativeSandboxDispatch(str(uuid4()));entered=asyncio.Event();release=asyncio.Event();events=[]
        async def holding(req):entered.set();await release.wait();events.append('settled')
        async def next_handler(req):events.append(req.tool_call['name'])
        first=asyncio.create_task(gate.awrap_tool_call(request(),holding));await entered.wait();first.cancel()
        await gate.awrap_tool_call(request('wx_run_cancel'),next_handler)
        second=asyncio.create_task(gate.awrap_tool_call(request('read_file'),next_handler));await asyncio.sleep(.02)
        assert events==['wx_run_cancel'];assert not first.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):await first
        await second;assert events==['wx_run_cancel','settled','read_file']
    asyncio.run(scenario())


def test_sync_workers_share_gate():
    gate=NativeSandboxDispatch(str(uuid4()));active=0;peak=0;guard=threading.Lock()
    def handler(req):
        nonlocal active,peak
        with guard:active+=1;peak=max(active,peak)
        threading.Event().wait(.01)
        with guard:active-=1
        return 'read child complete'
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert [f.result() for f in [pool.submit(gate.wrap_tool_call,request('task'),handler),pool.submit(gate.wrap_tool_call,request('read_file'),handler)]]==['read child complete']*2
    assert peak==1


def test_real_session_parallel_http_consumers_conflict_without_gate_and_succeed_with_it():
    # Models/HTTP-consumer tool bodies are fixtures; E003 execution and 409 are real.
    with real_native_session() as (sandbox,_):
        async def scenario(gated):
            start=asyncio.Event();arrived=0;statuses=[]
            @tool
            async def consume(value:int)->str:
                """Use the actual independently transported sandbox execution slot."""
                nonlocal arrived
                if not gated:
                    arrived+=1
                    if arrived==2:start.set()
                    await start.wait()
                response=await asyncio.to_thread(sandbox._client.post,f'/sessions/{sandbox.id}/executions',headers={'Authorization':f'Bearer {sandbox._token}'},json={'executionId':str(uuid4()),'command':"python3 -c 'import time; time.sleep(0.15); print(42)'",'timeoutMs':5000})
                statuses.append(response.status_code);return str(response.status_code)
            graph=create_agent(ScriptedModel(messages=iter([AIMessage(content='',tool_calls=[{'name':'consume','id':str(n),'args':{'value':n}} for n in [1,2]]),AIMessage(content='done')])),tools=[consume],middleware=[NativeSandboxDispatch(sandbox.id)] if gated else [])
            await graph.ainvoke({'messages':[{'role':'user','content':'both'}]})
            return sorted(statuses)
        assert asyncio.run(scenario(False))==[200,409]
        assert asyncio.run(scenario(True))==[200,200]
