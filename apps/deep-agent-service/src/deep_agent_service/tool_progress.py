"""issue #3322 —— 一次工具调用**执行期间**的中间进展，走 LangGraph `custom` 流。

## 为什么需要这个模块

在这之前，一次工具调用在账本里只有 `tool_start` / `tool_end` 两个时刻。`call_skill`
里那次一口气跑几分钟的聚焦模型调用（`tools.py` 的 `model.invoke`）中间**不产生任何
事实**，于是用户实测「生成 pptx 跑了 03:54、工具 5 次」时，轨迹里只有一串
「已执行工具操作」——看不出在做什么、到第几步。展示层修不了这个，因为这些事实从来
没有被产生过。

线格式是 `packages/contracts/src/execution-journal.ts` 的 `ToolProgressStream`
**唯一一份**声明，投影成 `generated/tool_progress_schema.json`；这里只读那份生成物，
不重写形状（漂移由 `packages/contracts/tests/tool-progress-schema.test.ts` 判红）。

## ⚠ 这是**有损采样**，不是账本的终态的一部分

节流（`_MIN_INTERVAL_S`）+ 每次工具调用硬上限（`_MAX_EVENTS_PER_CALL`）。丢几条不影响
任何终态判定，消费端**不许**用它推断工具成功与否——那是 `tool_end.ok` 唯一负责的事。
上限不是洁癖：apps/api 每写一条事件都要在 `agent_runs` 上取一次行锁
（`pg-agent-run-repository.ts` 的 `appendExecutionEvent`），而 `readExecutionEvents`
一页只取 1000 条。一个不封顶的进展通道会把这两处同时挤爆。

## ⚠ `message` 里**永远不放模型正在生成的正文**

与 `text_delta` / `skill_activity` 同一条隐私纪律。只放调用方自己知道的公开安全事实
（第几步、已产出多少字）。子模型写出来的脚本内容留在工具结果里，不从这里泄出去。
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from jsonschema import Draft7Validator

logger = logging.getLogger(__name__)

_ARTIFACT = json.loads((Path(__file__).parent / 'generated/tool_progress_schema.json').read_text())
_VALIDATOR = Draft7Validator(_ARTIFACT['schema'])

_MIN_INTERVAL_S = 5.0
_MAX_EVENTS_PER_CALL = 30
_MESSAGE_MAX = 200


class ToolProgressError(RuntimeError):
    pass


class ToolProgressThrottle:
    """把一串高频的内部进展压成账本扛得住的少量采样。

    `first_immediately=True`：第一条**立刻**放行。用户等的就是"系统开始动了"的第一个
    信号，让它先等满 5 秒是把这个通道最有价值的一条给节流掉了。
    """

    def __init__(self, writer, tool_name, tool_call_id, *, now=time.monotonic):
        self._writer = writer
        self._tool_name = tool_name
        self._tool_call_id = tool_call_id
        self._now = now
        self._last_at = None
        self._sent = 0

    @property
    def sent(self):
        return self._sent

    def emit(self, message, *, force=False):
        """返回是否真的发出去了。被节流/超上限/写失败都返回 False，**从不抛给调用方**。"""
        if self._writer is None or not isinstance(message, str) or message == '':
            return False
        if self._sent >= _MAX_EVENTS_PER_CALL:
            return False
        now = self._now()
        if not force and self._last_at is not None and now - self._last_at < _MIN_INTERVAL_S:
            return False
        envelope = {'type': 'tool_progress', 'version': 1,
                    'toolCallId': self._tool_call_id, 'toolName': self._tool_name,
                    'message': message[:_MESSAGE_MAX]}
        try:
            _VALIDATOR.validate(envelope)
            self._writer(envelope)
        except Exception as error:
            # ⚠ 刻意**不**上抛：进展是有损的展示信号，一条写不出去不该把一次本来会成功的
            # 工具调用变成失败。但也**不静默**——结构化 log 带错误码，运维能查到。
            logger.warning('tool progress delivery failed',
                           extra={'error_code': 'TOOL_PROGRESS_DELIVERY_FAILED',
                                  'tool_name': self._tool_name, 'detail': str(error)})
            return False
        self._last_at = now
        self._sent += 1
        return True


def resolve_writer():
    """拿 LangGraph 的 `custom` 流 writer；拿不到（不在图里跑、比如单测直调）返回 None。"""
    try:
        from langgraph.config import get_stream_writer
        return get_stream_writer()
    except Exception:
        return None
