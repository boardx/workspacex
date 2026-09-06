"""The dynamic, org-scoped tools (#739 -- architecture decided in #738), plus the three
named virtual HITL tools from the `agent-interrupts` contract bundle (issue #2252).

## #2252 -- `confirm_task_intent` / `fill_run_params` / `choose_execution_option`

`packages/contracts/src/agent-interrupts.ts` is the single source of truth for these three
tool names and their initial-call arg shapes (`ConfirmIntentArgs` / `FillParamsArgs` /
`ChooseOptionArgs`) -- that file's header explicitly deferred the Python `@tool` bodies as
"the next feature, out of scope for this issue"; this is that next feature.

Same architectural shape as `call_skill` (issue #2017's own conclusion): `interrupt_on`
(`harness.py::build_interrupt_on`) is only a "should this tool name pause before running"
switch -- the model can only call tools that are REALLY registered in the `tools` list
handed to `create_deep_agent`. Listing these three names in
`harness.py::DEFAULT_HITL_TOOL_NAMES` without a matching `@tool` here would keep the cards
permanently unreachable, exactly the gap #2252 was filed to close.

### Why every parameter below is `| None` (not the contract's required shape)

`HumanInTheLoopMiddleware` (0.7.6, `human_in_the_loop.py:429`, confirmed against the vendored
source, same as `deep-agent-hitl.ts`'s own citation) intercepts the tool call BEFORE this
function body ever runs, and re-invokes the SAME underlying function once a decision resumes
the run:

- `approve` -- resumes with the ORIGINAL proposed args verbatim (`decide-agent-run.ts`'s
  `approveAndRequeue` path never touches `editedArgs`) -- e.g. `confirm_task_intent` gets its
  full `{requestId, understanding, assumptions}` back.
- `edit` -- resumes with `edited_action.args` set to the DECISION's `editedArgs`, which is
  a narrower, DIFFERENT shape than the tool's own initial-call args (by contract design,
  confirmed in `packages/contracts/src/agent-interrupts.ts` and consumed by
  `apps/api/src/application/agent-interrupts/{fill-params,choose-option}-decision.ts`):
  `ConfirmIntentDecision.editedArgs = {assumptions}` (no `understanding`/`requestId`),
  `FillParamsDecision.editedArgs = {fields: [{name, value}]}` (not the full `ParamField`
  shape with `aiGuess`/`rationale`/...), `ChooseOptionDecision.editedArgs =
  {selectedOptionId}` (no `requestId`/`options` at all).
- `choose_execution_option` never receives `approve` at all -- its contract only allows
  `edit`/`reject` (`CHOOSE_OPTION_ALLOWED_DECISIONS`), and `reject` never re-invokes the
  tool (the run fails with `HITL_REJECTED` instead, same as any other rejected HITL tool).

So each function below has to tolerate being called with either its full initial shape
(the `approve` path) or a reduced edited shape (the `edit` path) -- optional keyword
parameters with the body branching on which fields are actually present is how that is
made possible without a second, parallel "edited" tool definition. The docstring on each
function (what the MODEL reads) still documents the full initial-call contract shape,
since that is the only shape the model itself is ever expected to supply.

## Why two GENERIC tools instead of one tool per Skill

The TS tool loop being replaced (`apps/api/src/application/agent-run/tool-definitions.ts`)
registers ONE tool per pinned Skill, because that loop is built fresh, in-process, for
every single run. A `deepagents` graph served via `langgraph dev` is the opposite shape:
one process, one `langgraph.json`, one `create_deep_agent(...)` call at import time -- and
an organization's Skill set is runtime data that changes independently of this process's
lifecycle. Baking one tool per Skill into the graph at import time would mean either
restarting this service every time any org's Skills change, or serving a fixed Skill list
that quietly drifts from what `skills`/`skill_versions` actually holds. Neither is
acceptable, so the tool SET is static (`list_org_skills`, `call_skill`) and the Skill DATA
is dynamic, carried per-run through `RunnableConfig["configurable"]["org_skills"]` -- the
caller (`apps/api`'s `DeepAgentModelProvider`, #740) puts the run's already-pinned Skill
list there when it creates the thread/run, exactly the same list `readPinnedSkills` already
resolved for the TS path. This service never queries workspacex's own database for Skill
content, matching the existing `open_deep_research` integration's discipline of staying a
standalone service with no direct DB access (see #738's investigation).

## Why `call_skill` makes a REAL model call, not a canned response

Same requirement the human's task description states explicitly for the TS version it
replaces: "语义要和刚被替换掉的 TS 版本等价（拿 skill 内容当 system prompt 发起真实模型
调用，返回真实结果，不是编造）". This mirrors `execute-run.ts`'s `executeSkillTool`
one-for-one: a SEPARATE, focused model call whose system prompt is only that Skill's
content, task text as the user turn, real response returned.

## #1747 -- that focused call may now answer with a SCRIPT, and the caller executes it

"A real model call" turned out not to be enough for a Skill whose whole point is producing
a FILE (a .pptx, say). Measured, in the deployment's own database: three consecutive runs
with a Skill pinned recorded one pinned Skill and ZERO output files, one of them with a
terminal status of `succeeded` -- so not a timeout, this path simply never produced a file.
The reason is that this tool returned prose, and prose is not a deck.

The fix keeps every boundary this file's header already defends. When the caller tells us a
sandbox stands behind this run, it sends the run-script protocol as per-run config and this
tool appends it to the focused call's system prompt; whatever that call answers is returned
VERBATIM, and the caller pulls the script block out of this tool's result and executes it on
its own side. This service still never touches a sandbox, a socket, or a database -- it
gains no new capability at all, it just stops flattening an executable answer into prose.

A run with no `script_protocol` in its config behaves byte-for-byte as it did before #1747. A failure (skill not found,
model call raises) becomes a result TEXT the orchestrating deep agent can see and react
to -- never an exception that aborts the whole run, same discipline `executeSkillTool`'s
own doc comment describes ("Never throws").
"""
from __future__ import annotations

import json

import logging
from typing import Annotated, Callable, TypedDict

import httpx
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool

_logger = logging.getLogger(__name__)


class OrgSkill(TypedDict):
    stable_name: str
    name: str
    content: str


def _read_org_skills(config: RunnableConfig) -> list[OrgSkill]:
    configurable = (config or {}).get("configurable") or {}
    skills = configurable.get("org_skills") or []
    # Tolerant of a malformed/missing entry (a caller bug elsewhere should not crash this
    # tool) -- same "never throw, degrade to an explainable result" discipline as the rest
    # of this file.
    return [
        s for s in skills
        if isinstance(s, dict) and isinstance(s.get("stable_name"), str) and isinstance(s.get("content"), str)
    ]


def _read_script_protocol(config: RunnableConfig) -> str | None:
    """#1747 -- the run-script protocol text, supplied by the calling API per run.

    Absent (the default) means this run has no sandbox behind it, so `call_skill` behaves
    exactly as it did before #1747. The protocol TEXT is never authored here: the regex that
    parses a script block out of a reply lives on the TypeScript side, in
    `run-script-with-retries.ts`, and a second copy of the prose describing that regex is the
    "same fact declared in two places" drift this repository has been bitten by five times.
    The caller sends it, this side forwards it verbatim.
    """
    configurable = (config or {}).get("configurable") or {}
    protocol = configurable.get("script_protocol")
    return protocol if isinstance(protocol, str) and protocol.strip() != "" else None


def _find_skill(skills: list[OrgSkill], stable_name: str) -> OrgSkill | None:
    for skill in skills:
        if skill["stable_name"] == stable_name:
            return skill
    return None


class SubtaskCallback(TypedDict):
    base_url: str
    key: str
    org_id: str
    parent_run_id: str


def _read_subtask_callback(config: RunnableConfig) -> SubtaskCallback | None:
    """#2664 -- 从 `configurable` 里取出 `spawn_async_task` 需要的四样东西：TS 侧
    `POST /internal/subtask-runs` 的基础地址、鉴权用的共享密钥、以及本次调用属于哪个
    org/父 run（`deep-agent-model-provider.ts::createRun` 写进去的
    `subtask_callback_base_url`/`subtask_callback_key`/`org_id`/`parent_run_id`，
    见该文件同一处的注释）。四者任一缺席都返回 `None`——`spawn_async_task` 据此判断
    "这次运行没有配好异步派发通路"，走诚实降级分支，不是这个函数该处理的场景。
    """
    configurable = (config or {}).get("configurable") or {}
    base_url = configurable.get("subtask_callback_base_url")
    org_id = configurable.get("org_id")
    parent_run_id = configurable.get("parent_run_id")
    if not isinstance(base_url, str) or base_url.strip() == "":
        return None
    if not isinstance(org_id, str) or org_id.strip() == "":
        return None
    if not isinstance(parent_run_id, str) or parent_run_id.strip() == "":
        return None
    key = configurable.get("subtask_callback_key")
    return {
        "base_url": base_url.rstrip("/"),
        "key": key if isinstance(key, str) else "",
        "org_id": org_id,
        "parent_run_id": parent_run_id,
    }


# issue #2842（2026-09-06 本地真栈实测，qwen3.8-max）：模型给三个 HITL 虚拟工具的数组
# 参数偶尔是**一个 JSON 字符串**（`assumptions: "[\"…\", \"…\"]"`）。原签名 `list[str]`
# 让 langchain 在 approve/resume 时校验失败——ToolMessage 变成
# "Error invoking tool 'confirm_task_intent' with kwargs …"，模型据此再调一次同样形状的
# confirm_task_intent，再中断、再确认……用户点了「继续」永远走不出去。签名放宽到
# `list | str`，进来先解一层；解不出的按原值处理（空 ⇒ 走各自的"没有收到有效…"分支）。
def _coerce_list(value: object) -> list | None:
    if value is None:
        return None
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("["):
            try:
                parsed = json.loads(text)
            except ValueError:
                parsed = None
            if isinstance(parsed, list):
                return parsed
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        return lines or None
    return None



def build_tools(model: BaseChatModel) -> list[Callable[..., str]]:
    """Bind the two tools to a concrete chat model (dependency injection, not a module-level
    singleton) -- this is what makes `tools.py` testable without a real `deepagents`/network
    dependency: tests pass a fake `BaseChatModel` and inspect what `call_skill` sends it.
    """

    @tool
    def list_org_skills(config: RunnableConfig) -> str:
        """列出本次运行可用的技能（组织已导入、已 pin 到这次对话的技能），每项包含技能的
        工具名（调用 call_skill 时要用的 skill_stable_name）和人类可读名称。调用其他工具
        之前，先用这个看看有哪些技能可用。"""
        skills = _read_org_skills(config)
        if not skills:
            return "本次运行没有挂载任何技能，直接依靠已有知识回答即可。"
        lines = [f"- {s['stable_name']}：{s['name']}" for s in skills]
        return "\n".join(lines)

    @tool
    def call_skill(skill_stable_name: str, task: str, config: RunnableConfig) -> str:
        """调用一个已挂载的技能，让它针对给定任务真正执行一次并返回结果——不是复述这个
        技能会做什么，而是把任务交给它去做。`skill_stable_name` 必须是 list_org_skills
        返回过的工具名之一；`task` 要写清这个技能需要知道的全部上下文，描述得越具体，
        结果越可用。"""
        skills = _read_org_skills(config)
        skill = _find_skill(skills, skill_stable_name)
        if skill is None:
            return (
                f"未知技能「{skill_stable_name}」：本次运行挂载的技能里没有这一个，"
                "先调用 list_org_skills 看看有哪些，或直接根据已有信息回答。"
            )
        # #1747 -- when the caller tells us a sandbox is behind this run, the focused call
        # this tool makes must be allowed to answer with an EXECUTABLE script block rather
        # than prose about one. Appended AFTER the skill body, never before: the skill's own
        # instructions stay in charge, this only adds a capability statement -- the same
        # ordering discipline the TypeScript side uses when it appends the identical text to
        # its own system prompt.
        protocol = _read_script_protocol(config)
        system_prompt = (
            skill["content"] if protocol is None
            else f"{skill['content']}\n\n---\n\n{protocol}"
        )
        try:
            response = model.invoke(
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": task},
                ]
            )
            text = (response.content if isinstance(response.content, str) else str(response.content)).strip()
            if text == "":
                raise ValueError("skill tool call returned empty content")
            return text
        except Exception:
            # The provider's own error text stays server-side (same discipline
            # `ModelCallError`/`executeSkillTool` use on the TS side) -- the orchestrating
            # deep agent only sees that the call failed, not why.
            return f"技能「{skill['name']}」执行失败。"

    @tool
    def confirm_task_intent(
        requestId: str | None = None,
        understanding: str | None = None,
        assumptions: list[str] | str | None = None,
    ) -> str:
        """当用户的请求存在歧义、缺少关键上下文，或你需要依赖若干未经确认的假设才能
        继续时，调用这个工具向用户复述你对任务的理解，并列出你依赖的真实假设（可以为零条或一条，不要编造），
        等待用户确认或修改这些假设后再继续执行。`requestId` 用一个新的唯一字符串标识
        本次确认请求；`understanding` 是你对任务目标的复述；`assumptions` 是你为了完成
        任务而依赖的真实假设清单（允许零条或一条，每条都要具体、可核实）。不要在用户已经把目标
        说得很清楚、且不需要额外假设时调用这个工具——那只会制造不必要的等待。"""
        # 空数组是合法的“没有额外假设”；缺少数组仍是损坏的恢复载荷。
        parsed = _coerce_list(assumptions)
        if parsed is None or any(not isinstance(a, str) or not a.strip() for a in parsed):
            return "没有收到有效的假设清单，无法确认任务目标，请提供真实假设数组（可以为空）。"
        assumptions = parsed
        if understanding is not None:
            # approve 路径：resume 时原样收到完整的初始提案。
            return (
                f"用户已确认对任务的理解：{understanding}。"
                f"确认的假设：{'；'.join(assumptions) if assumptions else '无额外假设'}。请据此继续执行任务。"
            )
        # edit 路径：resume 只带回了改过的 assumptions（`ConfirmIntentDecision.editedArgs`
        # 不含 understanding/requestId，见本文件头部说明）。
        return f"用户修改了假设为：{'；'.join(assumptions) if assumptions else '无额外假设'}。请据此继续执行任务，不要再使用你最初提出的假设。"

    @tool
    def fill_run_params(
        requestId: str | None = None,
        fields: list[dict] | str | None = None,
    ) -> str:
        """当继续执行任务需要若干运行参数、但用户尚未提供全部取值时，调用这个工具列出
        需要补全的每个参数——包括你对该参数的 AI 猜测值（没有把握就填 null）、给出这个
        猜测的依据、该参数是否必填、以及当前已知值，交给用户逐项确认或修改，然后再继续
        执行。`requestId` 用一个新的唯一字符串标识本次请求；`fields` 是参数字段清单，
        每项包含 `name`（参数名）、`label`（人类可读标签）、`aiGuess`（你的猜测值，
        没把握则为 null）、`rationale`（给出该猜测的依据，`aiGuess` 非 null 时必须提供）、
        `required`（是否必填）、`currentValue`（当前已知值，没有则为 null）。不要在所有
        必填参数已经明确时调用这个工具。"""
        fields = _coerce_list(fields)
        if not fields:
            return "没有收到需要补全的参数字段，无法继续，请重新列出参数字段后再次调用。"
        resolved: list[str] = []
        for field in fields:
            if not isinstance(field, dict):
                continue
            name = field.get("name", "?")
            if "value" in field:
                # edit 路径：resume 只带回了 {name, value} 精简形状
                # （`FillParamsDecision.editedArgs.fields`，不是完整的 ParamField）。
                resolved.append(f"{name}={field.get('value')!r}")
            else:
                # approve 路径：resume 原样收到完整 ParamField，采纳 AI 猜测
                # （没有猜测时退回当前已知值）。
                guess = field.get("aiGuess")
                current = field.get("currentValue")
                resolved.append(f"{name}={guess if guess is not None else current!r}")
        if not resolved:
            return "参数字段格式无法识别，无法继续，请重新列出参数字段后再次调用。"
        return "参数已确认：" + "，".join(resolved) + "。请据此继续执行任务。"

    @tool
    def choose_execution_option(
        requestId: str | None = None,
        options: list[dict] | str | None = None,
        selectedOptionId: str | None = None,
    ) -> str:
        """当完成任务存在多个（2-3 个）可行方案、且各方案在投入/见效时间/预期收益上有
        实质差异时，调用这个工具把方案摆出来交给用户对比选择，不要替用户擅自决定。
        `requestId` 用一个新的唯一字符串标识本次请求；`options` 是 2 到 3 个方案卡片，
        每项包含 `optionId`（方案唯一标识）、`title`（方案标题）、`effort`（投入：
        低/中/高）、`timeToValue`（预计见效时间）、`expectedReturn`（预期收益）。
        只有一个可行方案、或方案之间没有实质取舍时，不要调用这个工具。"""
        if not selectedOptionId:
            # 唯一能真正走到这里执行的路径是 edit（见本文件头部说明：这个工具没有
            # approve 分支，reject 从不重新调用工具），selectedOptionId 缺失说明
            # resume 载荷不合法。
            return "没有收到用户选择的方案，无法继续，请重新列出可选方案后再次调用。"
        chosen_title = selectedOptionId
        options = _coerce_list(options)
        if options:
            for option in options:
                if isinstance(option, dict) and option.get("optionId") == selectedOptionId:
                    chosen_title = option.get("title", selectedOptionId)
                    break
        return f"用户选择了方案「{chosen_title}」，请据此继续执行任务，不要再考虑其它方案。"

    @tool
    def spawn_async_task(description: str, config: RunnableConfig,
                         tool_call_id: Annotated[str, InjectedToolCallId],
                         context: str | None = None) -> str:
        """把一个可以独立并行处理的子任务派发出去，**不等待它跑完**——调用后立即返回
        「已派发」，你应该继续处理主对话的其它部分或直接回复用户，不要停下来等这个子任务
        的结果。适合用在：一次请求里能拆出多个互不依赖、可以同时进行的子任务时，把每个
        子任务分别派发一次。`description` 要写清楚这个子任务的目标，写得越具体，子任务
        执行时越不会跑偏；`context` 可选，补充子任务需要知道的背景信息（例如父任务已经
        确认的事实、用户提到的约束）。

        与 `task` 工具的区别：`task` 是**同步**委托给一个具名子代理，调用方要等它跑完才
        拿到结果，适合"这一步必须先有子代理的结论才能继续"的场景；这个工具是**异步**
        派发进后台队列，不阻塞当前对话，适合"这几个子任务可以各自独立跑，我不需要现在
        就知道结果"的场景——两者是两种不同的委托方式，不要混用。

        没有配置好异步派发通路时（本次运行的部署未开启这项能力），会诚实告诉你派发失败，
        而不是假装派发成功——遇到这种情况，改用 `task` 或自己继续处理这个子任务，不要
        当作它已经在后台跑了。"""
        callback = _read_subtask_callback(config)
        if callback is None:
            return (
                "无法派发异步子任务：本次运行没有配置好异步派发通路"
                "（缺少 subtask_callback_base_url/org_id/parent_run_id 之一）。"
                "请改用 task 工具委托给具名子代理，或自己继续处理这个子任务。"
            )
        payload = {
            "orgId": callback["org_id"],
            "parentRunId": callback["parent_run_id"],
            "description": description,
            "context": context,
            "idempotencyKey": tool_call_id,
        }
        headers = {"content-type": "application/json"}
        if callback["key"] != "":
            headers["x-deep-agent-internal-key"] = callback["key"]
        try:
            response = httpx.post(
                f"{callback['base_url']}/internal/subtask-runs",
                json=payload,
                headers=headers,
                timeout=10.0,
            )
            response.raise_for_status()
            body = response.json()
            subtask_run_id = body.get("subtaskRunId") if isinstance(body, dict) else None
            if not isinstance(subtask_run_id, str) or not subtask_run_id.strip():
                raise ValueError("Missing subtask run identifier")
        except Exception as exc:  # noqa: BLE001 -- 同 call_skill 的纪律：错误不冒泡阻断主循环
            _logger.warning("spawn_async_task 派发失败：%s: %s", type(exc).__name__, exc)
            return f"派发子任务失败（{type(exc).__name__}），未能加入后台队列，请改为同步处理这个子任务。"
        return (
            f"子任务已派发（subtaskRunId={subtask_run_id}），正在后台异步执行，"
            "不需要等待它完成，请继续处理对话的其它部分。"
        )

    # Phase 14 F02（R6）：`spawn_async_task` 此前由 `DEEP_AGENT_ASYNC_SUBTASKS_ENABLED=1`
    # 这个灰度开关控制是否注册进主图的工具清单（#2664）——`graph.py` 把
    # `build_tools(_model)` 的返回值**整体**、无条件地传给
    # `create_deep_agent(tools=...)`（不像 `build_subagents` 那样按名字挑选转发），
    # 验证稳定后按 R6 要求默认开启且开关本身移除，现在无条件注册。
    return [
        list_org_skills,
        call_skill,
        confirm_task_intent,
        fill_run_params,
        choose_execution_option,
        spawn_async_task,
    ]
