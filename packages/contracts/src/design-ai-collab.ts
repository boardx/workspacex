/**
 * 契约束 `design-ai-collab` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份是前后端类型、运行时校验、OpenAPI 的共同来源，任何一样都不许手写第二份。
 *
 * 覆盖：**UC-17.8 Sprint 4 · B5.1 / B5.2「AI 协作」**，见
 * `phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md` §B5。
 * D7 裁决时（2026-09-02）草稿「继续完善」与设计详情对话都先用**固定回执**上线
 * （`feedback-loop.ts` 的 `REFINE_SEED_QUESTION`/`REFINE_ACK`、`design-workbench.ts` 的
 * `DESIGN_WORKBENCH_CHAT_REPLY`），AI 项后置成本束。
 *
 * ## 本文件为什么没有自己的 `operations`
 *
 * 本束**不新增任何 HTTP 路由**。它改的是两条既有操作的语义：
 *   · `feedbackLoop.updateFeedbackDraft`（追加对话时由模型生成澄清问题/回复）与
 *     `feedbackLoop.submitFeedbackDraft`（提交时由模型把对话摘要成结构化字段）——B5.1；
 *   · `designWorkbench.appendProjectChat`（模型按项目上下文回复，且可写回
 *     `problem/criteria/frames`）——B5.2。
 * 这两条操作各自的 `in`/`out`/路径继续住在各自的束文件里（单一事实源不搬家）；本文件只
 * 声明**两个束共用、且只属于「AI 协作」这个能力域**的词汇，由那两个文件 `import` 进去。
 * 把 `AiReplySource` 抄进两个文件各一份，就是本仓「同一事实声明在两处」的第六次。
 *
 * ## `AiReplySource`：这一轮是模型说的，还是退路
 *
 * 模型不可用/超时/输出解析失败时，服务端**退回 D7 的固定回执**，而不是让整个操作失败——
 * 用户这次点击的主动作是「把我这句话记下来」，那句话已经落库了，AI 没回好不该让它丢。
 * 但退路**必须如实标记，不许静默**：`source: "fallback"` 让前端能用一个小标识告诉用户
 * 「这句是固定回执，不是模型针对你说的」，也让人类复盘时分得清哪一轮模型其实没在。
 * 没有这个字段（旧记录 / 用户自己说的话）⇒ 不适用，不是「模型说的」。
 */
import { z } from "zod";
import { DesignPrototypePatch, DesignPrototypeWriteback } from "./design-prototype";

/**
 * 一条 AI 回复的来源。**只出现在 `role: "ai"` 的记录上**；`user` 记录与 B5 之前写入的旧
 * 记录都没有这个键。
 *   · `model`    —— 由模型按上下文生成。
 *   · `fallback` —— 模型不可用/超时/输出不可解析，退回固定回执（文案仍是各束自己的常量）。
 */
export const AiReplySource = z.enum(["model", "fallback"]);
export type AiReplySource = z.infer<typeof AiReplySource>;

/**
 * B5.2：设计详情对话的回复**可写回**的项目字段。闭集三值——`problem`（背景）、`criteria`
 * （验收标准）、`frames`（画布页标签文案）、`prototype`（B5.3，2026-09-06 起：每页的组件树，
 * 见 `design-prototype.ts`；写回形状是 `{frame, root}[]`，服务端拆成 `frames` + `prototype` 原子写）。
 * `name`/`template` 不在里面：那两个是 owner 在弹窗里定的身份信息，不该被一句对话改掉。
 */
export const DesignWritebackField = z.enum(["problem", "criteria", "frames", "prototype"]);
export type DesignWritebackField = z.infer<typeof DesignWritebackField>;

/**
 * B5.2：模型建议写回的形状——服务端只认能通过这份 `.strict()` 解析的字段，逐字段判：
 * 某个字段不合法 ⇒ 只丢那个字段，其余合法字段照写（`applied` 如实列出真的写了哪些）。
 * 边界与 `DesignProject` 同源：`problem` ≤ 4000；数组每项非空 ≤ 200、至少 1 项、至多 20 项
 * （空数组会把验收标准/画布页清空——一句对话不该有这个权力）。
 */
export const DesignChatWriteback = z
  .object({
    problem: z.string().min(1).max(4000).optional(),
    criteria: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
    frames: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
    /** B5.3 整页重生成：给出即替换全部页面（标签 + 树）。与 `frames` 同时给出时 `prototype` 优先——它自带标签。 */
    prototype: DesignPrototypeWriteback.optional(),
    /** 迭代 1：局部修改，按节点 id 寻址（`design-prototype.ts` `PrototypePatchOp`）。与 `prototype` 同时给出时 `prototype` 优先（整页更完整）。应用成功 ⇒ `applied` 里记 `prototype`——它是被改的项目字段。 */
    patch: DesignPrototypePatch.optional(),
  })
  .strict();
export type DesignChatWriteback = z.infer<typeof DesignChatWriteback>;

/**
 * B5.2：`appendProjectChat.out.reply`——这一轮 AI 回复的来源 + 真的写回了哪些字段。
 * 与其把「建议」返回给用户再点一次确认，这里选**直接写回 + 如实回报**：理由见
 * `design-workbench.ts` `appendProjectChat` 头注。
 */
export const DesignChatReply = z
  .object({
    source: AiReplySource,
    applied: z.array(DesignWritebackField),
  })
  .strict();
export type DesignChatReply = z.infer<typeof DesignChatReply>;
