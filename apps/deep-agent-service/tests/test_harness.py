"""DA-02 的反证套件（rubric D1/D4/D8/D10）。

纪律：写完门控立刻造反证（本仓九次「全绿但空转」）。每条断言先确认
「缺了对应配置时它会红」，才有资格相信它绿的时候说明了什么——
test_todo_tool_absent_without_middleware 就是那条反向对照。
"""
from __future__ import annotations

import re
import tomllib
from pathlib import Path

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from deep_agent_service.harness import build_checkpointer, build_middleware

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def _tool_names(graph) -> set[str]:
    node = graph.nodes["tools"]
    bound = getattr(node, "bound", node)
    return set(getattr(bound, "tools_by_name", {}).keys())


def _fake_model():
    return FakeListChatModel(responses=["ok"])


def test_write_todos_present_with_harness_middleware():
    """D1：挂上 harness middleware 后，规划工具必须真实存在于编译图中。"""
    from deepagents import create_deep_agent

    graph = create_deep_agent(model=_fake_model(), middleware=build_middleware(_fake_model()))
    assert "write_todos" in _tool_names(graph)


def test_todo_tool_absent_without_middleware():
    """反向对照：0.7 起裸调用没有 write_todos——这正是基线 D1=0 的机械复现。

    如果未来某个版本把 TodoList 改回默认自带，这条会红，提醒我们移除冗余挂载
    并回评 rubric，而不是让「我们的配置」与「库的默认」悄悄叠加成两份。
    """
    from deepagents import create_deep_agent

    graph = create_deep_agent(model=_fake_model())
    assert "write_todos" not in _tool_names(graph)


def test_summarization_settings_pinned():
    """D8：trigger/keep 显式固定，不吃库默认（升级时默认值漂移不得改变上下文策略）。"""
    mw = build_middleware(_fake_model())
    summarizer = next(m for m in mw if type(m).__name__ == "SummarizationMiddleware")
    assert summarizer.trigger == ("tokens", 60000)
    assert summarizer.keep == ("messages", 20)


def test_checkpointer_none_without_dsn(monkeypatch):
    """D4 分环境：平台托管（无 DSN）时图上不带 checkpointer——带了会 GraphLoadError，
    见 guided_research_graph.py:226 的原始实测记录。"""
    monkeypatch.delenv("DEEP_AGENT_CHECKPOINT_DB", raising=False)
    assert build_checkpointer() is None


def test_checkpointer_fails_closed_on_bad_dsn(monkeypatch):
    """D4 fail-closed：DSN 设了但连不上必须在建图时炸，不许静默降级成无持久化。"""
    monkeypatch.setenv("DEEP_AGENT_CHECKPOINT_DB", "postgresql://nobody@127.0.0.1:1/void")
    import pytest

    with pytest.raises(Exception):
        build_checkpointer()


def test_version_floor_matches_lock():
    """D10：pyproject 地板与 uv.lock 锁定版本的 major.minor 必须一致。

    基线时地板 >=0.0.5、锁 0.7.6，差 15 个 minor——按地板装到的是另一个库。
    这条测试就是 backlog 承诺的「CI 门」：deep-agent-service 的测试在门控链上，
    地板漂移当场红，不需要新的 CI 配置。
    """
    pyproject = tomllib.loads((SERVICE_ROOT / "pyproject.toml").read_text())
    floor_spec = next(d for d in pyproject["project"]["dependencies"] if d.startswith("deepagents"))
    m = re.search(r">=(\d+)\.(\d+)", floor_spec)
    assert m, f"deepagents 依赖必须写明 >=major.minor 地板：{floor_spec}"
    floor = (int(m.group(1)), int(m.group(2)))

    lock_text = (SERVICE_ROOT / "uv.lock").read_text()
    lm = re.search(r'\[\[package\]\]\nname = "deepagents"\nversion = "(\d+)\.(\d+)\.', lock_text)
    assert lm, "uv.lock 里找不到 deepagents 锁定版本"
    locked = (int(lm.group(1)), int(lm.group(2)))

    assert floor == locked, (
        f"pyproject 地板 {floor} != uv.lock 锁定 {locked}——按地板安装会装到不同 minor 的库；"
        "升级 lock 时必须同步提地板（反之亦然）。"
    )


# ── DA-07（rubric D6）：人在环中断 + 恢复的活体反证（进程内真图，MemorySaver）──


def _hitl_graph(monkeypatch):
    """带 interrupt_on 的真编译图。模型是脚本化假模型：第一轮发起 dangerous_tool
    调用，第二轮直接作答——这样中断/恢复的全链路不需要任何网络或凭据。"""
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool
    from langgraph.checkpoint.memory import MemorySaver

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_interrupt_on

    monkeypatch.setenv("DEEP_AGENT_HITL_TOOLS", "dangerous_tool")

    @tool
    def dangerous_tool(payload: str) -> str:
        """A tool that must not run without approval."""
        return f"EXECUTED:{payload}"

    class ScriptedToolCallingModel(GenericFakeChatModel):
        """GenericFakeChatModel 的基类 bind_tools 抛 NotImplementedError（实测）——
        deepagents 建图时要 bind 全套 harness 工具。脚本已定死要发什么调用，
        bind 在这里就是个 no-op：返回自身即可。"""

        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = ScriptedToolCallingModel(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "dangerous_tool", "args": {"payload": "x"}}]),
        AIMessage(content="done after approval"),
    ]))
    return create_deep_agent(
        model=model,
        tools=[dangerous_tool],
        interrupt_on=build_interrupt_on(),
        checkpointer=MemorySaver(),
    )


def test_hitl_interrupts_before_sensitive_tool(monkeypatch):
    """D6 正向：列入 DEEP_AGENT_HITL_TOOLS 的工具调用前，run 必须停在 interrupt——
    工具没有执行（消息里没有 EXECUTED），状态里挂着待裁决的中断。"""
    graph = _hitl_graph(monkeypatch)
    config = {"configurable": {"thread_id": "hitl-1"}}
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    assert "__interrupt__" in result, "run 应停在 interrupt 等人裁决"
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert not any("EXECUTED" in t for t in texts), "工具在批准前绝不能执行"


def test_hitl_resume_approve_runs_tool(monkeypatch):
    """D6 恢复：Command(resume=[approve]) 后工具真实执行、run 走到终稿。"""
    from langgraph.types import Command

    graph = _hitl_graph(monkeypatch)
    config = {"configurable": {"thread_id": "hitl-2"}}
    graph.invoke({"messages": [{"role": "user", "content": "go"}]}, config)
    # resume 形状是 {"decisions": [...]}，不是裸列表——0.7.6 的
    # HumanInTheLoopMiddleware.after_model 源码实测（interrupt(...)["decisions"]），
    # 传裸列表会 TypeError。这条注释就是那次红的存档。
    result = graph.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config)
    texts = [str(getattr(m, "content", "")) for m in result.get("messages", [])]
    assert any("EXECUTED:x" in t for t in texts), "批准后工具必须真实执行"
    assert "__interrupt__" not in result


def test_hitl_off_by_default(monkeypatch):
    """双轨反证：未设 DEEP_AGENT_HITL_TOOLS 时 build_interrupt_on 返回 None——
    行为与 DA-07 之前逐字相同，没有任何工具会被拦。"""
    monkeypatch.delenv("DEEP_AGENT_HITL_TOOLS", raising=False)
    from deep_agent_service.harness import build_interrupt_on

    assert build_interrupt_on() is None


def test_hitl_env_parsing(monkeypatch):
    from deep_agent_service.harness import build_interrupt_on

    monkeypatch.setenv("DEEP_AGENT_HITL_TOOLS", "call_skill, execute ,")
    assert build_interrupt_on() == {"call_skill": True, "execute": True}


# ── DA-08（rubric D8②）：大工具结果驱逐到虚拟文件系统的活体反证 ──


def _offload_graph(payload_chars: int):
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_middleware

    @tool
    def probe_tool() -> str:
        """Returns a payload of a controlled size."""
        return "X" * payload_chars

    class ScriptedModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    model = ScriptedModel(messages=iter([
        AIMessage(content="", tool_calls=[{"id": "c1", "name": "probe_tool", "args": {}}]),
        AIMessage(content="done"),
    ]))
    return create_deep_agent(model=model, tools=[probe_tool], middleware=build_middleware(model))


def test_large_tool_result_evicted_to_file():
    """超过阈值（1000 token ≈ 4KB）的工具输出必须被驱逐：正文只留文件引用，
    完整内容一字不丢地落在 state files——两半都断言，缺一半就是丢数据。"""
    out = _offload_graph(payload_chars=8000).invoke({"messages": [{"role": "user", "content": "go"}]})
    tool_msgs = [m for m in out["messages"] if type(m).__name__ == "ToolMessage"]
    assert len(tool_msgs) == 1
    body = str(tool_msgs[0].content)
    # 驱逐后的正文 = 文件引用 + 一段截断预览（实测 ~1600 字符）。断言口径：
    # 本体绝大部分已搬走（正文远小于 8000）且引用在场——不断言"一个 X 都没有"，
    # 预览是设计行为，帮模型不用 read_file 就知道结果大概长什么样。
    assert len(body) < 4000, f"正文应远小于本体（实际 {len(body)}）——驱逐没生效"
    assert "/large_tool_results/" in body, "正文必须留下文件引用路径"
    files = out.get("files") or {}
    stored = next((v for k, v in files.items() if "/large_tool_results/" in k), None)
    assert stored is not None, "完整结果必须落在虚拟文件系统里"
    content = stored if isinstance(stored, str) else str(stored)
    assert content.count("X") == 8000, "落盘内容必须一字不丢"


def test_small_tool_result_stays_inline():
    """反向：不超限的输出保持原样内联——驱逐不是无差别搬家，小结果搬走只会
    多一次 read_file 往返。"""
    out = _offload_graph(payload_chars=200).invoke({"messages": [{"role": "user", "content": "go"}]})
    tool_msgs = [m for m in out["messages"] if type(m).__name__ == "ToolMessage"]
    assert "X" * 200 in str(tool_msgs[0].content)
    assert not (out.get("files") or {}), "小结果不该产生任何落盘文件"


def test_evict_threshold_pinned():
    """阈值显式固定为 1000（≈4KB，rubric v2 口径），不吃库默认 20000——
    升级时默认值漂移不得悄悄改变上下文策略（与 Summarization 同一条纪律）。"""
    from deep_agent_service.harness import TOOL_RESULT_EVICT_TOKENS, build_middleware
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    assert TOOL_RESULT_EVICT_TOKENS == 1000
    mw = build_middleware(FakeListChatModel(responses=["ok"]))
    fs = next(m for m in mw if type(m).__name__ == "FilesystemMiddleware")
    assert getattr(fs, "_tool_token_limit_before_evict", None) == 1000  # 私有名，实测 vars() 确认


# ── DA-07d（rubric D7）：预算熔断 + 死循环纠偏 + 失败重试的活体反证 ──


def _looping_graph(n_tool_rounds: int, tool_fn=None):
    """脚本化模型连发 n 轮工具调用再收尾——模拟会循环的任务。"""
    import itertools
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.tools import tool

    from deepagents import create_deep_agent
    from deep_agent_service.harness import build_middleware

    calls = {"n": 0}

    @tool
    def spin_tool() -> str:
        """A tool the model keeps calling."""
        calls["n"] += 1
        if tool_fn is not None:
            return tool_fn(calls["n"])
        return f"round {calls['n']}"

    class ScriptedModel(GenericFakeChatModel):
        def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003
            return self

    def gen():
        for i in range(n_tool_rounds):
            yield AIMessage(content="", tool_calls=[{"id": f"c{i}", "name": "spin_tool", "args": {}}])
        while True:
            yield AIMessage(content="finally done")

    model = ScriptedModel(messages=gen())
    return create_deep_agent(model=model, tools=[spin_tool], middleware=build_middleware(model)), calls


def test_model_call_budget_ends_run_with_notice():
    """D7③ 熔断：模型调用到 25 次预算时 run 必须**优雅终止且带明确通告**——
    不是裸异常（那是崩溃不是熔断），也不是静默截断（rubric 点名禁止）。"""
    graph, _ = _looping_graph(n_tool_rounds=100)
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]},
                          {"recursion_limit": 300})
    texts = " ".join(str(getattr(m, "content", "")) for m in result["messages"])
    assert "finally done" not in texts, "100 轮循环的剧本不该自然走完——熔断必须先触发"
    assert "limit" in texts.lower(), "终止时必须有 limit 通告消息，静默截断不算熔断"


def test_tool_call_limit_injects_correction():
    """D7② 纠偏：工具调用超 40 次后，后续调用被拦截并注入超限消息（模型被迫收尾），
    真实工具执行次数被钉在阈值——纠偏不是计数器装饰。"""
    graph, calls = _looping_graph(n_tool_rounds=60)
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]},
                          {"recursion_limit": 300})
    from deep_agent_service.harness import RUN_TOOL_CALL_LIMIT
    assert calls["n"] <= RUN_TOOL_CALL_LIMIT, (
        f"真实执行 {calls['n']} 次，超过 {RUN_TOOL_CALL_LIMIT}——拦截没生效"
    )


def test_tool_retry_recovers_transient_failure():
    """D7① 重试：工具前两次抛错、第三次成功——run 必须拿到成功结果走到终稿，
    而不是把瞬时失败当终局。"""
    def flaky(n: int) -> str:
        if n <= 2:
            raise RuntimeError(f"transient failure {n}")
        return "recovered"

    graph, calls = _looping_graph(n_tool_rounds=1, tool_fn=flaky)
    result = graph.invoke({"messages": [{"role": "user", "content": "go"}]},
                          {"recursion_limit": 50})
    texts = " ".join(str(getattr(m, "content", "")) for m in result["messages"])
    assert calls["n"] == 3, f"应重试到第 3 次成功，实际执行 {calls['n']} 次"
    assert "recovered" in texts, "重试成功的结果必须回到对话"


def test_budget_thresholds_pinned():
    """阈值钉死（25/40），不吃库默认——升级漂移不得悄悄改变预算策略。"""
    from deep_agent_service.harness import RUN_MODEL_CALL_LIMIT, RUN_TOOL_CALL_LIMIT, build_middleware
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    assert (RUN_MODEL_CALL_LIMIT, RUN_TOOL_CALL_LIMIT) == (25, 40)
    mw = build_middleware(FakeListChatModel(responses=["ok"]))
    names = [type(m).__name__ for m in mw]
    for required in ["ToolCallLimitMiddleware", "ModelCallLimitMiddleware", "ToolRetryMiddleware"]:
        assert required in names
