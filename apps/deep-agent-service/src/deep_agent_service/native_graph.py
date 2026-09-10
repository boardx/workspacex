"""Opt-in native capability graph for a trusted, already-created sandbox session.

No identity allocation, session lifecycle, event persistence or legacy fallback.
The caller owns the HTTP client and checkpoint lifecycle. A graph is bound to
one immutable session/package set; it must not be cached across those bindings.
"""
from __future__ import annotations

import base64
import hashlib
import json
from typing import Annotated, Any

from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend
from deepagents.backends.protocol import FileDownloadResponse
from deepagents.middleware.skills import (
    SkillsMiddleware,
    SkillsState,
    SkillsStateUpdate,
    _skill_metadata_from_response,
)
from langchain.agents import create_agent
from langchain.agents.middleware import ToolRetryMiddleware
from langchain.agents.middleware.types import PrivateStateAttr
from langchain_core.language_models.chat_models import BaseChatModel
from typing_extensions import NotRequired

from .native_tool_authority import NativeToolAuthority, ToolAuthority, ToolAuthorityError
from .native_sandbox_dispatch import NativeSandboxDispatch
from .harness import build_middleware
from .native_skill_activity import NativeSkillActivity, SkillActivityError
from .sandbox_backend import HttpSessionSandbox, SandboxTransportError
from .skill_packages import package_mount_files
from .native_tool_identity import verify_native_tool_identities
from .native_tool_snapshot import NativeToolSnapshot
from .native_file_delegation import file_delegation_subagent, validated_inputs


class _BoundSkillsState(SkillsState):
    native_skills_binding: NotRequired[Annotated[str, PrivateStateAttr]]


def metadata_from_pins(pinned_skills):
    """Parse `skills_metadata` out of the trusted pin bytes -- zero sandbox round trips.

    #3309: the official loader discovers skills by asking the sandbox for a
    directory listing plus every `SKILL.md` in it. In native mode that is a
    round trip per skill for bytes we are already holding: `create_native_graph`
    has just downloaded the whole mount and compared it BYTE FOR BYTE against
    these same pins (see the `download_files` check below -- it is what makes
    this shortcut sound; without it we would be seeding metadata for a mount we
    never verified). Measured on a real stack: 1 `ls` + 21 `SKILL.md` reads =
    22 round trips / 105 KB / ~3.1 s per run, on every first turn of every
    thread, including turns that call no tool at all.

    Parsing stays upstream's: the same `_skill_metadata_from_response` the
    official loader feeds its download responses to, and the same "key by
    frontmatter name, last one wins" collapse from `before_agent`. A drift
    gate asserts this returns exactly what the official loader returns for the
    same mount (`test_pin_seeded_metadata_matches_official_loader`); if
    upstream changes how it parses, that test goes red rather than this
    silently serving a stale shape.
    """
    by_name: dict[str, Any] = {}
    for skill in pinned_skills:
        name = skill["stable_name"]
        directory = f"/skills/{name}"
        path = f"{directory}/SKILL.md"
        # `package_mount_files` already refused any package without a SKILL.md.
        body = next(f for f in skill["package"]["files"] if f["path"] == "SKILL.md")
        metadata = _skill_metadata_from_response(
            FileDownloadResponse(path=path, content=base64.b64decode(body["contentBase64"], validate=True), error=None),
            directory, path)
        if metadata is not None:
            by_name[metadata["name"]] = metadata
    return list(by_name.values())


class _BoundSkillsMiddleware(SkillsMiddleware):
    """Only guard cache provenance; official prompts and hooks do the work."""
    state_schema = _BoundSkillsState

    @property
    def name(self) -> str:
        # Official by-name override: exactly one SkillsMiddleware in the graph.
        return "SkillsMiddleware"

    def __init__(self, backend, binding: str, activity=None, pinned_skills=()):
        super().__init__(backend=backend, sources=["/skills/"])
        self._binding = binding
        self._activity = activity
        self._pinned = list(pinned_skills)

    def _validate_binding(self, state):
        previous = state.get("native_skills_binding")
        if (previous is not None and previous != self._binding) or (
            "skills_metadata" in state and previous != self._binding
        ):
            raise ValueError("Native skill cache binding mismatch; start with the matching session and package set")

    # #3206：只有"这一轮真的发现了"才报发现。官方 loader 在 `skills_metadata` 已在
    # state 里时返回 None——那一轮它一个字节都没读（实测：首轮 21 次沙箱往返，第二轮
    # 0 次）。此前这里拿 `(update or state)` 兜底，于是同一线程的每一轮都把整包
    # 元数据重报一遍：20 个 skill = 每轮 20 条事实 → 20 次 `appendExecutionEvent`
    # 串行 Postgres 事务 + 用户轨迹里 20 行"发现技能元数据"，而后台其实什么都没发现。
    # 事实流的契约是"观察到的，不是推断的"，重报缓存值本身就是假事实。
    def _load(self, state):
        """Same contract as upstream `before_agent`: an update, or `None` when cached.

        #3309 changes only WHERE the bytes come from (verified pins instead of
        a fresh sandbox read). The cache rule is upstream's, unchanged: a state
        that already carries `skills_metadata` is a turn on which nothing was
        loaded, so nothing is reported -- that is #3206's fix and it still
        holds here.
        """
        if "skills_metadata" in state:
            return None
        return SkillsStateUpdate(skills_metadata=metadata_from_pins(self._pinned))

    def before_agent(self, state, runtime, config):
        self._validate_binding(state)
        update = self._load(state)
        if self._activity is not None and update is not None:
            self._activity.metadata_discovered(update.get("skills_metadata", []))
        return {**(update or {}), "native_skills_binding": self._binding}

    async def abefore_agent(self, state, runtime, config):
        self._validate_binding(state)
        update = self._load(state)
        if self._activity is not None and update is not None:
            self._activity.metadata_discovered(update.get("skills_metadata", []))
        return {**(update or {}), "native_skills_binding": self._binding}


def create_native_graph(
    model: BaseChatModel,
    *,
    sandbox: HttpSessionSandbox,
    pinned_skills: list[dict[str, Any]],
    interrupt_on: dict,
    tool_authority: ToolAuthority,
    tools=(),
    tool_snapshot: frozenset[str] | None = None,
    system_prompt=None,
    inputs=(),
    file_authority=None,
    binding_guard=None,
    checkpointer=None,
    store=None,
):
    """Build official native tools over an existing, fully mounted skill set.

    Complete package bytes are verified against the trusted pins before graph
    construction. Missing/legacy-only packages fail closed. No mount is modified.
    The trusted factory must create this session from exactly the same
    package_mount_files(pinned_skills), without additional packages.
    tool_authority is mandatory and checked immediately before every tool dispatch.
    interrupt_on is mandatory trusted-factory policy; {} is an explicit grant
    for the isolated low-risk tools, never an inferred default.
    Checkpoint bindings reject stale skills_metadata rather than silently reusing
    cached descriptions from another package version or session.
    """
    from .native_artifact_publish import NativeArtifactPublishError
    from .standard_web_tools import StandardWebError
    from .standard_artifact_download import StandardArtifactDownloadError
    from .standard_run_status import StandardRunStatusError
    from .standard_run_cancel import StandardRunCancelError
    from .standard_browser_tools import StandardBrowserError
    from .standard_memory import StandardMemoryError
    from .standard_context_tools import StandardContextError
    from .standard_canvas_tools import StandardCanvasError
    from .standard_document_tools import StandardDocumentError
    from .standard_image_tools import StandardImageError
    from .standard_audio_tools import StandardAudioError
    from .standard_schedule import StandardScheduleError
    from .standard_sql_database import StandardSqlError
    from .standard_skill_draft import SkillDraftError
    from .standard_subtask_tools import StandardSubtaskError
    from .mcp_snapshot_tools import McpExecutionError
    snapshot = NativeToolSnapshot(tool_snapshot, tool_authority) if tool_snapshot is not None else None
    if snapshot is not None:
        tool_authority = snapshot
    authority_middleware = NativeToolAuthority(tool_authority)
    if not isinstance(interrupt_on, dict):
        raise ValueError("An explicit trusted interrupt policy is required; {} explicitly authorizes sandbox tools")
    if not isinstance(sandbox, HttpSessionSandbox):
        raise TypeError("Native graph requires the trusted HTTP session adapter")
    files = package_mount_files(pinned_skills)
    downloaded = sandbox.download_files([file["path"] for file in files])
    if len(downloaded) != len(files) or any(
        result.error or result.path != file["path"]
        or result.content != base64.b64decode(file["contentBase64"], validate=True)
        for file, result in zip(files, downloaded, strict=True)
    ):
        raise ValueError("Mounted skill package does not match the trusted pin")
    identity = [{"stable_name": skill["stable_name"], "skillId": skill["package"]["skillId"],
                 "versionId": skill["package"]["versionId"],
                 "files": sorted((file["path"], file["digest"]) for file in skill["package"]["files"])}
                for skill in pinned_skills]
    binding = hashlib.sha256(json.dumps({"session": sandbox.id, "packages": identity},
                                       sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    # Official tool eviction must not try writing /large_tool_results into the
    # sandbox's immutable root. This state route belongs to the invoking thread.
    backend = CompositeBackend(default=sandbox, routes={"/large_tool_results/": StateBackend()})
    middleware = build_middleware(model, backend=backend)
    for item in middleware:
        if isinstance(item, ToolRetryMiddleware):
            previous = item.retry_on
            # Keep the official retry implementation and all harness settings.
            # A lost execution response must not become a new side-effect call.
            def retry_known_failure(error, prior=previous):
                return not isinstance(error, (SandboxTransportError, SkillActivityError, ToolAuthorityError, NativeArtifactPublishError, StandardWebError, StandardBrowserError, StandardArtifactDownloadError, StandardRunStatusError, StandardRunCancelError, StandardMemoryError, StandardContextError, StandardCanvasError, StandardDocumentError, StandardSqlError, StandardScheduleError, StandardImageError, StandardAudioError, SkillDraftError, StandardSubtaskError, McpExecutionError)) and (
                    prior(error) if callable(prior) else isinstance(error, prior)
                )
            item.retry_on = retry_known_failure
    activity = NativeSkillActivity(pinned_skills)
    delegated_inputs = validated_inputs(list(inputs))
    graph = create_deep_agent(
        model=model, tools=tools, system_prompt=system_prompt, backend=backend,
        skills=["/skills/"],
        # Explicit compiled override prevents automatic parent tool/backend/skill
        # inheritance. File delegation is a separate explicit subagent type.
        subagents=[{"name": "general-purpose",
                    "description": "Text-only reasoning and drafting. No tools, files, skills or code execution.",
                    "runnable": create_agent(model, tools=[], system_prompt="Provide text-only reasoning or drafting. You have no tools, files, skills, or code execution.")},
                   *([file_delegation_subagent(model, sandbox, delegated_inputs, tool_authority, file_authority)] if delegated_inputs else [])],
        middleware=[_BoundSkillsMiddleware(backend, binding, activity, pinned_skills), activity, *middleware, *([snapshot] if snapshot is not None else []), NativeSandboxDispatch(sandbox.id, binding_guard=binding_guard), authority_middleware],
        checkpointer=checkpointer, store=store, interrupt_on=interrupt_on,
    )

    verify_native_tool_identities(graph)
    if snapshot is not None:
        node = graph.nodes["tools"]
        snapshot.validate(getattr(node, "bound", node).tools_by_name)
    return graph
