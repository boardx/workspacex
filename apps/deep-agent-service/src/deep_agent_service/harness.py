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

import os

from langchain.agents.middleware import (
    AgentMiddleware,
    ModelCallLimitMiddleware,
    SummarizationMiddleware,
    TodoListMiddleware,
    ToolCallLimitMiddleware,
    ToolRetryMiddleware,
)
from langchain_core.language_models.chat_models import BaseChatModel

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

    灰度（S1=B 纪律）：`RubricMiddleware` **无条件**挂——没有 rubric 时它逐字 no-op，
    挂上等于零行为变更，同时让任何调用方传 `rubric` 就能用上这条能力。
    而「每次退出都跑一遍默认清单」会给每次收尾多加一次 grader 模型调用（成本与延迟
    都真实变化），所以默认清单的播种由 `DEEP_AGENT_PRECOMPLETION_CHECKLIST=1` 打开；
    未设时行为与接线前逐字相同。
    """
    enabled = (os.environ.get("DEEP_AGENT_PRECOMPLETION_CHECKLIST") or "").strip() == "1"
    seed: list[AgentMiddleware] = [_DefaultCompletionChecklistMiddleware()] if enabled else []
    # max_iterations 显式钉死不吃库默认（库默认 3）——同 Summarization trigger/keep
    # 的纪律：升级时默认值漂移不得悄悄改变我们的重试预算。2 = 最多返工一次。
    return [*seed, RubricMiddleware(model=model, max_iterations=RUBRIC_MAX_ITERATIONS)]


def build_middleware(model: BaseChatModel) -> list[AgentMiddleware]:
    """rubric 驱动的 middleware 清单。顺序即挂载顺序。

    trigger/keep 显式固定而不是吃库默认——升级 deepagents/langchain 时默认值
    漂移不该悄悄改变我们的上下文策略（「同一事实不两处声明」的运行时版本）。
    """
    return [
        TodoListMiddleware(),
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


def build_interrupt_on() -> dict[str, bool] | None:
    """DA-07（#1749，rubric D6 人在环）：敏感工具调用前暂停待人批。

    `DEEP_AGENT_HITL_TOOLS`：逗号分隔的工具名列表（如 "call_skill"）。列出的工具
    在每次调用前触发 langgraph interrupt——run 停住、状态落 checkpointer，等外部用
    `Command(resume={"decisions": [{"type": "approve"|...}]})` 裁决后继续
    （0.7.6 的 HumanInTheLoopMiddleware 实测契约，四种决策类型）。

    默认未设 = 完全关闭 = 行为与 DA-07 之前逐字相同（S1=B 双轨纪律：新能力
    必须先以灰度开关存在）。⚠ 中断依赖 checkpointer——平台托管环境由平台提供；
    自托管必须同时设 DEEP_AGENT_CHECKPOINT_DB，否则 interrupt 无处落地，
    langgraph 会在运行时报错，这是正确的 fail-closed 而不是我们要吞的错。
    """
    raw = (os.environ.get("DEEP_AGENT_HITL_TOOLS") or "").strip()
    if raw == "":
        return None
    tools = [t.strip() for t in raw.split(",") if t.strip() != ""]
    return {t: True for t in tools} if tools else None


def build_subagents(model: BaseChatModel) -> list[dict] | None:
    """DA-05（#1838，rubric D5 子代理委托）：具名研究子代理，让 task 工具有真实用途。

    基线实测（2026-08-23）：SubAgentMiddleware 是 create_deep_agent 默认自带的，
    task 工具一直存在，但可用类型只有内建 general-purpose——「task 工具守着空气」，
    D5 = 0.3。本函数注册一个具名 `org-skill-researcher`：调研组织技能库并汇总，
    system_prompt 指示它先用 list_org_skills 探查、再汇总；tools 复用主图同一套
    org skills 工具（build_tools(model) 里的 `list_org_skills`/`call_skill` 两个，
    见下方按名字过滤），model 显式钉为主模型——不吃「继承主 agent 模型」的库默认，
    升级时默认继承策略漂移不得悄悄改变子代理用哪个模型。

    ⚠（#2252）`build_tools(model)` 现在还返回三个具名 HITL 虚拟工具
    （`confirm_task_intent`/`fill_run_params`/`choose_execution_option`）——那三个是
    面向主对话、需要人在环裁决的中断点语义，不是"调研组织技能库"这个子代理该有的
    能力，所以这里按名字显式挑选，不是把 `build_tools()` 的返回值整体转发。新增/
    改名工具名单需要跟着改这里的过滤集合，不会因为忘记而静默混进子代理。

    deepagents 0.7.6 实测契约（inspect，不是猜的）：
    - SubAgent 是 TypedDict：必填 name/description/system_prompt（⚠ 是
      system_prompt 不是 prompt），可选 tools/model/middleware/...
    - 主模型触发委托的 task 工具参数形状：{"description": str, "subagent_type": str}，
      subagent_type 取 SubAgent["name"]。

    灰度（S1=B 纪律）：`DEEP_AGENT_SUBAGENTS_ENABLED=1` 才启用。默认未设 → 返回
    None → create_deep_agent 收到 None 与参数默认值逐字一致，行为与之前完全相同。
    """
    if (os.environ.get("DEEP_AGENT_SUBAGENTS_ENABLED") or "").strip() != "1":
        return None
    # 延迟导入与 tools.py 的依赖，避免 harness 模块在无关路径上加载它。
    from deep_agent_service.tools import build_tools

    # #2252：只挑选调研子代理该有的两个工具，显式按名字过滤——不整体转发
    # build_tools() 的返回值（见上方模块注释）。
    org_skill_tools = [t for t in build_tools(model) if t.name in ("list_org_skills", "call_skill")]

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
        }
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
