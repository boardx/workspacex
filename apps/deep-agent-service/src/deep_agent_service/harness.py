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
- `RubricMiddleware`（deepagents，DA-09/#2051）→ D7「退出前对照任务自检」：本来要
  收尾的那一刻先对照清单评一遍，不合格带着差距说明跳回模型返工。上游官方件，
  核实过程与灰度口径见 `build_precompletion_middleware` 上方的注释。
  ⚠ 它在 0.7.6 里带 `@beta`（构造时会发 `LangChainBetaWarning`）——API 可能变，
  升级时优先看它；`test_harness.py::test_precompletion_checklist_uses_official_middleware`
  是那道看守。
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

import logging
import os
import re
from typing import Awaitable, Callable

from langchain.agents.middleware import (
    AgentMiddleware,
    InterruptOnConfig,
    ModelCallLimitMiddleware,
    ModelRequest,
    ModelResponse,
    SummarizationMiddleware,
    TodoListMiddleware,
    ToolCallLimitMiddleware,
    ToolRetryMiddleware,
)
from langchain.agents.middleware.types import AgentState
from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.config import get_config
from langgraph.errors import GraphBubbleUp
from langgraph.prebuilt.tool_node import ToolCallRequest
from typing_extensions import NotRequired

from deepagents import FilesystemMiddleware, RubricMiddleware
from deepagents.middleware.rubric import RubricState

# DA-08（#1749，rubric D8②）：单个工具输出超过这个 token 数就驱逐到虚拟文件系统，
# 正文只留文件引用（实测行为：ToolMessage 被替换为
# "saved in the filesystem at this path: /large_tool_results/<call_id>"，
# 完整内容落 state files——2026-08-23 进程内实测，见 test_harness.py 的反证）。
#
# 1000 token ≈ 4KB 文本，对齐 rubric v2 的量化口径（人类改进意见第 4 条）。
# deepagents 默认 20000（≈80KB）——不显式固定就是吃库默认，升级时默认值漂移会
# 悄悄改变我们的上下文策略，与 Summarization trigger/keep 同一条纪律。
TOOL_RESULT_EVICT_TOKENS = 1000

# DA-07d（#1749，rubric D7 三件套）：死循环纠偏 + 预算熔断 + 失败重试。全部用
# langchain 原生 middleware，参数显式钉死不吃库默认（同 Summarization 的纪律）。
#
# 双层防线，先纠偏后熔断：
# · ToolCallLimitMiddleware(run_limit=40, exit_behavior="continue")——单 run 工具
#   调用超 40 次后，后续工具调用被拦截并注入「超限」ToolMessage，模型被迫收尾。
#   这是 rubric「重复操作超阈值时注入纠偏」的实现：不硬杀，先给模型一次自己
#   收敛的机会。
# · ModelCallLimitMiddleware(run_limit=25, exit_behavior="end")——模型调用（≈步数）
#   到 25 次强制优雅终止，**注入 limit-exceeded 消息**（实测 "end" 行为语义）：
#   用户看到的是「预算耗尽的明确通告」，不是静默截断也不是裸异常。
# · ToolRetryMiddleware(max_retries=2)——工具瞬时失败自动退避重试两次，
#   重试仍败时错误如实回给模型改道（on_failure 默认 continue = 错误进对话）。
#
# 时间预算在 provider 层已有（KERNEL_DEEP_AGENT_TIMEOUT_MS，默认 300s）——
# rubric「三种预算至少两种」由步数（本处）+ 时间（provider）满足。
RUN_MODEL_CALL_LIMIT = 25
RUN_TOOL_CALL_LIMIT = 40

# DA-09（issue #2051，rubric D7「退出前对照任务自检」）：上游**有**官方等价件。
#
# 核实过程（2026-08-25，读的是 .venv 里锁定的 deepagents 0.7.6 源码，不是猜的）：
# `langchain.agents.middleware` 的 24 个导出里没有任何 completion/checklist 语义的件；
# `deepagents.middleware.rubric.RubricMiddleware`（`deepagents.__all__` 公开导出）
# 的语义与「PreCompletionChecklist」逐字对应——库自己的模块注释原话：
# 「Each time the agent would otherwise finish — i.e. the model returns a response with
# no further tool calls — the middleware invokes a separate grader sub-agent against the
# transcript. If the grader returns `needs_revision`, its feedback is injected as a
# `HumanMessage` and the agent loop resumes.」
# 实现上是 `after_agent` + `@hook_config(can_jump_to=["model"])`：退出前拦一道、
# 不合格就带着差距说明跳回模型。⇒ 按本仓纪律（用官方 middleware，不写私有 hack）
# 直接接它，不自建。
#
# ⚠ 激活条件（库的公开契约）：只有调用方在 invocation state 里传了 `rubric` 才生效，
# 否则 before_agent/after_agent 双双 no-op——所以挂上它本身是零行为变更的。
# 「每次退出都对照默认清单自检」需要有人把默认 rubric 放进 state，那就是下面
# `_DefaultCompletionChecklistMiddleware` 干的唯一一件事。
RUBRIC_MAX_ITERATIONS = 2

# 默认自检清单。措辞刻意贴住本仓的完成定义（AGENTS.md「没有证据 = 没有完成」）与
# 反伪造纪律——自检的价值不在「多问一遍」，在于问的是**我们**认定的 done。
DEFAULT_COMPLETION_CHECKLIST = """在结束前，对照下面每一条自检本次回复：

1. 用户原始请求里的每一项要求都被真实处理了，没有只答其中一半就收尾。
2. 回复里声称做过的每一个动作，都有本轮 transcript 里对应的真实工具调用结果支撑；
   没有把没做过的事写成做过了，没有凭工具名字或既有印象编造结果。
3. 如果本轮产生过 todo 列表，每一项都处于终态；没有留着未完成项就直接给结论。
4. 遇到的失败、被拒绝的操作、预算超限、无法完成的部分，都如实告诉了用户，
   不是静默省略或包装成成功。
5. 最终回复是可以直接用的结论，不是「我接下来打算……」这样的过程陈述。

任何一条不满足就判 needs_revision，并在 gap 里写清楚缺的是什么。"""


class _DefaultCompletionChecklistMiddleware(AgentMiddleware):
    """把 `DEFAULT_COMPLETION_CHECKLIST` 播种进 state，激活 `RubricMiddleware`。

    只有一个 `before_agent`，只写 `rubric` 这一个**库自己声明为公开 I/O 的**字段
    （`RubricState` 文档原话：「Only `rubric` is part of the public I/O schema」），
    且调用方自带 rubric 时原样让路。不碰任何私有字段、不改库的控制流——
    这是「按官方契约喂参数」，不是绕过框架的私有 hack（D10②）。

    挂载顺序上必须排在 `RubricMiddleware` 之前：langchain factory 按 middleware
    列表顺序串 before_agent 节点（`factory.py` 的 `middleware_w_before_agent`），
    RubricMiddleware 的 before_agent 要读到已经播好的 rubric 才会开始记账。
    """

    state_schema = RubricState

    def before_agent(self, state, runtime):  # noqa: ANN001, ANN201, ARG002
        if state.get("rubric"):
            # 调用方显式传了自己的 rubric——用他的，不覆盖。
            return None
        return {"rubric": DEFAULT_COMPLETION_CHECKLIST}


def build_precompletion_middleware(model: BaseChatModel) -> list[AgentMiddleware]:
    """D7 退出前自检的两件（顺序有意义，见上面的挂载顺序说明）。

    Phase 14 F02（R6）：此前默认清单的播种由 `DEEP_AGENT_PRECOMPLETION_CHECKLIST=1`
    这个灰度开关打开，验证稳定后按 R6 要求默认开启且开关本身移除——现在
    `_DefaultCompletionChecklistMiddleware()` 与 `RubricMiddleware`（后者本来就
    无条件挂，没有 rubric 时逐字 no-op）一样无条件挂载，退出前自检对所有 run 生效。
    """
    seed: list[AgentMiddleware] = [_DefaultCompletionChecklistMiddleware()]
    # max_iterations 显式钉死不吃库默认（库默认 3）——同 Summarization trigger/keep
    # 的纪律：升级时默认值漂移不得悄悄改变我们的重试预算。2 = 最多返工一次。
    return [*seed, RubricMiddleware(model=model, max_iterations=RUBRIC_MAX_ITERATIONS)]


# DA-11（issue #2220 方案 B，rubric D1「结构化计划」的确定性保证；issue #2417 重做——
# 第一版通过 PR #2410 合入、又被 PR #2423 紧急回滚，见下方"2026-08-30 生产事故"一节）：
# 任务模式的用户可见承诺是「Agent 会先给出计划，得到确认后再执行」，方案 A（graph.py
# 的 SYSTEM_PROMPT 追加一段"必须调用 write_todos"的规则）只是概率性服从——实测同一句
# 提示词换一轮对话，真实模型可能仍然直接在回复正文里写"第一步/第二步"纯文字，从不
# 触发 write_todos（issue #2220 实测命中率 0/1）。plan-control 六态面板的唯一数据来源
# 是 write_todos 工具调用成功（copilotkit-agui.controller.ts），所以"模型愿不愿意听话"
# 这件事必须从系统提示词的软约束升级为 API 层的硬约束。
#
# 任务模式标记：`copilotkit-v2-panel-body.tsx` 的 `send()` 在任务模式开启时会把这句
# 固定中文前缀拼进用户消息正文（无其它结构化字段传这个信号，接线现状见 issue #2220
# 诊断第 4 点）——本模块就近读这句文案，不在 web/API 层新开一条结构化通道：把这次
# 修复限定在 deep-agent-service 内部，避免因为要新增跨服务字段而把一次"补齐确定性
# 保证"的小改动放大成 web+api+graph 三层的接口变更。
#
# ## 2026-08-30 生产事故（issue #2417）：只实现同步 wrap_model_call 导致 100% 请求失败
#
# 第一版实现（PR #2410）只重写了 `AgentMiddleware.wrap_model_call`（同步）。
# `deep-agent-service` 是用 `langgraph dev` 跑的，走的是**异步** runtime
# （`ainvoke()`/`astream()`）。真实容器日志（PR #2423 描述里的完整 traceback）实锤：
# LangChain agents 框架在异步上下文里调用中间件链时，任何一个中间件只要没实现
# `awrap_model_call`，框架自己的默认实现会在**中间件的业务逻辑跑之前**直接
# `raise NotImplementedError`——不区分这次调用是不是任务模式、消息里有没有标记，
# 每一次模型调用都会命中。这解释了两件事：①用户第一次任务模式实测失败、第二次连
# "你好"都失败——根因和触发条件完全无关；②PR #2410 自己的 TC-6 测试全绿——测试用
# `graph.invoke()`（同步路径），从未覆盖 `langgraph dev` 实际使用的异步路径。
#
# 教训直接写进了这次重做的验证方式：`test_tc6_...` 现在同时覆盖同步 `graph.invoke()`
# 与异步 `asyncio.run(graph.ainvoke(...))` 两条路径（后者是 issue #2417 的直接反证——
# 见该测试文件头注），而不是只跑同步桩测试就断言"修好了"。修法：`AgentMiddleware`
# 的官方契约是"要么两个都不覆写（都用框架默认的同步/异步互转），要么两个都覆写"——
# 下面的 `wrap_model_call`/`awrap_model_call` 是同一份判断逻辑（`_prepare_forced_request`）
# 的两个入口，业务逻辑单一事实源，只是 sync/async 调用 handler 的方式不同。
TASK_MODE_MARKER = "请先给出计划，经确认后再执行"

_logger = logging.getLogger(__name__)


def _human_text(message: object) -> str:
    """从一条消息里抽出人类可读文本；只认 `type == "human"`，结构化多模态 content
    时兜底拼接文本块，不因为 content 不是纯字符串就漏判任务模式标记。"""
    if getattr(message, "type", None) != "human":
        return ""
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = [
        str(part.get("text", ""))
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    ]
    return "".join(parts)


def _write_todos_already_called(messages: list) -> bool:
    """给定的消息片段里 `write_todos` 是否已经被真实调用过一次。"""
    for message in messages:
        for call in getattr(message, "tool_calls", None) or []:
            if call.get("name") == "write_todos":
                return True
    return False


def _latest_human_turn_index(messages: list) -> int | None:
    """`messages` 里最后一条人类消息的下标；没有人类消息时返回 `None`。"""
    for i in range(len(messages) - 1, -1, -1):
        if getattr(messages[i], "type", None) == "human":
            return i
    return None


def _tool_names(tools: list) -> set[str]:
    return {
        (getattr(t, "name", None) or (t.get("name") if isinstance(t, dict) else None))
        for t in tools
    }


def _prepare_forced_request(request: ModelRequest) -> ModelRequest | None:
    """任务模式判据是否命中、要不要把这次 `request` 钉成 `tool_choice="write_todos"`。

    命中时返回替换后的 `request`；不命中（没有任务模式标记 / `write_todos` 未挂载 /
    本轮已经调用过）原样返回 `None`，调用方（`wrap_model_call`/`awrap_model_call`）
    直接透传原始 `request`，不做任何改动——sync/async 两个入口共享同一份判断逻辑，
    不重复写两遍容易漂移的条件判断。

    触发条件（同时满足，判据全部锚定**最新一条人类消息所在的这一轮**——首版实现
    按"本次 run 的整份 transcript"判断，在长线程/多轮对话里有两个真实 bug：①同一
    线程里更早一次任务已经调用过 write_todos，会永久关闭后续新任务模式请求的强制；
    ②summarization 裁掉了那次历史工具调用、但更早的任务模式标记还留在某条人类消息
    里时，一次后续的普通提问会被误判成任务模式并被强制。两者的共同根因都是"看了
    不该看的历史"，修法是把判断窗口收窄到"最新这一轮"）：
    1. `write_todos` 工具确实挂载在本次可用工具清单里（`TodoListMiddleware` 提供）；
       没挂载时不强行指向一个不存在的工具，原样放行——这是配置异常，不是本中间件
       该兜底的场景（下方 `_logger.warning` 让这个分支可观测，不是真的悄无声息）。
    2. **最新一条人类消息**（不是历史上任意一条）里出现任务模式标记
       （`TASK_MODE_MARKER`）。
    3. `write_todos` 在**这条最新人类消息之后**还没被调用过——一旦模型已经在
       本轮产出过结构化计划，立刻不再强制，确认后的执行/收尾步骤按模型自己的
       判断继续，不会被卡成"每一步都必须先摆一次待办"；更早某一轮任务已经调用
       过 write_todos 完全不影响这一判断，新一轮任务模式请求会被独立、重新强制。
    """
    turn_start = _latest_human_turn_index(request.messages)
    if turn_start is None:
        return None

    if TASK_MODE_MARKER not in _human_text(request.messages[turn_start]):
        return None

    if "write_todos" not in _tool_names(request.tools):
        # 任务模式标记要求确定性强制，但 write_todos 这次没挂载——多半是
        # build_middleware() 被改动（比如误删 TodoListMiddleware）导致的配置
        # 漂移。不强行把 tool_choice 指向一个不存在的工具（那样每次模型调用
        # 都会直接报错，比"退回方案 A 的提示词软约束"更糟），但记一条可观测的
        # warning——production 里 build_middleware() 无条件挂 TodoListMiddleware，
        # 这个分支目前不可达，warning 是留给未来重构不慎踩到这里时的信号。
        _logger.warning(
            "任务模式标记出现但 write_todos 工具未挂载，无法确定性强制"
            "（build_middleware() 是否误删了 TodoListMiddleware？）——"
            "已退回不强制，行为等同于只有方案 A 的提示词软约束。"
        )
        return None

    if _write_todos_already_called(request.messages[turn_start + 1 :]):
        return None

    return request.override(tool_choice="write_todos")


class PlanFirstToolChoiceMiddleware(AgentMiddleware):
    """任务模式下把第一次模型调用的 `tool_choice` 钉成 `write_todos`（见上方模块注释）。

    机制：把改过的 `request`（`tool_choice="write_todos"`）转交给 `handler`，
    `langchain.agents.factory` 最终原样把它传进
    `model.bind_tools(final_tools, tool_choice=request.tool_choice, ...)`——这是
    provider 的 API 契约（OpenAI 等模型收到具名 tool_choice 时必须调用该工具），
    不依赖模型对提示词的服从概率。

    ⚠ **同步/异步两个入口都必须实现**（issue #2417 的教训，见上方模块注释）：
    `AgentMiddleware` 的官方契约是子类只覆写 `wrap_model_call` 时，框架在**异步**
    runtime（`ainvoke()`/`astream()`，`langgraph dev` 的实际运行方式）下调用
    `awrap_model_call` 会直接 `raise NotImplementedError`——这个异常发生在
    `_prepare_forced_request` 的业务判断**之前**，不区分任务模式请求还是普通对话，
    每一次模型调用都会命中。两个方法共享 `_prepare_forced_request` 这一份判断逻辑，
    只是调用/await `handler` 的方式不同，业务逻辑不会因为要覆写两个入口而分叉出
    两份容易漂移的判据。

    强制调用若被 provider 拒绝/报错，捕获后退回**不强制**的原始 `request` 重试一次
    （等同于只有方案 A 的提示词软约束）；仍然失败说明失败与 tool_choice 无关，
    异常原样往上抛，不吞真实故障。显式放行 `langgraph.errors.GraphBubbleUp`
    （HITL interrupt 等控制流信号，不是"错误"，不能被当成 provider 拒绝吞掉再重试）。
    """

    def wrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]
    ) -> ModelResponse:
        forced_request = _prepare_forced_request(request)
        if forced_request is None:
            return handler(request)
        try:
            return handler(forced_request)
        except GraphBubbleUp:
            raise
        except Exception as exc:  # noqa: BLE001 — 见类头注"强制调用若被拒绝"
            _logger.warning(
                "任务模式强制 tool_choice=\"write_todos\" 被 provider 拒绝/报错，"
                "退回不强制重试一次（等同于只有方案 A 的提示词软约束）：%s: %s",
                type(exc).__name__,
                exc,
            )
            return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        forced_request = _prepare_forced_request(request)
        if forced_request is None:
            return await handler(request)
        try:
            return await handler(forced_request)
        except GraphBubbleUp:
            raise
        except Exception as exc:  # noqa: BLE001 — 见类头注"强制调用若被拒绝"
            _logger.warning(
                "任务模式强制 tool_choice=\"write_todos\" 被 provider 拒绝/报错，"
                "退回不强制重试一次（等同于只有方案 A 的提示词软约束）：%s: %s",
                type(exc).__name__,
                exc,
            )
            return await handler(request)


# DA-13（issue #2662，需求文档「会自己拿主意的助手」04-目标①，US-01/02/03）：
# 现状是「要不要先出计划」完全靠用户手动点开任务模式开关——`TASK_MODE_MARKER` 需要
# `apps/web/lib/copilotkit-v2-task-mode.ts` 手动把固定文案拼进用户消息正文。没有任何
# 根据任务内容自动判断的机制：一句简单指令和一句需要多步调研的请求，只要用户没手动
# 开开关，两者在 `PlanFirstToolChoiceMiddleware` 眼里毫无区别。
#
# 本节新增 `TaskClassifierMiddleware`：在模型第一次响应前，把**最新一条人类消息**
# 判为三类之一：
#   1. `TASK_CATEGORY_NO_PLAN`      —— 一步到位，不需要计划。
#   2. `TASK_CATEGORY_MULTI_STEP_LOW_RISK`  —— 多步、无外部副作用，可自动执行。
#   3. `TASK_CATEGORY_MULTI_STEP_HIGH_RISK` —— 多步、有外部副作用，理应需要确认
#      （gate 本身怎么处理"需要确认"是另一个 issue #2663「计划确认策略」的范围——
#      本中间件只产出分类结果，不实现确认流程）。
#
# 判类用途分两层，都不引入额外模型调用（避免给每次首次响应多加一次延迟/成本；
# 启发式规则已经足够区分"一步到位"与"多步"，见下方判据函数的注释）：
#   · 分类结果写入 `TaskClassificationState.task_classification`（`before_model`/
#     `abefore_model` 挂载），随 checkpointer/AG-UI 状态流一起可观测——这是给
#     #2663 的 gate 逻辑消费的落点，也是这次验收标准要求的"产出分类结果"。
#   · 分类为**多步**（无论低/高风险）时，与 `PlanFirstToolChoiceMiddleware` 同样的
#     手法，把这次模型调用的 `tool_choice` 钉成 `"write_todos"`——"low-risk 情况下
#     也触发强制"是这次验收标准的明文要求：真正的确认门槛（是否需要人工确认才能
#     继续）留给 #2663 的 gate，本中间件只负责"有没有先出计划"这一半。
#
# 与 `PlanFirstToolChoiceMiddleware`（手动 marker）并存，不互斥替换：手动开关是
# "用户强制"这一种输入，本中间件是新增的"自动判类"输入，两条各自独立判断、各自
# 可能触发强制——某一轮同时命中两者时，两个中间件都会把 `tool_choice` 钉成
# `"write_todos"`，结果等价（钉同一个工具），不会互相冲突。
#
# Phase 14 F02（R6）：此前灰度（S1=B 纪律，同 build_subagents/build_interrupt_on
# 的既有模式）要求 `DEEP_AGENT_TASK_AUTO_CLASSIFY=1` 才启用、且整个类才进入
# `build_middleware()` 返回的列表——验证稳定后按 R6 要求默认开启且开关本身移除，
# `TaskClassifierMiddleware` 现在无条件进入 `build_middleware()` 的列表（见该函数），
# 每轮循环都会新增这个节点，是这条能力生效的固定代价，不再是可关闭的灰度。
TASK_CATEGORY_NO_PLAN = "no_plan"
TASK_CATEGORY_MULTI_STEP_LOW_RISK = "multi_step_low_risk"
TASK_CATEGORY_MULTI_STEP_HIGH_RISK = "multi_step_high_risk"

# 类别 1 vs 2/3 的初筛：多步任务的两个廉价信号。
# · 连接词/枚举词——"并且""然后""再""接着""同时""分别""各自"这类词，出现在句子里
#   通常意味着不止一个动作在同一句请求里被串起来。
# · 消息长度——真实的一步到位指令（"改个错别字""把标题改成 xxx"）通常很短；
#   需要调研/汇总/多个产出的请求（验收标准给的例子「调研三个方向分别给出结论并写
#   一份对比报告」）自然会更长。单独用长度阈值容易误判长句但仍是单一动作的请求
#   （比如一句很长的需求描述），所以判据是"长 且 含连接词"，不是任一条单独命中。
_MULTI_STEP_CONNECTORS = ("并且", "然后", "接着", "同时", "分别", "各自", "并", "再")
_MULTI_STEP_MIN_CHARS = 20

# issue #2786（"生成一个 pdf，总结你可以做的事情"，18 字，无连接词）：上面这条
# "长 且 含连接词"的判据对这句话双双落空——中文里用逗号/顿号并列两个动作
# （"生成 X，总结 Y"）比用"然后/并且"这类显式连接词更常见，尤其是短句。这类
# 表达完全落在原判据的盲区里，需要一条独立的第二信号，而不是简单调低长度阈值
# （调低阈值会让"你好，在吗"这类问候语也变长句判类的候选，风险更大）。
#
# 新信号：逗号/顿号分隔的文本，分隔符**两侧**各自都命中动作动词表——两侧都有
# 动词，才说明这确实是两个不同的动作串在一句话里，不是"一个长句子中间插了个
# 逗号做语气停顿"（比如"这份周报，我觉得写得还不错"只有后半句有动词，不算
# 多步；"你好，最近怎么样"两侧都没有动词，同样不算）。不叠加长度阈值——两个
# 明确的动作已经是足够强的信号，短句"发个邮件，提醒一下"本来就短，硬套 20 字
# 阈值只会让这条新信号形同虚设。
_MULTI_STEP_ENUMERATION_MARKERS = ("，", "、")
_ACTION_VERBS = (
    "生成", "总结", "汇总", "创建", "新建", "写", "撰写", "查找", "搜索", "查询",
    "分析", "整理", "翻译", "合并", "发送", "发", "删除", "上传", "下载", "对比",
    "调研", "检查", "修改", "更新", "设计", "开发", "测试", "部署", "发布", "复制",
    "转换", "提取", "统计", "绘制", "画", "计算", "回复", "回答", "解释", "说明",
    "介绍", "提醒", "整合", "导出", "导入", "打包", "校对", "润色", "拆分", "归纳",
)


def _has_enumerated_multi_action(text: str) -> bool:
    """逗号/顿号并列的两个动作是否两侧都各自带动词（见上方模块注释）。只看
    第一个命中的分隔符两侧——前两段都有动词已经足以确认"至少两个动作被串起来"
    这件事，不需要处理任意多段的情况。"""
    for marker in _MULTI_STEP_ENUMERATION_MARKERS:
        if marker not in text:
            continue
        head, _, tail = text.partition(marker)
        if not head.strip() or not tail.strip():
            continue
        if any(verb in head for verb in _ACTION_VERBS) and any(
            verb in tail for verb in _ACTION_VERBS
        ):
            return True
    return False


# 类别 2 vs 3：是否提到有外部副作用的动作。关键词表直接取验收标准里点名的例子
# （"发issue""创建PR""发邮件""删除"）并补齐同义表达——命中任何一个即判为"有外部
# 影响"（类别 3），需要人工确认；否则判为"无外部影响"（类别 2），可自动执行。
#
# 两层匹配：①独立动词本身就是强信号（"删除""合并""发布""部署""转账""付款""支付"，
# 不需要搭配宾语也能判定有外部影响）；②"动词 + 宾语"组合信号（"创建...issue"、
# "发...邮件"这类短语里动词和宾语中间常插了"一个/这个/xxx"之类的词，直接字面量
# 枚举穷举不完，改用"动词字符 + 宾语关键词在几个字以内共现"的宽松正则，覆盖
# "创建一个issue""发一封邮件""提交个PR"这类真实表达变体）。
_EXTERNAL_IMPACT_STANDALONE_VERBS = ("删除", "移除", "清空", "合并", "发布", "上线", "部署", "转账", "付款", "支付")
_EXTERNAL_IMPACT_OBJECT_VERB_CHARS = "创建发提开写"
_EXTERNAL_IMPACT_OBJECTS = ("issue", "pr", "邮件", "工单")
_EXTERNAL_IMPACT_OBJECT_PATTERN = re.compile(
    rf"[{_EXTERNAL_IMPACT_OBJECT_VERB_CHARS}][^，。！？\s]{{0,6}}(?:{'|'.join(_EXTERNAL_IMPACT_OBJECTS)})",
    re.IGNORECASE,
)


def _classify_task_text(text: str) -> str:
    """纯启发式判类，零额外模型调用（见上方模块注释）——`text` 通常是最新一条
    人类消息的纯文本。空文本（没有人类消息/纯多模态消息取不到文本）判为
    `TASK_CATEGORY_NO_PLAN`，与"没有任务模式标记就不强制"的既有语义一致，不额外
    制造一种"无法判断"的第四态。"""
    stripped = text.strip()
    if not stripped:
        return TASK_CATEGORY_NO_PLAN

    is_multi_step = (
        len(stripped) >= _MULTI_STEP_MIN_CHARS
        and any(connector in stripped for connector in _MULTI_STEP_CONNECTORS)
    ) or _has_enumerated_multi_action(stripped)
    if not is_multi_step:
        return TASK_CATEGORY_NO_PLAN

    has_external_impact = any(
        verb in stripped for verb in _EXTERNAL_IMPACT_STANDALONE_VERBS
    ) or _EXTERNAL_IMPACT_OBJECT_PATTERN.search(stripped) is not None
    return TASK_CATEGORY_MULTI_STEP_HIGH_RISK if has_external_impact else TASK_CATEGORY_MULTI_STEP_LOW_RISK


# issue #2667（"保留手动『每次都先计划』开关"）：`TaskClassifierMiddleware` 现在
# 无条件挂在图上（Phase 14 F02 起不再有全局灰度那种"类在不在列表里"的构建期开关，
# 见上方模块注释）——`graph.py` 的 `create_deep_agent(...)` 在**模块导入时**跑一次，
# 产出一个进程级单例 graph（见其头注"one process, one `langgraph.json`, one
# `create_deep_agent(...)` call at import time"），中间件列表因此没有"按 run 变化"
# 的架构空间：不存在给某一次 run 单独重建一份 middleware 列表、把这个类换掉/摘掉的
# 调用点。
#
# 这里要做的是"个人设置：坚持要手动控制的用户可以关掉自动判类，退回手动任务模式"——
# 一个 per-run（更准确地说 per 用户当前设置）的覆盖，粒度比"整个类在不在列表里"更细：
# `TaskClassifierMiddleware` 已经作为单例挂在图上，它的 `before_model`/
# `wrap_model_call` 每次都是**运行时**被调用一次，可以在方法体内部读这一次调用自己
# 携带的 `RunnableConfig.configurable` 来决定"这次生效还是不生效"——图结构本身不
# 因为这次 run 要不要用而变化，运行时判断成本可以忽略（一次 dict.get）。
#
# `get_config()` 是 langgraph 官方文档收录的"在 graph 节点/中间件运行期读当次
# `RunnableConfig`"机制（见 `langgraph.runtime.Runtime` 类头注："Accessing config"
# 一节，明确指向 `get_config()` 作为替代方案）——不需要中间件声明 `context_schema`，
# 也不改 `ModelRequest`/`AgentState` 的字段形状。`config.configurable` 这条通道本身
# 早就在用（`deep-agent-model-provider.ts` 已经拿它透传 `org_skills`/`script_protocol`，
# 见该文件头注），这里只是新增一个键：`disable_task_auto_classify`，此前由前端"每次都先给我看
# 计划"设置打开时带出（缺席 = 未覆盖，与 `script_protocol` 同一条"缺席就按老样子跑"
# 纪律）。
#
# issue #2770（2026-09-05）：那个前端开关连同 web → api 整条透传来源已删（要不要先计划
# 由本中间件自动判，不再要用户选），TS 网关不再产生这个键。这里的读法保留为防御性
# 兼容 + golden 测试的 seam（`test_tc7_interjection_replan.py` 用它关掉判类以隔离被测
# 路径）；生产流量里它恒缺席，行为即"自动判类始终生效"。
_DISABLE_TASK_AUTO_CLASSIFY_CONFIG_KEY = "disable_task_auto_classify"


def _run_disables_auto_classify() -> bool:
    """读这一次 run 的 `configurable.disable_task_auto_classify`——`True` 时即使全局灰度
    已经打开，本次判类也不生效（回退到纯手动 `TASK_MODE_MARKER` 路径）。不在 runnable
    执行上下文中调用（理论上不会发生：这个函数只在 `before_model`/`wrap_model_call`
    内部被调，两者都在 langgraph 的节点执行期间跑）时 `get_config()` 抛
    `RuntimeError`——防御性地按"没有覆盖"处理，不额外制造第三态，与 `_classify_task_text`
    对空文本的处理是同一条纪律。"""
    try:
        config = get_config()
    except RuntimeError:
        return False
    configurable = config.get("configurable") or {}
    return bool(configurable.get(_DISABLE_TASK_AUTO_CLASSIFY_CONFIG_KEY, False))


def _latest_human_text(messages: list) -> str:
    turn_start = _latest_human_turn_index(messages)
    if turn_start is None:
        return ""
    return _human_text(messages[turn_start])


class TaskClassificationState(AgentState):
    """`TaskClassifierMiddleware` 的 state schema——公开 I/O 只有
    `task_classification` 这一个字段，供 #2663 的 gate 逻辑与外部观测消费。"""

    task_classification: NotRequired[dict]
    """最近一次判类结果：`{"category": <三选一常量>, "source": "heuristic"}`。
    未产生过判类（per-run 覆盖关闭/尚未跑过 before_model）时不存在该键，不是空字典——
    调用方用 `.get("task_classification")` 判"有没有分类结果"这件事本身。"""


def _prepare_auto_classified_request(request: ModelRequest) -> ModelRequest | None:
    """本轮判类被 per-run 覆盖关闭 / 命中"一步到位" / write_todos 未挂载 / 本轮已
    调用过 → 不强制，返回 `None`。判类逻辑与"这一轮判断窗口收窄到最新人类消息"的
    纪律与 `_prepare_forced_request` 完全同源（同一个 issue #2417 教训：只看最新
    一轮，不看整份历史），只是触发信号从"手动 marker"换成"启发式判类结果"。"""
    if _run_disables_auto_classify():
        return None

    turn_start = _latest_human_turn_index(request.messages)
    if turn_start is None:
        return None

    category = _classify_task_text(_human_text(request.messages[turn_start]))
    if category == TASK_CATEGORY_NO_PLAN:
        return None

    if "write_todos" not in _tool_names(request.tools):
        # 同 `_prepare_forced_request` 的处理：配置漂移导致 write_todos 未挂载时
        # 不强行指向不存在的工具，退回不强制。
        _logger.warning(
            "任务自动判类命中多步任务（%s）但 write_todos 工具未挂载，无法确定性强制"
            "（build_middleware() 是否误删了 TodoListMiddleware？）。",
            category,
        )
        return None

    if _write_todos_already_called(request.messages[turn_start + 1 :]):
        return None

    return request.override(tool_choice="write_todos")


class TaskClassifierMiddleware(AgentMiddleware):
    """DA-13（issue #2662）：不依赖手动 marker，根据最新一条人类消息的内容自动
    判类，产出结果给后续 gate 消费，并在判为多步任务时（无论低/高风险）同样把
    首次模型调用的 `tool_choice` 钉成 `write_todos`（见上方模块注释）。

    与 `PlanFirstToolChoiceMiddleware` 并存、互不替代：两者共用同一个
    `write_todos` 工具与同一条"最新一轮判断窗口"纪律，但触发信号完全独立
    （手动 marker vs 自动判类），任何一个命中都会强制。

    ⚠ 同步/异步两个入口都要实现（issue #2417 教训——见
    `PlanFirstToolChoiceMiddleware` 类头注，本类的 `wrap_model_call`/
    `awrap_model_call`/`before_model`/`abefore_model` 四个钩子分别有对应的
    同步/异步版本，缺任何一个都会在异步 runtime 下于业务逻辑跑之前直接
    `NotImplementedError`）。
    """

    state_schema = TaskClassificationState

    def _classification_update(self, state: dict) -> dict | None:
        if _run_disables_auto_classify():
            return None
        messages = state.get("messages") or []
        category = _classify_task_text(_latest_human_text(messages))
        return {"task_classification": {"category": category, "source": "heuristic"}}

    def before_model(self, state, runtime):  # noqa: ANN001, ANN201, ARG002
        return self._classification_update(state)

    async def abefore_model(self, state, runtime):  # noqa: ANN001, ANN201, ARG002
        return self._classification_update(state)

    def wrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]
    ) -> ModelResponse:
        forced_request = _prepare_auto_classified_request(request)
        if forced_request is None:
            return handler(request)
        try:
            return handler(forced_request)
        except GraphBubbleUp:
            raise
        except Exception as exc:  # noqa: BLE001 — 同 PlanFirstToolChoiceMiddleware 的纪律
            _logger.warning(
                "任务自动判类强制 tool_choice=\"write_todos\" 被 provider 拒绝/报错，"
                "退回不强制重试一次：%s: %s",
                type(exc).__name__,
                exc,
            )
            return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        forced_request = _prepare_auto_classified_request(request)
        if forced_request is None:
            return await handler(request)
        try:
            return await handler(forced_request)
        except GraphBubbleUp:
            raise
        except Exception as exc:  # noqa: BLE001 — 同 PlanFirstToolChoiceMiddleware 的纪律
            _logger.warning(
                "任务自动判类强制 tool_choice=\"write_todos\" 被 provider 拒绝/报错，"
                "退回不强制重试一次：%s: %s",
                type(exc).__name__,
                exc,
            )
            return await handler(request)


# ── Phase 14 后续 A（#2755，`artifacts-steering` R3'/R12）：中途插话回灌内核 ──────
#
# F11（PR #2742）把 `POST /agent-runs/:runId/interject` 做到了网关侧：插话在"下一次
# 工具调用之间"被消费、写账本、方向性改变时撤销 L2 授权——但如实记录了一道边界：
# 插话文本没有真正回到这张图，内核不会据此重规划。本节把这道边界关掉。
#
# 通道：与 `disable_task_auto_classify` 完全同一条——TS 网关（`deep-agent-model-provider.ts`）
# 把待投递的插话放进 `config.configurable[_INTERJECTION_CONFIG_KEY]`，形状是契约
# `KernelInterjection`（`packages/contracts/src/artifacts-steering.ts`）；键名、字段名、
# 分类枚举三者的唯一事实源都在那份契约里，下面三个常量只是 Python 侧的**读法**，
# `packages/contracts/tests/artifacts-steering/cross-lang-interjection-parity.test.ts`
# 机械比对它们与契约逐字一致——改任何一侧不改另一侧，那条测试会红。
#
# 两件事，分别落在中间件的两组钩子上：
# 1. `before_model`/`abefore_model`：读到插话且本线程还没注入过（按固定 message id
#    去重——同一条插话只进图一次，TS 侧也只投递一次，双保险）⇒ 以 `HumanMessage`
#    追加进 `messages`。用 human 消息而不是改 system prompt：它就是用户在这个时点
#    说的话，落在 transcript 里的位置（紧接着刚结束的那次工具调用之后）本身就是
#    "最高优先级上下文"的形状——模型接下来看到的最新一条人类消息就是它。
# 2. `wrap_model_call`/`awrap_model_call`：最新一条人类消息是插话、且其后还没调过
#    `write_todos` ⇒ 把这次 `tool_choice` 钉成 `write_todos`——与
#    `PlanFirstToolChoiceMiddleware` 同一条"确定性强制而非提示词软约束"的纪律与同一份
#    "最新一轮判断窗口"（issue #2417 教训）。重规划由此经**既有** `write_todos` 路径
#    产生 `plan_update`（`copilotkit-agui.controller.ts` 读工具调用），不伪造事件。
#    局部调整与方向性改变都强制一次：待办清单就是计划，任何一条追加指令都该让
#    计划的剩余步骤如实反映它；分类只影响注入文本的标签，让模型知道网关怎么判的。
#
# 同步/异步四个钩子都实现（issue #2417：只实现同步版会让 `langgraph dev` 的异步
# runtime 在业务逻辑之前直接 `NotImplementedError`，生产 100% 请求失败）。
_INTERJECTION_CONFIG_KEY = "interjection"
_INTERJECTION_FIELDS: tuple[str, ...] = ("interjectionId", "text", "classification", "receivedAt")
_INTERJECTION_CLASSIFICATIONS: tuple[str, ...] = ("adjustment", "direction_change")
_INTERJECTION_MESSAGE_ID_PREFIX = "interjection:"
_INTERJECTION_LABELS = {"adjustment": "局部调整", "direction_change": "方向性改变"}


def _run_interjection() -> dict | None:
    """读这一次 run 的 `configurable.interjection`；缺席/形状不对 ⇒ `None`（按"没有插话"
    处理，warning 让坏形状可观测，不让一条坏输入把整轮判死）。`get_config()` 不在
    runnable 上下文时的 `RuntimeError` 与 `_run_disables_auto_classify` 同一条防御纪律。"""
    try:
        config = get_config()
    except RuntimeError:
        return None
    raw = (config.get("configurable") or {}).get(_INTERJECTION_CONFIG_KEY)
    if raw is None:
        return None
    if not isinstance(raw, dict) or any(not isinstance(raw.get(f), str) for f in _INTERJECTION_FIELDS):
        _logger.warning("configurable.%s 形状不符合契约 KernelInterjection，忽略：%r", _INTERJECTION_CONFIG_KEY, raw)
        return None
    if raw["classification"] not in _INTERJECTION_CLASSIFICATIONS:
        _logger.warning("configurable.%s.classification 不在契约枚举内，忽略：%r", _INTERJECTION_CONFIG_KEY, raw)
        return None
    if not raw["text"].strip():
        return None
    return raw


def _interjection_message_id(interjection_id: str) -> str:
    return f"{_INTERJECTION_MESSAGE_ID_PREFIX}{interjection_id}"


def _is_interjection_message(message: object) -> bool:
    return getattr(message, "type", None) == "human" and str(getattr(message, "id", "") or "").startswith(
        _INTERJECTION_MESSAGE_ID_PREFIX
    )


def _interjection_already_injected(messages: list, interjection_id: str) -> bool:
    wanted = _interjection_message_id(interjection_id)
    return any(getattr(m, "id", None) == wanted for m in messages)


def _interjection_human_message(raw: dict):  # noqa: ANN202
    from langchain_core.messages import HumanMessage

    label = _INTERJECTION_LABELS[raw["classification"]]
    content = (
        f"【用户中途插话·{label}】{raw['text']}\n"
        "（这是运行中追加的最高优先级指令：先用 write_todos 按它更新剩余计划，再按更新后的计划继续执行；"
        "不要重做已经完成且不受影响的步骤。）"
    )
    return HumanMessage(
        content=content,
        id=_interjection_message_id(raw["interjectionId"]),
        additional_kwargs={_INTERJECTION_CONFIG_KEY: dict(raw)},
    )


def _prepare_replan_request(request: ModelRequest) -> ModelRequest | None:
    """最新一条人类消息是插话、`write_todos` 已挂载、且插话之后还没调过 `write_todos`
    ⇒ 返回钉成 `tool_choice="write_todos"` 的 request；否则 `None`（不强制）。判断
    窗口与 `_prepare_forced_request` 同源：只看最新一轮，不看整份历史。"""
    turn_start = _latest_human_turn_index(request.messages)
    if turn_start is None or not _is_interjection_message(request.messages[turn_start]):
        return None
    if "write_todos" not in _tool_names(request.tools):
        _logger.warning(
            "收到中途插话但 write_todos 工具未挂载，无法确定性强制重规划"
            "（build_middleware() 是否误删了 TodoListMiddleware？）——已退回不强制。"
        )
        return None
    if _write_todos_already_called(request.messages[turn_start + 1 :]):
        return None
    return request.override(tool_choice="write_todos")


class InterjectionMiddleware(AgentMiddleware):
    """Phase 14 后续 A（#2755）：接住 TS 网关投递的中途插话，注入图并强制重规划
    （见上方模块注释）。同步/异步四个钩子都实现（issue #2417 教训）。"""

    def _injection_update(self, state: dict) -> dict | None:
        raw = _run_interjection()
        if raw is None:
            return None
        if _interjection_already_injected(state.get("messages") or [], raw["interjectionId"]):
            return None
        return {"messages": [_interjection_human_message(raw)]}

    def before_model(self, state, runtime):  # noqa: ANN001, ANN201, ARG002
        return self._injection_update(state)

    async def abefore_model(self, state, runtime):  # noqa: ANN001, ANN201, ARG002
        return self._injection_update(state)

    def wrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]
    ) -> ModelResponse:
        forced_request = _prepare_replan_request(request)
        if forced_request is None:
            return handler(request)
        try:
            return handler(forced_request)
        except GraphBubbleUp:
            raise
        except Exception as exc:  # noqa: BLE001 — 同 PlanFirstToolChoiceMiddleware 的纪律
            _logger.warning(
                "插话重规划强制 tool_choice=\"write_todos\" 被 provider 拒绝/报错，"
                "退回不强制重试一次：%s: %s",
                type(exc).__name__,
                exc,
            )
            return handler(request)

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        forced_request = _prepare_replan_request(request)
        if forced_request is None:
            return await handler(request)
        try:
            return await handler(forced_request)
        except GraphBubbleUp:
            raise
        except Exception as exc:  # noqa: BLE001 — 同 PlanFirstToolChoiceMiddleware 的纪律
            _logger.warning(
                "插话重规划强制 tool_choice=\"write_todos\" 被 provider 拒绝/报错，"
                "退回不强制重试一次：%s: %s",
                type(exc).__name__,
                exc,
            )
            return await handler(request)


def build_middleware(model: BaseChatModel) -> list[AgentMiddleware]:
    """rubric 驱动的 middleware 清单。顺序即挂载顺序。

    trigger/keep 显式固定而不是吃库默认——升级 deepagents/langchain 时默认值
    漂移不该悄悄改变我们的上下文策略（「同一事实不两处声明」的运行时版本）。
    """
    return [
        TodoListMiddleware(),
        # Phase 14 后续 A（#2755）：紧跟规划工具之后、两个"钉 write_todos"的中间件之前——
        # 它的 before_model 要先把插话追加进 messages，后面 TaskClassifier 的判类与
        # 本类自己的 wrap_model_call 才会把"最新一条人类消息"看成这条插话。
        InterjectionMiddleware(),
        # DA-11（#2220 方案 B，重做见 issue #2417）：紧跟在 TodoListMiddleware 之后——
        # 它依赖 write_todos 工具已经挂载，逻辑上属于"规划工具本身"这一组，不是与
        # 限流/摘要同级的关注点。
        PlanFirstToolChoiceMiddleware(),
        # DA-13（#2662）：同组的第二个"规划工具"关注点——不同于
        # `PlanFirstToolChoiceMiddleware`（只有 `wrap_model_call`，组合进"model"节点
        # 内部、不新增图节点），`TaskClassifierMiddleware` 还实现了 `before_model`/
        # `abefore_model`（把判类结果写进可观测的图状态）；`langchain.agents.factory`
        # 按"类是否覆写了 before_model"**静态**决定要不要在图上新增一个
        # `TaskClassifierMiddleware.before_model` 节点并接入每一轮循环的入口边
        # （`middleware_w_before_model`/`loop_entry_node`，非运行期条件）——挂上这个
        # 类本身就会让每次模型调用循环多走一步。Phase 14 F02（R6）起不再是灰度开关：
        # 此前 `DEEP_AGENT_TASK_AUTO_CLASSIFY=1` 才让这个类进入返回列表，验证稳定后
        # 按 R6 要求默认开启且开关本身移除，多出的这一个循环节点是这条能力生效的
        # 固定代价，不是可以省掉的开销（同 Summarization trigger/keep 那条注释的纪律）。
        TaskClassifierMiddleware(),
        SummarizationMiddleware(
            model=model,
            trigger=("tokens", 60000),
            keep=("messages", 20),
            # DA-09（#2051）：这一项此前吃的是库默认 4000，而 TC-4 把它抓了出来——
            # 触发线 60000、保留最近 20 条，意味着一次压缩要丢掉的那一段可能有
            # 四万多 token；`_trim_messages_for_summary` 却用
            # `trim_messages(max_tokens=4000, strategy="last")` 只把**最后 4000 token**
            # 交给摘要器，更老的内容**根本没进摘要就没了**。
            # 实测（TC-4 第一版红的存档）：30 轮对话触发一次摘要，摘要器只收到第 15 轮
            # 一轮的内容，第 2 轮种下的事实在摘要输入里查无此句——那不是「滚动语义摘要」，
            # 是「把尾巴摘一下、其余静默丢弃」，正是 rubric D8 0.3 档写的「只有截断」。
            # 钉成与触发线同值：要丢掉的那一段按定义不超过触发线，60000 就是「不静默
            # 丢内容」所需的确切预算。代价是每次压缩有一次大输入的摘要调用——这是这条
            # 能力真正生效的价格，不是可以省掉的开销。
            trim_tokens_to_summarize=60000,
        ),
        # by-name override（0.7 机制）：同名实例替换 create_deep_agent 内建的默认
        # FilesystemMiddleware，不是叠第二份——文件工具仍只有一套。
        FilesystemMiddleware(tool_token_limit_before_evict=TOOL_RESULT_EVICT_TOKENS),
        ToolCallLimitMiddleware(run_limit=RUN_TOOL_CALL_LIMIT, exit_behavior="continue"),
        ModelCallLimitMiddleware(run_limit=RUN_MODEL_CALL_LIMIT, exit_behavior="end"),
        ToolRetryMiddleware(max_retries=2),
        # DA-09（#2051，D7③退出前自检）：放在最后——它的 after_agent 是「本来要
        # 结束时」的最后一道拦截，语义上就属于队尾。
        *build_precompletion_middleware(model),
    ]


# Phase 14 F02（R6）：此前由 `DEEP_AGENT_HITL_TOOLS`（逗号分隔的工具名列表，
# deploy.env 侧投影，见 packages/contracts/src/deep-agent-hitl.ts）配置，验证稳定
# 后按 R6 要求默认开启且开关本身移除——四个会中断待人批的工具名改为固定清单，
# 逐字等于此前生产 deploy.env 的值（provision.sh 曾经的
# `DEEP_AGENT_HITL_TOOLS=call_skill,confirm_task_intent,fill_run_params,
# choose_execution_option`）：`call_skill`（唯一真正执行技能、有副作用语义的工具，
# 见 deep-agent-hitl.ts 头注）与 #2252 新增的三个具名虚拟工具
# （confirm_task_intent/fill_run_params/choose_execution_option）。
DEFAULT_HITL_TOOL_NAMES: tuple[str, ...] = (
    "call_skill",
    "confirm_task_intent",
    "fill_run_params",
    "choose_execution_option",
)

# issue #2767 —— `call_skill` 不再对每一次调用无条件 interrupt：devapp 实测，让
# 通用助手「生成一个 pdf」会弹「等待批准：调用技能：pdf-create」，人类明确判定这是
# 错的——生成一份 PDF 不该需要任何批准。风险单位是**被调用的那个 skill**，不是
# "调用 skill"这个动作本身：网关（`apps/api` 的 `domain/agent-run/skill-risk-
# level.ts`）按平台目录/`SKILL.md` frontmatter 判定每个挂载 skill 的等级，把其中
# L2 的 stableName 列表投影进这里读的 `configurable.hitl_skill_names`
# （键名单一事实源见契约 `KERNEL_HITL_SKILLS_CONFIGURABLE_KEY`，
# `packages/contracts/src/plan-permissions.ts`）。
#
# 键名字面量只在这一处 Python 常量里出现；`packages/contracts/tests/plan-
# permissions/cross-lang-skill-hitl-parity.test.ts` 读本文件源文本机械比对，改
# 一侧不改另一侧会红（同 `_INTERJECTION_CONFIG_KEY` 那条既有跨语言门控的手法）。
_HITL_SKILLS_CONFIG_KEY = "hitl_skill_names"


def _call_skill_requires_hitl(request: ToolCallRequest) -> bool:
    """`call_skill` 的 `InterruptOnConfig.when` 谓词——`HumanInTheLoopMiddleware`
    每次都会调它，返回 `False` 时这次调用直接放行、绝不触发 interrupt。

    - 读不到 `RunnableConfig`（不在 runnable 上下文里，理论上不会发生在真实图
      执行期间）⇒ `True`：宁可多问一次，也不要在异常上下文里默默放行一个高风险
      判定跳过（fail-closed，同 `_run_disables_auto_classify` 的既有纪律）。
    - `configurable.hitl_skill_names` **缺席** ⇒ `True`：老网关/没投影这个键的
      调用方看到的行为必须与本 feature 之前逐字相同——每次 `call_skill` 都停。
    - 键存在但形状不是"字符串数组" ⇒ `True`：同上，坏形状按"没有名单"最保守处理，
      不静默放行。
    - 键存在且是数组 ⇒ 只有这次调用的 `skill_stable_name` 落在名单内才 `True`；
      参数缺失/不是字符串（理论上不该发生，`call_skill` 的签名要求它）同样按
      "不在名单"处理，不猜。
    """
    try:
        config = get_config()
    except RuntimeError:
        return True
    configurable = config.get("configurable") or {}
    if _HITL_SKILLS_CONFIG_KEY not in configurable:
        return True
    raw = configurable.get(_HITL_SKILLS_CONFIG_KEY)
    if not isinstance(raw, list) or any(not isinstance(name, str) for name in raw):
        _logger.warning(
            "configurable.%s 形状不符合契约 KernelHitlSkillNames（字符串数组），"
            "按最保守的『没有名单』处理：%r",
            _HITL_SKILLS_CONFIG_KEY,
            raw,
        )
        return True
    allowed = set(raw)
    args = request.tool_call.get("args") or {}
    stable_name = args.get("skill_stable_name") if isinstance(args, dict) else None
    return isinstance(stable_name, str) and stable_name in allowed


def build_interrupt_on() -> dict[str, bool | InterruptOnConfig]:
    """DA-07（#1749，rubric D6 人在环）：敏感工具调用前暂停待人批。

    `DEFAULT_HITL_TOOL_NAMES` 列出的工具在每次调用前触发 langgraph interrupt——
    run 停住、状态落 checkpointer，等外部用
    `Command(resume={"decisions": [{"type": "approve"|...}]})` 裁决后继续
    （0.7.6 的 HumanInTheLoopMiddleware 实测契约，四种决策类型）。

    Phase 14 F02 起无条件返回这份清单，不再由环境变量开关。⚠ 中断依赖
    checkpointer——平台托管环境由平台提供；自托管必须显式配置 Postgres
    checkpointer（见 `build_checkpointer`），否则 interrupt 无处落地，langgraph
    会在运行时报错，这是正确的 fail-closed 而不是我们要吞的错。

    issue #2767：`call_skill` 单独覆盖成带 `when` 谓词的 `InterruptOnConfig`——
    是否 interrupt 由 `_call_skill_requires_hitl` 按目标 skill 的风险等级决定，
    而不是像另外三个具名虚拟工具那样对每次调用都无条件触发。`allowed_decisions`
    逐字等于 `tool_config is True` 时库自己的默认展开（`human_in_the_loop.py`
    `__init__` 那段解析逻辑），只是显式写出来——因为一旦提供了 `InterruptOnConfig`
    就不再落到那条默认分支，必须自己声明，否则会在建图时被当成"没给
    `allowed_decisions`"直接拒绝。
    """
    result: dict[str, bool | InterruptOnConfig] = {name: True for name in DEFAULT_HITL_TOOL_NAMES}
    result["call_skill"] = InterruptOnConfig(
        allowed_decisions=["approve", "edit", "reject", "respond"],
        when=_call_skill_requires_hitl,
    )
    return result


def build_subagents(model: BaseChatModel) -> list[dict]:
    """DA-05（#1838，rubric D5 子代理委托）：具名子代理清单，让 task 工具有真实用途。

    基线实测（2026-08-23）：SubAgentMiddleware 是 create_deep_agent 默认自带的，
    task 工具一直存在，但可用类型只有内建 general-purpose——「task 工具守着空气」，
    D5 = 0.3。本函数注册若干具名子代理：model 显式钉为主模型——不吃「继承主 agent
    模型」的库默认，升级时默认继承策略漂移不得悄悄改变子代理用哪个模型。

    ⚠（#2252）`build_tools(model)` 现在还返回三个具名 HITL 虚拟工具
    （`confirm_task_intent`/`fill_run_params`/`choose_execution_option`）以及
    `spawn_async_task`（#2664）——那几个不是子代理该有的能力，所以每个子代理都按
    名字显式挑选自己要用的工具，不是把 `build_tools()` 的返回值整体转发。
    新增/改名工具名单需要跟着改这里的过滤集合，不会因为忘记而静默混进子代理。

    deepagents 0.7.6 实测契约（inspect，不是猜的）：
    - SubAgent 是 TypedDict：必填 name/description/system_prompt（⚠ 是
      system_prompt 不是 prompt），可选 tools/model/middleware/...
    - 主模型触发委托的 task 工具参数形状：{"description": str, "subagent_type": str}，
      subagent_type 取 SubAgent["name"]。

    ## #2664：从「1 个具名子代理」扩到「至少 3 个」

    `task` 工具是**同步**委托——主 agent 循环阻塞等这里注册的子代理跑完才拿到结果，
    与同一个 issue 新增的 `spawn_async_task`（**异步**派发进 TS 侧队列，不阻塞主对话，
    见 `tools.py` 该函数的文档）是两种不同的委托方式，本函数只管前者，不与后者合并。
    新增 `research`（通用调研，不局限于组织技能库）与 `generic`（无特定领域倾向的
    通用任务执行）两类，与既有 `org-skill-researcher` 并列——`org-skill-researcher`
    仍是原样保留的具名调研子代理（措辞与工具集不变），不是被这两个新类型取代。

    Phase 14 F02（R6）：此前由 `DEEP_AGENT_SUBAGENTS_ENABLED=1` 这个灰度开关控制，
    验证稳定后按 R6 要求默认开启且开关本身移除——本函数现在无条件返回下面这份
    子代理清单。
    """
    # 延迟导入与 tools.py 的依赖，避免 harness 模块在无关路径上加载它。
    from deep_agent_service.tools import build_tools

    all_tools = build_tools(model)
    # #2252：只挑选调研子代理该有的两个工具，显式按名字过滤——不整体转发
    # build_tools() 的返回值（见上方模块注释）。
    org_skill_tools = [t for t in all_tools if t.name in ("list_org_skills", "call_skill")]

    return [
        {
            "name": "org-skill-researcher",
            "description": (
                "调研本组织的技能库并汇总：探查本次运行挂载了哪些组织技能、各自能做什么，"
                "把调研结论汇总成一段可直接使用的报告。凡是「有哪些技能可用/该用哪个技能/"
                "技能库现状」这类调研型任务，委托给它。"
            ),
            "system_prompt": (
                "你是组织技能库研究员。收到任务后，先用 list_org_skills 探查本次运行"
                "挂载的全部技能，必要时用 call_skill 对具体技能做试探性验证，然后把"
                "调研发现汇总成结构化结论：有哪些技能、各自适合什么任务、与任务的匹配"
                "建议。只汇报你真实探查到的内容，不要凭技能名字编造能力。"
            ),
            "tools": org_skill_tools,
            "model": model,
        },
        {
            # #2664 -- 通用调研，不局限于组织技能库（与 org-skill-researcher 的分工
            # 区别：这个不预设"调研对象是本组织的技能"，主 agent 判断某个子问题需要
            # 独立、聚焦地查清楚再汇报结论时，可以委托给它，不必先假定跟技能库有关。
            "name": "research",
            "description": (
                "针对一个具体问题做聚焦调研并给出结论：把要调研的问题想清楚、分解，"
                "依据已有信息推理出站得住脚的结论，说明结论的依据与不确定之处。适合"
                "「查清楚 X」「X 的现状/利弊是什么」这类需要独立展开、给出可直接使用"
                "结论的子任务。"
            ),
            "system_prompt": (
                "你是一名调研员。收到一个调研问题后，先把问题分解成几个需要确认的"
                "子点，依据已有信息逐一给出有依据的判断，最后汇总成一段结构清楚的"
                "结论：结论是什么、依据是什么、哪些地方还不确定。只汇报你能站得住脚"
                "推理出的内容，不要编造你无法验证的具体事实。"
            ),
            "tools": [],
            "model": model,
        },
        {
            # #2664 -- 无特定领域倾向的通用任务执行子代理，兜底"不属于调研、也不特别
            # 需要组织技能"的独立子任务——同一个 `task` 工具下三种类型分工不重叠：
            # org-skill-researcher 管技能库，research 管调研结论，generic 管其余。
            "name": "generic",
            "description": (
                "执行一个不需要特殊领域知识、可以独立完成的子任务：按给定的目标描述"
                "把工作做完，给出可直接使用的结果。不确定该委托给 org-skill-researcher"
                "还是 research 时，且任务本身不是调研类问题，用这个兜底类型。"
            ),
            "system_prompt": (
                "你是一个通用任务执行者。收到任务描述后，按要求把工作做完，给出"
                "一段可以直接使用的结果；任务描述里缺少的关键信息，在结果里明确"
                "指出缺什么，不要替用户假设未说明的内容。"
            ),
            "tools": [],
            "model": model,
        },
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
