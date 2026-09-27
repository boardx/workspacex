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
from langchain.agents.middleware import AgentMiddleware, ToolRetryMiddleware
from langchain.agents.middleware.types import PrivateStateAttr
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import ToolMessage
from typing_extensions import NotRequired

from .native_tool_authority import NativeToolAuthority, ToolAuthority, ToolAuthorityError
from .native_sandbox_dispatch import NativeSandboxDispatch
from .native_task_observation import NativeTaskObservation
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
            item.retry_on = _retry_policy(previous)
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
        middleware=[_ReportToolOutcomeFailures(), _BoundSkillsMiddleware(backend, binding, activity, pinned_skills), activity, *middleware, *([snapshot] if snapshot is not None else []), NativeSandboxDispatch(sandbox.id, binding_guard=binding_guard), authority_middleware, NativeTaskObservation()],
        checkpointer=checkpointer, store=store, interrupt_on=interrupt_on,
    )

    verify_native_tool_identities(graph)
    if snapshot is not None:
        node = graph.nodes["tools"]
        snapshot.validate(getattr(node, "bound", node).tools_by_name)
    return graph


def _retry_policy(previous):
    """工具失败要不要重试。**提到模块层是为了能被单测直接打**——它此前是个闭包，
    只能靠跑整张图间接验证，而这条判据正是 2026-09-24「联网十次五次失败」的关键一环。

    规则（`StandardWebError` 的 `retryable` 是唯一事实源，不在这里重抄一份分类）：
      · 只读联网失败 ⇒ 按它自己声明的 `retryable`（超时 / 网关不可达 / 上游 5xx 才重试）；
      · 其余有副作用的工具 ⇒ 一律不重试（丢失的执行响应不得变成新的副作用调用）；
      · 都不是 ⇒ 交回官方 `ToolRetryMiddleware` 原本的判据。
    """
    from .standard_web_tools import StandardWebError

    def decide(error):
        if isinstance(error, StandardWebError):
            return getattr(error, 'retryable', False)
        if isinstance(error, _never_retry()):
            return False
        return previous(error) if callable(previous) else isinstance(error, previous)

    return decide


def _never_retry():
    """有副作用、重试可能造成第二次副作用的工具错误。惰性导入：与本模块既有写法一致。

    ⚠ 这份清单与 `build_native_graph` 里那份是**同一件事**，由
    `tests/test_web_retry_policy.py` 机械核对两边一致——第二份副本一旦分叉，
    会出现「某类错误在一处不重试、在另一处重试」这种最难查的行为差异。
    """
    from .native_artifact_publish import NativeArtifactPublishError
    from .standard_artifact_download import StandardArtifactDownloadError
    from .standard_audio_tools import StandardAudioError
    from .standard_browser_tools import StandardBrowserError
    from .standard_canvas_tools import StandardCanvasError
    from .standard_context_tools import StandardContextError
    from .standard_document_tools import StandardDocumentError
    from .standard_image_tools import StandardImageError
    from .standard_memory import StandardMemoryError
    from .standard_run_cancel import StandardRunCancelError
    from .standard_run_status import StandardRunStatusError
    from .standard_schedule import StandardScheduleError
    from .standard_skill_draft import SkillDraftError
    from .standard_sql_database import StandardSqlError
    from .standard_subtask_tools import StandardSubtaskError
    from .mcp_snapshot_tools import McpExecutionError
    # 这三个是本模块顶层就导入的（第 29/33/34 行），不重复惰性导入。
    return (SandboxTransportError, SkillActivityError, ToolAuthorityError, NativeArtifactPublishError,
            StandardBrowserError, StandardArtifactDownloadError, StandardRunStatusError,
            StandardRunCancelError, StandardMemoryError, StandardContextError, StandardCanvasError,
            StandardDocumentError, StandardSqlError, StandardScheduleError, StandardImageError,
            StandardAudioError, SkillDraftError, StandardSubtaskError, McpExecutionError)


def _platform_invariant_errors():
    """平台不变量类失败：沙箱传输结果未知 / 授权拒绝或未知 / 技能审计账本写不进去。

    这三类出了问题，继续让模型往下跑就是在一个已经不可信的状态上继续执行——
    照旧直接终止 run（`test_native_graph.py` 的 "outcome unknown" 用例守着这一侧）。
    """
    return (SandboxTransportError, ToolAuthorityError, SkillActivityError)


def _tool_outcome_errors():
    """「这个工具这次没做成」类失败：`_never_retry()` 去掉平台不变量之后的那一批。

    ⚠ 从 `_never_retry()` 派生，不另抄一份清单——那份清单已经有两个副本由测试
    机械核对，再抄第三份就是本仓头号病（同一事实声明在两处）。
    """
    invariants = _platform_invariant_errors()
    return tuple(error for error in _never_retry() if error not in invariants)


def _tool_failure_message(request, error: Exception) -> ToolMessage:
    call = request.tool_call
    name = call.get("name", "tool")
    return ToolMessage(
        content=(f"Tool '{name}' failed and was not retried automatically "
                 f"(it may have side effects): {error}"),
        tool_call_id=call.get("id"),
        name=name,
        status="error",
    )


class _ReportToolOutcomeFailures(AgentMiddleware):
    """不重试 ≠ 掀翻整条 run（2026-09-27 devapp 实测，见
    `tests/test_native_tool_failure_reporting.py` 头注）。

    `_retry_policy` 把有副作用工具的错误判为不重试——意图正确。但
    `ToolRetryMiddleware` 对 `retry_on` 不匹配的异常是**直接 re-raise、跳过
    `on_failure`**（锁定版本源码 `tool_retry.py`：`if not should_retry_exception(...):
    raise`），`on_failure="continue"` 只对"重试耗尽"生效。于是一次发布失败就让整张图
    崩掉，工具调用永远没有结果 → API 判 `tool_call_unresolved`；已经渲染验收完的
    12 页 PPT 连同 13 分钟的工作一起作废，模型连"发布失败"都没看到。

    这里挂在**最外层**：内层所有中间件看到的异常与今天逐字相同（不改它们的行为），
    只在异常即将掀翻整张图的最后一刻，把「工具结果类失败」转成一条
    `status="error"` 的 ToolMessage 交还模型——不重试，由模型决定是用同一个幂等键
    再发一次、换路，还是如实告诉用户。平台不变量类失败不在捕获范围内，照旧终止。
    """

    def wrap_tool_call(self, request, handler):
        try:
            return handler(request)
        except _tool_outcome_errors() as error:
            return _tool_failure_message(request, error)

    async def awrap_tool_call(self, request, handler):
        try:
            return await handler(request)
        except _tool_outcome_errors() as error:
            return _tool_failure_message(request, error)
