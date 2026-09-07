"""Persistent native capability snapshot controls automatic tools and actual dispatch."""
import asyncio
import pytest
from langchain_core.messages import AIMessage
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service.native_tool_authority import ToolAuthorityError
from test_native_graph import model,sandbox
from native_sandbox_fixture import FakeAuthority

@pytest.mark.parametrize('name,args',[('execute',{'command':'must not run'}),('read_file',{'file_path':'/workspace/secret'})])
def test_automatic_tool_outside_snapshot_cannot_dispatch(name,args):
    adapter=sandbox();authority=FakeAuthority()
    graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'forged','name':name,'args':args}])),
        sandbox=adapter,pinned_skills=[],tools=[],interrupt_on={},tool_authority=authority,tool_snapshot=frozenset({'write_todos'}))
    with pytest.raises(ToolAuthorityError,match='snapshot'):
        asyncio.run(graph.ainvoke({'messages':[{'role':'user','content':'test'}]},{'configurable':{'disable_task_auto_classify':True}}))
    adapter._client.close()


def test_model_only_sees_snapshot_tools_and_unknown_snapshot_refuses():
    from test_native_graph import ScriptedModel
    seen=[]
    class VisibleModel(ScriptedModel):
        def bind_tools(self,tools,**kwargs):
            seen.append({getattr(tool,'name',None) for tool in tools})
            return super().bind_tools(tools,**kwargs)
    adapter=sandbox()
    m=VisibleModel(messages=iter([AIMessage(content='done')]))
    graph=create_native_graph(m,sandbox=adapter,pinned_skills=[],tools=[],interrupt_on={},
        tool_authority=FakeAuthority(),tool_snapshot=frozenset({'read_file'}))
    graph.invoke({'messages':[{'role':'user','content':'test'}]},{'configurable':{'disable_task_auto_classify':True}})
    assert {'read_file'} in seen
    assert not any('execute' in names or 'task' in names for names in seen)
    with pytest.raises(ToolAuthorityError,match='unavailable'):
        create_native_graph(model(),sandbox=adapter,pinned_skills=[],tools=[],interrupt_on={},
            tool_authority=FakeAuthority(),tool_snapshot=frozenset({'unknown_model_tool'}))
    adapter._client.close()
