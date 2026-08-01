/**
 * 契约束 `agent-private-chat` — F59 · UC-4.3 与单个 Agent 私聊
 *
 * `user_visible_behavior`: 「点 AI 团队里某个 agent 右侧滑出与它的独立对话并显示它挂载的
 * skill 清单与当前模型；私聊消息不进入主线程的转录/洞察/产物三栏、不计入线程消息数；
 * 把一条结论转到主线程时带完整出处（agent + skill 版本 + 时间 + 数据来源）；私聊仍受三层
 * 权限与项目级 AI 权限约束，不构成提权；私聊正文归项目层……组员默认无私聊入口，由引导师
 * 逐场开关（不跨场继承）。」
 *
 * ## 为什么是独立的一束，不并进 `chat` 或 `agent-runtime`
 *
 * 私聊是**这两束交叉之外的第三个上下文**：它引用 `chat`（转出目标是主线程）与
 * `agent-runtime`（agent / skill 挂载 / 三层权限），但它自己的失败模式（观察者无入口、
 * 组员开关未开、出处不完整）不属于任何一束已有的枚举 —— 塞进 `chat.ChatError` 或
 * `agentRuntime.AgentRuntimeError` 会让"这个错误码属于哪个上下文"失去唯一答案，
 * 与 `chat.ChatVisibility` 的 `member-private`（组员之间的人际私聊，同名不同义，
 * 见该文件头注）混淆是本仓已经吃过的同一种亏。
 *
 * ## 为什么复用而不是重定义 `SkillMount` / `ProjectRole`
 *
 * `HandoffProvenance.skillMounts` 引用 `agent-runtime.SkillMount`（同一个版本粒度事实，
 * 不重写字段）；`PrivateChatSession.initiatorRole` 引用 `identity.ProjectRole`
 * （四值：facilitator / groupLead / member / observer；O-03 已裁决协同引导师 = 引导师的
 * 多实例，不新增第五个角色）。
 */
import { z } from "zod";
import { ProjectRole } from "./identity";
import { SkillMount } from "./agent-runtime";

/**
 * 私聊失败模式全集 —— 本束独立空间。
 * ⚠ 新增须走 ADR（与 `provenance.ProvenanceEventType` 同一纪律）。
 */
export const PrivateChatError = z.enum([
  /** agent 可见性范围不覆盖当前用户 / 未登录 / 链接失效（R5 · V6）——不区分"存在但无权"与"不存在" */
  "NOT_VISIBLE",
  /** 观察者无私聊入口（R4 A1 / V5） */
  "OBSERVER_NO_ENTRY",
  /** 组员默认不可私聊，本场引导师尚未开关（已裁决 O-24 · V15） */
  "MEMBER_TOGGLE_DISABLED",
  /** 目标 agent 非「运行中」——与 `lifecycle.visibleOnSurface(agent,"private-chat")` 同一个事实 */
  "AGENT_NOT_RUNNING",
  /** 请求的工具不在三层求交范围内（V2；语义复用 F56，报告码独立） */
  "TOOL_NOT_WHITELISTED",
  /** 项目级「AI 直接在小组画布落笔」关闭时，私聊同样不能落笔（V2 / R2 步骤 2） */
  "CANVAS_WRITE_DISABLED_PROJECT_LEVEL",
  /** 转出目标线程已归档只读，转出被拒并保留私聊内容（V11 / E4） */
  "THREAD_ARCHIVED_READONLY",
  /** 转出缺 agent / skill 版本 / 时间 / 数据来源任一项（R7 / V1） */
  "INCOMPLETE_PROVENANCE",
]);

/**
 * 私聊会话的最小事实。**归项目层**（已裁决 O-24），不是个人层——
 * 转出后私聊即成为项目产出的来源，归个人层会造成审计断链（D-18）。
 */
export const PrivateChatSession = z
  .object({
    sessionId: z.string(),
    threadId: z.string(),
    projectId: z.string(),
    agentId: z.string(),
    agentVersionId: z.string(),
    initiatorId: z.string(),
    initiatorRole: ProjectRole,
    createdAt: z.string(),
  })
  .strict();

/**
 * 转出到主线程时**必须**携带的完整出处（R7 / V1 / 已裁决 O-22⑤：agent 版本锁定后
 * 私聊须写明当次使用的版本，否则事后无法回答"当时跑的是哪一版"）。
 */
export const HandoffProvenance = z
  .object({
    sourceSessionId: z.string(),
    agentId: z.string(),
    agentVersionId: z.string(),
    skillMounts: z.array(SkillMount),
    dataSources: z.array(z.string()),
    handedOffAt: z.string(),
  })
  .strict();

/**
 * 组员私聊入口的逐场开关（已裁决 O-24 · V15）。
 * ⚠ 这是**引导师在本场的显式动作**，不是角色模板的一次性默认值——
 * `enabled` 本身不携带"上一场是什么"的记忆，见 `private-chat.ts` 的
 * `resolveMemberToggleForNewSession`（恒不继承）。
 */
export const PrivateChatMemberToggle = z
  .object({
    threadId: z.string(),
    enabled: z.boolean(),
    setBy: z.string(),
    setAt: z.string(),
  })
  .strict();
