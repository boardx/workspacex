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
    bound_tool_choice: Any = None
    calls: list[dict[str, Any]] = []
    # issue #2417 重做：devapp 走的是 DashScope（阿里云百炼）OpenAI 兼容模式的
    # qwen-plus——事故排查阶段一度怀疑 provider 拒绝具名 tool_choice 是根因（后被
    # 真实容器日志排除，见 harness.py 头注），但"provider 拒绝这次强制调用"仍是
    # `PlanFirstToolChoiceMiddleware` 该兜底的一类真实场景。设为 True 时，`_generate`
    # 在收到具名 tool_choice（"auto"/"any"/"none" 之外）时不接管输出、而是抛异常，
    # 如实模拟"provider 拒绝这次强制调用"这个契约，供 TC-6 的降级重试反证使用。
    reject_forced_tool_choice: bool = False

    @property
    def _llm_type(self) -> str:
        return "scripted-golden"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):  # noqa: ANN001, ANN003, ANN201
        """`tool_choice` 捕获进 `bound_tool_choice`（issue #2220 方案 B 的看守夹具）：
        `factory.py` 把 `ModelRequest.tool_choice` 原样传到这里
        （`model.bind_tools(final_tools, tool_choice=request.tool_choice, ...)`），
        断言这个字段就是在断言"中间件真的把请求钉成了这个 tool_choice"，不依赖假
        模型自己要不要服从它——服从与否是 provider 的契约，不是本仓引擎代码的职责。
        """
        names = [
            getattr(t, "name", None) or getattr(t, "__name__", None) or str(t) for t in tools
        ]
        return self.model_copy(
            update={"bound_tool_names": names, "bound_tool_choice": tool_choice}
        )

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:  # noqa: ANN001, ANN003
        forced = self.bound_tool_choice
        self.calls.append(
            {
                "bound_tools": list(self.bound_tool_names),
                "bound_tool_choice": forced,
                "n_messages": len(messages),
            }
        )
        if (
            self.reject_forced_tool_choice
            and isinstance(forced, str)
            and forced not in ("auto", "any", "none")
        ):
            # issue #2417：如实模拟 provider（DashScope 等）拒绝这次具名 tool_choice
            # 强制调用——不返回任何消息，调用本身就失败，供
            # PlanFirstToolChoiceMiddleware 的降级重试反证使用。
            raise ScriptedProviderRejectsToolChoice(forced)
        message = self.router(list(messages), list(self.bound_tool_names))
        already_forced_call = any(
            call.get("name") == forced for call in (getattr(message, "tool_calls", None) or [])
        )
        if isinstance(forced, str) and forced not in ("auto", "any", "none") and not already_forced_call:
            # 模拟真实 provider 对具名 tool_choice 的契约（OpenAI 等：收到
            # `tool_choice={"type":"function","name": X}` 时**只能**返回对 X 的工具
            # 调用，不能像未强制时那样自由选择输出纯文字或别的工具）——路由函数本身
            # 可以完全不知道 tool_choice 这回事（TC1/TC2/TC3/TC4 的路由函数都不知道，
            # 它们的 `bound_tool_choice` 也确实一直是 None，行为不变），这条分支只在
            # 真的发生强制时才接管输出，是 #2220 方案 B「确定性保证」这句话在假模型
            # 上必须如实模拟的那部分契约，断言才有意义（不然只是断言中间件设了个
            # 没人理会的字段）。
            message = ai_tool_call(forced, _FORCED_TOOL_CHOICE_DEFAULT_ARGS.get(forced, {}), f"forced-{forced}")
        return ChatResult(generations=[ChatGeneration(message=message)])

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:  # noqa: ANN001, ANN003
        """issue #2417 教训：TC-6 必须同时覆盖异步路径（`langgraph dev` 实际使用
        `ainvoke()`/`astream()`），不能只靠同步 `_generate()` 走 `graph.invoke()`
        断言就说"验证过了"——本仓真出过"同步桩测试全绿、异步生产 100% 挂"的事故。
        `BaseChatModel` 默认的 `_agenerate` 会用线程池把同步 `_generate` 包一层，
        这里显式覆写成直接调用同步实现，避免这份假模型自己的异步路径依赖库的默认
        转发行为——保证断言的是被测中间件（`PlanFirstToolChoiceMiddleware`）的
        `awrap_model_call`，不是这份测试桩本身的异步转发是否正确。"""
        return self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)


def ai_tool_call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    """一条发起工具调用的 AIMessage（`content` 留空，形状与真模型一致）。"""
    return AIMessage(content="", tool_calls=[{"id": call_id, "name": name, "args": args}])


class ScriptedProviderRejectsToolChoice(RuntimeError):
    """`ScriptedChatModel(reject_forced_tool_choice=True)` 抛出的假异常（issue #2417）。

    不是真实的 provider 异常类型——`PlanFirstToolChoiceMiddleware` 的降级重试路径
    按设计不关心具体异常类型（`except Exception`，见 harness.py 类头注：provider
    拒绝具名 tool_choice 的失败模式在不同 provider/SDK 下形状不同，中间件不该跟
    任何一家的异常类型耦合），这个假类型只用来验证"任意异常都会触发一次不强制的
    降级重试"这件事本身。
    """


# 具名 tool_choice 被强制命中时，各工具的最小默认参数——只覆盖本仓已经在用
# 强制语义的工具（目前只有 write_todos，issue #2220 方案 B）。未登记的工具名
# 强制命中时退化成空参数，不会报错，但请求方多半需要在这里补一条。
_FORCED_TOOL_CHOICE_DEFAULT_ARGS: dict[str, dict[str, Any]] = {
    "write_todos": {"todos": [{"content": "生成结构化计划", "status": "pending"}]},
}


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


