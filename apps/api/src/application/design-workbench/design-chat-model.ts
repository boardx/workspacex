/**
 * UC-17.8 B5.2 —— 设计详情「设计协作」对话的模型端口 + 唯一实现 `ModelDesignChatReplier`。
 *
 * 同 B5.1 的 `feedback/drafts/draft-refine-model.ts`：走 `ModelCallPort.complete` + 固定的
 * `FeedbackStructureModelConfig`（同一个部署级"标准单次补全" provider/model，不为设计对话再
 * 配一套——它们是同一类元任务），**不走** agent-run，**不传 `threadId`**。取舍见
 * `phases/phase-03-reuse-and-governance/contracts/design-ai-collab/domain.md` §3。
 *
 * ## 「每项目独立 thread」怎么落地
 *
 * 上下文只喂**本项目**的五个字段 + 本项目完整 `chat[]`（`design_project_chat_messages` 按
 * `project_id` 隔离，单一事实源）。thread 的身份就是 `projectId`，不另造 id、不在远端再存一份。
 *
 * ## 输出：一句回复 + 可选写回
 *
 * 要求模型只输出一个 JSON：`{"reply": "...", "writeback": {"problem"?, "criteria"?, "frames"?}}`。
 * `writeback` 经契约 `DesignChatWriteback` **逐字段**严格解析：某个字段不合法只丢那个字段。
 * 整段不是 JSON ⇒ 把整段非空输出当回复文字（模型只是没按格式说话，话本身还是它说的），
 * 不写回。模型不可用/超时/空输出 ⇒ 退回 `DESIGN_WORKBENCH_CHAT_REPLY`、`source: "fallback"`，不抛。
 */
import { designAiCollab, designPrototype, designWorkbench } from "@repo/contracts";
import type { z } from "zod";
import type { ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";
import type { FeedbackStructureModelConfig } from "../feedback/structure-feedback-draft";
import type { DesignProjectRow } from "./project-ports";

export type AiReplySource = z.infer<typeof designAiCollab.AiReplySource>;
export type DesignChatWriteback = z.infer<typeof designAiCollab.DesignChatWriteback>;

/**
 * 每轮回复的硬超时。B5.2 时是 30s（「用户在等一句话」）；B5.3 起模型可能整页重生成多页组件树，
 * 输出是数千字的 JSON，实测标准补全 30s 不够——放宽到 90s。前端发送中禁用输入框并显示进度。
 */
export const DESIGN_CHAT_REPLY_TIMEOUT_MS = 90_000;

/** 模型看到的项目上下文：六个字段 + 本项目完整历史（**已含**这次的用户消息）。 */
export type DesignChatContext = Pick<DesignProjectRow, "name" | "template" | "problem" | "criteria" | "frames" | "prototype" | "chat">;

export interface DesignChatReplyResult {
  readonly text: string;
  readonly source: AiReplySource;
  /** 逐字段解析后**合法**的写回；没有 ⇒ `{}`。 */
  readonly writeback: DesignChatWriteback;
}

export interface DesignChatModel {
  reply(ctx: DesignChatContext): Promise<DesignChatReplyResult>;
}

export interface ModelDesignChatReplierDeps {
  readonly model: ModelCallPort;
  readonly chatModel: FeedbackStructureModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

export const DESIGN_CHAT_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计协作助手，像一个能直接画原型的设计师。用户（产品经理）在和你讨论一个设计项目：" +
  "问题背景、验收标准、以及原型画布。你的任务是顺着用户说的话把设计推进一步：先用一两句话回应，必要时更新项目字段。" +
  "只输出一个 JSON 对象，不要解释、不要 markdown 代码块标记，形如 " +
  '{"reply":"给用户看的回复，中文，不超过 200 字","writeback":{"problem":"改写后的问题背景（可选）",' +
  '"criteria":["完整的验收标准列表（可选，给出即整体替换）"],' +
  '"prototype":[{"frame":"页标签","root":{组件树}}]}}。' +
  "还没有原型（当前原型为空数组）、用户首次描述要做的产品、要求新增页面、或要求整页重画/重排时，给 prototype：" +
  "把**全部页面**完整给出（整页替换，没提到的页也要原样给回），每页一个 {frame, root}，页数 1–20。" +
  "已有原型且只是局部改动（改文案/加删一块/调属性）时**不要**给 prototype，用 writeback.patch（见下）。" +
  "只改页面标签不改内容时用 writeback.frames（完整标签列表）。" +
  designPrototype.PROTOTYPE_SCHEMA_GUIDE + " " + designPrototype.PROTOTYPE_PATCH_GUIDE +
  " 原型要体现真实内容与交互意图（真实的文案、按钮、输入框、列表项），不要用占位符文字。" +
  "writeback 只在用户这句话确实要求或明显蕴含改动时才给，且只给要改的键；不改就省略 writeback。不要编造用户没说的需求。";

function describeProject(ctx: DesignChatContext): string {
  const lines = [
    `项目名称：${ctx.name}`,
    `模板：${ctx.template}`,
    `问题背景：${ctx.problem.trim() === "" ? "（还没写）" : ctx.problem}`,
    `验收标准：${JSON.stringify(ctx.criteria)}`,
    `画布页标签：${JSON.stringify(ctx.frames)}`,
    `当前原型（按页，与标签同序；每个节点带 id 供 patch 寻址；空数组 = 还没生成）：${JSON.stringify(ctx.prototype)}`,
    "对话记录（按时间顺序，最后一条是用户刚说的）：",
  ];
  if (ctx.chat.length === 0) lines.push("（还没有对话）");
  for (const t of ctx.chat) lines.push(`${t.role === "user" ? "用户" : "助手"}：${t.text}`);
  return lines.join("\n");
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no JSON object found in model output");
  return JSON.parse(text.slice(start, end + 1));
}

/** 逐字段过契约：不合法的字段丢掉，其余保留（契约 `DesignChatWriteback` 头注逐字）。 */
export function parseWriteback(raw: unknown, log?: (message: string, detail: Record<string, unknown>) => void): DesignChatWriteback {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  // 迭代 1：按写回**形状**的键遍历（含 `patch`），不是按 `DesignWritebackField`（那是被改的项目字段，
  // `patch` 改的是 `prototype`，`applied` 里记后者）。
  for (const field of Object.keys(designAiCollab.DesignChatWriteback.shape) as (keyof DesignChatWriteback)[]) {
    const value = (raw as Record<string, unknown>)[field];
    if (value === undefined) continue;
    // B5.3：`prototype` 是递归 schema，几千层嵌套会在 safeParse 里打爆调用栈，而契约的深度上限
    // 在递归解析之后才判——先用迭代探测把超深的原始值挡在外面（契约 `rawPrototypeDepth` 头注）。
    if (field === "prototype" && Array.isArray(value) && value.some((s) => rawScreenTooDeep(s))) {
      log?.("design chat: writeback field rejected by contract, skipped", { field, reason: "depth" });
      continue;
    }
    let parsed: ReturnType<typeof designAiCollab.DesignChatWriteback.safeParse>;
    try {
      parsed = designAiCollab.DesignChatWriteback.safeParse({ [field]: value });
    } catch (e) {
      // 兜底：解析本身抛（而不是返回 success:false）也只丢这个字段，不让整次对话 500。
      log?.("design chat: writeback field parse threw, skipped", { field, detail: e instanceof Error ? e.message : "unknown" });
      continue;
    }
    if (parsed.success) out[field] = parsed.data[field];
    else log?.("design chat: writeback field rejected by contract, skipped", { field });
  }
  return out as DesignChatWriteback;
}

function rawScreenTooDeep(screen: unknown): boolean {
  const root = screen !== null && typeof screen === "object" ? (screen as { root?: unknown }).root : undefined;
  return designPrototype.rawPrototypeDepth(root) > designPrototype.PROTOTYPE_MAX_DEPTH;
}

export class ModelDesignChatReplier implements DesignChatModel {
  constructor(private readonly deps: ModelDesignChatReplierDeps) {}

  async reply(ctx: DesignChatContext): Promise<DesignChatReplyResult> {
    const fallback: DesignChatReplyResult = { text: designWorkbench.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {} };
    let text: string;
    try {
      const completion = await Promise.race([
        this.deps.model.complete({
          modelProvider: this.deps.chatModel.provider,
          modelId: this.deps.chatModel.modelId,
          system: DESIGN_CHAT_SYSTEM_PROMPT,
          user: describeProject(ctx),
        }),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error("design chat model call timed out")), DESIGN_CHAT_REPLY_TIMEOUT_MS);
        }),
      ]);
      text = completion.text;
    } catch (e) {
      this.deps.log("design chat: model call failed, falling back to fixed reply", {
        modelProvider: this.deps.chatModel.provider,
        modelId: this.deps.chatModel.modelId,
        code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
        detail: e instanceof ModelCallError ? e.detail : e instanceof Error ? e.message : "unexpected model call failure",
      });
      return fallback;
    }
    if (text.trim() === "") {
      this.deps.log("design chat: model output was empty, falling back to fixed reply", {});
      return fallback;
    }
    let raw: unknown;
    try {
      raw = extractJsonObject(text);
    } catch {
      this.deps.log("design chat: model output was not JSON, using it verbatim without writeback", {});
      return { text: text.trim().slice(0, 4000), source: "model", writeback: {} };
    }
    const obj = raw as Record<string, unknown>;
    const reply = typeof obj.reply === "string" ? obj.reply.trim() : "";
    const writeback = parseWriteback(obj.writeback, this.deps.log);
    if (reply === "") {
      // JSON 里没有可用的 reply：写回仍可能有效，但给用户看的那句退回固定回执并如实标记。
      return { text: fallback.text, source: "fallback", writeback };
    }
    return { text: reply.slice(0, 4000), source: "model", writeback };
  }
}
