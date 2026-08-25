"""TC-2 高危操作：敏感技能中断 →「修改参数后放行」（检验 D6 D2）。

场景定义（rubric 原文）：「触发一个配置为 interrupt 的敏感技能，走『修改参数后放行』路径」。

## 与 `tests/test_harness.py` 里已有的 HITL 三态测试有什么不同（不是重复劳动）

已有的那三条用的是测试自造的 `dangerous_tool`——证明的是 `HumanInTheLoopMiddleware`
的**机制**通。本文件换成生产路径上真实存在的 `call_skill` + 真实的
`build_interrupt_on()` 读 `DEEP_AGENT_HITL_TOOLS`，并且把「改参数」改成一件有业务含义
的事：人把要执行的**技能本身**从 `market-scan` 改成 `risk-review`。断言落在
「实际被执行的是哪一个技能」上——机制通 ≠ 生产上那个真正危险的工具被拦住了。

## 自动化分级

| 检验点 | 本文件 | 说明 |
|---|---|---|
| D6 批准前不执行 | ✅ 全自动 | 技能的真实副作用（那次聚焦模型调用）计数钉在 0 |
| D6 改参数后放行，执行的是改过的参数 | ✅ 全自动 | 实际跑的是 risk-review，不是模型提议的 market-scan |
| D2 中断作为独立事件可见 | ✅ 全自动 | `__interrupt__` 里带着工具名与完整参数 |
| 前端 HITL 交互 | ❌ 不在本文件 | CopilotKit 新轨道架构上还够不到真实引擎，已登记 issue #2017 |
"""
from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage

from _scripted import ScriptedChatModel, ai_tool_call, tool_call_names

PROPOSED_SKILL = "market-scan"
HUMAN_EDITED_SKILL = "risk-review"


def _make_router(focused_calls: list[str]):  # noqa: ANN202
    """`call_skill` 的语义是「拿技能内容当 system prompt 发起一次真实模型调用」
    （tools.py 模块注释）。那次聚焦调用在本夹具里也走同一个假模型：它绑不到任何
    工具（`bound_tools == []`），据此把它与 agent 主链区分开，并把 system prompt
    里出现的技能身份记进 `focused_calls`——这就是「技能真的被执行过」的副作用证据，
    比只看消息文本硬。"""

    def router(messages, bound_tools):  # noqa: ANN001, ANN202
        if not bound_tools:
            system = " ".join(str(getattr(m, "content", "")) for m in messages)
            identity = "风险复核" if "风险复核" in system else "市场扫描"
            focused_calls.append(identity)
            return AIMessage(content=f"[{identity}] 技能执行结果")

        already = tool_call_names(messages)
        if "call_skill" not in already:
            return ai_tool_call(
                "call_skill",
                {"skill_stable_name": PROPOSED_SKILL, "task": "对本季度方案做一次评估"},
                "tc2-call-1",
            )
        return AIMessage(content="技能已执行，结论已汇总。")

    return router


@pytest.fixture
def tc2(monkeypatch):  # noqa: ANN001, ANN201
    from langgraph.checkpoint.memory import MemorySaver

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_interrupt_on, build_middleware
    from deep_agent_service.tools import build_tools

    # 生产口径：中断名单由这个环境变量声明，`build_interrupt_on()` 是唯一读它的地方。
    monkeypatch.setenv("DEEP_AGENT_HITL_TOOLS", "call_skill")
    focused_calls: list[str] = []
    model = ScriptedChatModel(router=_make_router(focused_calls))
    graph = create_deep_agent(
        model=model,
        tools=build_tools(model),
        middleware=build_middleware(model),
        interrupt_on=build_interrupt_on(),
        checkpointer=MemorySaver(),
    )
    return graph, focused_calls


def test_tc2_sensitive_skill_interrupt_then_edit_and_approve(tc2, org_skills_config, evidence):  # noqa: ANN001, ANN201
    from langgraph.types import Command

    graph, focused_calls = tc2
    config = {**org_skills_config, "configurable": {**org_skills_config["configurable"], "thread_id": "tc2-hitl"}}

    paused = graph.invoke({"messages": [{"role": "user", "content": "帮我评估本季度方案"}]}, config)

    # D6 ①：run 真的停住了，且停在**执行之前**。
    assert "__interrupt__" in paused, "敏感技能必须在执行前停下等人裁决"
    assert focused_calls == [], f"批准前技能绝不能执行，实际已执行 {focused_calls}"

    # D2：中断事件里带着工具名与完整参数——人要能看见自己在批什么才谈得上「人在环」。
    interrupt_payload = str(paused["__interrupt__"])
    assert "call_skill" in interrupt_payload, "中断必须暴露工具名"
    assert PROPOSED_SKILL in interrupt_payload, "中断必须暴露模型提议的参数"

    # D6 ②：人在线把技能从 market-scan 改成 risk-review 后放行。
    resumed = graph.invoke(
        Command(
            resume={
                "decisions": [
                    {
                        "type": "edit",
                        "edited_action": {
                            "name": "call_skill",
                            "args": {
                                "skill_stable_name": HUMAN_EDITED_SKILL,
                                "task": "对本季度方案做一次合规与执行风险复核",
                            },
                        },
                    }
                ]
            }
        ),
        config,
    )

    # 硬证据：真正被执行的是人改过的那个技能，不是模型原始提议的那个。
    assert focused_calls == ["风险复核"], (
        f"实际执行的必须是人改过的 {HUMAN_EDITED_SKILL}，模型提议的是 {PROPOSED_SKILL}，"
        f"实际记录到 {focused_calls}"
    )
    texts = [str(getattr(m, "content", "")) for m in resumed["messages"]]
    assert any("[风险复核]" in t for t in texts), "技能结果必须体现改过的参数"
    assert not any("[市场扫描]" in t for t in texts), "模型原始提议的技能绝不能被执行"
    assert "__interrupt__" not in resumed, "放行后 run 必须走到终稿"

    evidence.write(
        "tc2-sensitive-skill-hitl",
        {
            "scenario": "敏感技能中断 → 修改参数后放行",
            "dimensions": ["D6", "D2"],
            "not_covered_here": ["前端 HITL 交互（CopilotKit 新轨道，issue #2017）"],
            "hitl_tools_env": "DEEP_AGENT_HITL_TOOLS=call_skill",
            "model_proposed_skill": PROPOSED_SKILL,
            "human_edited_skill": HUMAN_EDITED_SKILL,
            "skill_executions_observed": focused_calls,
            "interrupt_payload_excerpt": interrupt_payload[:800],
            "final_answer": texts[-1],
        },
    )


def test_tc2_counterproof_without_hitl_env_skill_runs_unattended(monkeypatch, org_skills_config):  # noqa: ANN001, ANN201
    """反证（本仓九次「全绿但空转」的纪律）：不设 `DEEP_AGENT_HITL_TOOLS` 时，
    同一个剧本会一路跑到底、技能直接执行——上面那条绿灯因此确实是中断机制带来的，
    不是剧本本身跑不动造成的假象。"""
    from deepagents import create_deep_agent

    from deep_agent_service.harness import build_interrupt_on, build_middleware
    from deep_agent_service.tools import build_tools

    monkeypatch.delenv("DEEP_AGENT_HITL_TOOLS", raising=False)
    focused_calls: list[str] = []
    model = ScriptedChatModel(router=_make_router(focused_calls))
    graph = create_deep_agent(
        model=model,
        tools=build_tools(model),
        middleware=build_middleware(model),
        interrupt_on=build_interrupt_on(),
    )
    result = graph.invoke(
        {"messages": [{"role": "user", "content": "帮我评估本季度方案"}]}, org_skills_config
    )
    assert "__interrupt__" not in result
    assert focused_calls == ["市场扫描"], (
        f"无中断名单时技能应当无人值守地直接执行，实际 {focused_calls}"
    )
