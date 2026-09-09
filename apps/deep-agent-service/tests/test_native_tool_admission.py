"""跨语言准入门：TS 准入表 ↔ Python 真实构造出来的工具对象，两个方向都机械比对。

## 这个文件抓的是哪一类缺陷

`native_factory.native_graph_context` 里那句
`tools=[tool for tool in native_candidate_tools(...) if tool.name in interrupt_on]`
是**静默过滤**。`interrupt_on` 来自 TS 侧 `NATIVE_PROFILE_TOOLS`（经
`generated/native_profile_tools.json` 传过来）。于是：

* Python 构造了、TS 没登记 ⇒ 工具**消失**，无日志、无异常、模型侧看不见。
  `spawn_async_task` 就是这样：`native_factory` 逐字构造它，准入表里没有它的名字，
  它从 2026-08 起就没有一次真的进过图（#3159）。
* TS 登记了、没有任何东西注册这个名字 ⇒ 准入表里多一个**死名字**，那一档对真实调用
  不生效（#3160 的 `web_fetch` / `bash_exec` 是同一形态的另一半）。

两侧原本是两份**手抄**清单，没有任何机械比对——这是本仓第七次"同一事实两处声明"。
这里两条断言都不手抄名字：一边是生成物（TS 源码派生），一边是**真的把工具对象构造
出来 / 真的编译出一张图**再读它注册了什么。

## 为什么两条都要，缺一条都漏

`test_admitted_set_equals_the_compiled_graph_registry` 单独看不出 #3159：修复前
`spawn_async_task` 既不在准入表里、又被过滤掉，两个集合都少它一个，**相等成立**。
只有 `test_no_constructed_tool_is_silently_dropped` 在"过滤前"取证才能看见它。
反过来，死名字只有编译后的注册表能看见。
"""
import json
from pathlib import Path

from deep_agent_service.native_factory import native_candidate_tools
from deep_agent_service.native_graph import create_native_graph
from deep_agent_service.tools import build_tools
from native_sandbox_fixture import FakeAuthority
from test_native_graph import model, sandbox

ADMISSION = json.loads((Path(__file__).resolve().parents[1]
                        / "src/deep_agent_service/generated/native_profile_tools.json").read_text())

# 生成物本身坏掉时（空数组 / 键名改了）全称断言会平凡为真——宁可先红。
assert len(ADMISSION["tools"]) > 40, "admission table looks empty; refusing to pass vacuously"
assert set(ADMISSION["tools"]) == set(ADMISSION["interruptOn"])


def _candidates():
    chat = model()
    interactions = build_tools(chat, interactions_only=True)
    tools = native_candidate_tools(chat, interactions)
    # 构造集合本身必须非空且不含重名——否则下面的差集断言没有意义。
    names = [tool.name for tool in tools]
    assert len(names) > 30 and len(set(names)) == len(names)
    return chat, tools


def test_no_constructed_tool_is_silently_dropped():
    """#3159 的回归门：本进程构造出来的工具，必须全部被服务端准入表接住。"""
    _, tools = _candidates()
    admitted = set(ADMISSION["tools"])
    dropped = sorted(tool.name for tool in tools if tool.name not in admitted)
    assert dropped == [], (
        "these tools are constructed here but the server admission table never lets them into the graph: "
        + ", ".join(dropped))


def test_admitted_set_equals_the_compiled_graph_registry():
    """准入表里的每个名字，都必须真的是一张编译出来的图里注册着的工具，反之亦然。

    读的是 `graph.nodes['tools']` 的 `tools_by_name`——**编译后的活事实**，不是源码里
    的字面量清单。deepagents 自带的文件/命令/规划工具（`ls`/`read_file`/`execute`/
    `task`/`write_todos` 等）不在 `native_candidate_tools` 里，是 `create_native_graph`
    自己装的；正因为如此，这一条才是唯一能看见"准入表登记了一个谁也没注册的死名字"
    的地方。
    """
    chat, tools = _candidates()
    interrupt_on = dict(ADMISSION["interruptOn"])
    graph = create_native_graph(chat, sandbox=sandbox(), pinned_skills=[],
                                tools=[tool for tool in tools if tool.name in interrupt_on],
                                interrupt_on=interrupt_on, tool_authority=FakeAuthority())
    node = graph.nodes["tools"]
    registered = set(getattr(node, "bound", node).tools_by_name)
    assert registered, "compiled graph registered no tools at all"
    assert sorted(registered) == sorted(ADMISSION["tools"]), (
        f"registered-but-not-admitted={sorted(registered - set(ADMISSION['tools']))} "
        f"admitted-but-nobody-registers-it={sorted(set(ADMISSION['tools']) - registered)}")
