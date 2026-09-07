"""Native registration and official checkpoint decisions reuse the legacy interaction bodies."""
import asyncio
import httpx
import pytest
from deep_agent_service import native_factory as factory
from test_native_factory import config, resolved
from test_native_graph import model

NAMES={"confirm_task_intent","fill_run_params","choose_execution_option"}

@pytest.mark.parametrize("old_policy", [{}, {name:False for name in NAMES}])
def test_production_native_factory_registers_existing_interactions(monkeypatch,old_policy):
    value=config();value['configurable']['org_skills']=[]
    answer=resolved();answer['interruptOn']=old_policy;answer['packageDigest']=factory._package_set_digest([])
    async def resolve(*_):return answer
    monkeypatch.setenv('NATIVE_SESSION_SOCKET','/run/native.sock')
    monkeypatch.setattr(factory,'_resolve',resolve)
    monkeypatch.setattr(factory,'_sandbox_client',lambda _:httpx.Client(transport=httpx.MockTransport(lambda _:httpx.Response(500))))
    monkeypatch.setattr(factory,'_shared_runtime',lambda:(model(),None,[]))
    seen=[]
    class Graph:
        def with_config(self,_):return self
    def create(*args,**kwargs):
        seen.extend(kwargs['tools'])
        assert all(kwargs['interrupt_on'].get(name) is True for name in NAMES)
        return Graph()
    monkeypatch.setattr(factory,'create_native_graph',create)
    async def run():
        async with factory.native_graph_context(value):pass
    asyncio.run(run())
    assert NAMES <= {tool.name for tool in seen}
    assert not {'call_skill','list_org_skills','spawn_async_task'} & {tool.name for tool in seen}

import copy
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command
from deep_agent_service.tools import build_tools
from deep_agent_service.native_graph import create_native_graph
from test_native_graph import sandbox

CASES=[
    ('confirm_task_intent',{'requestId':'intent','understanding':'目标','assumptions':['原假设']},{'assumptions':['用户修改']},'用户修改'),
    ('fill_run_params',{'requestId':'params','fields':[{'name':'count','label':'数量','aiGuess':'1','rationale':'初始建议','required':True,'currentValue':None}]},{'fields':[{'name':'count','value':'42'}]},'42'),
    ('choose_execution_option',{'requestId':'options','options':[{'optionId':x,'title':x,'effort':'低','timeToValue':'一天','expectedReturn':'结果'} for x in ['A','B']]},{'selectedOptionId':'B'},'B'),
]

class RecordingAuthority:
    def __init__(self):self.calls=[]
    def check(self,call):self.calls.append(copy.deepcopy(call))
    async def acheck(self,call):self.check(call)

@pytest.mark.parametrize('name,args,edited,expected',CASES)
@pytest.mark.parametrize('decision',['edit','reject'])
def test_native_official_checkpoint_restores_actual_decision(name,args,edited,expected,decision):
    saver=MemorySaver()  # Test-only checkpointer; production factory keeps its existing durable checkpointer.
    adapter=sandbox();authority=RecordingAuthority()
    def graph(messages):
        m=model(*messages)
        return create_native_graph(m,sandbox=adapter,pinned_skills=[],tools=build_tools(m,interactions_only=True),
            tool_authority=authority,interrupt_on={n:True for n in NAMES},checkpointer=saver)
    config={'configurable':{'thread_id':name+'-'+decision,'disable_task_auto_classify':True}}
    async def run():
        initial=graph([AIMessage(content='',tool_calls=[{'id':'actual-call','name':name,'args':args}])])
        paused=await initial.ainvoke({'messages':[{'role':'user','content':'请确认后继续'}]},config)
        assert paused.get('__interrupt__') and not authority.calls
        # A fresh graph instance restores the actual saved checkpoint; no initial tool call is resubmitted.
        restored=graph([AIMessage(content='Finished after user decision.')])
        action={'type':'reject','message':'用户拒绝'} if decision=='reject' else {'type':'edit','edited_action':{'name':name,'args':edited}}
        return await restored.ainvoke(Command(resume={'decisions':[action]}),config)
    result=asyncio.run(run())
    outputs=[m for m in result['messages'] if isinstance(m,ToolMessage) and m.tool_call_id=='actual-call']
    assert len(outputs)==1
    if decision=='edit':
        assert authority.calls==[{'id':'actual-call','name':name,'args':edited,'type':'tool_call'}]
        assert expected in str(outputs[0].content)
    else:
        assert authority.calls==[]
        assert '用户拒绝' in str(outputs[0].content)
    adapter._client.close()


def test_native_empty_assumptions_approval_and_legacy_body_identity():
    m=model(AIMessage(content='',tool_calls=[{'id':'empty','name':'confirm_task_intent','args':{'requestId':'empty','understanding':'明确目标','assumptions':[]}}]),AIMessage(content='done'))
    legacy={t.name:t for t in build_tools(m)};selected=build_tools(m,interactions_only=True)
    for tool in selected:
        assert tool.func.__code__ is legacy[tool.name].func.__code__
    authority=RecordingAuthority();adapter=sandbox()
    graph=create_native_graph(m,sandbox=adapter,pinned_skills=[],tools=selected,tool_authority=authority,
        interrupt_on={n:True for n in NAMES},checkpointer=MemorySaver())
    config={'configurable':{'thread_id':'empty','disable_task_auto_classify':True}}
    assert graph.invoke({'messages':[{'role':'user','content':'确认目标'}]},config).get('__interrupt__')
    result=graph.invoke(Command(resume={'decisions':[{'type':'approve'}]}),config)
    assert len(authority.calls)==1 and authority.calls[0]['args']['assumptions']==[]
    assert any(isinstance(m,ToolMessage) and '无额外假设' in str(m.content) for m in result['messages'])
    adapter._client.close()
