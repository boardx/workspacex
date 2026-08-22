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
