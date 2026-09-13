"""Real nested agent streams: callback facts belong to the calling task only."""
import asyncio
import re
from langchain.agents import create_agent
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from deep_agent_service.native_task_observation import NativeTaskObservation, NativeTaskToolObserver


class Model(GenericFakeChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def model(*messages):
    return Model(messages=iter(messages))


@tool
async def lookup(value: str) -> str:
    """Read a public test value."""
    await asyncio.sleep(.015)
    return value


@tool
async def task(use_tool: bool) -> str:
    """Invoke an actual nested agent."""
    messages = ([AIMessage(content='', tool_calls=[{'id': 'child', 'name': 'lookup', 'args': {'value': 'ok'}}])]
                if use_tool else []) + [AIMessage(content='done')]
    child = create_agent(model(*messages), tools=[lookup])
    output = await child.ainvoke({'messages': [{'role': 'user', 'content': 'test'}]})
    return output['messages'][-1].content


def test_concurrent_nested_graphs_have_real_isolated_counts_and_timing():
    async def run():
        parent = create_agent(model(AIMessage(content='', tool_calls=[
            {'id': 'has-tool', 'name': 'task', 'args': {'use_tool': True}},
            {'id': 'no-tool', 'name': 'task', 'args': {'use_tool': False}},
        ]), AIMessage(content='finished')), tools=[task], middleware=[NativeTaskObservation()])
        facts = []
        async for mode, value in parent.astream({'messages': [{'role': 'user', 'content': 'run'}]},
                config={'callbacks': [NativeTaskToolObserver()]}, stream_mode=['custom', 'values']):
            if mode == 'custom':
                facts.append(value)
        return facts
    facts = asyncio.run(run())
    by_id = {fact['toolCallId']: fact['message'] for fact in facts}
    assert len(facts) == 2
    assert '工具调用 1 次' in by_id['has-tool']
    assert 'lookup×1' in by_id['has-tool']
    assert '工具调用 0 次' in by_id['no-tool']
    assert '未调用工具' in by_id['no-tool']
    assert 'lookup' not in by_id['no-tool']
    assert float(re.search(r'耗时 ([\d.]+) 秒', by_id['has-tool'])[1]) >= .01


def test_missing_observer_never_claims_zero_tools():
    async def run():
        parent = create_agent(model(AIMessage(content='', tool_calls=[
            {'id': 'missing-observer', 'name': 'task', 'args': {'use_tool': True}},
        ]), AIMessage(content='finished')), tools=[task], middleware=[NativeTaskObservation()])
        return [value async for mode, value in parent.astream(
            {'messages': [{'role': 'user', 'content': 'run'}]}, stream_mode=['custom', 'values']) if mode == 'custom']
    facts = asyncio.run(run())
    assert len(facts) == 1
    assert '工具统计不可用' in facts[0]['message']
    assert '0 次' not in facts[0]['message']


def test_official_deepagents_task_stream_attributes_child_tools():
    from deepagents import create_deep_agent
    async def run():
        child = create_agent(model(AIMessage(content='', tool_calls=[
            {'id': 'lookup', 'name': 'lookup', 'args': {'value': 'child'}}]),
            AIMessage(content='child result')), tools=[lookup])
        plain = create_agent(model(AIMessage(content='plain result')), tools=[])
        parent = create_deep_agent(model=model(AIMessage(content='', tool_calls=[
            {'id': 'official-tool', 'name': 'task', 'args': {'description': 'read', 'subagent_type': 'reader'}},
            {'id': 'official-plain', 'name': 'task', 'args': {'description': 'draft', 'subagent_type': 'writer'}},
        ]), AIMessage(content='done')), subagents=[
            {'name': 'reader', 'description': 'read', 'runnable': child},
            {'name': 'writer', 'description': 'draft', 'runnable': plain}],
            middleware=[NativeTaskObservation()])
        return [value async for mode, value in parent.astream(
            {'messages': [{'role': 'user', 'content': 'run'}]},
            config={'callbacks': [NativeTaskToolObserver()]}, stream_mode=['custom', 'values']) if mode == 'custom']
    facts = asyncio.run(run())
    by_id = {fact['toolCallId']: fact['message'] for fact in facts}
    assert len(facts) == 2
    assert '工具调用 1 次' in by_id['official-tool']
    assert 'lookup×1' in by_id['official-tool']
    assert '工具调用 0 次' in by_id['official-plain']


def test_failed_child_tool_is_counted_without_changing_task_failure():
    @tool
    async def broken() -> str:
        """Fail a test tool."""
        raise RuntimeError('expected test failure')

    @tool('task')
    async def failed_task() -> str:
        """Run a child whose tool fails."""
        child = create_agent(model(AIMessage(content='', tool_calls=[
            {'id': 'broken', 'name': 'broken', 'args': {}}])), tools=[broken])
        await child.ainvoke({'messages': [{'role': 'user', 'content': 'test'}]})
        return 'unreachable'

    async def run():
        parent = create_agent(model(AIMessage(content='', tool_calls=[
            {'id': 'failed-task', 'name': 'task', 'args': {}}])), tools=[failed_task],
            middleware=[NativeTaskObservation()])
        facts = []
        try:
            async for mode, value in parent.astream({'messages': [{'role': 'user', 'content': 'test'}]},
                    config={'callbacks': [NativeTaskToolObserver()]}, stream_mode=['custom', 'values']):
                if mode == 'custom':
                    facts.append(value)
        except RuntimeError as error:
            assert str(error) == 'expected test failure'
        else:
            raise AssertionError('observation must not swallow task failure')
        return facts
    facts = asyncio.run(run())
    assert len(facts) == 1
    assert facts[0]['toolCallId'] == 'failed-task'
    assert '工具调用 1 次，失败 1 次' in facts[0]['message']
    assert 'broken×1' in facts[0]['message']
