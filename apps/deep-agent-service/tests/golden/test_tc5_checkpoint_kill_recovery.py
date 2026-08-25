"""TC-5 断点恢复：执行中途 kill 进程 → 重启续跑 → 回溯一次历史节点（检验 D4 D7）。

场景定义（rubric 原文）：「任务执行中途 kill 服务进程，重启后从 checkpoint 续跑
并回溯一次历史节点」。

## 自动化分级（这条是五条里唯一**需要外部依赖**的）

| 检验点 | 本文件 | 说明 |
|---|---|---|
| 真的 kill 进程（`SIGKILL`，非优雅退出） | ✅ 全自动 | 子进程卡在第二步，父进程 `SIGKILL` 它 |
| 重启后从 checkpoint 续跑（第一步不重跑） | ✅ 全自动 | 副作用账本文件，不是消息文本 |
| 回溯到历史节点（time travel） | ✅ 全自动 | `get_state_history` + 按 `checkpoint_id` 读回 |
| 需要真 Postgres | ⚠ 半自动 | 无 `DEEP_AGENT_TEST_POSTGRES_URL` 即判失败（见下） |

⚠ **前置条件**：`DEEP_AGENT_TEST_POSTGRES_URL`。没有它本文件 `pytest.fail` 而不是
`skip`——沿用 `tests/test_deep_agent_postgres_recovery.py` 立下的反空转纪律：静默跳过
的测试等于没有，而 D4 恰恰是最容易「看起来有」的一维。
一键起库跑：`bash scripts/verify-golden-scenarios.sh`。

## 与 `tests/test_deep_agent_postgres_recovery.py` 的分工

那个文件是「**进程 A 正常退出**后进程 B 接手」（它自己的文件头把自己称作「TC-5 的
进程内前置版」）。本文件补上它明说没做的那一半：**进程根本没有机会退出**——
`SIGKILL` 之下没有 finally、没有 flush、没有优雅收尾。跨进程状态在这种情况下还在不在，
是 D4 与「优雅退出后状态还在」完全不同的一个问题。
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[2]
WORKER = Path(__file__).with_name("_tc5_worker.py")
READY_TIMEOUT_SECONDS = 90


def _postgres_url() -> str:
    url = (os.environ.get("DEEP_AGENT_TEST_POSTGRES_URL") or "").strip()
    if not url:
        pytest.fail(
            "TC-5 需要真 Postgres：设 DEEP_AGENT_TEST_POSTGRES_URL，"
            "或直接跑 bash apps/deep-agent-service/scripts/verify-golden-scenarios.sh"
        )
    return url


def _spawn_worker(dsn: str, thread_id: str, ledger: Path, ready: Path) -> subprocess.Popen:
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(SERVICE_ROOT / "src"), str(WORKER.parent)]),
        "PYTHONUNBUFFERED": "1",
    }
    return subprocess.Popen(
        [sys.executable, str(WORKER), dsn, thread_id, str(ledger), str(ready)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _wait_for_ready(proc: subprocess.Popen, ready: Path) -> None:
    deadline = time.time() + READY_TIMEOUT_SECONDS
    while time.time() < deadline:
        if ready.exists():
            return
        if proc.poll() is not None:
            out, err = proc.communicate()
            pytest.fail(
                "worker 进程在跑到第二步之前就退出了，说明这次失败与 kill/恢复无关：\n"
                f"stdout={out.decode(errors='replace')[-2000:]}\n"
                f"stderr={err.decode(errors='replace')[-2000:]}"
            )
        time.sleep(0.2)
    proc.kill()
    pytest.fail(f"worker 在 {READY_TIMEOUT_SECONDS}s 内没跑到第二步")


def test_tc5_sigkill_midrun_then_resume_and_time_travel(tmp_path, evidence):  # noqa: ANN001, ANN201
    from langgraph.checkpoint.postgres import PostgresSaver

    dsn = _postgres_url()
    thread_id = f"tc5-kill-{uuid.uuid4().hex[:8]}"
    ledger = tmp_path / "ledger.txt"
    ledger.write_text("", encoding="utf-8")
    ready = tmp_path / "ready.flag"

    # ── ① 起一个真进程，让它跑到第二步中途卡住，然后 SIGKILL ──
    proc = _spawn_worker(dsn, thread_id, ledger, ready)
    try:
        _wait_for_ready(proc, ready)
        os.kill(proc.pid, signal.SIGKILL)
        proc.wait(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode in (-signal.SIGKILL, -9), (
        f"必须是被 SIGKILL 打死，不是自己退出的（returncode={proc.returncode}）"
    )
    ledger_after_kill = ledger.read_text(encoding="utf-8").split()
    assert ledger_after_kill == ["step_one", "step_two"], (
        f"被 kill 前两步都应已开始执行，实际账本 {ledger_after_kill}"
    )

    # ── ② 全新进程内重建图（模拟服务重启），从 checkpoint 续跑 ──
    from deepagents import create_deep_agent

    from _tc5_worker import _Scripted  # noqa: PLC0415  # 与被 kill 的进程用同一份剧本

    with PostgresSaver.from_conn_string(dsn) as saver:
        config = {"configurable": {"thread_id": thread_id}}
        state = saver.get(config)
        assert state is not None, "SIGKILL 之后 checkpoint 必须还在 Postgres 里——这就是 D4 要的东西"

        from langchain_core.tools import tool

        @tool
        def step_one() -> str:
            """第一步。"""
            with ledger.open("a", encoding="utf-8") as fh:
                fh.write("step_one\n")
            return "step one done"

        @tool
        def step_two() -> str:
            """第二步（重启后不再卡住）。"""
            with ledger.open("a", encoding="utf-8") as fh:
                fh.write("step_two\n")
            return "step two done"

        graph = create_deep_agent(
            model=_Scripted(), tools=[step_one, step_two], checkpointer=saver
        )
        # `invoke(None, config)` = 从该 thread 的最后一个 checkpoint 续跑（不是重开一轮）。
        resumed = graph.invoke(None, config)

        texts = [str(getattr(m, "content", "")) for m in resumed["messages"]]
        assert any("两步都完成了" in t for t in texts), f"续跑必须走到终稿，实际：{texts[-3:]}"

        # 硬证据：**第一步没有重跑**。重启若是「从头再来」，账本里会多一条 step_one。
        ledger_final = ledger.read_text(encoding="utf-8").split()
        assert ledger_final.count("step_one") == 1, (
            f"续跑必须从 checkpoint 接着走，第一步不得重跑，实际账本 {ledger_final}"
        )

        # ── ③ 回溯一次历史节点（time travel）──
        history = list(graph.get_state_history(config))
        assert len(history) >= 3, f"checkpoint 历史必须可枚举，实际 {len(history)} 个"
        # 挑一个「第一步已完成、第二步还没开始」的历史节点读回去。
        earlier = history[len(history) // 2]
        replayed = graph.get_state(
            {
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_id": earlier.config["configurable"]["checkpoint_id"],
                }
            }
        )
        assert replayed.values.get("messages"), "按 checkpoint_id 必须能读回历史状态"
        assert len(replayed.values["messages"]) < len(resumed["messages"]), (
            "回溯到的历史节点消息数必须少于终态，否则读回的不是历史"
        )

        evidence.write(
            "tc5-checkpoint-kill-recovery",
            {
                "scenario": "执行中途 SIGKILL → 重启从 checkpoint 续跑 → 回溯历史节点",
                "dimensions": ["D4", "D7"],
                "requires": "真 Postgres（DEEP_AGENT_TEST_POSTGRES_URL）",
                "thread_id": thread_id,
                "worker_returncode": proc.returncode,
                "ledger_after_kill": ledger_after_kill,
                "ledger_after_resume": ledger_final,
                "step_one_executions": ledger_final.count("step_one"),
                "checkpoints_in_history": len(history),
                "replayed_checkpoint_id": earlier.config["configurable"]["checkpoint_id"],
                "messages_at_replayed_checkpoint": len(replayed.values["messages"]),
                "messages_at_final": len(resumed["messages"]),
                "final_answer": texts[-1],
            },
        )
