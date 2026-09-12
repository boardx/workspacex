"""Unit bridge checks; real PostgreSQL probe is run by the isolated VM verifier."""
import asyncio
import threading
from unittest.mock import Mock, patch


from deep_agent_service.postgres_checkpointer import AsyncCompatiblePostgresSaver


def test_async_methods_delegate_off_event_loop():
    saver = AsyncCompatiblePostgresSaver(Mock())
    main_thread = threading.get_ident()
    names = ["get_tuple", "put", "put_writes", "delete_thread", "get_delta_channel_history"]
    def operation(*args, **kwargs):
        assert threading.get_ident() != main_thread
        return "saved"
    for name in names:
        setattr(saver, name, Mock(side_effect=operation))
    saver.list = Mock(side_effect=lambda *args, **kwargs: iter([operation()]))
    async def exercise():
        assert await saver.aget_tuple({}) == "saved"
        assert await saver.aput({}, {}, {}, {}) == "saved"
        assert await saver.aput_writes({}, [], "task", "path") == "saved"
        assert await saver.adelete_thread("thread") == "saved"
        assert await saver.aget_delta_channel_history(config={}, channels=["value"]) == "saved"
        assert [row async for row in saver.alist({}, limit=2)] == ["saved"]
    asyncio.run(exercise())
    saver.put_writes.assert_called_once_with({}, [], "task", "path")
    saver.list.assert_called_once_with({}, filter=None, before=None, limit=2)


def test_owned_connection_survives_factory_and_closes_explicitly():
    connection = Mock()
    with patch("deep_agent_service.postgres_checkpointer.Connection.connect", return_value=connection), patch.object(AsyncCompatiblePostgresSaver, "setup"):
        saver = AsyncCompatiblePostgresSaver.connect("unused")
    assert saver.conn is connection
    connection.close.assert_not_called()
    saver.close()
    connection.close.assert_called_once()


def test_setup_failure_closes_connection():
    connection = Mock()
    with patch("deep_agent_service.postgres_checkpointer.Connection.connect", return_value=connection), patch.object(AsyncCompatiblePostgresSaver, "setup", side_effect=RuntimeError("setup")):
        try:
            AsyncCompatiblePostgresSaver.connect("unused")
        except RuntimeError as error:
            assert str(error) == "setup"
        else:
            raise AssertionError("setup failure must propagate")
    connection.close.assert_called_once()


def test_self_hosted_research_builds_one_persistent_graph():
    from deep_agent_service.self_hosted_runtime import _self_hosted_research_graph, production_graph_loader
    _self_hosted_research_graph.cache_clear()
    saver, graph = AsyncCompatiblePostgresSaver(Mock()), object()
    try:
        with patch("deep_agent_service.harness.build_checkpointer", return_value=saver) as build, patch("deep_agent_service.guided_research_graph.create_guided_research_graph", return_value=graph) as create:
            assert production_graph_loader("Guided Research", {}) is graph
            assert production_graph_loader("Guided Research", {}) is graph
            build.assert_called_once_with()
            create.assert_called_once()
            assert create.call_args.kwargs["checkpointer"].delegate is saver
            assert create.call_args.kwargs["checkpointer"].prefix == "guided-research:v1|"
    finally:
        _self_hosted_research_graph.cache_clear()


if __name__ == "__main__":
    for name, test in list(globals().items()):
        if name.startswith("test_"):
            test()
    print("PASS: checkpoint async bridge, connection lifecycle, cached research graph")
