"""Model configuration for this service (#739).

## Why this reads the SAME `KERNEL_MODEL_*` env vars the TS side reads

The human's own instruction for this migration: "复用同一把模型 API key
（`KERNEL_MODEL_API_KEY`，阿里云百炼，OpenAI 兼容），不需要新申请凭据." This process is a
separate container from `apps/api`, so it needs its OWN copy of these values injected at
container-start time (same names, same values, no new secret) -- it cannot reach into the
Node process's environment. `KERNEL_MODEL_BASE_URL`/`KERNEL_MODEL_API_KEY` are read here
with the identical names `configured-model-provider.ts`'s `readModelProviderConfig` uses,
so whoever wires the deployment env only has one pair of values to keep in sync, not two.

`KERNEL_DEEP_AGENT_MODEL_ID` is new and specific to this service (the TS side has no
single global "model id" env var either -- see `pg-default-agent-repository.ts`'s own
`KERNEL_DEFAULT_AGENT_MODEL_ID` comment for why that value is a per-agent, not a
per-deployment, fact). The default below is a placeholder, not a verified working model
id for any specific deployment -- whoever stands this service up for real MUST set
`KERNEL_DEEP_AGENT_MODEL_ID` to a model this deployment's Bailian account actually has
access to; nothing here has been run against a live endpoint (#739 could not install
`deepagents` in this environment -- Python 3.9 sandbox vs. the package's `>=3.11`
requirement -- see the PR description for what WAS and was not verified).
"""
from __future__ import annotations

import os

from langchain_openai import ChatOpenAI

DEFAULT_MODEL_ID = "qwen-plus"


class DeepAgentModelConfigError(RuntimeError):
    """Raised when this process cannot build a model client from its environment."""


def build_chat_model() -> ChatOpenAI:
    base_url = (os.environ.get("KERNEL_MODEL_BASE_URL") or "").strip().rstrip("/")
    api_key = os.environ.get("KERNEL_MODEL_API_KEY") or ""
    model_id = (os.environ.get("KERNEL_DEEP_AGENT_MODEL_ID") or "").strip() or DEFAULT_MODEL_ID

    if base_url == "" or api_key == "":
        # Fail loudly at graph-build time, not silently at first tool call -- the same
        # "fail closed, never fabricate a call" discipline `ModelCallError` enforces on
        # the TS side (`ports.ts`'s own doc comment).
        raise DeepAgentModelConfigError(
            "KERNEL_MODEL_BASE_URL and KERNEL_MODEL_API_KEY must both be set for this "
            "deployment; deep-agent-service does not fall back to a different provider."
        )

    return ChatOpenAI(base_url=base_url, api_key=api_key, model=model_id)
