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
 * 输出是数千字的 JSON，放宽到 90s。
 *
 * ⚠ 2026-09-07 线上实测（devapp，dashscope/qwen3.8-max）：**90s 仍然不够**，同一个项目连续
 * 五次全部 `design chat model call timed out`，用户屏上只看到固定回执、画布始终是空的。
 * 这不是"偶尔慢"——首次整页生成要输出多页组件树的完整 JSON，几千 token 的生成时间本来
 * 就在这个量级。默认提到 180s，与 `KERNEL_MODEL_TIMEOUT_MS` 的默认值同一量级（那是同一次
 * HTTP 请求的另一半预算，这里比它短就等于自己先放弃）；运维可用
 * `KERNEL_DESIGN_CHAT_TIMEOUT_MS` 按自己模型的实际速度覆盖。
 *
 * ⚠ 这个超时是 `Promise.race`，**不中止底层请求**——超时只是放弃等待，模型那边还在跑完。
 * 所以把它设得比模型真实耗时短，代价不只是"用户等不到"，还有"算力照付、结果全丢"。
 */
/** 超时那条 Error 的原话——`reply()` 靠它把超时与其它调用失败分开，只声明一次。 */
export const MODEL_TIMEOUT_MESSAGE = "design chat model call timed out";

export function readDesignChatTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.KERNEL_DESIGN_CHAT_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
}
export const DESIGN_CHAT_REPLY_TIMEOUT_MS = readDesignChatTimeoutMs();

/** 迭代 7：修复轮的硬超时——比首轮短，用户已经等过一次了（取首轮的一半）。 */
export const DESIGN_CHAT_REPAIR_TIMEOUT_MS = Math.round(DESIGN_CHAT_REPLY_TIMEOUT_MS / 2);
/** 修复轮只针对这两个字段：文字字段被拒几乎不会发生，且修复它不值一次往返。 */
const REPAIRABLE_FIELDS = new Set(["prototype", "patch"]);

/** 模型看到的项目上下文：六个字段 + 本项目完整历史（**已含**这次的用户消息）。 */
export type DesignChatContext = Pick<DesignProjectRow, "name" | "template" | "problem" | "criteria" | "frames" | "prototype" | "chat"> & {
  /**
   * 迭代 13（delta §1.3）：这一轮要给模型看的参考图（字节已由调用方取好）。
   * **随每一轮发**，不是只发第一轮——「照着这张画」在第 4 页仍然成立（V53）。
   */
  readonly refImages?: readonly { readonly filename: string; readonly mime: designWorkbench.ImageMime; readonly bytes: Uint8Array }[];
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
  /**
   * 2026-09-07：走退路的**为什么**。`source: "fallback"` 时必给（契约 `DesignChatReply`
   * 用 superRefine 机械绑定），让屏上那句话能说清楚是"没配模型"还是"调用失败"——
   * 用户实测时只看到一句"稍后会更新画布"，无从判断该等还是该找运维。
   */
  readonly fallbackReason?: designAiCollab.DesignChatFallbackReason;
}

export interface DesignChatModel {
  reply(ctx: DesignChatContext): Promise<DesignChatReplyResult>;
}

export interface ModelDesignChatReplierDeps {
  readonly model: ModelCallPort;
  readonly chatModel: FeedbackStructureModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

/**
 * 设计原则——写给模型的、可核对的约束，不是空话。
 *
 * ## 视觉那一半从哪来（2026-09-08，issue #3125）
 *
 * 人类实测原话：「现在出来的页面很不专业」。查下来根因是：`.agents/skills/frontend-design/SKILL.md`
 * 就在这个仓库里，讲排版层级、视觉结构、以及「一眼看出是 AI 生成」的具体特征，而这条链路
 * **完全没引用它**——原来的八条**全是布局结构**，一个字没讲视觉。模型被告知了怎么摆，
 * 没被告知怎么好看，产出「结构挑不出错但不专业」是必然的。
 *
 * ⚠ 但**不能把那份 skill 全文塞进来**：它写给「用 React/CSS 自由发挥」的场景，而这里的输出
 * 受限于本文件的 21 个原语闭集——「选一个有性格的字体」「做一次页面加载编排」在这套原语里
 * 根本无法表达，塞进去只会让模型输出它做不到的东西然后被契约拒。
 *
 * 所以下面是**翻译**：把 skill 的视觉判据落成这套原语能表达的约束。
 *
 * ⚠ **这里是原型画布这条链路视觉约束的唯一事实源**。`frontend-design/SKILL.md` 里有一行
 *   指回本常量；**不要**把同样的判据在那边再写一遍——同一事实声明两处必然漂移。
 */
export const DESIGN_PRINCIPLES =
  " 设计原则（每次生成/修改都要遵守）。" +
  "【结构】①每页只有一个主操作（primary 按钮），其余用 secondary/ghost；" +
  "②手机页从上到下：navbar → 内容 → 底部操作/bottomnav，内容区用 fill 的 stack 撑满；" +
  "③层级靠 text.variant（title/subtitle/body/caption），不靠堆 spacer；" +
  "④列表 ≥ 3 项才用 list，否则用 card；⑤每页至少考虑一种非理想态（空态/加载/错误）并在 notes 里说明；" +
  "⑥别一次塞超过 5 个功能块，超了就分页；" +
  "⑦每页的主操作都要有去处：用 links 把它连到对应的页；底部导航每一项都连到它那一页，别留死按钮。" +
  "【视觉】⑧一页只有一个视觉重点（hero / 大标题 / 关键数字三选一，且只出现一次），其余安静下来；" +
  "⑨字号要有级差：title 一页最多一次，subtitle 用于分区，caption 只用于真正的次要信息——" +
  "整页全是 body 说明你没做层级；⑩间距成体系：一页里 gap/padding 最多用两档，相邻同级区块用同一档；" +
  "⑪结构装置要**编码信息**而不是装饰——divider 只在真的分隔两类内容时用，card 只在真的成组时用，" +
  "数字编号只在内容真的是有序步骤时用；⑫不要每张卡都配 badge、不要每段文字上面都加一行小标签。" +
  "【避免这些一眼看出是生成的套路】⑬不要用全大写的小标签当眉头；不要用「A · B · C」中点拼元信息；" +
  "不要用「词 —— 片段」这种破折号标签；按钮文案不要缀「→」；不要只把标题里的一个词换成另一种 variant。" +
  "【文案】⑭按钮说清楚点下去会发生什么（「保存修改」而不是「提交」），同一个动作在全流程同名；" +
  "⑮错误不道歉也不含糊，说清出了什么事、怎么办；空态是一句邀请去做事的话，不是「暂无数据」；" +
  "⑯用用户的词不用系统的词，句子式大小写，不写填充语，每个文案元素只干一件事。" +
  "【收尾自查】⑰生成完回看一遍：有没有一处装饰是删掉也不损失信息的？有就删掉它。";

/** 迭代 9：一个极短的 few-shot——让模型看见「整页」与「patch」各长什么样，而不只是读规则。 */
export const DESIGN_FEW_SHOT =
  // 迭代 11：示例 1 带上 links——few-shot 是模型真正照抄的地方，只在规则里写"要连线"而例子里
  // 不连，模型多半也不连。这里同时演示了"想连线就自己给节点写 id"。
  ' 示例 1（还没有原型，用户说「做一个待办 App」）→ {"reply":"画了两页：待办首页、新增待办页，点「新增待办」会进第二页。","suggestions":["加一个完成筛选","给新增页加提醒时间"],' +
  '"writeback":{"prototype":[{"frame":"待办","root":{"type":"stack","props":{"direction":"column","gap":"sm"},"children":[{"type":"navbar","props":{"title":"我的待办"}},' +
  '{"type":"stack","props":{"fill":true},"children":[{"type":"list","props":{"items":["买牛奶","写周报","订机票"],"leading":"check"}}]},' +
  '{"id":"add","type":"button","props":{"label":"新增待办","variant":"primary","full":true}}]},' +
  '"notes":"首页列出未完成待办；空态显示「还没有待办」和新增按钮。","links":[{"from":"add","to":1}]},' +
  '{"frame":"新增待办","root":{"type":"stack","props":{"direction":"column","gap":"sm"},"children":[{"type":"navbar","props":{"title":"新增待办","left":"返回"}},' +
  '{"type":"input","props":{"label":"内容","placeholder":"要做什么？"}},{"type":"button","props":{"label":"保存","variant":"primary","full":true}}]},' +
  '"notes":"填内容后保存回到首页；内容为空时保存不可点。","links":[{"from":"n7","item":0,"to":0}]}]}}。' +
  ' 示例 2（已有原型，节点 n5 是按钮「新增待办」，用户说「按钮改成加号图标风格的文案」）→ {"reply":"改成了「＋ 新增」。","suggestions":["把按钮固定在底部"],"writeback":{"patch":[{"op":"setProps","id":"n5","props":{"label":"＋ 新增"}}]}}。';

export const DESIGN_CHAT_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计协作助手，像一个能直接画原型的设计师。用户（产品经理）在和你讨论一个设计项目：" +
  "问题背景、验收标准、以及原型画布。你的任务是顺着用户说的话把设计推进一步：先用一两句话回应，必要时更新项目字段。" +
  "只输出一个 JSON 对象，不要解释、不要 markdown 代码块标记，形如 " +
  '{"reply":"给用户看的回复，中文，不超过 200 字","suggestions":["最多 3 条下一步建议，每条 ≤ 20 字，用户点一下就会当作下一句话发给你"],"writeback":{"problem":"改写后的问题背景（可选）",' +
  '"criteria":["完整的验收标准列表（可选，给出即整体替换）"],' +
  '"prototype":[{"frame":"页标签","root":{组件树}}]}}。' +
  "还没有原型（当前原型为空数组）、用户首次描述要做的产品、要求新增页面、或要求整页重画/重排时，给 prototype：" +
  "把**全部页面**完整给出（整页替换，没提到的页也要原样给回），每页一个 {frame, root, notes}；" +
    "首次生成先给 1–3 页最核心的（页越多越容易超时，用户想要更多页会再让你加），已有原型的整页重画则保持原有页数，上限 20 页；" +
  "notes 是给工程看的这页交互说明（做什么、主要交互、空态/加载/错误），一到三句。" +
  "已有原型且只是局部改动（改文案/加删一块/调属性）时**不要**给 prototype，用 writeback.patch（见下）。" +
  "**只改页面标签、页数不变**时才用 writeback.frames（完整标签列表）；增页/删页必须整页给 prototype（它自带标签）——只给 frames 会让页数与组件树对不上，那次写回会被服务端拒绝。" +
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

/** 迭代 13：`intake-questions.ts` 也要解析模型的 JSON 输出，导出复用而不是抄第二份。 */
export function extractJsonObject(text: string): unknown {
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


/* ────────────────── 迭代 12：分页生成（delta `paged-generation-and-doc-export` §1） ────────────────── */

/**
 * 骨架轮的系统提示：**只**要页标签 + 每页一句意图，不要组件树。
 * 几百 token，实际上不可能被截断——所以"这个项目有哪几页"这件事永远拿得到，
 * 而在此之前它和"每页长什么样"绑在同一次输出里，一起超时、一起截断、一起没有。
 */
export const DESIGN_OUTLINE_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计协作助手。用户描述了一个要做的产品，你现在**只做一件事**：把它拆成几个页面。" +
  "不要输出任何组件树。只输出一个 JSON 对象：" +
  '{"reply":"给用户看的一句话，中文，不超过 100 字","outline":[{"frame":"页标签","intent":"这页做什么，一句话"}]}。' +
  `页数 3–6 页，最多 ${designPrototype.PROTOTYPE_MAX_SCREENS} 页；先给最核心的，用户想要更多会再让你加。` +
  "页标签是用户会说的话（「登录」「我的订单」），不是「页面1」。";

/** 每页轮的系统提示：只画**一页**。 */
export const DESIGN_ONE_SCREEN_SYSTEM_PROMPT =
  "你是 PM 设计工作台里的设计协作助手。你正在为一个已经定好页面划分的设计项目画**其中一页**。" +
  "只输出一个 JSON 对象，不要解释、不要 markdown 代码块标记，形如 " +
  '{"frame":"页标签","root":{组件树},"notes":"给工程看的交互说明，一到三句","links":[{"from":"节点id","to":目标页序号}]}。' +
  "只画被指定的那一页，不要输出别的页。" +
  designPrototype.PROTOTYPE_SCHEMA_GUIDE +
  " 原型要体现真实内容与交互意图（真实的文案、按钮、输入框、列表项），不要用占位符文字。" +
  DESIGN_PRINCIPLES;

export interface OutlineEntry { readonly frame: string; readonly intent: string; }

/** 某页被截断之后，重试那一页时追加的要求。只改输出**体量**，不改这一页要做什么。 */
/**
 * V54：模型看不了图时，**在给用户的那句话里说出来**。
 * 不说的话，界面显示"图已上传"而模型根本没看过——用户会以为它照着画了。
 */
export const BLIND_MODEL_NOTICE = "\n\n⚠ 这个部署的 AI 模型看不了图，你传的参考图它没有看到，上面是按你的文字描述画的。";

export const SIMPLER_SCREEN_HINT =
  "\n\n⚠ 你上一次的输出没写完就被长度限制截断了。这一次请把这一页画得**更简单**：" +
  "节点数控制在 30 个以内、嵌套不超过 3 层，只保留这一页最核心的结构与主操作，" +
  "列表最多 3 项，去掉次要的装饰性区块。宁可简单也要**完整输出**。";

/** JSON 能不能解析——截断判据的另一半（provider 没报 finish_reason 时靠它）。 */
function canParse(text: string): boolean {
  try {
    extractJsonObject(text);
    return true;
  } catch {
    return false;
  }
}

/** 骨架轮的输出解析。逐条过 `Label`（页标签的既有上限），不合法的丢掉。 */
export function parseOutline(raw: unknown): readonly OutlineEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: OutlineEntry[] = [];
  for (const e of raw) {
    if (e === null || typeof e !== "object") continue;
    const frame = (e as { frame?: unknown }).frame;
    const intent = (e as { intent?: unknown }).intent;
    if (typeof frame !== "string" || frame.trim() === "") continue;
    out.push({ frame: frame.trim().slice(0, 200), intent: typeof intent === "string" ? intent.trim().slice(0, 300) : "" });
    if (out.length >= designPrototype.PROTOTYPE_MAX_SCREENS) break;
  }
  return out;
}

/**
 * 已生成页的**结构摘要**——每页轮的上下文里带它，不带完整树（delta §1.1 取舍 ③ = A）。
 * 带完整树等于把分页省下来的输入 token 又填回去；只带类型序列，模型仍能看出"别的页长什么样"。
 *
 * ⚠ 这是本 delta 唯一的未验证假设（摘要够不够让风格一致），verification.md V44 钉它。
 */
export function summarizeScreen(frame: string, root: designPrototype.PrototypeNode): string {
  const types: string[] = [];
  const walk = (n: designPrototype.PrototypeNode, depth: number): void => {
    types.push(n.type);
    if (depth < 2 && designPrototype.isPrototypeContainer(n)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return `「${frame}」：${types.slice(0, 24).join(" > ")}`;
}

export class ModelDesignChatReplier implements DesignChatModel {
  constructor(private readonly deps: ModelDesignChatReplierDeps) {}


  /**
   * 迭代 12 —— 分页生成：**一次骨架 + 每页一次**（delta §1）。
   *
   * 病根是：一次调用要吐出所有页的完整组件树，输出长度随页数线性增长而模型单次预算固定，
   * 到 4、5 页必然撞顶（线上实测：先是连续超时，接着是输出被截断，截断后 JSON 不完整）。
   * 拆开之后单次输出量与页数**解耦**，8 页和 3 页一样安全。
   *
   * 失败面也跟着降级：在此之前一次截断 = 整段丢弃 = 用户白等三分钟；现在第 i 页失败
   * 只损失第 i 页，**其余页照常落库**（`DesignPrototypeWriteback` 里省掉那一页），
   * 回复里如实说是哪几页没画出来。
   *
   * ⚠ 与 delta §1 的一处出入，如实登记：契约写的是「每页生成完就写回，画布一页页长出来」。
   *   这里是**一次原子写回**。原因不是省事——这条路径是一次 HTTP 请求一次响应，服务端写
   *   八次也不会让用户的画布逐页刷新（客户端只在响应回来时才看到）。真要逐页可见需要
   *   流式/轮询通道，那不在本 delta 范围内。写多次只会多担风险、多记 N 条版本，换不到
   *   任何用户可见的东西。
   */
  private async generatePaged(ctx: DesignChatContext): Promise<DesignChatReplyResult> {
    const outlineText = await this.callModel(describeProject(ctx), DESIGN_CHAT_REPLY_TIMEOUT_MS, DESIGN_OUTLINE_SYSTEM_PROMPT, ctx.refImages);
    if (outlineText.truncated) return this.fallback("MODEL_OUTPUT_TRUNCATED");
    let outlineRaw: unknown;
    try {
      outlineRaw = extractJsonObject(outlineText.text);
    } catch {
      this.deps.log("design chat: outline round output was not parseable JSON", { length: outlineText.text.length });
      return this.fallback("MODEL_BAD_JSON");
    }
    const obj = outlineRaw as Record<string, unknown>;
    const outline = parseOutline(obj.outline);
    if (outline.length === 0) {
      this.deps.log("design chat: outline round produced no usable pages", {});
      return this.fallback("MODEL_EMPTY_OUTPUT");
    }
    this.deps.log("design chat: outline ready", { pages: outline.length });

    const done: { frame: string; screen: Record<string, unknown> }[] = [];
    const failed: string[] = [];
    for (const [i, entry] of outline.entries()) {
      const context =
        describeProject(ctx) +
        `\n\n这个项目的页面划分（共 ${outline.length} 页，序号从 0 起）：\n` +
        outline.map((e, k) => `${k}. 「${e.frame}」——${e.intent}`).join("\n") +
        (done.length === 0 ? "" : "\n\n已经画好的页（只给结构轮廓，供你保持风格一致）：\n" + done.map((d) => summarizeScreen(d.frame, d.screen.root as designPrototype.PrototypeNode)).join("\n")) +
        `\n\n现在只画第 ${i} 页「${entry.frame}」。links 的 to 用上面的页序号。`;
      let one: { text: string; truncated: boolean };
      try {
        // V53：**每页轮都带图**，不是只发骨架轮——「照着这张画」在第 4 页仍然成立。
        one = await this.callModel(context, DESIGN_CHAT_REPLY_TIMEOUT_MS, DESIGN_ONE_SCREEN_SYSTEM_PROMPT, ctx.refImages);
      } catch (e) {
        this.deps.log("design chat: screen round failed", { index: i, detail: e instanceof Error ? e.message : "unknown" });
        failed.push(entry.frame);
        continue;
      }
      // 截断 / JSON 不完整 ⇒ 同一页再来一次，但**要求画简单一点**（换了个请求，不是原样重试）。
      const needsSimpler = one.truncated || !canParse(one.text);
      if (needsSimpler) {
        this.deps.log("design chat: screen round truncated, retrying smaller", { index: i, truncated: one.truncated });
        try {
          one = await this.callModel(
            context + SIMPLER_SCREEN_HINT,
            DESIGN_CHAT_REPAIR_TIMEOUT_MS,
            DESIGN_ONE_SCREEN_SYSTEM_PROMPT,
            ctx.refImages,
          );
        } catch (e) {
          this.deps.log("design chat: smaller retry failed", { index: i, detail: e instanceof Error ? e.message : "unknown" });
          failed.push(entry.frame);
          continue;
        }
        if (one.truncated) {
          this.deps.log("design chat: smaller retry still truncated", { index: i });
          failed.push(entry.frame);
          continue;
        }
      }
      let parsed: unknown;
      try {
        parsed = extractJsonObject(one.text);
      } catch {
        this.deps.log("design chat: screen round output was not parseable JSON", { index: i, length: one.text.length });
        failed.push(entry.frame);
        continue;
      }
      const screen = { ...(parsed as Record<string, unknown>), frame: entry.frame };
      // 逐页过契约：这一页不合法就只丢这一页，不连累别的页——与整页写回「一页被拒整批拒」
      // 刻意不同，那条纪律的前提是"半套原型比没有更糟"，分页之后前提变了：
      // 缺一页且**说清楚缺哪页**，比八页全没有好。
      if (!designPrototype.PrototypeScreen.safeParse(screen).success) {
        this.deps.log("design chat: screen rejected by contract", { index: i });
        failed.push(entry.frame);
        continue;
      }
      done.push({ frame: entry.frame, screen });
    }

    if (done.length === 0) {
      this.deps.log("design chat: every screen round failed", { pages: outline.length });
      return this.fallback(failed.length === outline.length ? "MODEL_OUTPUT_TRUNCATED" : "MODEL_CALL_FAILED");
    }
    const { writeback } = parseWritebackDetailed({ prototype: done.map((d) => d.screen) }, this.deps.log);
    const reply = typeof obj.reply === "string" && obj.reply.trim() !== ""
      ? obj.reply.trim()
      : `画了 ${done.length} 页：${done.map((d) => d.frame).join("、")}。`;
    const text = (failed.length === 0
      ? reply
      : `${reply}\n\n还有 ${failed.length} 页没画出来：${failed.join("、")}。已经画好的都留着了，可以让我单独把没画的那几页补上。`)
      + this.blindNotice(ctx);
    return {
      text: text.slice(0, 4000),
      source: "model",
      writeback,
      suggestions: failed.length === 0 ? [] : [`补画「${failed[0]!}」`],
      ...(failed.length === 0 ? {} : { fallbackReason: undefined }),
    };
  }

  /** 传了图但模型看不了 ⇒ 那句提示；没传图或看得了 ⇒ 空串。 */
  private blindNotice(ctx: DesignChatContext): string {
    return (ctx.refImages ?? []).length > 0 && !this.canSeeImages() ? BLIND_MODEL_NOTICE : "";
  }

  private fallback(reason: designAiCollab.DesignChatFallbackReason): DesignChatReplyResult {
    return { text: designWorkbench.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback: {}, suggestions: [], fallbackReason: reason };
  }

  /**
   * 迭代 13（V54，**本 delta 最重要的一条**）：这个部署的模型能不能看图。
   *
   * 不能看时**不发** `images`，并且**在回复里说出来**。静默丢弃是本仓反复栽过的形态：
   * 界面显示"图已上传"，模型根本没看过，用户还以为它照着画了。
   */
  private canSeeImages(): boolean {
    return this.deps.model.supportsVision?.(this.deps.chatModel.provider, this.deps.chatModel.modelId) === true;
  }

  private async callModel(
    user: string,
    timeoutMs: number,
    system: string = DESIGN_CHAT_SYSTEM_PROMPT,
    images?: readonly { readonly filename: string; readonly mime: designWorkbench.ImageMime; readonly bytes: Uint8Array }[],
  ): Promise<{ text: string; truncated: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completion = await Promise.race([
        this.deps.model.complete({
          modelProvider: this.deps.chatModel.provider,
          modelId: this.deps.chatModel.modelId,
          system,
          user,
          // 看不了图的 provider 永远收不到 `images`（端口头注的既有纪律）。
          ...(images !== undefined && images.length > 0 && this.canSeeImages() ? { images: [...images] } : {}),
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(MODEL_TIMEOUT_MESSAGE)), timeoutMs);
        }),
      ]);
      // 迭代 12：provider 报的 `finish_reason === "length"` 一路带上来。缺席 = 没报告，
      // **不是**"确定没截断"——所以是 `=== true` 而不是真值判断。
      return { text: completion.text, truncated: completion.truncated === true };
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
      const { text } = await this.callModel(user, DESIGN_CHAT_REPAIR_TIMEOUT_MS);
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
    const fallbackWith = (reason: designAiCollab.DesignChatFallbackReason): DesignChatReplyResult => this.fallback(reason);
    /**
     * 迭代 12：**首次生成走分页**（还没有任何树 ⇒ 这一句必然要模型吐出全部页）。
     * 已有原型时不走——那时用户多半是局部改动（patch），一次调用足够，分页只会多花 N 倍的钱。
     */
    if (ctx.prototype.length === 0) {
      try {
        return await this.generatePaged(ctx);
      } catch (e) {
        this.deps.log("design chat: paged generation failed, falling back", {
          code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
          detail: e instanceof ModelCallError ? e.detail : e instanceof Error ? e.message : "unexpected failure",
        });
        if (e instanceof ModelCallError && e.code === "MODEL_PROVIDER_NOT_CONFIGURED") return fallbackWith("MODEL_NOT_CONFIGURED");
        return fallbackWith(e instanceof Error && e.message === MODEL_TIMEOUT_MESSAGE ? "MODEL_TIMEOUT" : "MODEL_CALL_FAILED");
      }
    }
    let text: string;
    let truncated = false;
    try {
      const first = await this.callModel(describeProject(ctx), DESIGN_CHAT_REPLY_TIMEOUT_MS, DESIGN_CHAT_SYSTEM_PROMPT, ctx.refImages);
      text = first.text;
      truncated = first.truncated;
    } catch (e) {
      this.deps.log("design chat: model call failed, falling back to fixed reply", {
        modelProvider: this.deps.chatModel.provider,
        modelId: this.deps.chatModel.modelId,
        code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
        detail: e instanceof ModelCallError ? e.detail : e instanceof Error ? e.message : "unexpected model call failure",
      });
      // `MODEL_PROVIDER_NOT_CONFIGURED` 是"这个部署没配 provider"，与"配了但打不通"是
      // 两件不同的事，屏上给的下一步也不同——不要合并成一句"模型不可用"。
      if (e instanceof ModelCallError && e.code === "MODEL_PROVIDER_NOT_CONFIGURED") return fallbackWith("MODEL_NOT_CONFIGURED");
      // 超时与"打不通"是两件事：前者说明这次要画的东西对这个模型来说太大了（少画几页会好），
      // 后者是网络/鉴权。合并成一句"调用失败"，用户只会一遍遍重试同一个必然超时的请求。
      return fallbackWith(e instanceof Error && e.message === MODEL_TIMEOUT_MESSAGE ? "MODEL_TIMEOUT" : "MODEL_CALL_FAILED");
    }
    if (text.trim() === "") {
      this.deps.log("design chat: model output was empty, falling back to fixed reply", {});
      return fallbackWith("MODEL_EMPTY_OUTPUT");
    }
    // 迭代 12：模型**自己说**没说完 ⇒ 直接判截断，不先去 parse。
    // 在此之前只能靠"JSON 解析失败"反推，那把「输出不合语法」和「输出被切断」混成一件事，
    // 而屏上给用户的下一步不同（换个说法 vs 拆小一点／单页重试）。
    if (truncated) {
      this.deps.log("design chat: model reported truncated output", { length: text.length });
      return fallbackWith("MODEL_OUTPUT_TRUNCATED");
    }
    let raw: unknown;
    try {
      raw = extractJsonObject(text);
    } catch {
      /**
       * ⚠ 2026-09-07 用户实测：这条分支曾把**整坨 JSON 泼进对话框**。原意是"模型用大白话答的、
       * 没给 JSON ⇒ 原样显示"，但模型一次整页重画 5 页时输出被截断，JSON 没闭合、parse 失败，
       * 于是半截 JSON 被当成聊天回复显示出来。
       *
       * 所以要分两种：真·大白话（不以 `{` 开头）照旧原样显示；看着是 JSON 却解析不了 ⇒ 判失败。
       * **不救里面那句 `reply` 拿来显示**——它往往写着"已在各页补充了跳转逻辑"，而写回一个字
       * 都没生效，那正是本迭代反复在修的"界面声称的事情没有真的发生"。
       */
      const looksLikeJson = text.trimStart().startsWith("{");
      this.deps.log("design chat: model output was not parseable JSON", { looksLikeJson, length: text.length });
      if (looksLikeJson) return fallbackWith("MODEL_BAD_JSON");
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
      return { text: designWorkbench.DESIGN_WORKBENCH_CHAT_REPLY, source: "fallback", writeback, suggestions, fallbackReason: "MODEL_NO_REPLY_TEXT" };
    }
    return { text: (reply.slice(0, 4000) + this.blindNotice(ctx)).slice(0, 4200), source: "model", writeback, suggestions };
  }
}
