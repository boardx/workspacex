from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver

from deep_agent_service.guided_research_graph import (
    GuidedResearchGraphError,
    create_guided_research_graph,
    invoke_guided_research_command,
    start_guided_research_thread,
)
from deep_agent_service.guided_research_state import initial_guided_research_state


def brief_state() -> dict[str, object]:
    return {
        "name": "欧洲储能进入研究",
        "tags": ["欧洲", "储能"],
        "topic": "欧洲储能市场进入策略",
        "objective": "确定首批进入国家",
        "timeRange": "2025-2028",
        "geography": "欧洲",
        "focus": "市场、政策和并网",
    }


def command(
    *, node: str, action: str, request_id: str, graph_version: int, node_state: dict[str, object]
) -> dict[str, object]:
    return {
        "sessionId": "grs-1",
        "node": node,
        "action": action,
        "requestId": request_id,
        "expectedGraphVersion": graph_version,
        "nodeState": node_state,
    }


def config() -> dict[str, object]:
    return {
        "configurable": {
            "thread_id": "grs-1",
            "checkpoint_ns": "guided-research:v1",
        }
    }


def test_new_thread_interrupts_at_brief() -> None:
    graph = create_guided_research_graph(MemorySaver())
    state = initial_guided_research_state("grs-1", brief_state=brief_state())

    projection = start_guided_research_thread(graph, config(), state)

    assert projection["currentNode"] == "brief"
    assert projection["graphVersion"] == 0
    assert projection["interrupt"] == {
        "node": "brief",
        "allowedActions": ["save", "confirm"],
    }
    assert set(graph.get_graph().nodes) >= {
        "await_command",
        "route_command",
        "brief",
        "directions",
        "outline",
        "research",
        "report",
    }


def test_route_command_can_reconfirm_completed_upstream_node() -> None:
    graph = create_guided_research_graph(MemorySaver())
    state = initial_guided_research_state(
        "grs-1",
        brief_state=brief_state(),
        current_node="outline",
        available_nodes=["brief", "directions", "outline"],
        existing_node_states={
            "directions": {"directions": []},
            "outline": {"sections": []},
        },
    )
    start_guided_research_thread(graph, config(), state)

    projection = invoke_guided_research_command(
        graph,
        config(),
        command(
            node="brief",
            action="reconfirm",
            request_id="req-reconfirm",
            graph_version=0,
            node_state=brief_state(),
        ),
    )

    assert projection["currentNode"] == "directions"
    assert projection["revision"] == 2
    assert projection["nodeSummaries"]["directions"]["status"] == "stale"
    assert projection["nodeSummaries"]["outline"]["status"] == "stale"


def test_future_node_command_is_rejected() -> None:
    graph = create_guided_research_graph(MemorySaver())
    state = initial_guided_research_state("grs-1", brief_state=brief_state())
    start_guided_research_thread(graph, config(), state)

    try:
        invoke_guided_research_command(
            graph,
            config(),
            command(
                node="outline",
                action="confirm",
                request_id="req-future",
                graph_version=0,
                node_state={
                    "sections": [{
                        "id": "section-1",
                        "title": "市场规模",
                        "description": "核验市场容量",
                        "researchQuestions": ["市场容量是多少？"],
                        "order": 0,
                    }],
                },
            ),
        )
    except GuidedResearchGraphError as error:
        assert error.code == "RESEARCH_NODE_LOCKED"
    else:
        raise AssertionError("future node command must be rejected")


def test_same_request_pending_resumes_without_second_effect() -> None:
    calls: list[str] = []
    graph = create_guided_research_graph(
        MemorySaver(),
        effect_observer=lambda operation_id: calls.append(operation_id),
    )
    state = initial_guided_research_state("grs-1", brief_state=brief_state())
    start_guided_research_thread(graph, config(), state)
    first_command = command(
        node="brief",
        action="confirm",
        request_id="req-1",
        graph_version=0,
        node_state=brief_state(),
    )

    first = invoke_guided_research_command(graph, config(), first_command)
    replay = invoke_guided_research_command(graph, config(), first_command)

    assert replay["graphVersion"] == first["graphVersion"]
    assert replay["checkpointId"] == first["checkpointId"]
    assert calls == ["grs-1:req-1:brief:confirm"]


def test_brief_confirm_can_be_followed_by_generated_directions_state() -> None:
    graph = create_guided_research_graph(MemorySaver())
    state = initial_guided_research_state("grs-1", brief_state=brief_state(), current_node="directions", available_nodes=["brief", "directions"])
    start_guided_research_thread(graph, config(), state)

    after_brief = invoke_guided_research_command(
        graph,
        config(),
        command(
            node="brief",
            action="reconfirm",
            request_id="req-brief",
            graph_version=0,
            node_state=brief_state(),
        ),
    )
    projection = invoke_guided_research_command(
        graph,
        config(),
        command(
            node="directions",
            action="generate",
            request_id="req-brief:generated-directions",
            graph_version=after_brief["graphVersion"],
            node_state={
                "directions": [
                    {
                        "id": "direction-model-market",
                        "title": "市场优先级",
                        "description": "比较目标区域的市场容量、政策窗口和客户成熟度。",
                        "enabled": True,
                        "order": 0,
                    }
                ]
            },
        ),
    )

    assert projection["graphVersion"] == 2
    assert projection["currentNode"] == "directions"
    assert projection["activeNodeState"]["directions"][0]["id"] == "direction-model-market"
    assert projection["nodeSummaries"]["directions"]["status"] == "ready"
    assert projection["nodeSummaries"]["directions"]["modelId"] == "qwen3.7-plus"
    assert projection["nodeSummaries"]["directions"]["modelOutputSchemaVersion"] == "guided-research-directions:v1"
