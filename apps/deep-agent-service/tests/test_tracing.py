"""D10④ 的反证套件（rubric `deepagent-capability-rubric.md` 第 104 行）。

纪律：写完门控立刻造反证（本仓九次「全绿但空转」）。这里的反证是
`test_no_spans_without_tracer`：不挂 tracer 时图能跑，但落不出任何 span——
证明「有 span」这件事真的是 tracer 挂上去才有的，不是巧合。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from deepagents import create_deep_agent

from deep_agent_service.tracing import build_tracing_callbacks, get_tracer_provider


class _ScriptedToolCallingModel(GenericFakeChatModel):
    """`GenericFakeChatModel` 的基类 `bind_tools` 抛 `NotImplementedError`（实测，
    见 test_harness.py 的 `_hitl_graph` 同一处 bug 记录）——脚本已定死要发什么
    调用，bind 在这里就是个 no-op。"""

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
        return self


def _scripted_model() -> _ScriptedToolCallingModel:
    return _ScriptedToolCallingModel(
        messages=iter(
            [
                AIMessage(
                    content="",
                    tool_calls=[{"id": "c1", "name": "echo_tool", "args": {"text": "hi"}}],
                ),
                AIMessage(content="done"),
            ]
        )
    )


@tool
def echo_tool(text: str) -> str:
    """Echo back the given text."""
    return f"echo:{text}"


def _reset_tracing_module_state(monkeypatch) -> None:
    """`get_tracer_provider()` memoizes a process-wide singleton (deliberately --
    see its own docstring on why it never calls the global OTel `set_tracer_provider`
    API). Tests need a fresh provider per case so each one's exporter config
    (env vars) actually takes effect instead of reusing a previous test's provider."""
    import deep_agent_service.tracing as tracing_module

    monkeypatch.setattr(tracing_module, "_provider", None)


def test_agent_run_produces_a_real_trace_id_linked_to_thread_id(tmp_path: Path, monkeypatch):
    """D10④ 正向：一次真实（进程内，脚本化模型）agent run 必须导出一条可读的
    trace，且能用应用层 thread_id 把它和这条 trace 关联起来——不是只包一层顶层
    span：模型调用、工具调用、middleware 节点都要各自成 span。"""
    trace_file = tmp_path / "otel-traces.jsonl"
    monkeypatch.setenv("DEEP_AGENT_OTEL_TRACE_FILE", str(trace_file))
    monkeypatch.delenv("DEEP_AGENT_OTEL_DISABLED", raising=False)
    monkeypatch.delenv("DEEP_AGENT_OTEL_OTLP_ENDPOINT", raising=False)
    _reset_tracing_module_state(monkeypatch)

    graph = create_deep_agent(model=_scripted_model(), tools=[echo_tool])
    graph = graph.with_config({"callbacks": build_tracing_callbacks()})

    result = graph.invoke(
        {"messages": [{"role": "user", "content": "please echo hi"}]},
        config={"configurable": {"thread_id": "test-trace-thread"}},
    )
    assert result["messages"][-1].content == "done"

    get_tracer_provider().force_flush()

    spans = _parse_console_span_stream(trace_file.read_text(encoding="utf-8"))
    assert len(spans) >= 4, "至少要有 model/tool/middleware 各一个 span，不是单层顶壳"

    span_names = {s["name"] for s in spans}
    assert any(name.startswith("llm:") for name in span_names), "缺模型调用 span"
    assert any(name.startswith("tool:") for name in span_names), "缺工具调用 span"
    assert any(name.startswith("chain:") for name in span_names), "缺 middleware/节点 span"

    trace_ids = {s["context"]["trace_id"] for s in spans}
    assert len(trace_ids) == 1, "同一次 run 的全部 span 必须落在同一条 trace 里"
    trace_id = next(iter(trace_ids))
    assert trace_id.startswith("0x") and len(trace_id) == 34, f"trace_id 形状不对: {trace_id}"

    root = next(s for s in spans if s["parent_id"] is None)
    assert root["attributes"]["deep_agent.thread_id"] == "test-trace-thread", (
        "根 span 必须能用应用层 thread_id 关联到这条 trace（rubric D10④ 原文要求）"
    )
    assert root["attributes"]["deep_agent.run_id"], "根 span 必须带 run_id"


def test_no_spans_without_tracer(tmp_path: Path, monkeypatch):
    """反向对照：不挂 `build_tracing_callbacks()` 的 run 照样能跑完，但不产生
    任何 OTel span——证明前一条测试看到的 span 确实是 tracer 挂上去才有的。"""
    trace_file = tmp_path / "otel-traces-off.jsonl"
    monkeypatch.setenv("DEEP_AGENT_OTEL_TRACE_FILE", str(trace_file))
    _reset_tracing_module_state(monkeypatch)

    graph = create_deep_agent(model=_scripted_model(), tools=[echo_tool])
    # 故意不 .with_config(callbacks=...)
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "please echo hi"}]},
        config={"configurable": {"thread_id": "no-trace-thread"}},
    )
    assert result["messages"][-1].content == "done"
    assert not trace_file.exists() or trace_file.read_text(encoding="utf-8").strip() == ""


def test_otel_disabled_env_yields_no_callbacks(monkeypatch):
    """`DEEP_AGENT_OTEL_DISABLED=1` 是 S1=B 纪律要求的灰度回退开关：必须能整体
    关掉，回到「压根没挂 tracer」的行为。"""
    monkeypatch.setenv("DEEP_AGENT_OTEL_DISABLED", "1")
    _reset_tracing_module_state(monkeypatch)
    assert build_tracing_callbacks() == []


def _parse_console_span_stream(content: str) -> list[dict]:
    """`ConsoleSpanExporter`'s default formatter is `json.dumps(indent=2) + "\\n"`
    per span, back-to-back -- split on brace-depth, not on any custom delimiter,
    since we don't control the formatter's exact framing."""
    spans: list[dict] = []
    depth = 0
    buf = ""
    for ch in content:
        if depth > 0 or ch == "{":
            buf += ch
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and buf:
                spans.append(json.loads(buf))
                buf = ""
    return spans
