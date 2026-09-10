"""issue #3322 —— `call_skill` 执行期间必须产出中间进展。

## 判据落在**这次工具调用的进展条数**上，不是"组件能渲染进展行"

用户看到的缺陷是：pptx 跑了 03:54，轨迹里没有任何能说出"在做什么"的行。所以这里断言
的是「一次跑很久的 `call_skill` 到底吐没吐出中间事实」——把 `_focused_call` 改回一次性
`invoke`，`test_long_call_without_streaming_emits_nothing` 之外的断言必须全红。
"""
from __future__ import annotations

from typing import Any

import pytest

from deep_agent_service.tool_progress import ToolProgressThrottle
from deep_agent_service.tools import build_tools


class Chunk:
    def __init__(self, text: str) -> None:
        self.content = text


class StreamingChatModel:
    """会流式吐分片的替身——真实 `BaseChatModel` 就有 `.stream`。"""

    def __init__(self, pieces: list[str]) -> None:
        self._pieces = pieces
        self.invoked = 0

    def stream(self, messages: list[dict[str, Any]]):
        self.received_messages = messages
        for piece in self._pieces:
            yield Chunk(piece)

    def invoke(self, messages: list[dict[str, Any]]):
        self.invoked += 1
        return Chunk("".join(self._pieces))


class BlockingChatModel:
    """只有 `.invoke` 的鸭子替身——本仓改这个 feature **之前**的全部形状。"""

    def __init__(self, text: str) -> None:
        self._text = text

    def invoke(self, messages: list[dict[str, Any]]):
        return Chunk(self._text)


SKILL_CONFIG = {"configurable": {"org_skills": [
    {"stable_name": "deck-maker", "name": "PPT 生成", "content": "You make decks."}]}}


def _tool_call(args: dict[str, Any]) -> dict[str, Any]:
    return {"args": args, "name": "call_skill", "type": "tool_call", "id": "tc-3322"}


def _run(model, writer):
    import deep_agent_service.tools as tools_module
    original = tools_module.resolve_writer
    tools_module.resolve_writer = lambda: writer
    try:
        _, call_skill, *_ = build_tools(model)
        return call_skill.invoke(_tool_call({"skill_stable_name": "deck-maker", "task": "做一个 deck"}),
                                 config=SKILL_CONFIG)
    finally:
        tools_module.resolve_writer = original


def test_streaming_call_emits_intra_tool_progress() -> None:
    """一次工具调用**中间**必须有事实产生——这是 #3322 的核心判据。"""
    seen: list[dict[str, Any]] = []
    model = StreamingChatModel(["const pptx", " = require('pptxgenjs');", " // ...long script"])
    result = _run(model, seen.append)

    assert result.content == "const pptx = require('pptxgenjs'); // ...long script"
    assert len(seen) >= 1, "跑了很久的工具调用中间一条进展都没有 —— 正是 #3322 的缺陷形状"
    assert all(e["type"] == "tool_progress" and e["version"] == 1 for e in seen)
    assert all(e["toolCallId"] == "tc-3322" and e["toolName"] == "call_skill" for e in seen)
    # 进展必须是**人能读懂的一句话**，不是一个空壳事件。
    assert any("PPT 生成" in e["message"] for e in seen)


def test_progress_never_carries_the_model_text_being_generated() -> None:
    """隐私纪律：正在生成的正文留在工具结果里，不从进展通道泄出去。"""
    seen: list[dict[str, Any]] = []
    secret = "SUPER_SECRET_SCRIPT_BODY"
    _run(StreamingChatModel([secret, secret]), seen.append)

    assert seen, "没有进展事件时这条断言无法证伪，先修上一支"
    assert all(secret not in e["message"] for e in seen)


def test_model_without_stream_falls_back_and_emits_nothing() -> None:
    """没有 `.stream` 的模型就是真的没有中间信号——这里**不编**一个假进度。"""
    seen: list[dict[str, Any]] = []
    result = _run(BlockingChatModel("prose"), seen.append)

    assert result.content == "prose"
    assert seen == []


def test_throttle_caps_events_per_call() -> None:
    """成本闸：一次工具调用最多 30 条，否则 `appendExecutionEvent` 的行锁事务与
    `readExecutionEvents` 的 LIMIT 1000 分页会被同时挤爆。"""
    seen: list[dict[str, Any]] = []
    clock = iter(range(0, 100000, 60))  # 每次取时间都跨过节流窗口
    throttle = ToolProgressThrottle(seen.append, "call_skill", "tc", now=lambda: next(clock))
    for i in range(200):
        throttle.emit(f"第 {i} 步")

    assert len(seen) == 30


def test_throttle_drops_events_inside_the_interval() -> None:
    seen: list[dict[str, Any]] = []
    now = 0.0
    throttle = ToolProgressThrottle(seen.append, "call_skill", "tc", now=lambda: now)
    assert throttle.emit("第一条立刻放行", force=True) is True
    assert throttle.emit("同一秒的第二条") is False
    now = 10.0
    assert throttle.emit("过了节流窗口") is True
    assert len(seen) == 2


def test_writer_failure_never_breaks_the_tool_call() -> None:
    """进展是有损通道：写不出去不该把一次本来会成功的工具调用变成失败。"""
    def exploding(_envelope):
        raise RuntimeError("stream closed")

    result = _run(StreamingChatModel(["ok"]), exploding)
    assert result.content == "ok"


def test_invalid_envelope_is_rejected_not_silently_shipped() -> None:
    seen: list[dict[str, Any]] = []
    throttle = ToolProgressThrottle(seen.append, "call_skill", "tc")
    assert throttle.emit("") is False
    assert seen == []
