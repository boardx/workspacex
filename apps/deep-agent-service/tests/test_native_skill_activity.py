from native_sandbox_fixture import FakeAuthority
import asyncio
import hashlib
import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage
from deep_agent_service import native_skill_activity as activity
from deep_agent_service.native_graph import create_native_graph
from native_sandbox_fixture import pinned_skill_package, real_native_session
from test_native_graph import ScriptedModel


def test_canonical_manifest_matches_generated_unicode_golden():
    golden=activity._ARTIFACT['golden']
    assert activity.canonical_package_manifest(golden['files']) == golden['canonical']
    assert hashlib.sha256(activity.canonical_package_manifest(golden['files']).encode()).hexdigest() == golden['sha256']


def test_metadata_replays_stably_and_unknown_identity_refuses(monkeypatch):
    facts=[]; monkeypatch.setattr(activity,'get_stream_writer',lambda: facts.append)
    reporter=activity.NativeSkillActivity(pinned_skill_package())
    entries=[{'path':'/skills/example/SKILL.md','name':'example'}]
    reporter.metadata_discovered(entries); reporter.metadata_discovered(entries)
    assert facts[0] == facts[1] and facts[0]['fact']['stage']=='metadata_discovered'
    with pytest.raises(activity.SkillActivityError):
        reporter.metadata_discovered([{'path':'/skills/other/SKILL.md','name':'example'}])


def test_body_requires_success_and_real_context_and_writer_failure_propagates(monkeypatch):
    facts=[]; reporter=activity.NativeSkillActivity(pinned_skill_package())
    result=SimpleNamespace(error=None,file_data={'content':'body'})
    activity.observe_skill_read('/skills/example/SKILL.md',result)
    assert facts==[]
    token=activity._READ_CONTEXT.set((reporter,'call-1',facts.append))
    try:
        activity.observe_skill_read('/workspace/other',result)
        activity.observe_skill_read('/skills/example/SKILL.md',SimpleNamespace(error='missing',file_data=None))
        activity.observe_skill_read('/skills/example/SKILL.md',SimpleNamespace(error=None,file_data={'content':''},no_lines_requested=True))
        assert facts==[]
        activity.observe_skill_read('/skills/example/SKILL.md',result)
        activity.observe_skill_read('/skills/example/SKILL.md',result)
        assert facts[0]==facts[1] and facts[0]['fact']['stage']=='body_read'
        assert 'toolCallId' not in facts[0]['fact']
    finally: activity._READ_CONTEXT.reset(token)
    def fail(_): raise RuntimeError('writer down')
    with pytest.raises(activity.SkillActivityError): reporter.body_read('/skills/example/SKILL.md','call-1',fail)


@pytest.mark.parametrize('asynchronous',[False,True])
def test_real_native_metadata_and_body_are_distinct_custom_stream_facts(asynchronous):
    with real_native_session() as (adapter,pins):
        model=ScriptedModel(messages=iter([
            AIMessage(content='',tool_calls=[{'id':'read-body-1','name':'read_file','args':{'file_path':'/skills/example/SKILL.md'}}]),
            AIMessage(content='body read')]))
        graph=create_native_graph(model,sandbox=adapter,pinned_skills=pins,tool_authority=FakeAuthority(), interrupt_on={})
        data={'messages':[{'role':'user','content':'Read the skill instructions.'}]}
        config={'configurable':{'disable_task_auto_classify':True}}
        if asynchronous:
            async def collect(): return [event async for event in graph.astream(data,config=config,stream_mode='custom')]
            events=asyncio.run(collect())
        else: events=list(graph.stream(data,config=config,stream_mode='custom'))
        facts=[event['fact'] for event in events if event.get('type')=='skill_activity']
        assert [fact['stage'] for fact in facts]==['metadata_discovered','body_read']
        assert facts[0]['factId']!=facts[1]['factId']
        assert facts[1]['readPath']=='/skills/example/SKILL.md'
        assert all(fact['skillVersion']=='v1' for fact in facts)


def test_real_recovery_replays_discovery_and_read_ids_without_execution_claim():
    from langgraph.checkpoint.memory import InMemorySaver
    with real_native_session() as (adapter,pins):
        model=ScriptedModel(messages=iter([
            AIMessage(content='',tool_calls=[{'id':'stable-read','name':'read_file','args':{'file_path':'/skills/example/SKILL.md'}}]),
            AIMessage(content='read'),
            AIMessage(content='',tool_calls=[{'id':'stable-read','name':'read_file','args':{'file_path':'/skills/example/SKILL.md'}}]),
            AIMessage(content='read again')]))
        graph=create_native_graph(model,sandbox=adapter,pinned_skills=pins,tool_authority=FakeAuthority(), interrupt_on={},checkpointer=InMemorySaver())
        config={'configurable':{'thread_id':'stable-facts','disable_task_auto_classify':True}}
        batches=[]
        for _ in range(2):
            events=list(graph.stream({'messages':[{'role':'user','content':'Read instructions'}]},config=config,stream_mode='custom'))
            batches.append([e['fact'] for e in events if e.get('type')=='skill_activity'])
        assert batches[0]==batches[1]
        assert [f['stage'] for f in batches[0]]==['metadata_discovered','body_read']


def test_real_body_writer_failure_propagates_without_retry(monkeypatch):
    seen=[]
    def writer(event):
        seen.append(event['fact']['stage'])
        if event['fact']['stage']=='body_read': raise RuntimeError('persistence unavailable')
    monkeypatch.setattr(activity,'get_stream_writer',lambda:writer)
    with real_native_session() as (adapter,pins):
        model=ScriptedModel(messages=iter([
            AIMessage(content='',tool_calls=[{'id':'failed-write','name':'read_file','args':{'file_path':'/skills/example/SKILL.md'}}]),
            AIMessage(content='must not be reached')]))
        graph=create_native_graph(model,sandbox=adapter,pinned_skills=pins,tool_authority=FakeAuthority(), interrupt_on={})
        with pytest.raises(activity.SkillActivityError):
            graph.invoke({'messages':[{'role':'user','content':'read'}]},config={'configurable':{'disable_task_auto_classify':True}})
        assert seen==['metadata_discovered','body_read']
