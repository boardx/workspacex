"""Shared native composition uses the cloud browser adapter without replaying unknown actions."""
import asyncio
import httpx
import pytest
from langchain_core.messages import AIMessage
from deep_agent_service import native_factory as factory
from deep_agent_service import standard_browser_tools as browser
from deep_agent_service.native_graph import create_native_graph
from native_sandbox_fixture import FakeAuthority
from test_native_factory import config, resolved
from test_native_graph import model, sandbox


@pytest.mark.parametrize("admitted", [False, True])
def test_real_native_factory_registers_all_shared_browser_tools(monkeypatch,admitted):
    value=config();value['configurable']['org_skills']=[]
    answer=resolved();answer['interruptOn']={tool.name:True for tool in browser.standard_browser_tools()} if admitted else {};answer['packageDigest']=factory._package_set_digest([])
    async def resolve(*_):return answer
    monkeypatch.setenv('NATIVE_SESSION_SOCKET','/run/native.sock')
    monkeypatch.setattr(factory,'_resolve',resolve)
    monkeypatch.setattr(factory,'_sandbox_client',lambda _:httpx.Client(transport=httpx.MockTransport(lambda _:httpx.Response(500))))
    monkeypatch.setattr(factory,'_shared_runtime',lambda:(model(),None,[]))
    seen=[]
    class Graph:
        def with_config(self,_):return self
    def create(*args,**kwargs):seen.extend(kwargs['tools']);return Graph()
    monkeypatch.setattr(factory,'create_native_graph',create)
    async def run():
        async with factory.native_graph_context(value):pass
    asyncio.run(run())
    selected={tool.name:tool for tool in seen}
    for tool in browser.standard_browser_tools():
        if not admitted:
            assert tool.name not in selected
            continue
        assert tool.name in selected
        assert selected[tool.name].coroutine.__code__ is tool.coroutine.__code__
        assert selected[tool.name].args_schema==tool.args_schema
    assert 'browser_evaluate' not in selected


def test_native_browser_unknown_action_is_dispatched_once(monkeypatch):
    calls=[]
    async def unknown(name,args,runtime):
        calls.append((name,args))
        raise browser.StandardBrowserError('Browser action has an unknown outcome')
    monkeypatch.setattr(browser,'_invoke',unknown)
    adapter=sandbox()
    m=model(AIMessage(content='',tool_calls=[{'id':'real-browser-call','name':'browser_click','args':{'pageRef':'page:'+'a'*64,'elementRef':'element:'+'b'*64}}]),AIMessage(content='unknown'))
    graph=create_native_graph(m,sandbox=adapter,pinned_skills=[],tools=browser.standard_browser_tools(),
        interrupt_on={},tool_authority=FakeAuthority())
    async def run():return await graph.ainvoke({'messages':[{'role':'user','content':'click'}]},{'configurable':{'disable_task_auto_classify':True}})
    with pytest.raises(browser.StandardBrowserError):asyncio.run(run())
    assert len(calls)==1
    adapter._client.close()
