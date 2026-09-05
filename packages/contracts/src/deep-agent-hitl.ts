/**
 * deep-agent 人在环（HITL）审批 —— **工具名与参数形状的唯一事实源**（issue #2017）。
 *
 * ## 这个模块为什么存在
 *
 * 在它之前，"哪个工具需要人批、它的参数长什么样"这件事被声明在**三个**互不相干的地方：
 *
 * | 声明处 | 值 | 后果 |
 * |---|---|---|
 * | `apps/web/components/chat/copilotkit-v2-panel.tsx` 的 `APPROVAL_TOOL_NAME` | `"send_email"` | 前端只认这个名字 |
 * | `apps/api/scripts/loopback-deep-agent-provider.ts` 的 `APPROVAL_TOOL_NAME` | `"send_email"` | e2e 替身发这个名字 ⇒ **e2e 恒绿** |
 * | 引擎 `DEEP_AGENT_HITL_TOOLS`（`deep_agent_service/harness.py` 的 `build_interrupt_on`） | 真实工具名 | 生产发真实名字 ⇒ **生产恒红** |
 *
 * `send_email` 在 `apps/deep-agent-service` 全树 grep 零命中——它从来只是替身自己的剧本。
 * 前两处对齐、第三处对不上，于是「替身绿、真实引擎红」，而且是**静默**红：名字对不上时
 * CopilotKit 的 `useHumanInTheLoop` 不认领这次工具调用，把它渲染成普通工具卡，`respond`
 * 恒为 `undefined`，三个决策按钮永远不出现，run 停在 `awaiting_tool_permission` 无人能裁决。
 * 这正是 `DEEP_AGENT_HITL_TOOLS` 此前**故意不敢打开**的原因：打开比不打开更糟。
 *
 * 本仓已五次因「同一事实声明在两处」而漂移（见本包 `index.ts` 头注与 ADR-020）。这是
 * 第六次的现场，所以修法不是"把 `send_email` 换成 `call_skill`"——那只是把写死的错名字
 * 换成写死的对名字，第七次漂移的种子。修法是：**名字与参数形状只在本文件声明一次**，
 * 上面三处全部从这里派生。
 *
 * ## 派生关系（改这里 = 改全部；不许在别处再写一份）
 *
 * - 前端审批对话框注册：`copilotkit-v2-panel.tsx` 从这里 import 名字与 `parameters`。
 * - e2e 确定性替身：`loopback-deep-agent-provider.ts` 从这里 import 名字，**不再有
 *   `?? "send_email"` 兜底**——替身与真实引擎必须发同一个名字，否则 e2e 绿而生产红。
 * - 部署开关：`DEEP_AGENT_HITL_TOOLS_ENV_VALUE` 就是 deploy.env 里该键应有的**逐字**值，
 *   由 `deploy.sh` 的 `deep_agent_project_capability_env` 投影进容器（PR #2077）。
 *
 * ## 跨语言这一段没法靠 import，靠门控
 *
 * 工具本身是 Python 侧定义的（`deep_agent_service/tools.py` 的 `@tool def call_skill`），
 * TypeScript 无法 import 它。这条边界由 `tests/deep-agent-hitl.test.ts` 直接读那个 `.py`
 * 文件断言函数名与参数名逐字一致来守——Python 侧改了名字而这里没跟，测试会红。
 * **没有脚本的规范条目视为未落地**（根 AGENTS.md），所以这条跨语言约定必须是会红的东西。
 */
import { z } from "zod";

/**
 * 引擎真实会中断在其上的工具名，逐字等于 `deep_agent_service/tools.py` 里
 * `@tool def call_skill(...)` 的函数名（langchain 的 `@tool` 以函数名作工具名）。
 *
 * 为什么是 `call_skill` 而不是别的：`build_tools()` 全树只注册两个工具——
 * `list_org_skills` 是只读枚举、无副作用，拦它只会平白多一次点击；`call_skill` 是唯一
 * **真正执行一个技能**、有副作用语义的工具。（`write_todos` 不是本仓注册的，是
 * deepagents `TodoListMiddleware` 的内建规划记账工具，同样不该挡人。）
 *
 * 这个选择与引擎侧已有的黄金用例逐字一致：
 * `apps/deep-agent-service/tests/golden/test_tc2_sensitive_skill_hitl.py` 已经用
 * `DEEP_AGENT_HITL_TOOLS=call_skill` 断言中断成立，并带了"不设就不中断"的反证。
 * ⇒ 引擎侧不需要改一行代码。
 */
export const DEEP_AGENT_HITL_TOOL_NAME = "call_skill" as const;

/**
 * `call_skill` 的真实参数形状，逐字对应 `tools.py` 的
 * `def call_skill(skill_stable_name: str, task: str, config: RunnableConfig)`。
 *
 * `config` 不在这里：它是 langchain 注入的 `RunnableConfig`，不进模型看到的 schema，
 * 也不会出现在事件流的 args 里。
 *
 * ⚠ 与被它取代的 `{to, subject, body}`（`send_email` 的形状）完全无关——那三个字段
 * 在真实引擎里不存在，审批卡照着它渲染时只会显示三个空字段。
 */
export const DeepAgentHitlToolArgs = z.object({
  /** 要调用的技能的稳定工具名，必须是 `list_org_skills` 返回过的其中之一。 */
  skill_stable_name: z.string(),
  /** 交给该技能执行的任务描述。自由文本，**可以很长**——见下面 `ARGS_MAX_CHARS` 那段。 */
  task: z.string(),
});

export type DeepAgentHitlToolArgs = z.infer<typeof DeepAgentHitlToolArgs>;

/**
 * 待批工具的 args 在事件流上**不允许被截断**时所需的字符上限。
 *
 * 背景（这是"改完名字仍然不通"的第二个坑，issue #2017 的认领评论 ② ）：桥发给前端的
 * `TOOL_CALL_ARGS` delta 是 `step.toolArgsSummary`
 * （`copilotkit-agui.controller.ts` 的 `writeToolCallStep`），其产地是
 * `deep-agent-model-provider.ts` 的
 * `summarizeProgressText(JSON.stringify(call.args), maxChars)`，默认
 * `PROGRESS_SUMMARY_MAX_CHARS = 500`，**超长会在尾部接一个 `…`**。
 *
 * 那段代码当时的注释原话是"其他工具……argsSummary 是给人读的摘要，不是给程序解析的
 * 数据"——这个前提对普通工具成立，但 `call_skill` 一旦进入 HITL 就**不再成立**：审批卡
 * 要显示真实参数、edit 决策要把参数改了再提交，两件事都必须 `JSON.parse` 这个 delta。
 * 而 `call_skill` 的 `task` 按其 docstring 就是"要写清这个技能需要知道的全部上下文"的
 * 自由文本，天然会超过 500 字符 ⇒ 截断成非法 JSON ⇒ 审批卡在**真实长任务上**坏掉，
 * 而**短任务的 e2e 全绿**。这正是本仓"全绿但空转"的形态，所以它有独立的会红用例。
 *
 * 取 4000 与 `write_todos` 已有的豁免同一档（那条豁免的理由逐字相同：参数是结构化数据、
 * 要被前端 `JSON.parse`）。不取无上限：DB 列虽是 text 无约束，但事件流上的单帧仍应有界。
 */
export const DEEP_AGENT_HITL_ARGS_MAX_CHARS = 4000;

/**
 * 这个工具名在 `harness.py` 固定的 `DEFAULT_HITL_TOOL_NAMES` 清单里贡献的那一项。
 *
 * Phase 14 F02（R6）之前，这里曾是 deploy.env 里 `DEEP_AGENT_HITL_TOOLS` 应有的
 * **逐字**值，由 `deploy.sh` 的 `deep_agent_project_capability_env` 投影进容器、
 * `harness.py` 的 `build_interrupt_on` 按逗号分隔解析。该开关已验证稳定，按 R6
 * 要求默认开启且开关本身移除——`build_interrupt_on` 现在无条件返回
 * `DEFAULT_HITL_TOOL_NAMES` 这份固定清单（不再读任何环境变量），本常量与
 * `agent-interrupts.ts` 的 `AGENT_INTERRUPTS_HITL_TOOLS_ENV_VALUE` 仍然是两个文件
 * 各自工具名的单一事实源，只是消费方从"部署脚本拼接环境变量"变成"跨语言门控测试
 * 断言 Python 常量包含这个值"（见 `deep-agent-hitl.test.ts`）。
 */
export const DEEP_AGENT_HITL_TOOLS_ENV_VALUE = DEEP_AGENT_HITL_TOOL_NAME;
