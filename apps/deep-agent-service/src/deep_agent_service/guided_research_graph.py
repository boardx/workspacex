"""Guided Research 状态机（DA-10，issue #1749 系列 / 人类 2026-08-23 裁决核对结果）。

## 2026-08-23 迁移核对结论：不迁移到 `create_deep_agent`，理由是真实语义鸿沟，不是嫌麻烦

人类裁决「289 行手写 StateGraph 要么迁移到 deepagents（若 interrupt 语义可覆盖），
要么在文件头写明豁免理由」——本节是那次核对的记录（对照 `harness.py::build_middleware`
逐条过的，不是没试就下结论）。

**这个图不是 agent。** 全文 289 行没有一次模型调用、没有一个工具。每一次状态转移
（`handle_node`）都由外部调用方显式传入的 `command`（`{node, action, requestId,
expectedGraphVersion, nodeState}`）决定，经 JSON Schema（`_COMMAND_VALIDATOR`）与
`_validate_command` 校验后确定性执行——`directions` 节点上出现的 `modelId` /
`modelInvocationId` 只是把「模型调用发生在图外」这件事记录进 nodeSummaries 的元数据，
图本身不 invoke 任何 `BaseChatModel`。`langgraph.json` 把它注册成与 "Deep Agent"
平行的独立顶层 graph（"Guided Research"），由前端 API 直接 invoke/resume 驱动，
不经过任何 LLM 决策循环。

`interrupt()` 在这里的语义也和 deepagents 的 HITL 不同：`await_command` 是**无条件**
在每一步之后暂停、等待下一条外部命令——本质是借 LangGraph 的 checkpointer + interrupt
机制换取「线程级持久化 + 乐观并发（`expectedGraphVersion`）+ 请求幂等（`processedRequests`
按 requestId 去重并核对 fingerprint）」这几个 RPC-over-checkpoint 的免费能力，
不是「工具调用前暂停等人批准/拒绝/编辑」。

逐条对照 `harness.py::build_middleware` 的七件 middleware，没有一件的适用前提
（存在一个自主决定下一步做什么的 LLM 循环）在这里成立：

- `TodoListMiddleware`（D1 规划可见性）——没有多步任务规划，下一步永远由外部命令指定。
- `SummarizationMiddleware`（D8 滚动摘要）——没有累积的对话消息历史需要摘要；
  `nodeStates` 是按节点覆盖写入的结构化字段，不是消息列表。
- `FilesystemMiddleware`（大工具输出卸载）——没有工具调用，没有工具输出可卸载。
- `ToolCallLimitMiddleware` / `ModelCallLimitMiddleware`（预算熔断）——没有工具调用、
  没有模型调用可计数；这里的 "retry" 是**领域动作**（前端可对 research/report 节点
  发 `action=retry` 要求重做），不是 `ToolRetryMiddleware` 防的那种工具瞬时故障重试，
  两者字面同名、语义不同，不能互相替代。
- `ToolRetryMiddleware`——同上，没有工具调用可重试。
- `HumanInTheLoopMiddleware`——它中断的对象是「即将发生的某个具体工具调用」，
  裁决类型是 approve/reject/edit 这四种固定动作；guided_research 的中断对象是
  「任意下一条命令」，路由目标是 5 个节点 × 多种领域动作的笛卡尔积，裁决内容是
  结构化的业务状态（`nodeState`），形状完全不同，硬套上去意味着发明一套假工具
  （每个 node×action 组合一个），让 LLM「决定」调用哪个——这不是把底层实现换掉，
  是把「外部调用方显式指定、JSON Schema 校验、乐观并发保护」的确定性状态转移
  改造成「LLM 猜测意图」的非确定性转移，属于行为回归，不是等价迁移。

**结论**：不满足「用 deepagents 原生等价物覆盖」的前提——没有 agent 循环可以套
middleware。继续维持这个独立的手写 StateGraph 不是「偷懒留了第二条路」，是因为
它服务的是与 "Deep Agent"（真正的 LLM ReAct 循环，`harness.py` 那一套）完全不同的
问题：一个前端驱动的、带乐观并发与幂等保证的向导式状态机后端。豁免记录同步写回
`.harness/state/deepagent-copilotkit-backlog.md` DA-10 条目。

若未来 deepagents 出现「确定性状态机」类的原生构件（不是 LLM 循环控制器），
应重新评估；在此之前这条不应被重复提起为「未收口」。
"""
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
