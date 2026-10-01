"""数字人能力（决策 B）：`configurable.model_id` ⇒ 本次模型调用换成钉住的模型；缺席 ⇒ 原样透传。"""
from __future__ import annotations

from unittest.mock import patch

from deep_agent_service import harness
from deep_agent_service.harness import PinnedModelMiddleware, build_middleware


class _Req:
    def __init__(self, model):
        self.model = model
        self.overrides = None

    def override(self, **kw):
        self.overrides = kw
        return ("overridden", kw)


class _M:
    def __init__(self, name):
        self.model_name = name


def _run(config, req):
    mw = PinnedModelMiddleware()
    with patch.object(harness, "get_config", return_value=config):
        return mw.wrap_model_call(req, lambda r: r)


def test_no_model_id_passes_request_through():
    req = _Req(_M("qwen-max"))
    assert _run({"configurable": {}}, req) is req


def test_same_model_id_passes_request_through():
    req = _Req(_M("qwen-plus"))
    assert _run({"configurable": {"model_id": "qwen-plus"}}, req) is req


def test_pinned_model_id_overrides_model(monkeypatch):
    monkeypatch.setenv("KERNEL_MODEL_BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setenv("KERNEL_MODEL_API_KEY", "k")
    harness._pinned_models.clear()
    out = _run({"configurable": {"model_id": "qwen-plus"}}, _Req(_M("qwen-max")))
    assert out[0] == "overridden"
    assert out[1]["model"].model_name == "qwen-plus"


def test_outside_runnable_context_passes_through():
    req = _Req(_M("x"))
    with patch.object(harness, "get_config", side_effect=RuntimeError):
        assert PinnedModelMiddleware().wrap_model_call(req, lambda r: r) is req


def test_wired_into_build_middleware():
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    names = [type(m).__name__ for m in build_middleware(FakeListChatModel(responses=["x"]))]
    assert "PinnedModelMiddleware" in names
