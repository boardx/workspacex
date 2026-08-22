"""Deep Agent harness 配置（DA-02，issue #1749 / rubric D1·D4·D8·D10）。

## 为什么存在这个模块

2026-08-22 基线实测（rubric 评分史首行）：本服务锁定 deepagents 0.7.6，但 graph.py
用的是 0.0.5 时代的裸调用——`create_deep_agent(model, tools, system_prompt)`，
零 middleware。0.7 起 `TodoListMiddleware` 不再默认附带（官方 changelog），
所以这个「deep agent」连规划工具都没有：D1 = 0。

本模块把 harness 配置集中到一处，graph.py 只做组装。判据与验收口径见
`.harness/rubrics/deepagent-capability-rubric.md`（人类 2026-08-22 已签署生效）。

## 每个 middleware 对应的 rubric 维度（不是装饰，漏一个掉一维的分）

- `TodoListMiddleware`（langchain.agents.middleware）→ D1 规划可见性：
  多步任务先产生结构化 todos，AG-UI 状态流靠它才有东西可同步。
- `SummarizationMiddleware` → D8 滚动语义摘要。实测（2026-08-22）：
  create_deep_agent 默认**不带**任何 summarization——默认 middleware 只有
  Filesystem/PatchToolCalls/Skills/SubAgent（源码扫描 + 默认图工具清单双证）。
  用 langchain 基础版（只需 model），不用 deepagents 变体（后者还要 backend
  实例，要与 create_deep_agent 内部的 StateBackend 对齐，收益不抵耦合；
  等 DA-12 VFS 落地、卸载有真实落点时再换）。
- checkpointer → D4 持久化。⚠ 分环境：`langgraph dev` / LangGraph Platform 托管
  持久层，图上**不能**自带 checkpointer（实测会 GraphLoadError，见
  guided_research_graph.py:226 的原始记录）。自托管（Docker/裸进程）时通过
  `DEEP_AGENT_CHECKPOINT_DB`（Postgres DSN）显式启用 PostgresSaver——依赖
  `langgraph-checkpoint-postgres` 从 #739 起就在 uv.lock 里，只是从未接线。

## 版本纪律（D10）

`pyproject.toml` 的依赖地板必须与 `uv.lock` 锁定版本的 major.minor 一致，
由 `tests/test_harness.py::test_version_floor_matches_lock` 机械看守——
基线时地板写着 `>=0.0.5`、锁着 0.7.6，差 15 个 minor：任何人在别的环境按
地板安装，装到的是一个 API 完全不同的库。
"""
from __future__ import annotations

import os

from langchain.agents.middleware import (
    AgentMiddleware,
    SummarizationMiddleware,
    TodoListMiddleware,
)
from langchain_core.language_models.chat_models import BaseChatModel


def build_middleware(model: BaseChatModel) -> list[AgentMiddleware]:
    """rubric 驱动的 middleware 清单。顺序即挂载顺序。

    trigger/keep 显式固定而不是吃库默认——升级 deepagents/langchain 时默认值
    漂移不该悄悄改变我们的上下文策略（「同一事实不两处声明」的运行时版本）。
    """
    return [
        TodoListMiddleware(),
        SummarizationMiddleware(model=model, trigger=("tokens", 60000), keep=("messages", 20)),
    ]


def build_checkpointer():
    """自托管时显式 Postgres 持久化；平台托管时返回 None（图上不带，平台自己管）。

    返回 (checkpointer | None, 需要调用方关闭的上下文 | None)。
    这里刻意不吞异常：DSN 设了但连不上必须在建图时炸，而不是首轮对话时静默丢状态
    ——与 model.py 的 fail-closed 纪律同一条。
    """
    dsn = (os.environ.get("DEEP_AGENT_CHECKPOINT_DB") or "").strip()
    if dsn == "":
        return None
    from langgraph.checkpoint.postgres import PostgresSaver

    saver_ctx = PostgresSaver.from_conn_string(dsn)
    saver = saver_ctx.__enter__()  # 进程生命周期即连接生命周期，随进程退出释放
    saver.setup()
    return saver
