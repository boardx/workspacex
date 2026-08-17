from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal, TypedDict


ResearchNode = Literal["brief", "directions", "outline", "research", "report"]
RESEARCH_NODES: tuple[ResearchNode, ...] = (
    "brief",
    "directions",
    "outline",
    "research",
    "report",
)


class GuidedResearchGraphState(TypedDict, total=False):
    sessionId: str
    graphVersion: int
    revision: int
    currentNode: ResearchNode
    availableNodes: list[ResearchNode]
    nodeStates: dict[str, dict[str, Any]]
    nodeSummaries: dict[str, dict[str, Any]]
    processedRequests: dict[str, dict[str, Any]]
    pendingCommand: dict[str, Any] | None
    routedNode: ResearchNode | None
    lastRequestId: str | None


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _node_meta(status: str, version: int = 0) -> dict[str, Any]:
    return {
        "status": status,
        "version": version,
        "confirmedVersion": version if status in {"confirmed", "completed"} else None,
        "contentVersionId": None,
        "modelId": None,
        "modelInvocationId": None,
        "modelOutputSchemaVersion": None,
        "confirmedAt": None,
        "updatedAt": _now(),
        "errorCode": None,
    }


def initial_guided_research_state(
    session_id: str,
    *,
    brief_state: dict[str, Any],
    current_node: ResearchNode = "brief",
    available_nodes: list[ResearchNode] | None = None,
    existing_node_states: dict[str, dict[str, Any]] | None = None,
) -> GuidedResearchGraphState:
    """Build the first persisted state from an already-authorized BoardX session.

    F195 migrates only content supplied by the caller. It deliberately never creates
    directions, outline, sources, or report content.
    """

    available = list(available_nodes or ["brief"])
    if current_node not in available:
        available.append(current_node)
    node_states = {"brief": dict(brief_state), **(existing_node_states or {})}
    current_index = RESEARCH_NODES.index(current_node)
    summaries: dict[str, dict[str, Any]] = {}
    for index, node in enumerate(RESEARCH_NODES):
        if node not in available:
            status = "locked"
        elif index < current_index:
            status = "confirmed"
        elif node == current_node:
            status = "draft"
        else:
            status = "ready"
        summaries[node] = _node_meta(status, 1 if node in node_states else 0)

    return {
        "sessionId": session_id,
        "graphVersion": 0,
        "revision": 1,
        "currentNode": current_node,
        "availableNodes": available,
        "nodeStates": node_states,
        "nodeSummaries": summaries,
        "processedRequests": {},
        "pendingCommand": None,
        "routedNode": None,
        "lastRequestId": None,
    }

