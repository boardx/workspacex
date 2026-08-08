"""Unit tests for `deep_agent_service.model` (#739). No network call: constructing a
`ChatOpenAI` client does not contact the endpoint, so this runs the same real code path a
deployment would hit at graph-build time -- only the actual `.invoke()` is untested here
(covered instead by `test_tools.py` against a fake model, see that file's own header)."""
from __future__ import annotations

import pytest

from deep_agent_service.model import DeepAgentModelConfigError, build_chat_model


def test_build_chat_model_fails_closed_when_base_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KERNEL_MODEL_BASE_URL", raising=False)
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    with pytest.raises(DeepAgentModelConfigError):
        build_chat_model()


def test_build_chat_model_fails_closed_when_api_key_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "https://example.invalid/compatible-mode/v1")
    monkeypatch.delenv("KERNEL_MODEL_API_KEY", raising=False)
    with pytest.raises(DeepAgentModelConfigError):
        build_chat_model()


def test_build_chat_model_uses_configured_model_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "https://example.invalid/compatible-mode/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.setenv("KERNEL_DEEP_AGENT_MODEL_ID", "qwen-max")

    model = build_chat_model()

    assert model.model_name == "qwen-max"


def test_build_chat_model_defaults_model_id_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "https://example.invalid/compatible-mode/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.delenv("KERNEL_DEEP_AGENT_MODEL_ID", raising=False)

    model = build_chat_model()

    assert model.model_name == "qwen-plus"
