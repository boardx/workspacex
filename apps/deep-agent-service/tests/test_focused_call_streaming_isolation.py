"""`call_skill` 的聚焦子调用不许把 token 串进编排模型自己的对话流
（2026-09-25 真实模型实测："生成一个交互式的网页，来介绍设计思维"）。

## 量到的用户可见后果

聊天里出现了一段英文旁白——"Now let me create the bundle.html (self-contained
copy) and compute hashes:"——混在中文对话里，界面上看起来像编排模型自己在说话。
实际上这段文字来自 `web-artifact` 技能自己的那次聚焦调用（`tools.py` 的
`_focused_call`），它在写代码前用英文起了个头。

## 根因（真实 langchain-core 上验证过，不是猜的）

`Runnable.stream()` 不显式传 `config` 时，会用 `ensure_config()` 去读**环境态**
（`contextvars` 里的 `var_child_runnable_config`）——图执行期间，LangGraph 往这个
环境态里挂的正是"把 token 转发进这次 run 的 SSE 流"的回调。`_focused_call` 调用
`model.stream(messages)` 时没传 `config`，于是这次**技能内部**的子调用，跟编排
模型自己说话共用了同一条转发通道。

下面用真实 `langchain_core` 的 contextvar 机制模拟"图执行期间挂着一个转发回调"
这件事，不用替身对付——这条 bug 恰恰是"替身太老实、真实 Runnable 的环境态传播
才会触发"的那一类，duck-typed 的 `FakeChatModel`/`RaisingChatModel`（本文件同目录
`test_tools.py` 用的那两个）没有 `.stream`，从来不会走到这条代码路径。
"""
from __future__ import annotations

from langchain_core.callbacks.base import BaseCallbackHandler
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables.config import ensure_config, var_child_runnable_config

from deep_agent_service.tools import build_tools


class TokenSpy(BaseCallbackHandler):
    """站在"图执行期间挂着的那份转发回调"这个位置——真实场景里它就是把 token
    写进这次 run 的 SSE 流的那一个。"""

    def __init__(self) -> None:
        self.tokens: list[str] = []

    def on_llm_new_token(self, token: str, **kwargs: object) -> None:
        self.tokens.append(token)


SKILL_CONFIG = {
    "configurable": {
        "org_skills": [
            {"stable_name": "web-artifact", "name": "网页产物", "content": "You build web pages."},
        ],
    },
}


def _tool_call(args: dict[str, object]) -> dict[str, object]:
    return {"args": args, "name": "call_skill", "type": "tool_call", "id": "tc-isolation-1"}


def test_focused_call_does_not_leak_tokens_into_the_ambient_graph_callback() -> None:
    """模拟 LangGraph 图执行期间挂着一份转发回调（`var_child_runnable_config`），
    调用 `call_skill`，断言那份回调**一个 token 都没收到**——它只该收到编排模型
    自己说的话，不该收到技能内部聚焦调用产出的英文旁白。"""
    model = GenericFakeChatModel(messages=iter([
        AIMessage(content="Now let me create the bundle.html and compute hashes:"),
    ]))
    _, call_skill, *_ = build_tools(model)

    spy = TokenSpy()
    token = var_child_runnable_config.set(ensure_config({"callbacks": [spy]}))
    try:
        result = call_skill.invoke(
            _tool_call({"skill_stable_name": "web-artifact", "task": "画一个页面"}), config=SKILL_CONFIG,
        )
    finally:
        var_child_runnable_config.reset(token)

    assert result.content == "Now let me create the bundle.html and compute hashes:"
    assert spy.tokens == [], (
        "技能内部聚焦调用的 token 泄进了环境态里挂着的回调——"
        f"实际收到：{spy.tokens!r}"
    )


def test_focused_call_result_is_unaffected_by_the_isolation() -> None:
    """反证的另一半：隔离环境态回调不能连累返回值本身——`call_skill` 该拿到的
    文本一个字都不能少，隔离只该切断"转发给谁"，不该切断"生成了什么"。"""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="正文一个字都不能少")]))
    _, call_skill, *_ = build_tools(model)

    result = call_skill.invoke(
        _tool_call({"skill_stable_name": "web-artifact", "task": "画一个页面"}), config=SKILL_CONFIG,
    )

    assert result.content == "正文一个字都不能少"
