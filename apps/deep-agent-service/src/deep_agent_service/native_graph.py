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
from deepagents.middleware.skills import SkillsMiddleware, SkillsState
from langchain.agents import create_agent
from langchain.agents.middleware import ToolRetryMiddleware
from langchain.agents.middleware.types import PrivateStateAttr
from langchain_core.language_models.chat_models import BaseChatModel
from typing_extensions import NotRequired

from .native_tool_authority import NativeToolAuthority, ToolAuthority, ToolAuthorityError
from .harness import build_middleware
from .native_skill_activity import NativeSkillActivity, SkillActivityError
from .sandbox_backend import HttpSessionSandbox, SandboxTransportError
from .skill_packages import package_mount_files
from .native_tool_identity import verify_native_tool_identities


class _BoundSkillsState(SkillsState):
    native_skills_binding: NotRequired[Annotated[str, PrivateStateAttr]]


class _BoundSkillsMiddleware(SkillsMiddleware):
    """Only guard cache provenance; official loader, prompts and hooks do the work."""
    state_schema = _BoundSkillsState

    @property
    def name(self) -> str:
        # Official by-name override: exactly one SkillsMiddleware in the graph.
        return "SkillsMiddleware"

    def __init__(self, backend, binding: str, activity=None):
        super().__init__(backend=backend, sources=["/skills/"])
        self._binding = binding
        self._activity = activity

    def _validate_binding(self, state):
        previous = state.get("native_skills_binding")
        if (previous is not None and previous != self._binding) or (
            "skills_metadata" in state and previous != self._binding
        ):
            raise ValueError("Native skill cache binding mismatch; start with the matching session and package set")

    def before_agent(self, state, runtime, config):
        self._validate_binding(state)
        update = super().before_agent(state, runtime, config)
        if self._activity is not None:
            self._activity.metadata_discovered((update or state).get("skills_metadata", []))
        return {**(update or {}), "native_skills_binding": self._binding}

    async def abefore_agent(self, state, runtime, config):
        self._validate_binding(state)
        update = await super().abefore_agent(state, runtime, config)
        if self._activity is not None:
            self._activity.metadata_discovered((update or state).get("skills_metadata", []))
        return {**(update or {}), "native_skills_binding": self._binding}


def create_native_graph(
    model: BaseChatModel,
    *,
    sandbox: HttpSessionSandbox,
    pinned_skills: list[dict[str, Any]],
    interrupt_on: dict,
    tool_authority: ToolAuthority,
    tools=(),
    system_prompt=None,
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
    from .standard_memory import StandardMemoryError
    from .standard_context_tools import StandardContextError
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
                return not isinstance(error, (SandboxTransportError, SkillActivityError, ToolAuthorityError, NativeArtifactPublishError, StandardWebError, StandardMemoryError, StandardContextError)) and (
                    prior(error) if callable(prior) else isinstance(error, prior)
                )
            item.retry_on = retry_known_failure
    activity = NativeSkillActivity(pinned_skills)
    graph = create_deep_agent(
        model=model, tools=tools, system_prompt=system_prompt, backend=backend,
        skills=["/skills/"],
        # Explicit compiled override prevents automatic parent tool/backend/skill
        # inheritance. T010 currently permits text-only delegation.
        subagents=[{"name": "general-purpose",
                    "description": "Text-only reasoning and drafting. No tools, files, skills or code execution.",
                    "runnable": create_agent(model, tools=[], system_prompt="Provide text-only reasoning or drafting. You have no tools, files, skills, or code execution.")}],
        middleware=[_BoundSkillsMiddleware(backend, binding, activity), activity, *middleware, authority_middleware],
        checkpointer=checkpointer, store=store, interrupt_on=interrupt_on,
    )

    verify_native_tool_identities(graph)
    return graph
