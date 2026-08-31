"""TC 场景的共用构件（DA-09，issue #2051）。

放在 conftest 之外的独立模块，是为了让每个 TC 文件都能 `from _scripted import ...`
显式导入（pytest 会把 `tests/golden/` 前置进 sys.path）——夹具只放真正需要
依赖注入的那几个，构件本身按普通模块导入，读起来知道东西从哪来。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

SERVICE_ROOT = Path(__file__).resolve().parents[2]


class ScriptedChatModel(BaseChatModel):
    """假模型：`router(messages, bound_tool_names) -> AIMessage`。

    `bind_tools` 返回带 `bound_tool_names` 的副本（而不是 `self`）——路由函数靠这份
    工具名清单区分「这次是谁在问」：主 agent 绑着 `task`/`write_todos`，子代理绑着
    组织技能工具，`RubricMiddleware` 的 grader 绑着 `GraderResponse` 结构化输出。

    为什么不用现成的 `GenericFakeChatModel`：那个吃一条线性消息生成器，而 TC-1 里
    主 agent 和子代理**共享同一个模型实例**（`build_subagents` 显式把主模型传给
    子代理），线性剧本会被两条互相穿插的对话共同消费，跑出来的东西没法解释。
    按内容路由则主链、子代理链、摘要器链、grader 链各自命中自己的分支，剧本与
    断言一一对应。
    """

    router: Callable[[list[BaseMessage], list[str]], AIMessage]
    bound_tool_names: list[str] = []
    calls: list[dict[str, Any]] = []

    @property
    def _llm_type(self) -> str:
        return "scripted-golden"

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003, ANN201
        names = [
            getattr(t, "name", None) or getattr(t, "__name__", None) or str(t) for t in tools
        ]
        return self.model_copy(update={"bound_tool_names": names})

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:  # noqa: ANN001, ANN003
        message = self.router(list(messages), list(self.bound_tool_names))
        self.calls.append(
            {"bound_tools": list(self.bound_tool_names), "n_messages": len(messages)}
        )
        return ChatResult(generations=[ChatGeneration(message=message)])


def ai_tool_call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    """一条发起工具调用的 AIMessage（`content` 留空，形状与真模型一致）。"""
    return AIMessage(content="", tool_calls=[{"id": call_id, "name": name, "args": args}])


def tool_call_names(messages: list[BaseMessage]) -> list[str]:
    """按顺序抽出 transcript 里所有被发起过的工具调用名。"""
    names: list[str] = []
    for m in messages:
        for call in getattr(m, "tool_calls", None) or []:
            names.append(call["name"])
    return names


class EvidenceWriter:
    """把一个 TC 的实测产物落盘。故意只写事实（消息序列/计数/断言到的字段），
    不写「通过/失败」结论——结论由评分者读证据后自己下，不由被评者预先宣布。"""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def write(self, tc: str, payload: dict[str, Any]) -> Path:
        path = self.root / f"{tc}.json"
        body = {
            "tc": tc,
            "collected_at_utc": datetime.now(timezone.utc).isoformat(),
            "harness": "in-process pytest, ScriptedChatModel（假模型，非真模型质量证据）",
            **payload,
        }
        path.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def write_text(self, name: str, text: str) -> Path:
        path = self.root / name
        path.write_text(text, encoding="utf-8")
        return path


