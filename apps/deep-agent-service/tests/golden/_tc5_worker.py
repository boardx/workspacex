"""TC-5 的「被 kill 的那个进程」（DA-09，issue #2051）。

作为独立进程跑起来，故意在执行中途卡住不动，等外面 `SIGKILL` 它——这就是 rubric
TC-5 原文要求的「任务执行中途 kill 服务进程」。不是模拟、不是抛异常、不是优雅退出：
父进程发的是 `SIGKILL`，这个进程没有任何机会做收尾，checkpoint 里剩下什么，就是
引擎在**真被拔电**之后真实留下的东西。

用法（由 `test_tc5_checkpoint_kill_recovery.py` 拉起）：
    python _tc5_worker.py <postgres_dsn> <thread_id> <ledger_path> <ready_flag_path>

约定：
- `ledger_path`：两个工具每次真实执行都往里 append 一行——恢复后「第一步没有重跑」
  靠的是这份副作用账本，不是消息文本。
- `ready_flag_path`：第二个工具一开始执行就写它，然后无限 sleep。父进程看到这个文件
  出现，才知道「run 已经跑到中途了」，可以下手 kill——不靠 sleep 猜时机。
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool


class _Scripted(BaseChatModel):
    """与 `_scripted.ScriptedChatModel` 同形，但在这里独立定义：这个进程会被
    `SIGKILL`，越少的导入面越少的「因为环境问题没跑起来」的假失败。"""

    ledger_path: str = ""
    ready_flag_path: str = ""

    @property
    def _llm_type(self) -> str:
        return "tc5-worker"

    def bind_tools(self, tools, **kwargs):  # noqa: ANN001, ANN003, ANN201
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:  # noqa: ANN001, ANN003
        done = [
            call["name"]
            for m in messages
            for call in (getattr(m, "tool_calls", None) or [])
        ]
        if "step_one" not in done:
            msg = AIMessage(content="", tool_calls=[{"id": "s1", "name": "step_one", "args": {}}])
        elif "step_two" not in done:
            msg = AIMessage(content="", tool_calls=[{"id": "s2", "name": "step_two", "args": {}}])
        else:
            msg = AIMessage(content="两步都完成了。")
        return ChatResult(generations=[ChatGeneration(message=msg)])


def main() -> None:
    dsn, thread_id, ledger_path, ready_flag_path = sys.argv[1:5]
    ledger = Path(ledger_path)

    @tool
    def step_one() -> str:
        """第一步。"""
        with ledger.open("a", encoding="utf-8") as fh:
            fh.write("step_one\n")
        return "step one done"

    @tool
    def step_two() -> str:
        """第二步（这一步会卡住，等着被 kill）。"""
        with ledger.open("a", encoding="utf-8") as fh:
            fh.write("step_two\n")
        Path(ready_flag_path).write_text("ready", encoding="utf-8")
        time.sleep(600)  # 等外面动手；正常路径下永远走不到 return
        return "step two done"

    from langgraph.checkpoint.postgres import PostgresSaver

    from deepagents import create_deep_agent

    with PostgresSaver.from_conn_string(dsn) as saver:
        saver.setup()
        graph = create_deep_agent(
            model=_Scripted(), tools=[step_one, step_two], checkpointer=saver
        )
        graph.invoke(
            {"messages": [{"role": "user", "content": "跑完两步"}]},
            {"configurable": {"thread_id": thread_id}},
        )


if __name__ == "__main__":
    main()
