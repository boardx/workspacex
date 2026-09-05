"""TC-1 长链综合调研（rubric 黄金压测场景，检验 D1 D2 D3 D5）。

场景定义（rubric 原文）：「一个需要 ≥5 步、≥2 次子代理委托的调研任务」。

## 自动化分级（如实分类，不把跑不了的伪装成能跑）

| 检验点 | 本文件 | 说明 |
|---|---|---|
| D1 结构化 todo 由工具调用产生并被更新 | ✅ 全自动 | `write_todos` 真实进入 transcript，state 里读得到 todos |
| D2 每次工具调用作为**独立事件**流出 | ✅ 全自动 | `stream_mode="updates"` 逐节点事件，逐条落证据 |
| D5 ≥2 次真实子代理委托 | ✅ 全自动 | `task` 工具真跑，子代理在隔离上下文里自己调工具 |
| D1/D2 的**前端可见性** | ❌ 不在本文件 | 需要生产前端 + 活体 SSE，见 `scripts/live-evidence.sh` |
| D3 token 级真流式 | ❌ 不在本文件 | 假模型没有 token delta；必须用真模型抓活体 SSE |

⇒ 本文件给的是**引擎侧**证据。D3 与「前端逐个渲染」两项，评分时必须另取活体证据，
不得拿本文件的绿灯顶替。上一轮评分（7.5）D2 判 0.7 正是卡在前端那一半。
"""
from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage

from _scripted import ScriptedChatModel, ai_tool_call, grader_always_satisfied_response, tool_call_names

SUBAGENT_TYPE = "org-skill-researcher"


def _router(messages, bound_tools):  # noqa: ANN001, ANN201
    """按「谁在问 + 已经走到哪一步」路由，不吃线性剧本（理由见 conftest 模块注释）。"""
    if bound_tools == ["GraderResponse"]:
        return grader_always_satisfied_response()
    # 子代理：绑着组织技能工具但没有 task（子代理不再往下派活）。
    if "list_org_skills" in bound_tools and "task" not in bound_tools:
        already = tool_call_names(messages)
        if "list_org_skills" not in already:
            return ai_tool_call("list_org_skills", {}, "sub-list-1")
        if "call_skill" not in already:
            return ai_tool_call(
                "call_skill",
                {"skill_stable_name": "market-scan", "task": "扫描竞品定价"},
                "sub-call-1",
            )
        return AIMessage(content="子代理调研结论：技能库有 market-scan 与 risk-review 两项。")

    # 主 agent 的五步剧本。
    already = tool_call_names(messages)
    n_delegations = already.count("task")
    if "write_todos" not in already:
        return ai_tool_call(
            "write_todos",
            {
                "todos": [
                    {"content": "盘点组织技能库", "status": "in_progress"},
                    {"content": "委托子代理做风险面调研", "status": "pending"},
                    {"content": "汇总成结论", "status": "pending"},
                ]
            },
            "main-todo-1",
        )
    if n_delegations == 0:
        return ai_tool_call(
            "task",
            {"description": "盘点本组织技能库有哪些技能可用", "subagent_type": SUBAGENT_TYPE},
            "main-task-1",
        )
    if n_delegations == 1:
        return ai_tool_call(
            "task",
            {"description": "从风险面复核这些技能的适用边界", "subagent_type": SUBAGENT_TYPE},
            "main-task-2",
        )
    if already.count("write_todos") == 1:
        return ai_tool_call(
            "write_todos",
            {
                "todos": [
                    {"content": "盘点组织技能库", "status": "completed"},
                    {"content": "委托子代理做风险面调研", "status": "completed"},
                    {"content": "汇总成结论", "status": "in_progress"},
                ]
            },
            "main-todo-2",
        )
    return AIMessage(content="综合调研结论：技能库覆盖市场扫描与风险复核，建议先扫描后复核。")


@pytest.fixture
def tc1_graph():  # noqa: ANN201
    from deepagents import create_deep_agent

    from deep_agent_service.harness import build_middleware, build_subagents
    from deep_agent_service.tools import build_tools

    # D5：`build_subagents()` 无条件返回具名子代理清单（Phase 14 F02 起不再是灰度
    # 开关），`task` 因此有真实可委托对象，不只是内建 general-purpose。
    model = ScriptedChatModel(router=_router)
    graph = create_deep_agent(
        model=model,
        tools=build_tools(model),
        middleware=build_middleware(model),
        subagents=build_subagents(model),
    )
    # 同时把模型交出来：D5 的「隔离上下文」意味着子代理的工具调用**不进**主链
    # transcript，只能从「模型被谁的工具集绑过」这一侧取证（见测试里的注释）。
    return graph, model


def test_tc1_long_chain_research(tc1_graph, org_skills_config, evidence):  # noqa: ANN001, ANN201
    graph, model = tc1_graph
    updates: list[dict] = []
    for chunk in graph.stream(
        {"messages": [{"role": "user", "content": "帮我做一次组织技能库的综合调研"}]},
        {**org_skills_config, "recursion_limit": 60},
        stream_mode="updates",
    ):
        updates.append(chunk)

    final = graph.invoke(
        {"messages": [{"role": "user", "content": "帮我做一次组织技能库的综合调研"}]},
        {**org_skills_config, "recursion_limit": 60},
    )
    names = tool_call_names(final["messages"])

    # D1：结构化 todo 由**工具调用**产生（不是正文里的计划文本装饰），且被更新过。
    assert names.count("write_todos") >= 2, f"todos 必须产生且被更新，实际：{names}"
    assert final.get("todos"), "todos 必须进 state（AG-UI 状态流靠它才有东西可同步）"

    # D5：≥2 次真实子代理委托。
    assert names.count("task") >= 2, f"rubric 要求 ≥2 次子代理委托，实际：{names}"

    # D5 的「隔离上下文」是可证的：子代理的工具调用**不出现在主链 transcript 里**
    # （上面 names 里没有 list_org_skills / call_skill），主链只拿到归并回来的结论。
    # 所以「子代理真的干了活」要从另外两处取证，不是从主链消息里找：
    # ① 模型被子代理的工具集绑过（绑着 list_org_skills 但没有 task = 只可能是子代理）；
    sub_turns = [
        c
        for c in model.calls
        if "list_org_skills" in c["bound_tools"] and "task" not in c["bound_tools"]
    ]
    assert len(sub_turns) >= 4, f"两次委托各自都要在隔离上下文里真跑，实际子代理轮次 {len(sub_turns)}"
    # ② 委托结果真的归并回主链（task 的 ToolMessage 带着子代理的结论）。
    task_results = [
        str(getattr(m, "content", ""))
        for m in final["messages"]
        if getattr(m, "name", None) == "task"
    ]
    assert task_results and all("子代理调研结论" in t for t in task_results), (
        f"子代理结论必须归并回主链，实际：{task_results}"
    )

    # rubric 「≥5 步」：主链上的模型轮次。
    ai_turns = [m for m in final["messages"] if isinstance(m, AIMessage)]
    assert len(ai_turns) >= 5, f"rubric 要求 ≥5 步，实际 {len(ai_turns)} 轮 AI 消息"

    # D2：每次工具调用是**独立事件**，不是终态一次性打包。
    tool_events = [u for u in updates if "tools" in u]
    assert len(tool_events) >= 3, f"工具调用必须逐个作为独立事件流出，实际 {len(tool_events)} 条"

    evidence.write(
        "tc1-long-chain-research",
        {
            "scenario": "长链综合调研（≥5 步、≥2 次子代理委托）",
            "dimensions": ["D1", "D2", "D5"],
            "not_covered_here": ["D3 token 级流式（需真模型活体 SSE）", "D1/D2 前端可见性"],
            "tool_calls_in_order": names,
            "ai_turns": len(ai_turns),
            "delegations": names.count("task"),
            "stream_update_node_sequence": [k for u in updates for k in u],
            "final_todos": final.get("todos"),
            "final_answer": str(getattr(final["messages"][-1], "content", "")),
        },
    )
