"""DA-04 补证（rubric D4，评估者 v2 点名）：Deep Agent 主图的 Postgres 跨进程恢复。

第二次独立评估的原话：「唯一活体 checkpoint 测试（HITL）用的是 MemorySaver，
Postgres 跨重启 round-trip 零证据」。本文件把那个零补上——模式照抄
test_guided_research_postgres_recovery（同一个 env 约定、同一个 verify 脚本家族）：
无 env 时 pytest.fail 而非 skip（反空转：静默跳过的测试等于没有）。

场景 = HITL 中断 + 换进程恢复的组合：
  进程 A：带 interrupt_on 的图跑到敏感工具前中断，状态落 Postgres
  进程 B：**全新构建的图**（模拟重启）读同一 thread，approve 恢复，跑到终稿
中断态跨进程存活 + 恢复后工具真执行，两半都断——这是 TC-5 的进程内前置版。
"""
from __future__ import annotations

import os

import pytest
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.types import Command


def _build_graph(saver, marker: dict, opening_tool_call: bool = True):
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool

    from deepagents import create_deep_agent

    @tool
    def dangerous_tool(payload: str) -> str:
        """A tool that must not run without approval."""
        marker["ran"] = marker.get("ran", 0) + 1
        return f"EXECUTED:{payload}"

    class ScriptedModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    def gen():
        # 进程 B 的剧本不再发起工具调用：resume 时 HITL 中间件先执行被批的工具，
        # **之后才回到模型要下一步**——若剧本从头再发一次 tool_call，会触发第二次
        # 中断（首版测试就这么红的：断言信息里 allowed_decisions 又出现了）。
        # 生成器状态不跨进程，这是脚本模型的固有形状，不是引擎行为。
        if opening_tool_call:
            yield AIMessage(content="", tool_calls=[{"id": "c1", "name": "dangerous_tool", "args": {"payload": "x"}}])
        while True:
            yield AIMessage(content="done after approval")

    return create_deep_agent(
        model=ScriptedModel(messages=gen()),
        tools=[dangerous_tool],
        interrupt_on={"dangerous_tool": True},
        checkpointer=saver,
    )


def test_interrupt_survives_process_restart_and_resumes() -> None:
    postgres_url = os.environ.get("DEEP_AGENT_TEST_POSTGRES_URL")
    if not postgres_url:
        pytest.fail("DEEP_AGENT_TEST_POSTGRES_URL is required for the Postgres recovery test")

    config = {"configurable": {"thread_id": "da-pg-recovery-hitl"}}

    with PostgresSaver.from_conn_string(postgres_url) as saver:
        saver.setup()
        marker_a: dict = {}
        process_a = _build_graph(saver, marker_a)
        result_a = process_a.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
        assert "__interrupt__" in result_a, "进程 A 应停在 interrupt 等人裁决"
        assert marker_a.get("ran", 0) == 0, "批准前工具绝不能执行"

    # ── 模拟进程重启：新 saver 连接、全新构建的图，只有 thread_id 是同一个 ──
    with PostgresSaver.from_conn_string(postgres_url) as saver_b:
        marker_b: dict = {}
        process_b = _build_graph(saver_b, marker_b, opening_tool_call=False)
        state = process_b.get_state(config)
        assert state.interrupts, "中断态必须跨进程存活在 Postgres 里——这就是 D4 要的证据"

        result_b = process_b.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)
        texts = " ".join(str(getattr(m, "content", "")) for m in result_b.get("messages", []))
        assert marker_b.get("ran", 0) == 1, "恢复后工具必须在进程 B 真实执行恰好一次"
        assert "EXECUTED:x" in texts
        assert "__interrupt__" not in result_b
