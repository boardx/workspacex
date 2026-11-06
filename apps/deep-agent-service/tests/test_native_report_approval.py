import asyncio
import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from test_native_graph import model, sandbox
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service import native_tool_authority as auth

@pytest.mark.parametrize('decision', ['approve', 'reject', 'edit'])
@pytest.mark.parametrize('asynchronous', [False, True])
def test_report_call_waits_for_existing_approval_then_rechecks_exact_call(decision, asynchronous):
    async def scenario():
        calls=[]
        @tool('report_render_probe')
        def render_probe(value: str) -> str:
            """Render a saved report in a controlled test."""
            calls.append(value); return 'rendered'
        class Authority:
            approved=False
            checked=[]
            def check(self, call):
                self.checked.append(call.copy())
                if not self.approved:
                    # The same validated denial shape returned by the production API.
                    return auth.HttpNativeToolAuthority._validate(__import__('httpx').Response(200,json={'allowed':False,'reason':'approval_required'}))
                assert call['id']=='render-1'
                if call['args']!={'value': 'edited' if decision=='edit' else 'frozen'}:
                    return auth.HttpNativeToolAuthority._validate(__import__('httpx').Response(200,json={'allowed':False,'reason':'approval_required'}))
                return {'allowed':True,'approvedOnce':True}
            async def acheck(self,call): return self.check(call)
        authority=Authority()
        graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'render-1','name':'report_render_probe','args':{'value':'frozen'}}]),AIMessage(content='done')),
            sandbox=sandbox(),pinned_skills=[],tool_authority=authority,interrupt_on={},tools=[render_probe],checkpointer=InMemorySaver())
        config={'configurable':{'thread_id':f'approval-{decision}','disable_task_auto_classify':True}}
        result=await graph.ainvoke({'messages':[{'role':'user','content':'export saved report'}]},config) if asynchronous else graph.invoke({'messages':[{'role':'user','content':'export saved report'}]},config)
        assert calls==[]
        assert result.get('__interrupt__')
        authority.approved=decision!='reject'
        response={'type':decision}
        if decision=='edit': response['edited_action']={'name':'report_render_probe','args':{'value':'edited'}}
        result=await graph.ainvoke(Command(resume={'decisions':[response]}),config) if asynchronous else graph.invoke(Command(resume={'decisions':[response]}),config)
        assert calls==([] if decision=='reject' else ['edited' if decision=='edit' else 'frozen'])
        assert result['messages'][-1].content=='done'
        assert len(authority.checked)==(2 if decision=='reject' else 3)
    asyncio.run(scenario())

def test_resume_approve_cannot_replace_host_authorization():
    async def scenario():
        dispatched=[]
        @tool('approval_forgery_probe')
        def probe() -> str:
            """Controlled forbidden dispatch probe."""
            dispatched.append(True); return 'forbidden'
        class Denied:
            def check(self, call):
                return auth.HttpNativeToolAuthority._validate(__import__('httpx').Response(200,json={'allowed':False,'reason':'approval_required'}))
            async def acheck(self,call): return self.check(call)
        graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'forged','name':'approval_forgery_probe','args':{}}])),
            sandbox=sandbox(),pinned_skills=[],tool_authority=Denied(),interrupt_on={},tools=[probe],checkpointer=InMemorySaver())
        cfg={'configurable':{'thread_id':'forged','disable_task_auto_classify':True}}
        state=await graph.ainvoke({'messages':[{'role':'user','content':'export'}]},cfg)
        assert state.get('__interrupt__') and not dispatched
        with pytest.raises(auth.ToolAuthorityError):
            await graph.ainvoke(Command(resume={'decisions':[{'type':'approve'}]}),cfg)
        assert dispatched==[]
    asyncio.run(scenario())

@pytest.mark.parametrize('reason',['cancel_requested','lease_lost','attempt_stale','run_unavailable','skill_not_mounted','report_output_mismatch'])
def test_nonapproval_denial_does_not_create_approval_interrupt(reason):
    async def scenario():
        dispatched=[]
        @tool('hard_denial_probe')
        def probe() -> str:
            """Controlled hard-denial probe."""
            dispatched.append(True); return 'forbidden'
        class Denied:
            def check(self, call):
                return auth.HttpNativeToolAuthority._validate(__import__('httpx').Response(200,json={'allowed':False,'reason':reason}))
            async def acheck(self,call): return self.check(call)
        graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'denied','name':'hard_denial_probe','args':{}}])),
            sandbox=sandbox(),pinned_skills=[],tool_authority=Denied(),interrupt_on={},tools=[probe],checkpointer=InMemorySaver())
        cfg={'configurable':{'thread_id':reason,'disable_task_auto_classify':True}}
        with pytest.raises(auth.ToolAuthorityError):
            await graph.ainvoke({'messages':[{'role':'user','content':'export'}]},cfg)
        assert dispatched==[]
        snapshot=await graph.aget_state(cfg)
        assert not snapshot.interrupts
    asyncio.run(scenario())

def test_runtime_exports_real_checkpoint_and_replayable_approval_sse(tmp_path):
    import json
    from export_report_approval_fixture import generate_fixture
    output=tmp_path/'native-approval.json'
    asyncio.run(generate_fixture(output))
    fixture=json.loads(output.read_text())
    assert fixture['run']['status']=='interrupted'
    assert fixture['events'][-1]['event']=='metadata'
    assert fixture['events'][-1]['data']['status']=='interrupted'
    calls=fixture['state']['values']['messages'][-1]['tool_calls']
    assert calls==[{'name':'execute','args':{'command':'cd /workspace && node gen.js'},'id':'render-report-1','type':'tool_call'}]
    reviews=[interrupt['value'] for task in fixture['state']['tasks'] for interrupt in task['interrupts']]
    assert reviews[0]['action_requests']==[{'name':'execute','args':{'command':'cd /workspace && node gen.js'}}]
    assert reviews[0]['review_configs'][0]['allowed_decisions']==['approve','edit','reject']

    # The checked-in API fixture was captured from this same Runtime shape.
    from pathlib import Path
    golden=json.loads((Path(__file__).resolve().parents[2]/'api/tests/fixtures/report-native-approval.json').read_text())
    assert calls==golden['state']['values']['messages'][-1]['tool_calls']
    golden_reviews=[i['value'] for t in golden['state']['tasks'] for i in t['interrupts']]
    assert reviews==golden_reviews
