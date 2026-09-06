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


# #2700 -- deep-agent 主聊天路径没有关闭 Qwen3 深度思考，非流式调用（这个文件从未把
# `streaming=True` 传给 `ChatOpenAI`）要等整段隐藏 reasoning 生成完才返回，devapp 实测
# 简单问答卡 90+ 秒。以下断言直接检查 `ChatOpenAI.extra_body`——这是 `langchain-openai`
# 合并进底层 HTTP 请求体的字段，与 `configured-model-provider.test.ts` 断言
# `postCompletions` 请求体是同一层面的证据（"参数确实被传给模型调用"，不是走到网络层）。
_BAILIAN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def test_build_chat_model_disables_thinking_for_default_qwen_plus(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", _BAILIAN_URL)
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.delenv("KERNEL_DEEP_AGENT_MODEL_ID", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_THINKING_DISABLE_IDS", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_BAILIAN_EXTENSIONS", raising=False)

    model = build_chat_model()

    assert model.extra_body == {"enable_thinking": False}


def test_build_chat_model_disables_thinking_for_configured_qwen3_model_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", _BAILIAN_URL)
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.setenv("KERNEL_DEEP_AGENT_MODEL_ID", "qwen3.7-plus")
    monkeypatch.delenv("KERNEL_MODEL_THINKING_DISABLE_IDS", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_BAILIAN_EXTENSIONS", raising=False)

    model = build_chat_model()

    assert model.extra_body == {"enable_thinking": False}


def test_build_chat_model_does_not_disable_thinking_for_unlisted_model_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """modelId 不在 `KERNEL_MODEL_THINKING_DISABLE_IDS` 允许集合里 ⇒ 完全不带
    `enable_thinking`——与 `configured-model-provider.ts` 的反证同一纪律：未知能力
    不裸猜，行为回落到修复前的原始请求体。"""
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", _BAILIAN_URL)
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.setenv("KERNEL_DEEP_AGENT_MODEL_ID", "some-other-model")
    monkeypatch.delenv("KERNEL_MODEL_THINKING_DISABLE_IDS", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_BAILIAN_EXTENSIONS", raising=False)

    model = build_chat_model()

    assert model.extra_body is None


def test_build_chat_model_does_not_disable_thinking_for_non_bailian_base_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """modelId 在允许集合里，但 `baseUrl` 不是真的百炼端点 ⇒ 不带这个字段——一个
    复用了 `qwen-plus` 这个名字的非百炼端点不该被发送这个陌生扩展字段。"""
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "https://example.invalid/compatible-mode/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.delenv("KERNEL_DEEP_AGENT_MODEL_ID", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_THINKING_DISABLE_IDS", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_BAILIAN_EXTENSIONS", raising=False)

    model = build_chat_model()

    assert model.extra_body is None


def test_build_chat_model_respects_explicit_bailian_extensions_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "https://example.invalid/compatible-mode/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.delenv("KERNEL_DEEP_AGENT_MODEL_ID", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_THINKING_DISABLE_IDS", raising=False)
    monkeypatch.setenv("KERNEL_MODEL_BAILIAN_EXTENSIONS", "1")

    model = build_chat_model()

    assert model.extra_body == {"enable_thinking": False}


def test_build_chat_model_respects_explicit_thinking_disable_ids_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", _BAILIAN_URL)
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.setenv("KERNEL_DEEP_AGENT_MODEL_ID", "custom-hybrid-model")
    monkeypatch.setenv("KERNEL_MODEL_THINKING_DISABLE_IDS", "custom-hybrid-model")
    monkeypatch.delenv("KERNEL_MODEL_BAILIAN_EXTENSIONS", raising=False)

    model = build_chat_model()

    assert model.extra_body == {"enable_thinking": False}


def test_build_chat_model_disables_thinking_for_qwen3_8_max_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """2026-09-06：devapp 实际部署的 `qwen3.8-max`（混合思考、默认开）必须在默认集合里，
    否则 thinking 一直开着、task 子代理每一步都慢一截。"""
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", _BAILIAN_URL)
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "test-key")
    monkeypatch.setenv("KERNEL_DEEP_AGENT_MODEL_ID", "qwen3.8-max")
    monkeypatch.delenv("KERNEL_MODEL_THINKING_DISABLE_IDS", raising=False)
    monkeypatch.delenv("KERNEL_MODEL_BAILIAN_EXTENSIONS", raising=False)

    model = build_chat_model()

    assert model.extra_body == {"enable_thinking": False}


def test_default_thinking_disable_ids_match_typescript_side() -> None:
    """两份不能互相 import 的默认值（本文件头注「判断逻辑必须与 configured-model-provider.ts
    保持一致」）——机械比对，而不是靠注释互相承诺。"""
    from pathlib import Path
    from deep_agent_service.model import _DEFAULT_THINKING_DISABLE_MODEL_IDS

    ts = Path(__file__).resolve().parents[3] / "apps/api/src/infrastructure/agent-run/configured-model-provider.ts"
    src = ts.read_text(encoding="utf-8")
    needle = f'env.KERNEL_MODEL_THINKING_DISABLE_IDS ?? "{_DEFAULT_THINKING_DISABLE_MODEL_IDS}"'
    assert needle in src, f"TS 侧默认值与 Python 不一致，期望片段：{needle}"
