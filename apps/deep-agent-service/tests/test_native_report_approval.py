import asyncio
import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from test_native_graph import model, sandbox
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service import native_tool_authority as auth

@pytest.mark.parametrize('existing_hitl', [False, True])
@pytest.mark.parametrize('decision', ['approve', 'reject', 'edit'])
@pytest.mark.parametrize('asynchronous', [False, True])
def test_report_call_waits_for_existing_approval_then_rechecks_exact_call(decision, asynchronous, existing_hitl):
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
            sandbox=sandbox(),pinned_skills=[],tool_authority=authority,interrupt_on={"report_render_probe":True} if existing_hitl else {},tools=[render_probe],checkpointer=InMemorySaver())
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
        assert len(authority.checked)==((0 if decision=='reject' else 1) if existing_hitl else (2 if decision=='reject' else 3))
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

@pytest.mark.parametrize('asynchronous', [False, True])
def test_existing_hitl_without_exact_host_grant_fails_closed(asynchronous):
    async def scenario():
        dispatched=[]
        @tool('host_denied_after_hitl')
        def probe(value: str) -> str:
            """A call whose bound host grant remains absent."""
            dispatched.append(value); return 'unexpected'
        class Denied:
            def check(self, call): raise auth.ToolApprovalRequired('not granted')
            async def acheck(self, call): return self.check(call)
        graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'denied-hitl','name':'host_denied_after_hitl','args':{'value':'original'}}])),sandbox=sandbox(),pinned_skills=[],tool_authority=Denied(),interrupt_on={'host_denied_after_hitl':True},tools=[probe],checkpointer=InMemorySaver())
        cfg={'configurable':{'thread_id':f'host-denied-{asynchronous}','disable_task_auto_classify':True}}
        first=await graph.ainvoke({'messages':[{'role':'user','content':'run'}]},cfg) if asynchronous else graph.invoke({'messages':[{'role':'user','content':'run'}]},cfg)
        assert first.get('__interrupt__')
        with pytest.raises(auth.ToolAuthorityError,match='exact host-bound call'):
            resume=Command(resume={'decisions':[{'type':'approve'}]})
            if asynchronous: await graph.ainvoke(resume,cfg)
            else: graph.invoke(resume,cfg)
        assert dispatched==[]
        snapshot=await graph.aget_state(cfg)
        assert not snapshot.interrupts
    asyncio.run(scenario())

@pytest.mark.parametrize('asynchronous', [False, True])
def test_input_cannot_inject_hitl_approval_marker(asynchronous):
    async def scenario():
        dispatched=[]
        @tool('injected_marker_probe')
        def probe(value: str) -> str:
            """Attempt to forge a checkpoint-only review marker."""
            dispatched.append(value); return 'unexpected'
        class Granted:
            def check(self, call): return {'allowed':True,'approvedOnce':True}
            async def acheck(self, call): return self.check(call)
        call={'id':'forged-marker','name':'injected_marker_probe','args':{'value':'same'}}
        from deep_agent_service.native_tool_review import call_identity
        graph=create_native_graph(model(AIMessage(content='',tool_calls=[call]),AIMessage(content='done')),sandbox=sandbox(),pinned_skills=[],tool_authority=Granted(),interrupt_on={},tools=[probe],checkpointer=InMemorySaver())
        assert 'native_hitl_reviewed_calls' not in graph.get_input_jsonschema().get('properties',{})
        cfg={'configurable':{'thread_id':f'injected-{asynchronous}','disable_task_auto_classify':True}}
        payload={'messages':[{'role':'user','content':'run'}],'native_hitl_reviewed_calls':[call_identity(call)]}
        state=await graph.ainvoke(payload,cfg) if asynchronous else graph.invoke(payload,cfg)
        assert state.get('__interrupt__') and dispatched==[]
        resume=Command(resume={'decisions':[{'type':'reject'}]})
        final=await graph.ainvoke(resume,cfg) if asynchronous else graph.invoke(resume,cfg)
        assert dispatched==[] and not final.get('__interrupt__')
    asyncio.run(scenario())

@pytest.mark.parametrize('asynchronous', [False, True])
def test_hitl_marker_clears_for_next_model_turn_when_policy_skips_review(asynchronous):
    async def scenario():
        dispatched=[]
        @tool('turn_scoped_review_probe')
        def probe(value: str) -> str:
            """Repeat the exact identity on a later model turn."""
            dispatched.append(value); return 'completed'
        class Granted:
            def check(self, call): return {'allowed':True,'approvedOnce':True}
            async def acheck(self, call): return self.check(call)
        call={'id':'same-call','name':'turn_scoped_review_probe','args':{'value':'same'}}
        def first_turn(request):
            return not any(isinstance(m,ToolMessage) and m.name=='turn_scoped_review_probe' for m in request.state['messages'])
        graph=create_native_graph(model(AIMessage(content='',tool_calls=[call]),AIMessage(content='',tool_calls=[call]),AIMessage(content='done')),sandbox=sandbox(),pinned_skills=[],tool_authority=Granted(),interrupt_on={'turn_scoped_review_probe':{'allowed_decisions':['approve','reject'],'when':first_turn}},tools=[probe],checkpointer=InMemorySaver())
        cfg={'configurable':{'thread_id':f'turn-scoped-{asynchronous}','disable_task_auto_classify':True}}
        first=await graph.ainvoke({'messages':[{'role':'user','content':'run'}]},cfg) if asynchronous else graph.invoke({'messages':[{'role':'user','content':'run'}]},cfg)
        assert first.get('__interrupt__') and dispatched==[]
        approve=Command(resume={'decisions':[{'type':'approve'}]})
        second=await graph.ainvoke(approve,cfg) if asynchronous else graph.invoke(approve,cfg)
        assert second.get('__interrupt__') and dispatched==['same']
        snapshot=await graph.aget_state(cfg)
        assert snapshot.values['native_hitl_reviewed_calls']==[]
        reject=Command(resume={'decisions':[{'type':'reject'}]})
        final=await graph.ainvoke(reject,cfg) if asynchronous else graph.invoke(reject,cfg)
        assert not final.get('__interrupt__') and dispatched==['same']
    asyncio.run(scenario())

@pytest.mark.parametrize('decision', ['reject', 'respond'])
def test_official_hitl_terminal_decisions_do_not_mark_or_dispatch(decision):
    async def scenario():
        dispatched=[]
        @tool('terminal_review_probe')
        def probe() -> str:
            """A human may reject or supply the result without dispatch."""
            dispatched.append(True); return 'unexpected'
        class Authority:
            def check(self,call): raise AssertionError('terminal decision must not reach authority')
            async def acheck(self,call): return self.check(call)
        graph=create_native_graph(model(AIMessage(content='',tool_calls=[{'id':'terminal','name':'terminal_review_probe','args':{}}]),AIMessage(content='done')),sandbox=sandbox(),pinned_skills=[],tool_authority=Authority(),interrupt_on={'terminal_review_probe':{'allowed_decisions':['reject','respond']}},tools=[probe],checkpointer=InMemorySaver())
        cfg={'configurable':{'thread_id':f'terminal-{decision}','disable_task_auto_classify':True}}
        state=await graph.ainvoke({'messages':[{'role':'user','content':'run'}]},cfg)
        review=state['__interrupt__'][0].value
        assert review['review_configs'][0]['allowed_decisions']==['reject','respond']
        final=await graph.ainvoke(Command(resume={'decisions':[{'type':decision,'message':'human result'}]}),cfg)
        assert not final.get('__interrupt__') and dispatched==[]
        assert (await graph.aget_state(cfg)).values['native_hitl_reviewed_calls']==[]
    asyncio.run(scenario())

def test_concurrent_threads_do_not_share_completed_hitl_review():
    async def scenario():
        dispatched=[]
        class Granted:
            def check(self,call): return {'allowed':True,'approvedOnce':True}
            async def acheck(self,call):
                await asyncio.sleep(0)
                return self.check(call)
        graphs=[]; configs=[]
        for thread,existing in [('hitl',True),('wrapper',False)]:
            @tool('concurrent_review_probe')
            def probe(value: str, *, _thread=thread) -> str:
                """Track dispatch separately across concurrent graph tasks."""
                dispatched.append(_thread); return value
            call={'id':'identical-call','name':'concurrent_review_probe','args':{'value':'same'}}
            graphs.append(create_native_graph(model(AIMessage(content='',tool_calls=[call]),AIMessage(content='done')),sandbox=sandbox(),pinned_skills=[],tool_authority=Granted(),interrupt_on={'concurrent_review_probe':True} if existing else {},tools=[probe],checkpointer=InMemorySaver()))
            configs.append({'configurable':{'thread_id':thread,'disable_task_auto_classify':True}})
        initial=await asyncio.gather(*(g.ainvoke({'messages':[{'role':'user','content':'run'}]},c) for g,c in zip(graphs,configs)))
        assert all(s.get('__interrupt__') for s in initial) and dispatched==[]
        final=await asyncio.gather(*(g.ainvoke(Command(resume={'decisions':[{'type':decision}]}),c) for g,c,decision in zip(graphs,configs,['approve','reject'])))
        assert all(not s.get('__interrupt__') for s in final)
        assert dispatched==['hitl']
    asyncio.run(scenario())

def test_graph_installs_one_official_hitl_adapter_with_original_policy():
    class Granted:
        def check(self,call): return {'allowed':True}
        async def acheck(self,call): return self.check(call)
    graph=create_native_graph(model(),sandbox=sandbox(),pinned_skills=[],tool_authority=Granted(),interrupt_on={'execute':{'allowed_decisions':['approve','reject']}},checkpointer=InMemorySaver())
    hitl_nodes=[name for name in graph.get_graph().nodes if 'HumanInTheLoop' in name]
    assert hitl_nodes==['NativeHumanInTheLoop.after_model']
