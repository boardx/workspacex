from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable, Mapping

from jsonschema import Draft7Validator
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from deep_agent_service.guided_research_state import (
    RESEARCH_NODES,
    GuidedResearchGraphState,
    ResearchNode,
)


class GuidedResearchGraphError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


_CONTRACT_PATH = Path(__file__).parent / "generated" / "guided_research_schema.json"
_CONTRACT = json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))
_COMMAND_SCHEMA = _CONTRACT["definitions"]["GuidedResearchNodeCommand"]
_COMMAND_VALIDATOR = Draft7Validator(_COMMAND_SCHEMA)
_DIRECTION_MODEL_ID = "qwen3.7-plus"
_DIRECTION_SCHEMA_VERSION = "guided-research-directions:v1"


def _fingerprint(command: Mapping[str, Any]) -> str:
    encoded = json.dumps(command, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _allowed_actions(node: ResearchNode) -> list[str]:
    if node == "brief":
        return ["save", "confirm"]
    if node in {"directions", "outline"}:
        return ["save", "generate", "confirm", "reconfirm"]
    if node == "research":
        return ["save", "start", "retry", "complete", "reconfirm"]
    return ["save", "retry", "complete", "reconfirm"]


def _project(state: Mapping[str, Any], checkpoint_id: str | None) -> dict[str, Any]:
    current_node = state["currentNode"]
    node_states = state.get("nodeStates", {})
    active_state = deepcopy(node_states.get(current_node, {}))
    return {
        "sessionId": state["sessionId"],
        "graphVersion": state["graphVersion"],
        "revision": state["revision"],
        "currentNode": current_node,
        "availableNodes": list(state["availableNodes"]),
        "nodeSummaries": deepcopy(state["nodeSummaries"]),
        "activeNodeState": active_state,
        "nodeStateVersions": {
            node: meta["version"]
            for node, meta in state["nodeSummaries"].items()
            if meta["version"] > 0
        },
        "skill": {
            "threadId": state["sessionId"],
            "activeNode": current_node,
            "summaryId": None,
            "recentMessageIds": [],
            "activeProposalId": None,
            "proposalStatus": "none",
        },
        "interrupt": {
            "node": current_node,
            "allowedActions": _allowed_actions(current_node),
        },
        "checkpointId": checkpoint_id,
    }


def _graph_config(config: dict[str, Any]) -> dict[str, Any]:
    """Validate the product namespace and normalize LangGraph's reserved field.

    At a top-level graph LangGraph reserves ``checkpoint_ns`` for selecting a
    nested subgraph and always stores the root checkpoint under the empty internal
    namespace. The public Guided Research boundary remains fixed and is carried as
    ``guided_research_checkpoint_ns`` after validation.
    """
    normalized = deepcopy(config)
    configurable = normalized.setdefault("configurable", {})
    namespace = configurable.pop("checkpoint_ns", "guided-research:v1")
    if namespace != "guided-research:v1":
        raise GuidedResearchGraphError(
            "RESEARCH_NODE_STATE_INVALID",
            "guided research checkpoint namespace is invalid",
        )
    configurable["guided_research_checkpoint_ns"] = namespace
    configurable["checkpoint_ns"] = ""
    return normalized


def _snapshot_projection(graph: Any, config: dict[str, Any]) -> dict[str, Any]:
    snapshot = graph.get_state(_graph_config(config))
    if not snapshot.values:
        raise GuidedResearchGraphError("RESEARCH_NOT_FOUND", "guided research thread not found")
    checkpoint_id = snapshot.config.get("configurable", {}).get("checkpoint_id")
    return _project(snapshot.values, checkpoint_id)


def _validate_command(state: Mapping[str, Any], command: Mapping[str, Any]) -> None:
    if not _COMMAND_VALIDATOR.is_valid(command):
        raise GuidedResearchGraphError(
            "RESEARCH_NODE_STATE_INVALID",
            "guided research command does not match the shared contract",
        )
    node = command.get("node")
    if node not in RESEARCH_NODES:
        raise GuidedResearchGraphError("RESEARCH_NODE_STATE_INVALID", "unknown research node")
    if command.get("sessionId") != state["sessionId"]:
        raise GuidedResearchGraphError("RESEARCH_NOT_FOUND", "guided research thread not found")
    if node not in state["availableNodes"]:
        raise GuidedResearchGraphError("RESEARCH_NODE_LOCKED", "research node is locked")
    if command.get("action") != "reconfirm" and node != state["currentNode"]:
        raise GuidedResearchGraphError("RESEARCH_NODE_MISMATCH", "research node is not current")


def create_guided_research_graph(
    checkpointer: BaseCheckpointSaver | None = None,
    *,
    effect_observer: Callable[[str], None] | None = None,
) -> Any:
    observer = effect_observer or (lambda _operation_id: None)

    def await_command(_state: GuidedResearchGraphState) -> dict[str, Any]:
        resumed = interrupt({"kind": "guided_research_node_command"})
        return {"pendingCommand": resumed}

    def route_command(state: GuidedResearchGraphState) -> dict[str, Any]:
        pending = state["pendingCommand"]
        if pending is None:
            raise GuidedResearchGraphError("RESEARCH_NODE_STATE_INVALID", "missing resumed command")
        return {"routedNode": pending["node"]}

    def route_target(state: GuidedResearchGraphState) -> str:
        routed = state.get("routedNode")
        if routed not in RESEARCH_NODES:
            raise GuidedResearchGraphError("RESEARCH_NODE_STATE_INVALID", "invalid routed node")
        return routed

    def handle_node(state: GuidedResearchGraphState) -> dict[str, Any]:
        pending = state["pendingCommand"]
        if pending is None:
            raise GuidedResearchGraphError("RESEARCH_NODE_STATE_INVALID", "missing resumed command")
        node: ResearchNode = pending["node"]
        action = pending["action"]
        request_id = pending["requestId"]
        operation_id = f"{state['sessionId']}:{request_id}:{node}:{action}"
        observer(operation_id)

        node_states = deepcopy(state["nodeStates"])
        node_summaries = deepcopy(state["nodeSummaries"])
        available_nodes = list(state["availableNodes"])
        node_states[node] = deepcopy(pending["nodeState"])
        node_summaries[node]["version"] += 1
        node_summaries[node]["updatedAt"] = node_summaries[node]["updatedAt"]
        if action == "generate":
            node_summaries[node]["status"] = "ready"
            if node == "directions":
                node_summaries[node]["modelId"] = _DIRECTION_MODEL_ID
                node_summaries[node]["modelInvocationId"] = operation_id
                node_summaries[node]["modelOutputSchemaVersion"] = _DIRECTION_SCHEMA_VERSION
                node_summaries[node]["contentVersionId"] = _fingerprint(pending["nodeState"])

        current_node: ResearchNode = state["currentNode"]
        revision = state["revision"]
        if action in {"confirm", "reconfirm"}:
            node_index = RESEARCH_NODES.index(node)
            node_summaries[node]["status"] = "confirmed"
            node_summaries[node]["confirmedVersion"] = node_summaries[node]["version"]
            if action == "reconfirm":
                revision += 1
                for downstream in RESEARCH_NODES[node_index + 1 :]:
                    if downstream in available_nodes:
                        node_summaries[downstream]["status"] = "stale"
            if node_index + 1 < len(RESEARCH_NODES):
                next_node = RESEARCH_NODES[node_index + 1]
                if next_node not in available_nodes:
                    available_nodes.append(next_node)
                if node_summaries[next_node]["status"] != "stale":
                    node_summaries[next_node]["status"] = "draft"
                current_node = next_node
        elif action == "complete" and node == "report":
            node_summaries[node]["status"] = "completed"

        graph_version = state["graphVersion"] + 1
        processed = deepcopy(state["processedRequests"])
        processed[request_id] = {
            "fingerprint": _fingerprint(pending),
            "graphVersion": graph_version,
        }
        return {
            "graphVersion": graph_version,
            "revision": revision,
            "currentNode": current_node,
            "availableNodes": available_nodes,
            "nodeStates": node_states,
            "nodeSummaries": node_summaries,
            "processedRequests": processed,
            "lastRequestId": request_id,
            "pendingCommand": None,
            "routedNode": None,
        }

    builder = StateGraph(GuidedResearchGraphState)
    builder.add_node("await_command", await_command)
    builder.add_node("route_command", route_command)
    for node in RESEARCH_NODES:
        builder.add_node(node, handle_node)
    builder.add_edge(START, "await_command")
    builder.add_edge("await_command", "route_command")
    builder.add_conditional_edges("route_command", route_target, {node: node for node in RESEARCH_NODES})
    for node in RESEARCH_NODES:
        builder.add_edge(node, "await_command")
    # ⚠ 只在真的传了 checkpointer 时才带上它——LangGraph Platform（`langgraph dev`
    # 本地 CLI 与部署到 devapp 走的是同一套 langgraph_api）自己接管持久化，编译时若带
    # 自定义 checkpointer 会被判 GraphLoadError（"persistence is handled automatically
    # by the platform"，2026-08-17 生产实测：devapp 首次真部署时炸在这里，见 issue
    # 追踪）。单测（`create_guided_research_graph(MemorySaver())`）需要显式内存态
    # 隔离，继续传 checkpointer 就还是原来的行为，不受影响。
    if checkpointer is not None:
        return builder.compile(checkpointer=checkpointer)
    return builder.compile()


def start_guided_research_thread(
    graph: Any,
    config: dict[str, Any],
    state: GuidedResearchGraphState,
) -> dict[str, Any]:
    graph.invoke(state, config=_graph_config(config))
    return _snapshot_projection(graph, config)


def load_guided_research_projection(graph: Any, config: dict[str, Any]) -> dict[str, Any]:
    return _snapshot_projection(graph, config)


def invoke_guided_research_command(
    graph: Any,
    config: dict[str, Any],
    command: dict[str, Any],
) -> dict[str, Any]:
    snapshot = graph.get_state(_graph_config(config))
    if not snapshot.values:
        raise GuidedResearchGraphError("RESEARCH_NOT_FOUND", "guided research thread not found")
    state = snapshot.values
    request_id = command.get("requestId")
    fingerprint = _fingerprint(command)
    previous = state.get("processedRequests", {}).get(request_id)
    if previous is not None:
        if previous["fingerprint"] != fingerprint:
            raise GuidedResearchGraphError(
                "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH",
                "request id was already used for a different command",
            )
        return _snapshot_projection(graph, config)

    _validate_command(state, command)
    if command.get("expectedGraphVersion") != state["graphVersion"]:
        raise GuidedResearchGraphError(
            "RESEARCH_GRAPH_VERSION_CONFLICT",
            "guided research graph version is stale",
        )
    graph.invoke(Command(resume=command), config=_graph_config(config))
    return _snapshot_projection(graph, config)


# LangGraph Platform export（`langgraph.json` 里 "Guided Research" 指的就是这个
# 模块级 `graph`）——`langgraph dev` 本地 CLI 与部署到 devapp 走的是**同一套**
# langgraph_api 加载器，两边都由平台自己接管持久化，不接受编译时带自定义
# checkpointer（2026-08-17 生产实测：之前这里挂了 MemorySaver，devapp 首次真部署
# 直接 GraphLoadError）。之前设想的「production 分支该抛错、由服务自举另外传
# PostgresSaver」在这套加载机制下根本走不到——`langgraph.json` 声明的路径式加载
# 不区分 APP_ENV，一律走这个模块级导出，所以不再区分 dev/production 两条路。
# 单测要的显式内存隔离走 `create_guided_research_graph(MemorySaver())`，不经过
# 这个导出，不受影响。
graph = create_guided_research_graph()
