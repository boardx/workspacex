/**
 * 契约束 `design-workbench` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份是前后端类型、运行时校验、OpenAPI 的共同来源，任何一样都不许手写第二份。
 *
 * 覆盖：**UC-17.8 Sprint 3 · B4.1「PM 设计工作台」**，
 * 见 `phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md` §B4，
 * 需求 R4.4（`uc-17-8-研发闭环-反馈到设计到排期.md`）。
 * B4.2（迁移：`design_projects`/`design_project_chat_messages`/双向外键）、B4.3（API 事务）、
 * B4.4（「用 PM 设计工作台深化」真栈）都在本契约打的地基上做，字段与错误码在此一次定齐。
 *
 * ## 与 `inbox.ts` 的关系：**复用它预留的关联字段，不另造一套**
 *
 * `InboxItem.linkedFeedbackId` / `resolvedByDesignId` 本轮之前恒 `null`，是专门给 B4 留的位。
 * 本契约的 `DesignProject.linkedFeedbackId` 就是同一个概念在设计侧的镜像——B4.3 落地后：
 *   · 一条反馈「深化」出一个设计项目 ⇒ `DesignProject.linkedFeedbackId = <反馈 id>`，
 *     同时那条反馈对应的 `InboxItem.resolvedByDesignId` 回填为这个项目推送后生成的收件箱条目 id。
 *   · 双向关联在 DB 只有一对外键 + 唯一约束（B4.2），这里的两个字段是它的读投影，不是两份事实。
 *
 * ## 【待确认点 1】设计项目要不要 D3 门控（组织内谁能看见谁的项目）
 *
 * `feedback-loop.ts` 的 D3 门控是「反馈正文默认仅提交人与超管可见，仅摘要对外」，服务的是
 * 「反馈可能包含吐槽/隐私」这个动机。R4.4 与 R5 都没有对设计项目提出同等诉求：
 *   · R5 原文只把「PM 设计工作台」整体划给 PM/运营角色，**没有**在角色内部再分「谁能看谁的项目」。
 *   · R4.4 的操作描述（编辑/删除、推送）通篇是「项目」而非「我的项目」，首页卡片网格也没有
 *     提到按 owner 过滤——这与草稿（`FeedbackDraft`，明确「提交人私有」）的措辞形成对照。
 *   · 设计项目本身是**内部协作产出**（问题描述、验收标准、原型画布），不是像反馈正文那样可能
 *     携带的一次性吐槽；同一 PM 团队互相看得见彼此在做什么设计，反而符合「工作台」的协作语义。
 * 需求没有把这一点说清楚，所以这里**做出选择**：**组织内全员可读，仅 owner 可改/删/推送**——
 * 比照 D3 的保守版本会让「列出所有项目」这个最基础的操作也要过一层可见性判断，而这层判断
 * 需求完全没有描述该按什么规则收窄（不像反馈有「提交人 vs 非提交人」这个天然二分）。
 * `listMyProjects` 之所以叫「My」是 R4.4 的用户视角（「我的设计项目」按名称过滤），不是权限
 * 边界；它的 `ownerId` 过滤在应用层做，不代表别人的项目查不到——那是另一个尚未定义的操作。
 * 若将来需要「查看任意项目详情」，加一个不带 owner 过滤的读操作即可，不改这里的可见性口径。
 *
 * ## 【待确认点 2】首次默认引导语是展示层行为还是要落库的第一条消息
 *
 * R4.4 原文：「左侧固定 360px 对话面板……无历史时一条默认引导语」——用词是「无历史时**展示**」，
 * 不是「首次打开时**追加**一条」。对照草稿的「继续完善」浮层，PDF 原文是「首次打开自动**追加**
 * 一条 AI 澄清问题」，`FeedbackDraft.refineSeeded` 就是为了让服务端「只追加一次」这件事可判断
 * 而存在的标记；R4.4 描述设计项目引导语时**没有**用「追加」，也没有类似 `refineSeeded` 的「只出现
 * 一次」措辞——因为它的条件是「`chat` 为空」本身，`chat.length === 0` 就是天然的、不需要额外
 * 标记的判据。所以这里选**展示层**：`DesignProject` 不含引导语这条记录，`chat` 初始为 `[]`；
 * 前端在 `chat.length === 0` 时本地渲染 `DESIGN_WORKBENCH_CHAT_INTRO`（本文件常量导出，api/web
 * 同源）。一旦用户发送第一条消息，`appendProjectChat` 按「用户消息 + 固定回执」写入，引导语依旧
 * 不入库——它不是对话的一部分，只是空状态的占位提示，把它落库会让「第一条消息」在 UI 上和在
 * 数据里对不上（用户看到的第一条是引导语，数据库里第一条却是回执之后自己那条）。
 *
 * ## 推送幂等选的是 **upsert**，不是拒绝重复
 *
 * `pushToInbox` 的幂等键是 `projectId` 本身（`design_projects` 一行至多对应一条收件箱条目，
 * B4.2 的唯一约束保证）。选 upsert 而不是「已推送过就 `ALREADY_PUSHED` 拒绝」：
 *   · 需求把「推送到收件箱」按钮的态叫「已推送到收件箱」而不是禁用态——按钮点了一次以后
 *     还在，暗示它是可以再点的（比如改了 `note` 想重新说明一次给工程的备注）。
 *   · 拒绝重复会把「网络超时后用户手滑点了第二次」变成一个用户需要理解的错误，而这次操作
 *     本该是无害的——upsert 让重试天然安全，这正是幂等设计要解决的问题。
 *   · 因此 `DesignWorkbenchError` 里没有 `ALREADY_PUSHED`；`pushed`/`pushedAt`/`note`（收件箱
 *     条目那侧的说明）在重复推送时被最新一次调用覆盖，`inboxCode` 保持不变（同一条目的编号
 *     一旦生成不再改变，即使内容被更新）。
 *
 * ## ⚠ 本文件刻意**没有**的东西
 *
 *   · **`chat[]` 的独立查询接口**——同 `FeedbackDraft.chat` 的先例，直接嵌在实体里；B4.2 会建
 *     `design_project_chat_messages` 表，但那是存储层拆分，投影仍是 `DesignProject.chat`。
 *   · ~~画布/原型内容的字段~~——2026-09-06 人类决策推翻「B5.3 out of scope」：`prototype` 是按位置
 *     对应 `frames[i]` 的结构化组件树（`design-prototype.ts`），仍**只能经模型写回**，不接受前端传入。
 *   · **`PUT /pm-designs/:id/status`**——`go-live-backlog.md` §B3.1 提过这个假设路径，但
 *     设计方案没有状态机（`pushed: boolean` 就是它唯一的二态），状态迁移不需要单独接口；
 *     进收件箱后的状态机是 `InboxItem`/`system-error-logs` 那一套四态，属于 B3 契约，不在这里。
 */
import { z } from "zod";
import { AiReplySource, DesignChatReply } from "./design-ai-collab";
import { DesignPrototypePatch, PROTOTYPE_MAX_SCREENS, PrototypeLink, PrototypeNode, PrototypeNodeId } from "./design-prototype";

/* ─────────────────────────── 枚举与常量 ─────────────────────────── */

/**
 * 设计项目模板（PDF §5.4 首页三类入口）。**闭集三值**，同现有原型 mock `ProjectTemplate`。
 */
export const ProjectTemplate = z.enum(["mobile", "ui", "wireframe"]);
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;

/**
 * 验收标准固定文案（R4.4：「说明」Tab 固定三条）。**服务端在创建时填入**，不接受前端传入——
 * 这三条是产品对「什么算做完」的统一定义，不是每个项目各自填写的自由文本。api 与 web 都读这份
 * 常量，不各写一份（本仓已因「同一事实两处声明」漂移五次）。
 */
export const DESIGN_PROJECT_INITIAL_CRITERIA: readonly string[] = [
  "明确问题与目标范围",
  "给出交互方案与边界情况处理",
  "列出验收标准供工程对齐",
];

/* ─────────── 迭代 13：参考图（design-delta `design-chat-inputs` §1） ─────────── */

/**
 * 能交给模型去看的图片类型**闭集**。
 *
 * ⚠ 这里是**唯一声明处**。它原先住在 `apps/api` 的 `agent-run/ports.ts`，但设计工作台
 * 的参考图与 agent-run 的图片输入必须是同一个集合——两处各写一份，端口那边加一种格式时
 * 设计这边就会静默不支持（V52 用「集合相等」而不是「包含」钉住这件事）。
 * 契约是最内层，api 侧改成从这里再导出。
 */
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];
export function isImageMime(mime: string): mime is ImageMime {
  return (IMAGE_MIMES as readonly string[]).includes(mime);
}

/**
 * 一个设计项目最多挂几张参考图。
 *
 * 视觉输入按张计费且贵；一次给三张已经足够说清「照这个画」。不设上限等于把成本敞口
 * 交给用户手滑（delta §1.2，取舍 ①=A）。
 */
export const PROTOTYPE_MAX_REF_IMAGES = 3;
/** 单张参考图的字节上限。 */
export const PROTOTYPE_REF_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** 参考图的元信息——**不含字节**：列表接口带上字节会被撑爆（V55）。 */
export const RefImage = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(200),
    size: z.number().int().min(1),
    mime: z.enum(IMAGE_MIMES),
    createdAt: z.string(),
  })
  .strict();
export type RefImage = z.infer<typeof RefImage>;

/* ─────────── 迭代 13：引导式澄清（design-delta `design-chat-inputs` §3） ─────────── */

/**
 * 新建设计前的**澄清问答**。
 *
 * 在此之前「新建」是三个字段：类别 / 名称 / 背景（可选）。背景那行的占位符写着
 * 「想解决的问题、谁会用、现在怎么绕过去的」——**这已经是在提示该收集哪些数据了，
 * 只是把它塞进一行灰字，而且可选**。结果是大多数项目带着一句话甚至空背景就进了画布，
 * 模型只能靠猜。
 *
 * 改成：写一句 brief ⇒ 模型据此生成**针对这个产品**的问题 ⇒ 逐条回答（每条都能跳过）
 * ⇒ 汇成一份可编辑的「设计指导原则」⇒ 确认后创建。
 *
 * ⚠ **不新增存储**：问题在前端内存里，答案随 `createProject` 一次交上来，落地形态就是
 *   既有的 `problem` / `criteria`。指导原则**不是第四种事实源**。
 */
export const INTAKE_MIN_QUESTIONS = 3;
export const INTAKE_MAX_QUESTIONS = 6;
export const IntakeQuestion = z
  .object({
    /** 问给用户看的话。是模型按 brief 生成的，不是固定问卷念一遍。 */
    text: z.string().min(1).max(200),
    /** 这条问题对应 §3.5 六维里的哪一维——前端按它排序与配图标，不用再猜。 */
    dimension: z.enum(["who", "problem", "task", "constraint", "reference", "success"]),
    /** 一句示例答案，降低"不知道该说什么"的门槛；可省略。 */
    hint: z.string().max(200).optional(),
  })
  .strict();
export type IntakeQuestion = z.infer<typeof IntakeQuestion>;

/**
 * 用户的回答。跳过的题**不出现在数组里**，不是给一个空串——"没答"和"答了空"是两件事。
 *
 * ## `dimension` 为什么必须跟着答案走（迭代 17，#3773 后续）
 *
 * 只有「成功长什么样」那一维的答案该变成验收标准，其余五维是**背景**。在这个字段出现
 * 之前，答案里只有 `question` 文本，服务端无从分辨它属于哪一维——于是 controller 退而
 * 求其次，把**全部**问题都当成「成功」那一维交下去，结果是六维答案全都被写成验收标准。
 * 「谁会用这个东西」「现在他们怎么绕过去」这种背景句就这样进了验收口径，一路走到
 * 设计文档和排期里。
 *
 * ⚠ 可选是为了兼容老客户端。**缺这个键的答案不算「成功」那一维**（见
 *   `foldIntakeIntoCriteria`）：宁可少几条验收标准，也不要把背景当成验收口径——
 *   前者用户自己补得回来，后者他未必看得出来。
 */
export const IntakeAnswer = z
  .object({
    question: z.string().min(1).max(200),
    answer: z.string().min(1).max(1000),
    dimension: IntakeQuestion.shape.dimension.optional(),
  })
  .strict();
export type IntakeAnswer = z.infer<typeof IntakeAnswer>;

/* ─────────── 迭代 17：项目级强调色（#3773 后续，视觉身份） ─────────── */

/**
 * 原型的**强调色档位**。闭集，不是自由色值——同 `Radius` / `Scale` / `PrototypeIcon`
 * 的那条纪律。
 *
 * ## 为什么需要它
 *
 * 在这之前，这套原语画出来的东西**没有视觉身份**：不管做的是儿童记账 App 还是医院
 * 排班后台，按钮、选中态、进度条一律是同一个中性灰 `--primary`。一个产品给人的第一印象
 * 首先是它的主色，其次才是布局——少了这一层，所有产出看起来都像同一个模板的不同填空，
 * 这正是「和 claude design 有巨大差距」里最容易看出来、也最容易修的一段。
 *
 * ## 为什么是档位而不是 `#RRGGBB`
 *
 * 给了自由色值，模型和人就会造出 `#7B68EE` 这种在深色画布上读不出来的东西，而对比度
 * 是这套原语能看起来像成品的**前提**（按钮上的字读不清，再好的布局也白搭）。档位让
 * 每一个取值的对比度都可以被**一次性验过并钉住**（见 `PROTOTYPE_ACCENTS` 与
 * `design-workbench.test.ts` 的对比度门）。
 *
 * `neutral` = 这个字段出现之前的行为，逐字不变：不覆盖任何 token。
 */
export const PrototypeAccent = z.enum([
  "neutral", "blue", "violet", "teal", "green", "amber", "rose", "slate",
]);
export type PrototypeAccent = z.infer<typeof PrototypeAccent>;

/**
 * 每个档位在**浅色画布 / 深色画布**下的实际取值。HSL 三元组字符串，与
 * `app/globals.css` 里 token 的写法逐字同形——画布把它们直接写进 `--primary` /
 * `--primary-foreground` / `--ring` 的内联 style，整棵树因此跟着变，
 * 不需要在渲染表里逐个节点改颜色。
 *
 * ⚠ 两套值不是"同一个色的明暗变体"，是**各自为自己那块底色挑的**：浅色画布上是深色块
 *   配白字，深色画布上是亮色块配近黑字——与 `globals.css` 里 `--primary` 在 `:root`
 *   与 `.dark` 下的取向一致。照搬一套到另一套，结果是按钮上的字读不出来。
 *
 * ⚠ 改这里的任何一个数，对比度门会重算。**不要为了"更好看"把对比度压到 4.5 以下**：
 *   那不是好看，是别人读不了。
 */
export interface PrototypeAccentTokens {
  /** 强调面的底色（HSL 三元组）。 */
  readonly primary: string;
  /** 压在上面的字色。 */
  readonly foreground: string;
}

/**
 * 迭代 19：**低保真线框图**用的灰阶。与 `PROTOTYPE_ACCENTS` 放在一起、走同一条对比度门。
 *
 * 为什么它也要两套值：这些 token 不只当块的底色，也当**文字色**（底部导航当前项、
 * info badge、列表勾）。实测深色画布下灰 46% 的文字压在卡片上只有 3.65:1，低于 AA——
 * **低保真不是"可以读不清"的借口**。
 *
 * 放进契约而不是留在画布组件里，正是为了让它被那条门看见：这次差点又漏掉一次
 * 「新来的颜色没人验对比度」。
 */
export const PROTOTYPE_WIREFRAME: Readonly<Record<"light" | "dark", PrototypeAccentTokens>> = {
  light: { primary: "220 9% 46%", foreground: "0 0% 100%" },
  dark: { primary: "220 9% 70%", foreground: "220 15% 12%" },
};

export const PROTOTYPE_ACCENTS: Readonly<
  Record<Exclude<PrototypeAccent, "neutral">, { readonly light: PrototypeAccentTokens; readonly dark: PrototypeAccentTokens }>
> = {
  blue:   { light: { primary: "221 83% 41%", foreground: "0 0% 100%" }, dark: { primary: "213 94% 73%", foreground: "222 47% 11%" } },
  violet: { light: { primary: "262 72% 45%", foreground: "0 0% 100%" }, dark: { primary: "255 92% 79%", foreground: "258 45% 15%" } },
  teal:   { light: { primary: "184 82% 27%", foreground: "0 0% 100%" }, dark: { primary: "172 66% 62%", foreground: "185 60% 12%" } },
  green:  { light: { primary: "142 66% 26%", foreground: "0 0% 100%" }, dark: { primary: "141 70% 66%", foreground: "144 61% 12%" } },
  amber:  { light: { primary: "26 90% 33%",  foreground: "0 0% 100%" }, dark: { primary: "43 96% 66%",  foreground: "28 74% 12%" } },
  rose:   { light: { primary: "346 77% 40%", foreground: "0 0% 100%" }, dark: { primary: "351 95% 77%", foreground: "344 62% 13%" } },
  slate:  { light: { primary: "215 25% 30%", foreground: "0 0% 100%" }, dark: { primary: "213 27% 76%", foreground: "217 33% 12%" } },
};

/* ─────────── 对标 R1（#3933）：设计 token——任意品牌色与字体 ─────────── */

/**
 * 品牌色：`#RRGGBB`。
 *
 * ## 为什么在八档强调色之外还要放开一个任意色
 *
 * 强调色档位（`PrototypeAccent`）的理由是「只有这几档，原语才看起来像一个产品」——那条对
 * **原语的尺寸与圆角**成立，对**品牌色**不成立：一家餐厅说「我们的橙是 #FF5A1F」，给他一个
 * 最接近的 amber，就是没听他说话。Claude Design 能按团队的品牌出稿，这是对标评测 D1 里
 * 最直观的一段差距。
 *
 * 放开的代价是**对比度**：任意色上压什么字不再是人挑的。所以前景色不收用户输入，由
 * `brandAccentTokens` 在白字与近黑字里挑对比度高的那个（机械门控见契约测试，≥ 4.5）。
 * 底色**逐字**用品牌色本身——品牌色被悄悄调暗一档，比字不好读更让品牌方难受；
 * 真读不清的中间色（两边都 < 4.5）也照用，按钮字换成对比度更高的那个，不改底色。
 */
export const BrandColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "brand must be #RRGGBB");
export type BrandColor = z.infer<typeof BrandColor>;

/**
 * 字体档位。与强调色同一条纪律：**档位名进库，实际字体栈在 `PROTOTYPE_FONT_STACKS`**——
 * 存字体名等于把设计系统抄进数据库。四档覆盖常见的品牌气质：现代（sans）、有质感（serif）、
 * 亲和（rounded）、极客（mono）。
 */
export const PrototypeFont = z.enum(["sans", "serif", "rounded", "mono"]);
export type PrototypeFont = z.infer<typeof PrototypeFont>;

/**
 * 每档字体的 CSS 字体栈——**只此一处**，画布、导出的 HTML、分享页都读它。
 * 中文字体放在西文字体之后：西文字符先命中西文字体，中文落到对应气质的中文字体。
 * `sans` 是 `inherit`：跟随产品本身的字体（这个字段出现之前的行为，老项目一个像素都不变）。
 */
export const PROTOTYPE_FONT_STACKS: Readonly<Record<PrototypeFont, string>> = {
  sans: "inherit",
  serif: '"Noto Serif SC", "Source Han Serif SC", "Songti SC", Georgia, "Times New Roman", serif',
  rounded: '"Nunito", "Varela Round", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  mono: '"JetBrains Mono", Menlo, Consolas, "Courier New", monospace',
};

/**
 * 对标 R2（#3933）：**项目级**圆角档位——一处改、整套原型的按钮/卡片/输入框一起变。
 *
 * 与节点自己的 `radius`（none/sm/md/lg/full）是两层：节点说「我是小圆角还是大圆角」（层级），
 * 项目说「这套产品整体是直角、常规还是圆润」（气质）。画布按两者组合取类名，
 * 仍然只落在 `rounded-control / rounded-card / rounded-container` 这几档上（lint-design U11）。
 */
export const PrototypeRadiusScale = z.enum(["sharp", "default", "round"]);
export type PrototypeRadiusScale = z.infer<typeof PrototypeRadiusScale>;

/**
 * 对标 R2：项目级信息密度——整套原型的间距与内边距整体收紧或放宽一档。
 * 同上，节点的 `gap`/`padding` 是层级，这里是气质；画布把两者组合成 Tailwind 的间距档位。
 */
export const PrototypeDensity = z.enum(["compact", "default", "comfortable"]);
export type PrototypeDensity = z.infer<typeof PrototypeDensity>;

/**
 * 项目级设计 token。**一个对象、一列**（`design_projects.tokens jsonb`）：以后加圆角、密度
 * 是往这里加键，不是每加一项开一列、在十个地方各接一次线。
 * 缺省值 = 这个字段出现之前的行为（`brand: null` 不覆盖强调色，`font: sans` 跟随产品字体）。
 */
export const DesignTokens = z
  .object({
    /** `null` = 不用品牌色，沿用 `accent` 档位。给了 ⇒ 覆盖 `accent`。 */
    brand: BrandColor.nullable().default(null),
    font: PrototypeFont.default("sans"),
    /** 对标 R2：缺省 `default` = 这个键出现之前的圆角，逐像素不变。 */
    radius: PrototypeRadiusScale.default("default"),
    /** 对标 R2：缺省 `default` = 这个键出现之前的间距，逐像素不变。 */
    density: PrototypeDensity.default("default"),
  })
  .strict();
export type DesignTokens = z.infer<typeof DesignTokens>;
export const DEFAULT_DESIGN_TOKENS: DesignTokens = { brand: null, font: "sans", radius: "default", density: "default" };

function hexToRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 相对亮度。 */
function relativeLuminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 两色（`#RRGGBB`）的 WCAG 对比度。契约测试用它守住品牌色上的字。 */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(hexToRgb(a)), relativeLuminance(hexToRgb(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHslTriple([r, g, b]: readonly [number, number, number]): string {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
    h /= 6;
  }
  // 保留一位小数：取整会让 #FF5A1F 这类色回转后差一个色阶（评测按 rgb 精确比对）。
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return `${r1(h * 360)} ${r1(sat * 100)}% ${r1(l * 100)}%`;
}

/**
 * 品牌色上的两种字：白与纯黑。
 *
 * ⚠ 暗的那一个必须是**纯黑**，不是产品里常用的近黑：任意色上「白与黑挑对比度高的那个」
 *   的最坏情况是亮度 ≈ 0.18 的中间色，纯黑时两边都是 ≈ 4.58（过 AA），近黑 #111317 时
 *   最坏只有 ≈ 4.3——那一小段中间色上的按钮字会读不清。契约测试扫全色域守着这条。
 */
export const BRAND_FOREGROUND_LIGHT = "#FFFFFF";
export const BRAND_FOREGROUND_DARK = "#000000";

/**
 * 品牌色 ⇒ 与强调色同形的 token（HSL 三元组），画布照样写进 `--primary` / `--primary-foreground`。
 * 明暗两套画布用**同一个**品牌色（品牌就是品牌）；字色在白与近黑里挑对比度高的那个。
 */
export function brandAccentTokens(brand: BrandColor): PrototypeAccentTokens {
  const onLight = contrastRatio(brand, BRAND_FOREGROUND_LIGHT);
  const onDark = contrastRatio(brand, BRAND_FOREGROUND_DARK);
  const fg = onLight >= onDark ? BRAND_FOREGROUND_LIGHT : BRAND_FOREGROUND_DARK;
  return { primary: rgbToHslTriple(hexToRgb(brand)), foreground: rgbToHslTriple(hexToRgb(fg)) };
}

/* ─────────── 迭代 13：从已有对话导入（design-delta `design-chat-inputs` §2） ─────────── */

/**
 * 一次导入最多读线程里**最近**多少条消息。
 *
 * 有上限不是为了省钱（虽然也省），是因为一条聊了三个月的线程里，前面那些早已被后面推翻的
 * 需求会把摘要带偏——「最近 N 条」比「全部」更接近用户说「照那个做」时脑子里的那段。
 * 超出时**必须留痕说明截断了**（见 `importThread` 头注）：静默截断会让用户以为模型看过
 * 那段它其实没看过的对话，这是本仓反复栽过的形态。
 */
export const IMPORT_THREAD_MAX_MESSAGES = 40;

/**
 * 迭代 16（#3773 R3）：一次导入最多带回几条验收标准。
 *
 * 与 `DesignChatWriteback.criteria` 的上限（20）同量级、同形状（≤ 200 字一条）——
 * 它们写的是**同一个字段**，两边口径不一样的表现是「模型写得进去、导入写不进去」。
 */
export const IMPORT_THREAD_MAX_CRITERIA = 20;
export const ImportedCriterion = z.string().min(1).max(200);

/**
 * 一次导入的**留痕**：这一刻从哪条线程读了多少条。
 *
 * ⚠ 它是**事实记录，不是订阅句柄**（delta §2.1 取舍 ③=A）。项目不长期挂靠线程：
 *   `threadId` 留在这里只是为了半年后还答得出「这个项目的背景是从哪来的」，
 *   没有任何读路径会拿它回头再读一次线程。选 B（长期挂靠、每轮实时读）会让
 *   「这个设计是照什么做的」变成一个会变的东西，而设计评审要的恰恰是一个定住的输入。
 */
export const ImportedThread = z
  .object({
    threadId: z.string(),
    /** 线程标题——**服务端从线程读出来的**，不是前端传上来的（前端那份不可信）。 */
    title: z.string(),
    /** 本次真的读进摘要的条数（截断之后的数，不是线程总条数）。 */
    messageCount: z.number().int().nonnegative(),
    at: z.string(),
  })
  .strict();
export type ImportedThread = z.infer<typeof ImportedThread>;

/**
 * 画布页标签默认值。**空数组**（2026-09-08 人类实测反馈：「不要默认三个页面，有点奇怪」）。
 *
 * R4.4 当初填三个「草稿页」是因为 B5.3 之前画布内容本身就是占位块，标签是「页」这个概念
 * 唯一的载体——没有标签就什么都看不见。B5.3 之后画布画的是真组件树，页数应当由模型按
 * 用户描述的产品来定；预填三个空页会让新项目一打开就摆着三块永远不会被用到的占位屏，
 * 而且模型看到「画布页标签：["草稿页 1","草稿页 2","草稿页 3"]」还会以为这是要保留的页面划分。
 *
 * 空数组是合法状态：`DesignProject` 的不变量是 `prototype.length === 0 || === frames.length`，
 * 两者同时为 0 满足它。界面在 0 页时画空态（「还没有页面，在左边描述你要的产品」）。
 */
export const DESIGN_PROJECT_INITIAL_FRAMES: readonly string[] = [];

/**
 * 对话面板空状态引导语（R4.4：「无历史时一条默认引导语」）。**展示层文案，不落库**——
 * 选择理由见文件头【待确认点 2】。api 不会在任何响应里返回这段文字当作一条 `chat` 记录；
 * 前端在 `chat.length === 0` 时本地渲染它。
 */
export const DESIGN_WORKBENCH_CHAT_INTRO =
  "把你想解决的问题说清楚，我会顺着它更新右边的原型画布和验收标准。可以先从「谁在什么场景下会用到」讲起。";

/**
 * 迭代 9：空项目的起手模板——三条现成的第一句话，点一下即发。展示层文案，不落库；
 * 与引导语同源在这里声明一次（api/web 共用），不在前端另写一份。
 */
export const DESIGN_WORKBENCH_STARTERS: readonly { readonly label: string; readonly prompt: string }[] = [
  { label: "对话助手", prompt: "给我设计一个像 ChatGPT 的对话助手：会话列表、消息流、输入区（发送/停止）、空态与加载态。" },
  { label: "数据看板", prompt: "设计一个运营数据看板：顶部 3 个核心指标，中间趋势区，底部可筛选的明细列表，带空态。" },
  { label: "表单流程", prompt: "设计一个三步表单流程：填写信息 → 确认 → 完成，每步有校验错误态和返回上一步。" },
];

/**
 * 对话面板发送后的固定回执。D7（2026-09-02）上线时它是唯一路径；**UC-17.8 B5.2 起它是模型
 * 不可用/超时/输出为空时的退路**（`DesignProjectChatTurn.source: "fallback"`，见
 * `design-ai-collab.ts` 头注）。同 `feedback-loop.ts` 的纪律，回执文案在这里只声明一次。
 */
/**
 * ⚠ 2026-09-07 用户实测：原文案是「好的，我记下了这个调整，稍后会更新原型画布。」——这是
 * 一句**不会兑现的承诺**。走到这条退路时模型压根没被调用，没有任何后台任务在排队，画布
 * 永远不会"稍后更新"。用户因此连发两条、等了很久，才来问"为什么还是没出来"。
 * 退路必须说实话：这次没有生成、为什么、以及他能做什么。
 */
export const DESIGN_WORKBENCH_CHAT_REPLY = "这次没有生成画布——AI 模型没能返回结果。你的这条消息已经记下，可以稍后重试；如果一直这样，让运维看一眼这个部署的模型配置。";


/**
 * 迭代 30 —— 一句话的字数上限（单源）。
 *
 * `4000` 在本文件里原本以字面量出现六次（对话轮次、`appendProjectChat` 的入参、
 * `problem` 的四处）。界面上**一次都没出现过**：用户从别处粘一段长需求进来，
 * 按下发送才被服务端拒掉，而那时他已经等了一次往返。
 * 前端要在发送之前就说得出这个数，所以它必须是一个能被 import 的常量，
 * 而不是抄到输入框旁边的第二份 4000。
 */
export const DESIGN_TEXT_MAX_CHARS = 4000;

/* ─────────────────────────── 实体 ─────────────────────────── */

/**
 * 设计项目对话轮次。形状同 `feedback-loop.ts` 的 `FeedbackDraftChatTurn`，但没有 `kind`
 * （设计项目的对话没有「编辑正文」这个来源分支，草稿有）。
 */
export const DesignProjectChatTurn = z
  .object({
    role: z.enum(["user", "ai"]),
    text: z.string().min(1).max(DESIGN_TEXT_MAX_CHARS),
    at: z.string(),
    /** B5.2：`role: "ai"` 的记录带来源（模型 / 退路）；`user` 记录与 B5.2 之前的旧记录没有 */
    source: AiReplySource.optional(),
  })
  .strict();
export type DesignProjectChatTurn = z.infer<typeof DesignProjectChatTurn>;

/**
 * UC-17.8 B4 —— PM 设计项目。
 *
 * ⚠ 可见性口径见文件头【待确认点 1】：**组织内全员可读，仅 owner 可改/删/推送**。
 *   `ownerName` 可为 `null`——同 `InboxItem.reporter` 的 D3 口径写法：调用方拿不到姓名时
 *   （比如 owner 已离开组织）不是错误，是「说不出来」，与「没有 owner」（不存在，本类型没有
 *   这种情况——项目恒有 owner）区分开。
 * ⚠ `criteria` / `frames` 是创建时由服务端按 `DESIGN_PROJECT_INITIAL_CRITERIA` /
 *   `DESIGN_PROJECT_INITIAL_FRAMES` 填入的**快照**，不是每次读取都重算的常量引用——
 *   将来若默认文案改版，已创建项目的验收标准不应该跟着变。
 *   UC-17.8 B5.2 起，`problem`/`criteria`/`frames` 可由 `appendProjectChat` 里的模型回复
 *   **经服务端**写回（`DesignChatWriteback` 严格解析）；用户仍不能直接编辑 `criteria`/`frames`。
 * ⚠ B5.3：`prototype[i]` 是 `frames[i]` 那一页的组件树。不变量：长度为 0（还没生成，画布显示
 *   占位块）或恰等于 `frames.length`——由下方 `superRefine` 机械门控，任何一端违反都解析失败。
 */
/**
 * 迭代 13（delta §4）—— 项目标签。
 *
 * 上限 8 是**成本以外**的判断：卡片上放得下、过滤 chip 一行放得下；再多就不是"标签"
 * 而是第二套目录结构了。单个 20 字同理——超过就是把标签当描述用。
 *
 * ⚠ 标签**不另建一张表**：它是项目的属性，"有哪些标签"从现有项目派生（V66）。
 *   独立的标签表会留下没有任何项目引用的孤儿标签，然后长出"清理孤儿标签"这件事。
 */
export const DESIGN_PROJECT_MAX_TAGS = 8;
export const DESIGN_PROJECT_TAG_MAX_CHARS = 20;
export const DesignProjectTag = z.string().trim().min(1).max(DESIGN_PROJECT_TAG_MAX_CHARS);
export const DesignProjectTags = z.array(DesignProjectTag).max(DESIGN_PROJECT_MAX_TAGS);

/* ─────────── 迭代 22：发布与分享（对外只读链接） ─────────── */

/**
 * 分享链接带出去多少东西。**闭集两档**，默认 `prototype`。
 *
 * 为什么必须有这个开关、而不是"分享就是分享整个项目"：`problem` 很可能是从一条内部
 * 对话线程导进来的（`importThread`），里面带着立项背景、内部吐槽、客户名字。把一个
 * 原型发给外部评审，和把立项讨论发给外部评审，是两件事。
 *
 * ⚠ **两档都不含 `chat`**。对话是设计过程里最容易夹带内部信息的地方（澄清问答、
 *   "老板说不行"、模型的失败退路），它永远不随链接出去——这一条由
 *   `SharedDesign` 的字段闭集在编译期钉住，不是一句承诺。
 */
export const DesignShareScope = z.enum(["prototype", "full"]);
export type DesignShareScope = z.infer<typeof DesignShareScope>;

/** 一个项目当前的发布状态（未发布 ⇒ `DesignProject.share` 为 `null`）。 */
export const DesignShare = z
  .object({
    /** 链接里的那串令牌。owner 自己看得到（要能再复制一次），别人读项目时**不返回**（见下方 `DesignProject.share` 头注）。 */
    token: z.string().nullable(),
    scope: DesignShareScope,
    publishedAt: z.string(),
    /**
     * 已发布的那一份与**现在画布上这一份**已经不一样了。
     *
     * 这个字段存在的理由就是本仓那条「静态痕迹 ≠ 动态事实」：发布一次之后，
     * 界面上留下的是「已分享」这个**痕迹**，而画布还在继续改。没有它，用户以为
     * 对方看到的是最新稿，对方看到的其实是三轮之前——而两边都不会发现。
     * 由服务端逐字段比对快照与当前行算出，不是前端猜的。
     */
    stale: z.boolean(),
  })
  .strict();
export type DesignShare = z.infer<typeof DesignShare>;

export const DesignProject = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(200),
    template: ProjectTemplate,
    /** 背景/上下文（问题与目标）。可空字符串——新建时未填，不是 `null`（同 `FeedbackDraft.detail`） */
    problem: z.string().max(DESIGN_TEXT_MAX_CHARS),
    criteria: z.array(z.string()),
    frames: z.array(z.string()),
    /**
     * 按位置对应 `frames[i]` 的树。**`null` = 这一页规划了但没画出来**（issue #3340）。
     *
     * 迭代 12 的分页生成里，第 i 页失败只损失第 i 页——但在此之前失败页是**直接丢掉**的，
     * 于是用户要 5 页、只看到 3 页，页与页之间没有任何痕迹说明另外 2 页去哪了
     * （用户原话：「一次性生成了全部5个页面，且界面质量很差，似乎未经过迭代」）。
     * 契约 §1.2 本来就写了「`screens[i].root === undefined` ⇒ 未生成」，存储层
     * （`StoredScreen.root` 可选）一直支持，缺的是**读侧能表达这个洞**——此前只要有一页
     * 缺树，整份 `prototype` 就投影成 `[]`（全有全无）。
     *
     * ⚠ 模型写回不走这里：`DesignPrototypeWriteback` 的 `root` 仍是**必给**。`null` 只能由
     * 服务端写（哪一页没画出来是服务端知道的事实），模型没有「这页我不画」这个表达。
     */
    prototype: z.array(PrototypeNode.nullable()),
    /** 迭代 8：每页交互说明，按位置对应 `frames[i]`；长度 0（没写）或 = `frames.length`。空串 = 这页没写。 */
    frameNotes: z.array(z.string()),
    /** 迭代 13（delta §1）：项目挂着的参考图，只有元信息不含字节。 */
    refImages: z.array(RefImage).max(PROTOTYPE_MAX_REF_IMAGES).default([]),
    /**
     * 迭代 13（delta §5.2）：**原型自己的**明暗主题，与后台页面的主题无关——
     * 做深色 app 的人要看浅色稿，不该被迫把整个后台切成浅色。
     * 缺省 `dark` = 这个字段出现之前的行为（画布跟随后台，而后台是深色）。
     * 导出的 HTML / PDF 跟随**它**，不是导出时后台碰巧是什么色。
     */
    theme: z.enum(["light", "dark"]).default("dark"),
    /**
     * 迭代 17：原型的强调色档位。缺省 `neutral` = 这个字段出现之前的行为（不覆盖任何 token），
     * 所以老项目读出来一个像素都不会变。
     */
    accent: PrototypeAccent.default("neutral"),
    /**
     * 对标 R1（#3933）：项目级设计 token（品牌色、字体）。老行没有这一列 ⇒ 全是缺省值，
     * 与这个字段出现之前的渲染逐像素相同。导出的 HTML / 分享页跟随它。
     */
    tokens: DesignTokens.default(DEFAULT_DESIGN_TOKENS),
    /** 迭代 13（delta §4）：项目标签，用于首页过滤。老行没有这一列 ⇒ 空数组。 */
    tags: DesignProjectTags.default([]),
    /**
     * 迭代 11（design-delta `prototype-navigation`，待签核）：每页出发的跳转关系，`frameLinks[i]` 属于
     * `frames[i]`。可省略（服务端接线前不发；UI 先行阶段由夹具提供）。存储形状见 delta §5。
     */
    frameLinks: z.array(z.array(PrototypeLink)).optional(),
    pushed: z.boolean(),
    pushedAt: z.string().nullable(),
    /** 本项目是否深化自某条反馈；见文件头「与 inbox.ts 的关系」 */
    linkedFeedbackId: z.string().nullable(),
    /**
     * 2026-09-05「转开发」——这个方案对应的 GitHub issue。两个字段**同生同灭**
     * （要么都非空，要么都为 `null`），由 `createDesignGithubIssue` 一次写入。
     *
     * ⚠ 这里**没有** issue 的开关状态（`open`/`closed`）。设计方案不落 `dev_status`
     *   列——那会与 GitHub 上那张 issue 的真实状态构成第二份事实源（见迁移
     *   `20260905180000_design_project_github_issue.sql` 头注「为什么不顺手加一个
     *   dev_status 列」）。收件箱据「有没有 issue」派生 stage，见 `inbox.ts`。
     */
    githubIssueUrl: z.string().nullable(),
    githubIssueNumber: z.number().int().positive().nullable(),
    /**
     * 迭代 22：这个项目的发布状态；`null` = 没发布过（或已取消发布）。
     *
     * ⚠ `share.token` 只对 **owner** 返回，其他组织成员读到的是 `null`——组织内全员可读
     *   说的是"看得见这个项目"，不是"可以替 owner 把它发到组织外面去"。那两件事之间
     *   隔着一次明确的发布动作，而令牌就是那次动作的凭证。
     */
    share: DesignShare.nullable().default(null),
    chat: z.array(DesignProjectChatTurn),
    ownerId: z.string(),
    /** 见上方可见性口径注释 */
    ownerName: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.prototype.length !== 0 && p.prototype.length !== p.frames.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "prototype must be empty or one tree per frame", path: ["prototype"] });
    }
    if (p.frameNotes.length !== 0 && p.frameNotes.length !== p.frames.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "frameNotes must be empty or one note per frame", path: ["frameNotes"] });
    }
    if (p.frameLinks !== undefined && p.frameLinks.length !== 0 && p.frameLinks.length !== p.frames.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "frameLinks must be empty or one list per frame", path: ["frameLinks"] });
    }
  });
export type DesignProject = z.infer<typeof DesignProject>;

/**
 * 一个**已发布**设计项目对外的只读投影——免登录的分享页读到的全部内容。
 *
 * ## 这里的字段闭集就是隐私边界本身
 *
 * 它刻意**不是** `DesignProject.omit(...)`：`omit` 的默认方向是"新加的字段自动跟着漏出去"。
 * 本仓已经五次栽在"一处加了数据、下游少了一处跟进"上；在一条对**公网**开放的投影上，
 * 那个方向的默认值必须反过来——**新字段默认不出去**，要出去得在这里显式写一行。
 *
 * 所以这里没有、且不许有：`chat`（对话）、`refImages`（参考图字节的句柄）、`ownerId`、
 * `linkedFeedbackId`、`githubIssueUrl`、`pushed`、`tags`、`id`。
 * 由 `packages/contracts/tests/design-workbench.test.ts` 的字段闭集断言守着（加一个字段
 * 而不更新那条断言 ⇒ 红）。
 */
export const SharedDesign = z
  .object({
    name: z.string(),
    template: ProjectTemplate,
    theme: z.enum(["light", "dark"]),
    accent: PrototypeAccent,
    /** 对标 R1：品牌色与字体是原型长相的一部分，访客看到的必须和设计者看到的一样。 */
    tokens: DesignTokens,
    frames: z.array(z.string()),
    /** 与 `DesignProject.prototype` 同形：单项 `null` = 这一页规划了但没画出来。 */
    prototype: z.array(PrototypeNode.nullable()),
    frameNotes: z.array(z.string()),
    frameLinks: z.array(z.array(PrototypeLink)),
    /** 发布**那一刻**的时间——不是项目的 `updatedAt`。访客据它知道自己看的是哪一版。 */
    publishedAt: z.string(),
    /** 谁发布的。`null` = 取不到名字（不编一个）。 */
    ownerName: z.string().nullable(),
    /** `scope: "full"` 才有；`"prototype"` 档恒为 `null`（不是空串——空串会被渲染成"写了但是空的"）。 */
    problem: z.string().nullable(),
    criteria: z.array(z.string()).nullable(),
  })
  .strict();
export type SharedDesign = z.infer<typeof SharedDesign>;

/* ─────────────────────────── 错误码 ─────────────────────────── */

/**
 * 错误码。⚠ 每一个成员都在下方某个操作的 `err` 里出现。
 *
 * 没有 `ALREADY_PUSHED`——`pushToInbox` 是 upsert，重复推送不是错误，见文件头「推送幂等」。
 */
export const DesignWorkbenchError = z.enum([
  /** 项目不存在，或存在但请求者所在组织与项目不一致 */
  "PROJECT_NOT_FOUND",
  /** `name` 为空或超过 200 字（`createProject`/`updateProject` 共用） */
  "NAME_REQUIRED",
  /** 改/删/推送时请求者不是该项目的 owner。见文件头【待确认点 1】：读操作不受此限 */
  "NOT_PROJECT_OWNER",
  /** 超时/网络/下游不可用 */
  "DEPENDENCY_UNAVAILABLE",
  /** 迭代 3：原型版本不存在（或不属于该项目） */
  "VERSION_NOT_FOUND",
  /**
   * 迭代 13：参考图被拒——类型不在闭集、超过单张上限、或这个项目已经挂满 3 张。
   * 三种情形合成一个码：屏上给用户的下一步是同一句「换一张小一点的 PNG/JPEG/WebP」，
   * 分成三个码只会让前端多写两条一模一样的文案。具体是哪一种进日志。
   */
  "REF_IMAGE_REJECTED",
  /** 迭代 5：人直接改画布的 patch 没通过（未知 id / 删根 / 结果不合法 / 还没有原型）——`detail` 说明哪一条 */
  "PROTOTYPE_PATCH_REJECTED",
  /**
   * B4.4「用 PM 设计工作台深化」——源反馈不存在或不在本组织。
   * 同 `feedback-loop.ts` 的 `FEEDBACK_NOT_FOUND` 纪律：404 非 403，不泄露存在性。
   */
  "FEEDBACK_NOT_FOUND",
  /**
   * B4.4——请求者对这条反馈没有 D3 正文可见权（`feedback-detail-decision.ts`）。「深化」要把
   * 正文抄进 `problem`，看不到正文就不可能有意义地深化；同 `feedback-loop.ts` 的
   * `PERMISSION_REVOKED` 同一语义，这里不复用那个枚举（跨文件枚举会让"闭集在哪"分裂成两处）。
   */
  "FEEDBACK_DETAIL_NOT_VISIBLE",
  /**
   * 2026-09-05「转开发」——这个方案还没有推送到收件箱。转开发是**运维动作**，
   * 前提是这个方案已经作为收件箱条目存在；给一个还在草台上的私人方案建 issue
   * 会让 GitHub 上出现一张收件箱里找不到对应条目的票。
   */
  "PROJECT_NOT_PUSHED",
  /**
   * 2026-09-05——这个方案已经有 issue 了。**不是** upsert：`pushToInbox` 能 upsert
   * 是因为它写的是自己这张表的两列；建 issue 是一次不可回滚的外部副作用，
   * 「重复调用返回已有的那张」与「再建一张」都不对——前者悄悄吞掉一次明确的用户意图，
   * 后者让一个方案挂两张票。所以显式报错，让调用方看到已有的那张。
   */
  "DESIGN_ISSUE_ALREADY_EXISTS",
  /** 2026-09-05——另一个并发请求正在给这个方案建 issue（乐观锁未抢到，见迁移头注）。 */
  "DESIGN_ISSUE_IN_PROGRESS",
  /** 2026-09-05——GitHub 那一侧建失败（超时/鉴权/限流）。fail closed：库里不会留下半个 issue。 */
  "DESIGN_ISSUE_CREATION_FAILED",
  /** 深度 S2：批注不存在，或不属于这个项目。 */
  "COMMENT_NOT_FOUND",
  /** 深度 S2：删批注的人既不是作者也不是项目 owner。改状态（解决 / 重新打开）不受此限——那是讨论本身。 */
  "NOT_COMMENT_AUTHOR",
  /** 深度 S2：这个项目的批注已经到上限（`DESIGN_COMMENT_MAX_PER_PROJECT`），先删掉一些已解决的；S3 起一条批注的回复到上限（`DESIGN_COMMENT_MAX_REPLIES`）也用它。 */
  "COMMENT_LIMIT_REACHED",
  /**
   * 迭代 22：分享链接打不开——令牌不对、项目已取消发布、或项目被删了。
   *
   * **三种情形合成一个码，且不区分**：对一条公网可达的链接，"这个令牌不存在"与
   * "这个令牌存在但已经取消发布"分开报，等于给试令牌的人一个进度条。同
   * `feedback-loop.ts` 的 404 非 403 纪律。
   */
  "SHARE_NOT_FOUND",
  /**
   * 迭代 22：这个项目还没有任何画出来的页，没什么可发布的。
   *
   * 不是"允许发布一个空链接"：访客打开看到一片空白，只会以为链接坏了——而链接是好的，
   * 坏的是"发布"这个动作本身在这一刻没有意义。
   */
  "NOTHING_TO_PUBLISH",
]);
export type DesignWorkbenchError = z.infer<typeof DesignWorkbenchError>;

/* ─────────────────────────── 迭代 3：原型版本 ─────────────────────────── */

/** 这一版是谁产生的：模型写回 / 人在画布直接改（迭代 5 起）/ 人从历史恢复。 */
export const PrototypeVersionSource = z.enum(["model", "user", "restore"]);
export type PrototypeVersionSource = z.infer<typeof PrototypeVersionSource>;

export const PrototypeVersionSummary = z
  .object({
    id: z.string(),
    /** 项目内从 1 递增；列表按它倒序。 */
    seq: z.number().int().positive(),
    source: PrototypeVersionSource,
    /** 一句话：模型那轮回复的前 120 字 / 「恢复自 v3」/ 人改的说明。可空字符串。 */
    summary: z.string().max(200),
    frames: z.array(z.string()),
    /** 迭代 8：那一版的每页交互说明（与 frames 同长或空）。 */
    notes: z.array(z.string()),
    createdAt: z.string(),
  })
  .strict();
export type PrototypeVersionSummary = z.infer<typeof PrototypeVersionSummary>;

// 版本快照同样可能含未生成的页（拍快照那一刻就缺）——与 `DesignProject.prototype` 同形。
export const PrototypeVersion = PrototypeVersionSummary.extend({ prototype: z.array(PrototypeNode.nullable()) }).strict();
export type PrototypeVersion = z.infer<typeof PrototypeVersion>;

/**
 * 对标 R9（#3954）：同一页的**候选方案**。`root` 是一整棵页树（过 `PrototypeNode` 契约）；
 * 候选**不落库**——人挑中一个之后，前端用既有 `replace` patch 把它换进去，于是版本历史与
 * 撤销走的是同一条路，不另开一套「方案」存储。
 */
export const PROTOTYPE_VARIANTS_MIN = 2;
export const PROTOTYPE_VARIANTS_MAX = 4;
/** 深度 S9（#3988）：不说要几个时出几个——服务端的缺省与界面上「要几个」的初值同一个数。 */
export const PROTOTYPE_VARIANTS_DEFAULT = 3;
export const PrototypeVariant = z.object({ summary: z.string().min(1).max(120), root: PrototypeNode }).strict();
export type PrototypeVariant = z.infer<typeof PrototypeVariant>;

/* ─────────── 深度 S2（#3988）：批注存在服务端 ─────────── */

/**
 * 钉在原型某个节点上的一句批注。R8 时它只存在浏览器里（`lib/design-comments.ts` 头注写了为什么）；
 * 换台电脑、清一次缓存、同事打开同一个项目，批注都看不见——而批注本来就是给别人（AI 或同事）看的。
 *
 * 可见性**跟随项目**（全组织可读），写权限也向全组织开放：批注的意义就是让不是 owner 的人也能说话。
 * 删除只允许作者本人或项目 owner（用例层判）。
 */
export const DESIGN_COMMENT_MAX_CHARS = 300;
export const DESIGN_COMMENT_MAX_PER_PROJECT = 200;
/** 深度 S3：一条批注下最多几条回复——讨论长到这个数，该当面聊或开一条新批注了。 */
export const DESIGN_COMMENT_MAX_REPLIES = 50;
export const DesignCommentReply = z
  .object({
    id: z.string(),
    text: z.string().min(1).max(DESIGN_COMMENT_MAX_CHARS),
    authorId: z.string(),
    authorName: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export type DesignCommentReply = z.infer<typeof DesignCommentReply>;
export const DesignComment = z
  .object({
    id: z.string(),
    /** 钉在哪个节点上（项目内唯一的节点 id）。节点后来被删了，批注照旧在，只是画布上没有钉。 */
    nodeId: PrototypeNodeId,
    frameIndex: z.number().int().min(0).max(PROTOTYPE_MAX_SCREENS - 1),
    /** 写批注那一刻这个节点叫什么——节点被删了，列表里仍认得出说的是谁。 */
    label: z.string().max(200),
    text: z.string().min(1).max(DESIGN_COMMENT_MAX_CHARS),
    /** 已解决（交给 AI 改了，或有人手动标记）。可以重新打开。 */
    resolved: z.boolean(),
    authorId: z.string(),
    authorName: z.string().nullable(),
    createdAt: z.string(),
    /** 深度 S3：这条批注下的讨论，按先后排。 */
    replies: z.array(DesignCommentReply).max(DESIGN_COMMENT_MAX_REPLIES),
  })
  .strict();
export type DesignComment = z.infer<typeof DesignComment>;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /**
   * 新建设计项目（首页「新建」弹窗 + B4.4「用 PM 设计工作台深化」共用）。
   *
   * ⚠ `criteria`/`frames`/`chat` 不接受前端传入：服务端按 `DESIGN_PROJECT_INITIAL_CRITERIA` /
   *   `DESIGN_PROJECT_INITIAL_FRAMES` 填入、`chat` 恒为 `[]`（见文件头【待确认点 2】）。
   * ⚠ `linkedFeedbackId` 可选：B4.4「深化」时由调用方（`POST /feedback/:id/deepen` 的服务端
   *   实现，不是前端直接传任意 id）传入；首页新建弹窗不传，恒为 `null`。契约层不校验这个 id
   *   指向的反馈是否存在/属于同一组织——那是 B4.3 用例层的职责（含回写 `resolvedByDesignId`）。
   */
  /**
   * 迭代 13：按一句 brief 生成澄清问题。**不落库、不建项目**——纯粹一次模型调用。
   * 模型不可用时**不失败**，回退到 §3.5 的通用六问并把 `fallback` 置真，让界面能说
   * 「AI 没能生成针对性的问题，先按通用的问一遍」。新建流程不能因为模型挂了就堵死。
   */
  intakeQuestions: {
    method: "POST",
    path: "/pm-designs/intake-questions",
    in: z.object({ brief: z.string().min(1).max(2000) }).strict(),
    out: z.object({ questions: z.array(IntakeQuestion).min(INTAKE_MIN_QUESTIONS).max(INTAKE_MAX_QUESTIONS), fallback: z.boolean() }).strict(),
    err: [] as const,
  },
  /**
   * 迭代 13：上传一张参考图。字节走 multipart，**类型按字节嗅探**不信 Content-Type
   * （与反馈附件同一条纪律，V51）。
   */
  uploadRefImage: {
    method: "POST",
    path: "/pm-designs/:projectId/ref-images",
    in: z.object({ projectId: z.string() }).strict(),
    /**
     * 连**整个项目**一起回——与 `deleteRefImage` 同形。只回 `image` 的话，前端要自己把它
     * 拼进手上那份 `project.refImages`，也就是在客户端维护第二份「现在有哪几张」；
     * 上传失败重试、两个标签页同时传，两份就会分叉。服务端那份是唯一的事实源，直接给回来。
     */
    out: z.object({ image: RefImage, project: DesignProject }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "REF_IMAGE_REJECTED"] as const,
  },
  deleteRefImage: {
    method: "DELETE",
    path: "/pm-designs/:projectId/ref-images/:imageId",
    in: z.object({ projectId: z.string(), imageId: z.string() }).strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER"] as const,
  },
  /**
   * 迭代 13（delta §2）：把一个**已有对话线程**这一刻的内容抽成摘要，作为这个设计项目的背景。
   *
   * ## 语义是一次性导入，不是持续订阅
   *
   * 选中 ⇒ 这一刻抽一段摘要 ⇒ 用户可编辑 ⇒ 确认才写进 `problem`。线程**后来变了，
   * 项目的 `problem` 不跟着变**（delta §2.1 取舍 ③=A）。所以这里没有任何"挂靠"字段：
   * `ImportedThread` 只是留痕，不是句柄。
   *
   * ## 两个阶段，一条操作
   *
   * 契约 delta §2.2 写的入参是 `{ threadId }`，§2.3 又要求「**不确认不写**」——直接写会
   * 覆盖用户已经写好的 `problem`。两者只能靠 `problem` 这个**可选**入参同时成立：
   *
   *   · **不给 `problem`** ⇒ 预览：判权、读线程、摘要，`summary` 回传给前端渲染成可编辑
   *     的预览框。**项目一个字不改**（返回的 `project` 就是当前这一份）。
   *   · **给了 `problem`** ⇒ 确认：写进项目，并在 `chat` 里追加一条 `source: "system"` 的
   *     留痕。写进去的是**用户在预览里编辑之后**的这段文本，不是服务端重新摘要一遍——
   *     重新摘要会把他的修改冲掉，而那正是这两个阶段存在的理由。
   *
   * ⚠ 确认阶段**照样**重新判权、重新读线程：`title`/`messageCount` 是要写进留痕的事实，
   *   信前端传上来的那份等于让留痕可以被伪造。
   *
   * ## 只读调用者自己有权读的线程
   *
   * 走 `chat` 束 `getThread` 的**同一条**鉴权路径（`resolveVisibility` → 守卫读路径），
   * 不新开一条直接查库的读。看不见的线程与不存在的线程是**同一个出口**（`chat` 束 I-3
   * 的 404，不带 `reasonCode`）——所以这里的 `err` 闭集里没有它：那不是设计工作台的
   * 错误码，是对话束的既有拒绝，连标题都不该泄露。
   */
  importThread: {
    method: "POST",
    path: "/pm-designs/:projectId/import-thread",
    in: z
      .object({
        projectId: z.string(),
        threadId: z.string(),
        /** 见头注「两个阶段」：省略 = 预览（不写）；给出 = 确认写入这段（用户编辑后的）文本。 */
        problem: z.string().max(DESIGN_TEXT_MAX_CHARS).optional(),
        /**
         * 迭代 16（#3773 R3）：确认阶段一并写入的**验收标准**（用户在预览里改过的那份）。
         *
         * 省略 = 不动项目现有的 `criteria`（不是"清空"）。只在 `problem` 也给出时有意义——
         * 它和 problem 是同一次导入的两半，分开写会让"这个项目的背景是从哪来的"
         * 出现两个时间点。
         */
        criteria: z.array(ImportedCriterion).max(IMPORT_THREAD_MAX_CRITERIA).optional(),
      })
      .strict(),
    out: z
      .object({
        /** 预览阶段是**未改动**的当前项目；确认阶段是写入之后的。 */
        project: DesignProject,
        imported: ImportedThread,
        /** 预览阶段：模型生成的摘要正文（给用户编辑）。确认阶段：本次真正写进 `problem` 的那段。 */
        summary: z.string(),
        /**
         * 迭代 16（#3773 R3）：从同一段对话里抽出来的**验收标准建议**。
         *
         * 为什么不只给一段 `problem`：一次产品讨论里真正难复述的恰恰是那些具体口径
         * （「导出成功率 ≥ 99%」「历史会话要能继续」）。把它们一起压进 600 字散文，
         * 等于让用户再读一遍对话把它们挑出来——而他要的正是别自己复制粘贴。
         *
         * 抽不到 ⇒ **空数组**，不是编几条。没聊到的口径不许替他造。
         */
        criteria: z.array(ImportedCriterion).max(IMPORT_THREAD_MAX_CRITERIA),
        /** 线程长于 `IMPORT_THREAD_MAX_MESSAGES` ⇒ 真。屏上与留痕都要说出来，不许静默截断。 */
        truncated: z.boolean(),
      })
      .strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },
  createProject: {
    method: "POST",
    path: "/pm-designs",
    in: z
      .object({
        name: z.string().min(1).max(200),
        template: ProjectTemplate,
        problem: z.string().max(DESIGN_TEXT_MAX_CHARS).optional(),
        linkedFeedbackId: z.string().optional(),
        /** 迭代 13：新建时就能定主题；缺省 `dark`。 */
        theme: z.enum(["light", "dark"]).optional(),
        /** 迭代 17：强调色档位。省略 = 不动（不是"改回 neutral"）。 */
        accent: PrototypeAccent.optional(),
        /**
         * 迭代 13：澄清问答的结果。给出即由服务端汇进 `problem`（可验收的条目进 `criteria`）。
         * 与 `problem` 同时给出时：`problem` 是用户在预览里**编辑过**的最终文本，以它为准；
         * `intake` 只用来补 `criteria`——否则用户在预览里的修改会被重新汇总覆盖掉。
         */
        intake: z.array(IntakeAnswer).max(INTAKE_MAX_QUESTIONS).optional(),
        /** 迭代 13（delta §4）：新建时就能打标签。 */
        tags: DesignProjectTags.optional(),
      })
      .strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["NAME_REQUIRED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 我的设计项目列表（R4.4 首页：卡片网格，支持按名称过滤）。
   *
   * ⚠ **不分页**，同 `listMyFeedbackDrafts` 的理由：个人/团队级项目量级小（同一 PM 团队，
   *   不是全组织反馈那种体量）。
   * ⚠ 「我的」是 R4.4 的用户视角过滤，不是可见性边界——见文件头【待确认点 1】。
   */
  listMyProjects: {
    method: "GET",
    path: "/pm-designs",
    /**
     * 迭代 13（delta §4）：`tags` 过滤取**交集**——选了「后台」和「移动端」是"两者都有"，
     * 不是"有其一"。并集在标签数一多时等于没过滤。
     * 排序恒为 `updatedAt` 倒序，**在服务端**（V65）：放前端排，将来一分页就乱。
     * 它不是参数——"最近改过的排最前"是这个列表唯一有意义的顺序，给个选项只会让人纠结。
     */
    in: z.object({ q: z.string().max(200).optional(), tags: DesignProjectTags.optional() }).strict(),
    out: z.object({ items: z.array(DesignProject) }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 编辑项目（R4.4「编辑」弹窗：只改名称/模板/背景，同新建弹窗字段集）。
   *
   * ⚠ 不改 `criteria`/`frames`/`chat`——那些走详情页各自的操作（本轮 `criteria`/`frames`
   *   没有独立的用户编辑操作：用户不能直接改它们，B5.2 起只能经对话由模型写回，见 `appendProjectChat`）。
   * ⚠ 仅 owner：非 owner 调用 → `NOT_PROJECT_OWNER`。
   */
  updateProject: {
    method: "PATCH",
    path: "/pm-designs/:projectId",
    in: z
      .object({
        projectId: z.string(),
        name: z.string().min(1).max(200).optional(),
        template: ProjectTemplate.optional(),
        problem: z.string().max(DESIGN_TEXT_MAX_CHARS).optional(),
        /** 迭代 13：切原型的明暗主题。改的是**原型**，不是后台。 */
        theme: z.enum(["light", "dark"]).optional(),
        /** 迭代 17：强调色档位。省略 = 不动（不是"改回 neutral"）。 */
        accent: PrototypeAccent.optional(),
        /**
         * 对标 R1：设计 token，**按键合并**——只给 `{ font: "serif" }` 不会把品牌色清掉。
         * 清掉品牌色要显式给 `brand: null`。
         */
        tokens: DesignTokens.partial().strict().optional(),
        /**
         * 迭代 13（delta §4）：标签是**整份替换**，不是增删两个动作。
         * 一个 8 个上限的短列表，PATCH 一整份比 add/remove 两条路径少一半状态，
         * 也没有"同时加又删"的顺序问题。
         */
        tags: DesignProjectTags.optional(),
      })
      .strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["PROJECT_NOT_FOUND", "NAME_REQUIRED", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 追加一条对话（详情页左侧「设计协作」面板发送）。
   *
   * ⚠ UC-17.8 B5.2：回复由模型按**本项目**上下文（`name/template/problem/criteria/frames` +
   *   本项目完整 `chat`——每项目独立 thread，thread 身份即 `projectId`）生成。服务端在同一次
   *   调用里追加两条：`{role:"user", text}` 与 `{role:"ai", text, source}`。模型不可用/超时/
   *   输出为空 ⇒ 退回 `DESIGN_WORKBENCH_CHAT_REPLY`、`source: "fallback"`，**不**让这次追加失败。
   * ⚠ **写回选的是「直接写回 + 返回 `applied`」，不是「返回建议等用户确认」**：模型输出里
   *   通过 `DesignChatWriteback` 严格解析的 `problem`/`criteria`/`frames` 由服务端直接写进项目
   *   （走与 `updateProject` 同一条 owner 谓词），`reply.applied` 如实列出写了哪些，返回的
   *   `project` 已是写回后的。理由：R4.4 原文「我会顺着它更新右边的原型画布和验收标准」——
   *   对话面板的产品语义就是「说一句、右边跟着变」；多一次确认弹窗会把它变成表单。写回
   *   前的值仍在 `chat` 历史里可追溯（用户那句 + 模型那句），owner 不满意再说一句即可改回。
   *   `frames` 只是画布页标签文案，画布内容仍是占位块（B5.3 out of scope）。
   * ⚠ 首次引导语**不**在这里插入——见文件头【待确认点 2】，它是展示层，`chat` 为空时前端
   *   本地渲染 `DESIGN_WORKBENCH_CHAT_INTRO`，不经过这个接口。
   * ⚠ 仅 owner 可发送：设计协作是该项目 owner 的工作区，不是任意组织成员都能往里写消息
   *   （同「仅 owner 可改」的口径——见文件头【待确认点 1】）。非 owner 不调模型、不写回。
   */
  appendProjectChat: {
    method: "POST",
    path: "/pm-designs/:projectId/chat",
    in: z
      .object({
        projectId: z.string(),
        text: z.string().min(1).max(DESIGN_TEXT_MAX_CHARS),
        /**
         * 迭代 13（delta §1.2）：这一句要参考哪几张图。图属于**项目**不属于某条消息——
         * 同一张参考图往往要在好几轮里反复被指着说，所以这里传 id 而不是重新上传。
         */
        refImageIds: z.array(z.string()).max(PROTOTYPE_MAX_REF_IMAGES).optional(),
        /** 迭代 2：用户在画布上选中的节点——这句话优先针对它。服务端按 id 在当前 `prototype` 里找路径喂给模型；找不到（已被上一轮删掉）就当没选。 */
        focusNodeId: PrototypeNodeId.optional(),
        /**
         * 迭代 20：**这一轮最多画几页**。
         *
         * 超时的退路文案一直写着「试试少要几页、或把要求说得更具体一点再发一次」——
         * 而用户**没有任何控制页数的手段**：页数由骨架轮自己定（3–6 页），
         * 界面上没有旋钮，说「只画 3 页」也只是一句模型可以不听的话。
         * 又一句做不到的许诺。
         *
         * 所以这不是一个给模型的提示，是一条**服务端强制执行**的上限：骨架轮回来之后
         * 按它截断（见 `generatePaged`）。省略 ⇒ 不设限，行为与这个字段出现之前逐字相同。
         */
        maxScreens: z.number().int().min(1).max(PROTOTYPE_MAX_SCREENS).optional(),
      })
      .strict(),
    out: z.object({ project: DesignProject, reply: DesignChatReply }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 迭代 3：原型版本历史。每次 `prototype` 被写回（模型整页 / patch / 人恢复）都追加一条快照
   * （`design_project_prototype_versions`，append-only），列表不带树（可能很大 × N），单条带树。
   * 全组织可读（同项目可见性）；恢复仅 owner——恢复 = 把那一版的 `frames`+`prototype` 写回项目，
   * 并**再追加一条** `source: "restore"` 的版本（历史只追加、不回退，回退本身也是历史）。
   */
  listPrototypeVersions: {
    method: "GET",
    path: "/pm-designs/:projectId/versions",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ items: z.array(PrototypeVersionSummary) }).strict(),
    err: ["PROJECT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },
  getPrototypeVersion: {
    method: "GET",
    path: "/pm-designs/:projectId/versions/:versionId",
    in: z.object({ projectId: z.string(), versionId: z.string() }).strict(),
    out: z.object({ version: PrototypeVersion }).strict(),
    err: ["PROJECT_NOT_FOUND", "VERSION_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },
  restorePrototypeVersion: {
    method: "POST",
    path: "/pm-designs/:projectId/versions/:versionId/restore",
    in: z.object({ projectId: z.string(), versionId: z.string() }).strict(),
    out: z.object({ project: DesignProject, version: PrototypeVersionSummary }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "VERSION_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 迭代 5：人在画布上**直接改**——选中节点后在属性面板改文案/属性，或删掉它。仅 owner。
   * 走与模型写回完全同一条路：`applyPrototypePatch` 顺序执行、每步重验、整批原子；成功记一条
   * `source: "user"` 的版本（`summary` 由前端给一句，如「改了按钮「发送」的文案」）。
   * 这条路径的存在改写了 I-11「只经模型写回」——现在是「只经契约 patch 写回（模型或人），永远重验」。
   */
  patchPrototype: {
    method: "POST",
    path: "/pm-designs/:projectId/prototype/patch",
    in: z.object({ projectId: z.string(), ops: DesignPrototypePatch, summary: z.string().max(200).optional() }).strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "PROTOTYPE_PATCH_REJECTED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 对标 R9（#3954）：让模型对第 `screen` 页出 `count` 个**结构不同**的方案。仅 owner；**不写库**。
   * 模型给的每棵树都过契约，不合法的丢掉；合法的不足 `PROTOTYPE_VARIANTS_MIN` 个 ⇒ 503
   * `DEPENDENCY_UNAVAILABLE`——不拿当前页改几个字冒充「方案」。这一页没画出来 ⇒ `PROTOTYPE_PATCH_REJECTED`。
   */
  proposeVariants: {
    method: "POST",
    path: "/pm-designs/:projectId/variants",
    in: z
      .object({
        projectId: z.string(),
        screen: z.number().int().min(0).max(PROTOTYPE_MAX_SCREENS - 1),
        count: z.number().int().min(PROTOTYPE_VARIANTS_MIN).max(PROTOTYPE_VARIANTS_MAX).optional(),
        instruction: z.string().max(500).optional(),
      })
      .strict(),
    out: z.object({ variants: z.array(PrototypeVariant).min(PROTOTYPE_VARIANTS_MIN).max(PROTOTYPE_VARIANTS_MAX) }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "PROTOTYPE_PATCH_REJECTED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 深度 S2（#3988）：批注。**全组织可读可写**（同项目可见性）——批注就是让不是 owner 的人也能说话；
   * 删除只允许作者或项目 owner。列表按写下的先后排。
   */
  listDesignComments: {
    method: "GET",
    path: "/pm-designs/:projectId/comments",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ items: z.array(DesignComment) }).strict(),
    err: ["PROJECT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },
  createDesignComment: {
    method: "POST",
    path: "/pm-designs/:projectId/comments",
    in: z
      .object({
        projectId: z.string(),
        nodeId: PrototypeNodeId,
        frameIndex: z.number().int().min(0).max(PROTOTYPE_MAX_SCREENS - 1),
        label: z.string().max(200),
        text: z.string().trim().min(1).max(DESIGN_COMMENT_MAX_CHARS),
      })
      .strict(),
    out: z.object({ comment: DesignComment }).strict(),
    err: ["PROJECT_NOT_FOUND", "COMMENT_LIMIT_REACHED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
  /** 解决 / 重新打开。交给 AI 改完的那几条也走这里（前端在发送成功后逐条标记）。 */
  updateDesignComment: {
    method: "PATCH",
    path: "/pm-designs/:projectId/comments/:commentId",
    in: z.object({ projectId: z.string(), commentId: z.string(), resolved: z.boolean() }).strict(),
    out: z.object({ comment: DesignComment }).strict(),
    err: ["PROJECT_NOT_FOUND", "COMMENT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },
  /** 深度 S3：给一条批注回一句。全组织可写（同批注）；回复只追加，不改不删。回整条批注（含全部回复）。 */
  createDesignCommentReply: {
    method: "POST",
    path: "/pm-designs/:projectId/comments/:commentId/replies",
    in: z.object({ projectId: z.string(), commentId: z.string(), text: z.string().trim().min(1).max(DESIGN_COMMENT_MAX_CHARS) }).strict(),
    out: z.object({ comment: DesignComment }).strict(),
    err: ["PROJECT_NOT_FOUND", "COMMENT_NOT_FOUND", "COMMENT_LIMIT_REACHED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
  deleteDesignComment: {
    method: "DELETE",
    path: "/pm-designs/:projectId/comments/:commentId",
    in: z.object({ projectId: z.string(), commentId: z.string() }).strict(),
    out: z.object({}).strict(),
    err: ["PROJECT_NOT_FOUND", "COMMENT_NOT_FOUND", "NOT_COMMENT_AUTHOR", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 删项目。硬删——仅 owner；未推送/已推送均可删（需求未对已推送项目的删除设限）。 */
  deleteProject: {
    method: "DELETE",
    path: "/pm-designs/:projectId",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ projectId: z.string() }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 推送到收件箱（R4.4：推送确认弹窗 → 生成一条「设计方案」收件箱条目）。
   *
   * ⚠ **幂等 = upsert**，幂等键是 `projectId`（`design_projects` 一行至多对应一条收件箱条目，
   *   B4.2 唯一约束）。重复推送更新同一条收件箱条目的 `note`/`pushedAt`，`inboxCode` 不变。
   *   理由见文件头「推送幂等选的是 upsert」。
   * ⚠ 仅 owner 可推送。
   * ⚠ 若项目 `linkedFeedbackId` 非空，B4.3 用例层在同一事务里回写来源反馈的
   *   `resolved_by_design_id` 并追加一条状态事件「已生成 D-X」（`inbox.ts` 头注已预留这两个
   *   投影字段，这里不重复声明）——本契约只负责这次调用本身的 `in`/`out`。
   */
  pushToInbox: {
    method: "POST",
    path: "/pm-designs/:projectId/push",
    in: z.object({ projectId: z.string(), note: z.string().max(2000).optional() }).strict(),
    out: z
      .object({
        project: DesignProject,
        /** 生成/复用的收件箱条目编号，如 `D-2`（同 `inbox.ts` 的 `InboxItem.code` 前缀规则） */
        inboxCode: z.string().regex(/^D-\d+$/),
      })
      .strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * B4.4——反馈列表/详情「更复杂？去 PM 设计工作台深化」→ 直接建一个设计项目，跳到它的详情页
   * （PDF §9 建议；原型是跳工作台首页，这里按 PDF 收窄）。
   *
   * ⚠ **不接受调用方传 `name`/`problem`/`template`**——同 `createProject` 头注对
   *   `linkedFeedbackId` 的纪律反过来：这次是反过来的方向,调用方只给 `feedbackId`,
   *   `name`=反馈 `title`、`problem`=反馈 `detail`、`template` 恒 `"wireframe"`
   *   （backlog B4.4 原文三个等号），服务端读反馈行自己填,不接受前端各自拼一份可能对不上的值。
   * ⚠ **幂等，幂等键是 `feedbackId`**——同 `pushToInbox` 的 upsert 哲学，但形状不同：这里不是
   *   "覆盖同一行"，是"同一条反馈只产生一个设计项目"（`design_projects` 对 `linkedFeedbackId`
   *   的唯一约束保证,见迁移）。重复调用（用户手滑点两次「深化」、或网络重试）返回**已存在**的
   *   那个项目,不建第二个——第二个项目会让"这条反馈对应哪个方案"变成一对多,而前端要跳转的
   *   详情页只能选一个,选哪个没有依据。`out.created` 告诉调用方这次是新建还是复用（用于日志/
   *   埋点区分，不影响跳转行为——两种情况都跳同一个 `project.id`）。
   * ⚠ 权限：读正文要过 D3（`FEEDBACK_DETAIL_NOT_VISIBLE`）——「深化」把正文原样抄进
   *   `problem`,对正文没有可见权的人不能把它抄出来,即使抄的目的地只是同一组织内可读的
   *   设计项目（后者的可见性口径本身更宽,但不能绕开前者的门）。**没有** `NOT_PROJECT_OWNER`
   *   这个错误码：新建的项目 owner 恒是发起深化的人（同 `createProject`），不存在"深化别人
   *   已深化出的项目"这回事——命中已存在的项目时直接把它返回,不判断请求者是不是它的 owner
   *   （读操作对全组织放开,同文件头【待确认点 1】）。
   */
  deepenFeedback: {
    method: "POST",
    path: "/feedback/:feedbackId/deepen",
    in: z.object({ feedbackId: z.string() }).strict(),
    out: z
      .object({
        project: DesignProject,
        /** 这次调用是不是真的新建了项目（`false` = 命中了已有的深化结果，见上方幂等说明） */
        created: z.boolean(),
      })
      .strict(),
    err: ["FEEDBACK_NOT_FOUND", "FEEDBACK_DETAIL_NOT_VISIBLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 2026-09-05「转开发」——把一个已推送的设计方案变成一张 GitHub issue。
   *
   * ## 这一条补的是「原型 → 开发」那一段
   *
   * 在它之前，设计方案推送到收件箱之后就没有下一步了：`inbox.ts` 的 `InboxGithubRef`
   * 头注写着「设计方案：本轮恒 `null`」，收件箱 drawer 对 `kind === "design"` 的条目
   * 不给任何操作。方案能被看见，但交不出去。这条操作是那一步。
   *
   * ## 形状照抄 `triageFeedback` 的 `issueDraft`，不发明第二套
   *
   * `draft` 的三个字段（`title`/`body`/`labels`）与 `feedbackLoop.operations.
   * triageFeedback.in.issueDraft` **逐字相同**，语义也相同：服务端按方案内容拼一份
   * 建议正文交给前端，人类在弹层里改完再提交，用例层原样使用、不用方案原文覆盖它
   * （否则"可编辑"是空话——同那条操作头注的原话）。
   *
   * ⚠ **不复用 `feedback-loop.ts` 的那个 zod 对象**：两个契约文件互不 import 是本仓既有
   *   边界（`design-ai-collab.ts` 才是两束共享词汇的所在地）。形状相同但归属不同，
   *   一方将来要加字段时不应该被另一方绑住。
   *
   * ## 权限：owner，同 `pushToInbox`
   *
   * 不是「组织管理员」：设计方案的可见性口径是"组织内全员可读，仅 owner 可改/删/推送"
   * （文件头【待确认点 1】），转开发是写侧动作，跟着写侧的口径走。
   *
   * ## 前置：必须已推送（`PROJECT_NOT_PUSHED`）
   *
   * 见该错误码的说明。这条前置让「GitHub 上的每一张设计票都能在收件箱里找到对应条目」
   * 成为一条结构性保证，而不是靠调用方自觉。
   *
   * ## 不幂等，重复调用报错
   *
   * 见 `DESIGN_ISSUE_ALREADY_EXISTS`。并发由 `github_issue_claimed_at` 乐观锁挡住
   * （`DESIGN_ISSUE_IN_PROGRESS`），失败释放认领、fail closed，全部照抄
   * `product_feedback` 那一套已经过二轮独立审查的形状。
   */
  createDesignGithubIssue: {
    method: "POST",
    path: "/pm-designs/:projectId/github-issue",
    in: z
      .object({
        projectId: z.string(),
        draft: z
          .object({
            title: z.string().min(1),
            body: z.string(),
            labels: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
    out: z
      .object({
        /** 回填之后的整个项目（`githubIssueUrl`/`githubIssueNumber` 已非空） */
        project: DesignProject,
      })
      .strict(),
    err: [
      "PROJECT_NOT_FOUND",
      "NOT_PROJECT_OWNER",
      "PROJECT_NOT_PUSHED",
      "DESIGN_ISSUE_ALREADY_EXISTS",
      "DESIGN_ISSUE_IN_PROGRESS",
      "DESIGN_ISSUE_CREATION_FAILED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },
  /* ─────────── 迭代 22：发布与分享 ─────────── */

  /**
   * 发布（或**重新发布**）这个项目，拿到一条免登录的只读链接。
   *
   * ## 发布的是**快照**，不是活链接
   *
   * 这是本操作最重要的一条语义，理由是这个代码库自己的事实：原型是**分页渐进落库**的
   * （`append-project-chat.ts` 的 `persistProgress` 每画完一页就写一次库）。活链接意味着
   * 评审在你重新生成的那三十秒里刷新一下，看到的是三页空白 + 一页画到一半——然后他截图
   * 发到群里问"这就是你要给我看的？"。发布=冻结，之后你怎么改画布都不影响已经发出去的那一份。
   *
   * 代价是快照会过期，而这个代价**必须在界面上说出来**：`DesignShare.stale` 就是那句话，
   * 由服务端比对算出。再点一次发布 = 更新快照（同一条链接，令牌不变——重新发布换一条链接
   * 会让之前发出去的那条静默失效，而发出去的链接在别人的聊天记录里，你收不回来）。
   *
   * ⚠ 仅 owner。⚠ 一个项目同一时刻只有一条有效链接（幂等键 = `projectId`）。
   */
  publishProject: {
    method: "POST",
    path: "/pm-designs/:projectId/share",
    in: z
      .object({
        projectId: z.string(),
        /** 省略 = 沿用已发布那份的档位；从未发布过 ⇒ `prototype`（保守的那一档）。 */
        scope: DesignShareScope.optional(),
      })
      .strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "NOTHING_TO_PUBLISH", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 取消发布——链接**立刻**失效（访客再打开是 `SHARE_NOT_FOUND`）。
   *
   * ⚠ 令牌一并作废，不保留。再次发布会生成**新**令牌：取消发布的语义是"我收回了它"，
   *   如果旧令牌还能用，这个动作就没有做到它名字上写的那件事。
   * ⚠ 仅 owner。⚠ 幂等：没发布过也返回 200（要的状态已经达成了）。
   */
  unpublishProject: {
    method: "DELETE",
    path: "/pm-designs/:projectId/share",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ project: DesignProject }).strict(),
    err: ["PROJECT_NOT_FOUND", "NOT_PROJECT_OWNER", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 读一条分享链接。**免登录**——这是本束唯一一条不带 principal 的操作。
   *
   * 令牌形如 `<locator>.<secret>`：`locator` 是 base64url 的 `[orgId, projectId]`，
   * 只用来路由到那一行（RLS 按 org 判，没有组织上下文就查不出任何东西）；`secret` 是
   * 256 位随机数，**在任何内容返回之前**用定时安全比较验过。这套形状不是这里发明的，
   * 逐字照搬 `survey-service.ts` 的公开问卷令牌——同一个问题在一个仓库里只该有一种解法。
   */
  getSharedDesign: {
    method: "GET",
    path: "/public/design-shares/:token",
    in: z.object({ token: z.string() }).strict(),
    out: z.object({ design: SharedDesign }).strict(),
    err: ["SHARE_NOT_FOUND"] as const,
  },
} as const;
