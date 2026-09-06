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

/** 迭代 7：修复轮的硬超时——比首轮短，用户已经等过一次了。 */
export const DESIGN_CHAT_REPAIR_TIMEOUT_MS = 45_000;
/** 修复轮只针对这两个字段：文字字段被拒几乎不会发生，且修复它不值一次往返。 */
const REPAIRABLE_FIELDS = new Set(["prototype", "patch"]);

/** 模型看到的项目上下文：六个字段 + 本项目完整历史（**已含**这次的用户消息）。 */
export type DesignChatContext = Pick<DesignProjectRow, "name" | "template" | "problem" | "criteria" | "frames" | "prototype" | "chat"> & {
  /** 迭代 2：用户选中的节点（已解析成路径）；没选 / 找不到 ⇒ 不带。 */
  readonly focus?: { readonly id: string; readonly frame: string; readonly path: readonly string[]; readonly node: unknown };
};

export interface DesignChatReplyResult {
  readonly text: string;
  readonly source: AiReplySource;
  /** 逐字段解析后**合法**的写回；没有 ⇒ `{}`。 */
  readonly writeback: DesignChatWriteback;
  /** 迭代 9：模型给的下一步建议（已过契约：≤ 3 条、每条 ≤ 40 字；退路 ⇒ `[]`）。 */
  readonly suggestions: readonly string[];
}

export interface DesignChatModel {
  reply(ctx: DesignChatContext): Promise<DesignChatReplyResult>;
}

export interface ModelDesignChatReplierDeps {
  readonly model: ModelCallPort;
  readonly chatModel: FeedbackStructureModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

/** 迭代 9：设计原则——写给模型的、可核对的约束，不是空话。 */
export const DESIGN_PRINCIPLES =
  " 设计原则（每次生成/修改都要遵守）：①每页只有一个主操作（primary 按钮），其余用 secondary/ghost；" +
  "②手机页从上到下：navbar → 内容 → 底部操作/bottomnav，内容区用 fill 的 stack 撑满；③层级靠 text.variant（title/subtitle/body/caption），不靠堆 spacer；" +
  "④列表 ≥ 3 项才用 list，否则用 card；⑤每页至少考虑一种非理想态（空态/加载/错误）并在 notes 里说明；" +
  "⑥文案用用户会说的话，按钮是动词；⑦别一次塞超过 5 个功能块，超了就分页。";

/** 迭代 9：一个极短的 few-shot——让模型看见「整页」与「patch」各长什么样，而不只是读规则。 */
export const DESIGN_FEW_SHOT =
  ' 示例 1（还没有原型，用户说「做一个待办 App」）→ {"reply":"先画了首页：顶部标题，中间待办列表，底部新增按钮。","suggestions":["加一个完成筛选","设计新增待办页"],' +
  '"writeback":{"prototype":[{"frame":"待办","root":{"type":"stack","props":{"direction":"column","gap":"sm"},"children":[{"type":"navbar","props":{"title":"我的待办"}},' +
  '{"type":"stack","props":{"fill":true},"children":[{"type":"list","props":{"items":["买牛奶","写周报","订机票"],"leading":"check"}}]},{"type":"button","props":{"label":"新增待办","variant":"primary","full":true}}]},' +
  '"notes":"首页列出未完成待办；空态显示「还没有待办」和新增按钮。"}]}}。' +
  ' 示例 2（已有原型，节点 n5 是按钮「新增待办」，用户说「按钮改成加号图标风格的文案」）→ {"reply":"改成了「＋ 新增」。","suggestions":["把按钮固定在底部"],"writeback":{"patch":[{"op":"setProps","id":"n5","props":{"label":"＋ 新增"}}]}}。';

export const DESIGN_CHAT_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计协作助手，像一个能直接画原型的设计师。用户（产品经理）在和你讨论一个设计项目：" +
  "问题背景、验收标准、以及原型画布。你的任务是顺着用户说的话把设计推进一步：先用一两句话回应，必要时更新项目字段。" +
  "只输出一个 JSON 对象，不要解释、不要 markdown 代码块标记，形如 " +
  '{"reply":"给用户看的回复，中文，不超过 200 字","suggestions":["最多 3 条下一步建议，每条 ≤ 20 字，用户点一下就会当作下一句话发给你"],"writeback":{"problem":"改写后的问题背景（可选）",' +
  '"criteria":["完整的验收标准列表（可选，给出即整体替换）"],' +
  '"prototype":[{"frame":"页标签","root":{组件树}}]}}。' +
  "还没有原型（当前原型为空数组）、用户首次描述要做的产品、要求新增页面、或要求整页重画/重排时，给 prototype：" +
  "把**全部页面**完整给出（整页替换，没提到的页也要原样给回），每页一个 {frame, root, notes}，页数 1–20；" +
  "notes 是给工程看的这页交互说明（做什么、主要交互、空态/加载/错误），一到三句。" +
  "已有原型且只是局部改动（改文案/加删一块/调属性）时**不要**给 prototype，用 writeback.patch（见下）。" +
  "只改页面标签不改内容时用 writeback.frames（完整标签列表）。" +
  designPrototype.PROTOTYPE_SCHEMA_GUIDE + " " + designPrototype.PROTOTYPE_PATCH_GUIDE +
  " 原型要体现真实内容与交互意图（真实的文案、按钮、输入框、列表项），不要用占位符文字。" +
  DESIGN_PRINCIPLES + DESIGN_FEW_SHOT +
  "writeback 只在用户这句话确实要求或明显蕴含改动时才给，且只给要改的键；不改就省略 writeback。不要编造用户没说的需求。";

function describeProject(ctx: DesignChatContext): string {
  const lines = [
    `项目名称：${ctx.name}`,
    `模板：${ctx.template}（目标设备：${ctx.template === "mobile" ? "手机，画布宽 300px，单列为主，底部可放 bottomnav" : ctx.template === "ui" ? "桌面，画布宽 720px，可用 grid 2–3 列与 hero 头图" : "平板，画布宽 440px"}）`,
    `问题背景：${ctx.problem.trim() === "" ? "（还没写）" : ctx.problem}`,
    `验收标准：${JSON.stringify(ctx.criteria)}`,
    `画布页标签：${JSON.stringify(ctx.frames)}`,
    `当前原型（按页，与标签同序；每个节点带 id 供 patch 寻址；空数组 = 还没生成）：${JSON.stringify(ctx.prototype)}`,
  ];
  if (ctx.focus !== undefined) {
    lines.push(
      `用户当前在画布上选中了节点 id=${ctx.focus.id}（页「${ctx.focus.frame}」，路径：${ctx.focus.path.join(" > ")}）：${JSON.stringify(ctx.focus.node)}。` +
        "这句话优先针对这个节点，用 patch 改它（setProps/replace/insert 到它/remove 它），除非用户明显在说别的。",
    );
  }
  lines.push("对话记录（按时间顺序，最后一条是用户刚说的）：");
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

export interface WritebackRejection {
  readonly field: string;
  readonly reason: string;
}

/** 逐字段过契约：不合法的字段丢掉，其余保留（契约 `DesignChatWriteback` 头注逐字）。 */
export function parseWriteback(raw: unknown, log?: (message: string, detail: Record<string, unknown>) => void): DesignChatWriteback {
  return parseWritebackDetailed(raw, log).writeback;
}

/** 迭代 7：同 `parseWriteback`，但把每个被拒字段的**原因**带出来——修复轮要把它原话告诉模型。 */
export function parseWritebackDetailed(
  raw: unknown,
  log?: (message: string, detail: Record<string, unknown>) => void,
): { readonly writeback: DesignChatWriteback; readonly rejected: readonly WritebackRejection[] } {
  const rejected: WritebackRejection[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { writeback: {}, rejected };
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
      rejected.push({ field, reason: `某一页嵌套深度超过 ${designPrototype.PROTOTYPE_MAX_DEPTH}` });
      continue;
    }
    // 迭代 7：过契约前先做机械纠偏（type 大小写 / 容器漏 children / 数字字符串…），见契约 `coercePrototypeRaw`。
    // patch 里的 replace/insert 节点同样先挡深度——纠偏是递归的，不能在 try 之外被打爆（Codex P2）。
    if (field === "patch" && Array.isArray(value) && value.some((op) => op !== null && typeof op === "object" && "node" in (op as object) && designPrototype.rawPrototypeDepth((op as { node?: unknown }).node) > designPrototype.PROTOTYPE_MAX_DEPTH)) {
      log?.("design chat: writeback field rejected by contract, skipped", { field, reason: "depth" });
      rejected.push({ field, reason: `某条 patch 的节点嵌套深度超过 ${designPrototype.PROTOTYPE_MAX_DEPTH}` });
      continue;
    }
    const coerced = field === "prototype" && Array.isArray(value)
      ? value.map((s) => (s !== null && typeof s === "object" && !Array.isArray(s) ? { ...(s as Record<string, unknown>), root: designPrototype.coercePrototypeRaw((s as { root?: unknown }).root) } : s))
      : field === "patch" && Array.isArray(value)
        ? value.map((op) => (op !== null && typeof op === "object" && !Array.isArray(op) && "node" in op ? { ...(op as Record<string, unknown>), node: designPrototype.coercePrototypeRaw((op as { node?: unknown }).node) } : op))
        : value;
    let parsed: ReturnType<typeof designAiCollab.DesignChatWriteback.safeParse>;
    try {
      parsed = designAiCollab.DesignChatWriteback.safeParse({ [field]: coerced });
    } catch (e) {
      // 兜底：解析本身抛（而不是返回 success:false）也只丢这个字段，不让整次对话 500。
      log?.("design chat: writeback field parse threw, skipped", { field, detail: e instanceof Error ? e.message : "unknown" });
      rejected.push({ field, reason: "无法解析" });
      continue;
    }
    if (parsed.success) out[field] = parsed.data[field];
    else {
      const issue = parsed.error.issues[0];
      const reason = issue === undefined ? "不合法" : `${issue.path.join(".")}: ${issue.message}`;
      log?.("design chat: writeback field rejected by contract, skipped", { field, reason });
      rejected.push({ field, reason });
    }
  }
  return { writeback: out as DesignChatWriteback, rejected };
}

/** 迭代 9：建议逐条过契约（非字符串 / 超长丢弃），最多 3 条。 */
export function parseSuggestions(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const s of raw) {
    const parsed = designAiCollab.DesignChatSuggestion.safeParse(typeof s === "string" ? s.trim() : s);
    if (parsed.success) out.push(parsed.data);
    if (out.length >= designAiCollab.DESIGN_CHAT_MAX_SUGGESTIONS) break;
  }
  return out;
}

function rawScreenTooDeep(screen: unknown): boolean {
  const root = screen !== null && typeof screen === "object" ? (screen as { root?: unknown }).root : undefined;
  return designPrototype.rawPrototypeDepth(root) > designPrototype.PROTOTYPE_MAX_DEPTH;
}

export class ModelDesignChatReplier implements DesignChatModel {
  constructor(private readonly deps: ModelDesignChatReplierDeps) {}

  private async callModel(user: string, timeoutMs: number): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completion = await Promise.race([
        this.deps.model.complete({
          modelProvider: this.deps.chatModel.provider,
          modelId: this.deps.chatModel.modelId,
          system: DESIGN_CHAT_SYSTEM_PROMPT,
          user,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("design chat model call timed out")), timeoutMs);
        }),
      ]);
      return completion.text;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * 迭代 7：修复轮。首轮的 `prototype`/`patch` 被契约拒了 ⇒ 把**原话理由**告诉模型，让它只重新输出修正后的
   * 完整 JSON；再解析一次。修复轮也失败 ⇒ 保留首轮已经合法的字段与回复文字（不再第三轮）。
   */
  private async repair(ctx: DesignChatContext, firstText: string, rejected: readonly WritebackRejection[]): Promise<DesignChatWriteback | null> {
    const user =
      describeProject(ctx) +
      "\n\n你上一轮的输出如下：\n" + firstText.slice(0, 12_000) +
      "\n\n其中 writeback 有字段没通过契约校验：\n" +
      rejected.map((r) => `- ${r.field}：${r.reason}`).join("\n") +
      "\n请只修正这些问题，重新输出**完整**的 JSON（reply + writeback），不要解释。";
    try {
      const text = await this.callModel(user, DESIGN_CHAT_REPAIR_TIMEOUT_MS);
      const obj = extractJsonObject(text) as Record<string, unknown>;
      const { writeback, rejected: still } = parseWritebackDetailed(obj.writeback, this.deps.log);
      this.deps.log("design chat: repair round finished", { stillRejected: still.map((r) => r.field) });
      // 只把**这次要修的字段**里修好的那些拿回去；其余字段不用修复轮的（首轮已合法的不被覆盖）。修的一个都没成 ⇒ null。
      const wanted = new Set(rejected.map((r) => r.field));
      const repaired: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(writeback)) if (wanted.has(k) && v !== undefined) repaired[k] = v;
      return Object.keys(repaired).length === 0 ? null : (repaired as DesignChatWriteback);
    } catch (e) {
      this.deps.log("design chat: repair round failed, keeping first-round result", { detail: e instanceof Error ? e.message : "unknown" });
      return null;
    }
  }

  async reply(ctx: DesignChatContext): Promise<DesignChatReplyResult> {
    const fallback: DesignChatReplyResult = { text: designWorkbench.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {}, suggestions: [] };
    let text: string;
    try {
      text = await this.callModel(describeProject(ctx), DESIGN_CHAT_REPLY_TIMEOUT_MS);
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
      return { text: text.trim().slice(0, 4000), source: "model", writeback: {}, suggestions: [] };
    }
    const obj = raw as Record<string, unknown>;
    const reply = typeof obj.reply === "string" ? obj.reply.trim() : "";
    let { writeback } = parseWritebackDetailed(obj.writeback, this.deps.log);
    const { rejected } = parseWritebackDetailed(obj.writeback);
    const repairable = rejected.filter((r) => REPAIRABLE_FIELDS.has(r.field));
    if (repairable.length > 0) {
      const repaired = await this.repair(ctx, text, repairable);
      if (repaired !== null) {
        // 修复轮里合法的字段覆盖首轮；首轮已合法、修复轮没给的字段保留。
        writeback = { ...writeback, ...repaired };
      }
    }
    const suggestions = parseSuggestions(obj.suggestions);
    if (reply === "") {
      // JSON 里没有可用的 reply：写回仍可能有效，但给用户看的那句退回固定回执并如实标记。
      return { text: fallback.text, source: "fallback", writeback, suggestions };
    }
    return { text: reply.slice(0, 4000), source: "model", writeback, suggestions };
  }
}
