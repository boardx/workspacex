"""Storage-only namespace translation must preserve root and subgraph configs."""
import asyncio
from unittest.mock import Mock
from langgraph.checkpoint.base import CheckpointTuple
from deep_agent_service.postgres_checkpointer import FixedNamespaceCheckpointSaver


def test_all_operations_preserve_subgraph_namespace_and_input():
    delegate = Mock()
    saver = FixedNamespaceCheckpointSaver(delegate, "research:v1")
    for namespace in ("", "worker:uuid|nested:uuid"):
        config = {"configurable": {"thread_id": "same", "checkpoint_ns": namespace, "checkpoint_id": "new"}, "tags": ["retained"]}
        stored = {**config, "configurable": {**config["configurable"], "checkpoint_ns": "research:v1|" + namespace}}
        parent = {**stored, "configurable": {**stored["configurable"], "checkpoint_id": "old"}}
        row = CheckpointTuple(stored, {}, {}, parent, [])
        delegate.get_tuple.return_value = row
        result = saver.get_tuple(config)
        assert result.config == config
        assert result.parent_config["configurable"]["checkpoint_ns"] == namespace
        delegate.get_tuple.assert_called_with(stored)
        delegate.put.return_value = stored
        assert saver.put(config, {}, {}, {}) == config
        saver.put_writes(config, [], "task", "path")
        delegate.put_writes.assert_called_with(stored, [], "task", "path")
        delegate.list.return_value = iter([row])
        assert list(saver.list(config, before=config, limit=1))[0].config == config
        delegate.list.assert_called_with(stored, filter=None, before=stored, limit=1)
        saver.get_delta_channel_history(config=config, channels=["value"])
        delegate.get_delta_channel_history.assert_called_with(config=stored, channels=["value"])
        assert config["configurable"]["checkpoint_ns"] == namespace
        async def exercise():
            assert (await saver.aget_tuple(config)).config == config
            assert await saver.aput(config, {}, {}, {}) == config
        asyncio.run(exercise())


def test_unscoped_history_filters_before_limit():
    delegate = Mock()
    saver = FixedNamespaceCheckpointSaver(delegate, "research:v1")
    def row(namespace):
        return CheckpointTuple({"configurable": {"thread_id": "same", "checkpoint_ns": namespace}}, {}, {})
    delegate.list.return_value = iter([row(""), row("research:v1|"), row("research:v1|child:uuid")])
    rows = list(saver.list(None, limit=1))
    assert len(rows) == 1
    assert rows[0].config["configurable"]["checkpoint_ns"] == ""
    thread_config = {"configurable": {"thread_id": "same"}}
    delegate.list.return_value = iter([row(""), row("research:v1|"), row("research:v1|child:uuid")])
    rows = list(saver.list(thread_config, limit=2))
    assert [item.config["configurable"]["checkpoint_ns"] for item in rows] == ["", "child:uuid"]
    delegate.list.assert_called_with(thread_config, filter=None, before=None)


def test_real_graphs_isolate_same_thread_and_preserve_nested_state_history():
    from typing import TypedDict
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.graph import END, START, StateGraph

    class State(TypedDict):
        value: int

    raw = InMemorySaver()
    scoped = FixedNamespaceCheckpointSaver(raw, "research:v1")
    direct = StateGraph(State)
    direct.add_node("increment", lambda state: {"value": state["value"] + 1})
    direct.add_edge(START, "increment")
    direct.add_edge("increment", END)
    deep = direct.compile(checkpointer=raw)

    child = StateGraph(State)
    child.add_node("increment", lambda state: {"value": state["value"] + 1})
    child.add_node("finish", lambda state: {"value": state["value"] + 10})
    child.add_edge(START, "increment")
    child.add_edge("increment", "finish")
    child.add_edge("finish", END)
    parent = StateGraph(State)
    parent.add_node("worker", child.compile(checkpointer=True, interrupt_before=["finish"]))
    parent.add_edge(START, "worker")
    parent.add_edge("worker", END)
    research = parent.compile(checkpointer=scoped)
    config = {"configurable": {"thread_id": "shared-thread"}}

    async def exercise():
        assert await deep.ainvoke({"value": 1}, config) == {"value": 2}
        await research.ainvoke({"value": 100}, config)
        paused = await research.aget_state(config)
        assert paused.next == ("worker",)
        nested_config = paused.tasks[0].state
        nested_ns = nested_config["configurable"]["checkpoint_ns"]
        assert nested_ns.startswith("worker:")
        assert "research:v1" not in nested_ns
        nested = await research.aget_state(nested_config)
        assert nested.values == {"value": 101}
        assert nested.next == ("finish",)
        # Stateful subgraphs canonicalize task UUID namespaces to the node name.
        nested_ns = nested.config["configurable"]["checkpoint_ns"]
        assert nested_ns == "worker"
        history_config = {**nested.config, "configurable": {key: value for key, value in nested.config["configurable"].items() if key != "checkpoint_id"}}
        nested_history = [item async for item in research.aget_state_history(history_config)]
        assert len(nested_history) >= 2
        assert all(item.config["configurable"]["checkpoint_ns"] == nested_ns for item in nested_history)
        assert all(not item.parent_config or item.parent_config["configurable"]["checkpoint_ns"] == nested_ns for item in nested_history)
        assert (await deep.aget_state(config)).values == {"value": 2}
        assert await research.ainvoke(None, config) == {"value": 111}
        assert (await research.aget_state(config)).values == {"value": 111}
        assert (await deep.aget_state(config)).values == {"value": 2}
        roots = [item async for item in research.aget_state_history(config)]
        assert roots and all(item.config["configurable"]["checkpoint_ns"] == "" for item in roots)
        restored = parent.compile(checkpointer=FixedNamespaceCheckpointSaver(raw, "research:v1"))
        assert (await restored.aget_state(config)).values == {"value": 111}
        namespaces = set(raw.storage["shared-thread"])
        assert "" in namespaces and "research:v1|" in namespaces
        assert any(ns.startswith("research:v1|worker") for ns in namespaces)

    asyncio.run(exercise())


if __name__ == "__main__":
    test_all_operations_preserve_subgraph_namespace_and_input()
    test_unscoped_history_filters_before_limit()
    test_real_graphs_isolate_same_thread_and_preserve_nested_state_history()
    print("PASS: checkpoint namespace translation and history isolation")
