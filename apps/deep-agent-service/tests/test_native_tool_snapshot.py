"""Persistent native capability snapshot controls automatic tools and actual dispatch."""
import asyncio
import pytest
from langchain_core.messages import AIMessage
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service.native_tool_authority import ToolAuthorityError
from test_native_graph import model,sandbox
from native_sandbox_fixture import FakeAuthority

@pytest.mark.parametrize('asynchronous', [False, True])
@pytest.mark.parametrize('name,args',[('execute',{'command':'must not run'}),('read_file',{'file_path':'/workspace/secret'})])
def test_automatic_tool_outside_snapshot_cannot_dispatch(name,args,asynchronous):
    adapter=sandbox();authority=FakeAuthority()
    graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'forged','name':name,'args':args}])),
        sandbox=adapter,pinned_skills=[],tools=[],interrupt_on={},tool_authority=authority,tool_snapshot=frozenset({'write_todos'}))
    with pytest.raises(ToolAuthorityError,match='snapshot'):
        state={'messages':[{'role':'user','content':'test'}]}
        config={'configurable':{'disable_task_auto_classify':True}}
        if asynchronous:
            asyncio.run(graph.ainvoke(state,config))
        else:
            graph.invoke(state,config)
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

@pytest.mark.parametrize('asynchronous', [False, True])
def test_skill_name_is_not_a_tool_and_model_can_correct_without_dispatch(asynchronous):
    from langchain_core.tools import tool
    from langchain_core.messages import ToolMessage
    calls = []
    class Authority:
        def check(self, call): calls.append(call['name'])
        async def acheck(self, call): self.check(call)
    @tool
    def wx_document_parse(workspacePath: str) -> str:
        """Parse an already authorized document."""
        return 'PDF_PARSED'
    adapter = sandbox()
    graph = create_native_graph(model(
        AIMessage(content='', tool_calls=[{'id':'invalid-skill-name','name':'document-understanding',
            'args':{'mode':'full','limit':10000,'file_path':'/inputs/test.pdf'}}]),
        AIMessage(content='', tool_calls=[{'id':'real-parser','name':'wx_document_parse',
            'args':{'workspacePath':'/inputs/test.pdf'}}]),
        AIMessage(content='Analysis completed from PDF_PARSED')),
        sandbox=adapter,pinned_skills=[],tools=[wx_document_parse],interrupt_on={},
        tool_authority=Authority(),tool_snapshot=frozenset({'wx_document_parse','read_file'}))
    config={'configurable':{'disable_task_auto_classify':True}}
    state={'messages':[{'role':'user','content':'Analyze the attached PDF'}]}
    try:
        result=asyncio.run(graph.ainvoke(state,config)) if asynchronous else graph.invoke(state,config)
        messages=[m for m in result['messages'] if isinstance(m,ToolMessage)]
        rejected=next(m for m in messages if m.tool_call_id=='invalid-skill-name')
        assert rejected.status=='error'
        assert 'not a registered tool' in rejected.content
        assert 'SKILL.md' in rejected.content
        assert 'wx_document_parse' in rejected.content
        assert 'file_path' not in rejected.content
        assert calls==['wx_document_parse']
        assert next(m for m in messages if m.tool_call_id=='real-parser').content=='PDF_PARSED'
        assert result['messages'][-1].content=='Analysis completed from PDF_PARSED'
    finally:
        adapter._client.close()
