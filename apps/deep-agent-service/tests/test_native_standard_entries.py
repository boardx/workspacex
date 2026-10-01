"""Shared native composition uses the cloud browser adapter without replaying unknown actions."""
import asyncio
import httpx
import pytest
from langchain_core.messages import AIMessage, ToolMessage
from deep_agent_service import native_factory as factory
from deep_agent_service.standard_artifact_download import artifact_download_tool
from deep_agent_service.standard_run_status import run_status_tool
from deep_agent_service.standard_run_cancel import run_cancel_tool

def entry_tools(): return [artifact_download_tool(),run_status_tool(),run_cancel_tool()]
from deep_agent_service.native_graph import create_native_graph
from native_sandbox_fixture import FakeAuthority
from test_native_factory import config, resolved
from test_native_graph import model, sandbox


@pytest.mark.parametrize("admitted", [False, True])
def test_real_native_factory_registers_three_standard_entries(monkeypatch,admitted):
    value=config();value['configurable']['org_skills']=[]
    answer=resolved();answer['interruptOn']={tool.name:True for tool in entry_tools()} if admitted else {};answer['packageDigest']=factory._package_set_digest([])
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
    for tool in entry_tools():
        if not admitted:
            assert tool.name not in selected
            continue
        assert tool.name in selected
        assert selected[tool.name].coroutine.__code__ is tool.coroutine.__code__
        assert selected[tool.name].args_schema==tool.args_schema



@pytest.mark.parametrize('module,name,args',[
 ('standard_artifact_download','wx_artifact_download',{'artifactId':'a','versionId':'v','purpose':'download'}),
 ('standard_run_status','wx_run_status',{'runId':'target'}),
 ('standard_run_cancel','wx_run_cancel',{'runId':'target','idempotencyKey':'cancel'})])
def test_unknown_entry_outcome_is_never_replayed(monkeypatch,module,name,args):
    import importlib
    source=importlib.import_module('deep_agent_service.'+module)
    error=getattr(source,{'standard_artifact_download':'StandardArtifactDownloadError','standard_run_status':'StandardRunStatusError','standard_run_cancel':'StandardRunCancelError'}[module])
    calls=[]
    async def unknown(*_): calls.append(1);raise error('unknown')
    monkeypatch.setattr(source,'_invoke',unknown)
    adapter=sandbox()
    graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'real-entry','name':name,'args':args}]),AIMessage(content='done')),
        sandbox=adapter,pinned_skills=[],tools=entry_tools(),interrupt_on={},tool_authority=FakeAuthority())
    async def run():return await graph.ainvoke({'messages':[{'role':'user','content':'call'}]},{'configurable':{'disable_task_auto_classify':True}})
    try:
        # 2026-09-27：「不重放」这条不变量原样保留（calls==1）。变的只是观测方式——
        # 此前 unknown outcome 会掀翻整条 run（`ToolRetryMiddleware` 对不重试的异常直接
        # re-raise、跳过 on_failure），用户看到的是 tool_call_unresolved，模型连失败都
        # 没看见。现在它作为 status="error" 的 ToolMessage 交还模型，run 照常收尾。
        # 见 `native_graph._ReportToolOutcomeFailures` 与 test_native_tool_failure_reporting.py。
        result=asyncio.run(run())
        assert len(calls)==1
        failed=[m for m in result['messages'] if isinstance(m,ToolMessage) and m.tool_call_id=='real-entry']
        assert len(failed)==1 and failed[0].status=='error' and 'unknown' in str(failed[0].content)
        assert result['messages'][-1].content=='done'
    finally:adapter._client.close()
