// UC-17.8 研发闭环取材页（/preview/feedback-design-loop）的 **page.route 夹具**——单一事实源。
// 草稿 / 收件箱 / 设计工作台三块固定数据与拦截函数原先只住在 shot-feedback-design-loop.mjs 里；
// UC-17.8 B6.5 把它们抽到这里，让截图脚本与 e2e/design-loop-responsive.spec.ts（三档视口
// 不横向溢出，U8）读**同一份**夹具，不各自复制一份再各自漂移（AGENTS.md：同一事实不得声明在两处）。
// 形状对齐各契约（FeedbackDraft / InboxItem / DesignProject，均 .strict()），字段少一个屏上就少一块。

/** 固定的草稿取材数据。⚠ 与契约 `FeedbackDraft` 同形，字段少一个屏上就少一块。 */
export const NOW = "2026-09-03T02:14:00.000Z";
export const DRAFTS = [
  {
    id: "draft-batch-token", kind: "缺陷", target: { kind: "product" },
    title: "批准卡不记得上次的 token 预算",
    detail: "每次批准都要重填 token 预算，第三次之后就不想用了。期望能记住上一次填的值。",
    structured: { reproFrequencyEnv: "每次 · Chrome 128", expectedResult: "记住上次的值", actualResult: "每次都是空的" },
    attachments: [{ id: "att-1", url: "/feedback/attachments/att-1", mime: "image/png" }],
    chat: [{ role: "user", kind: "message", text: "批准卡不记得上次的 token 预算，每次都要重填。", at: NOW }],
    refineSeeded: false, occurredRoute: "/chat", appVersion: "2026.09.03", createdAt: NOW, updatedAt: NOW,
  },
  {
    id: "draft-rec-filter", kind: "需求", target: { kind: "product" },
    title: "希望能按项目筛选录音",
    detail: "现在录音列表是全组织的，找上周那场要翻很久。希望能按项目、按时间范围筛。",
    structured: null, attachments: [],
    chat: [{ role: "user", kind: "message", text: "录音列表能不能按项目筛选？", at: NOW }],
    refineSeeded: false, occurredRoute: "/rec", appVersion: "2026.09.03", createdAt: "2026-09-02T09:02:00.000Z", updatedAt: "2026-09-02T09:02:00.000Z",
  },
  {
    id: "draft-export-table", kind: "需求", target: { kind: "skill", skillId: "skill-meeting-notes" },
    title: "会议纪要输出希望固定成表格",
    detail: "有时候给表格有时候给段落，下游没法直接用。希望能在 skill 设置里固定输出格式。",
    structured: { useScenario: "导出纪要到下游表格", expectedCapability: "固定输出格式", priorityScope: "中 · 所有导出入口" },
    attachments: [],
    chat: [
      { role: "user", kind: "message", text: "会议纪要的输出格式不稳定，希望能固定成表格。", at: NOW },
      { role: "ai", kind: "message", text: "这个需求的边界在哪：只影响当前场景，还是所有相关入口都要一起改？优先级怎么排？", at: NOW },
      { role: "user", kind: "message", text: "所有导出入口都要一致，优先级中等。", at: NOW },
      { role: "ai", kind: "message", text: "已记录，还有想补充的吗？", at: NOW },
    ],
    refineSeeded: true, occurredRoute: "/chat", appVersion: "2026.09.03", createdAt: "2026-09-01T14:20:00.000Z", updatedAt: "2026-09-01T14:20:00.000Z",
  },
];

/** 拦 `/feedback/drafts*`：列表 / 计数 / 建 / 改（回整条草稿，追加的对话由"服务端"补 AI 回执）/ 删 / 提交。 */
export async function routeDrafts(page, { empty }) {
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const drafts = empty ? [] : DRAFTS.map((d) => ({ ...d, chat: [...d.chat] }));
  await page.route((url) => new URL(url).pathname.startsWith("/feedback/drafts"), (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === "/feedback/drafts/count") return json(route, { count: drafts.length });
    if (path === "/feedback/drafts" && method === "GET") return json(route, { items: drafts });
    if (path === "/feedback/drafts" && method === "POST") return json(route, { draftId: "draft-new" }, 201);
    const m = /^\/feedback\/drafts\/([^/]+)(\/submit)?$/.exec(path);
    if (!m) return json(route, { reasonCode: "DRAFT_NOT_FOUND" }, 404);
    const draft = drafts.find((d) => d.id === decodeURIComponent(m[1]));
    if (!draft) return json(route, { reasonCode: "DRAFT_NOT_FOUND" }, 404);
    if (m[2]) return json(route, { feedbackId: "fb-from-draft", status: "待处理" });
    if (method === "DELETE") return json(route, { draftId: draft.id });
    if (method === "PATCH") {
      const body = req.postDataJSON() ?? {};
      if (body.kind) draft.kind = body.kind;
      if (typeof body.detail === "string") draft.detail = body.detail;
      if (body.appendChat) {
        draft.chat.push({ ...body.appendChat, at: NOW });
        draft.chat.push({ role: "ai", kind: "message", text: "已记录，还有想补充的吗？", at: NOW });
      }
      return json(route, { draft });
    }
    return json(route, {}, 405);
  });
}

/** 固定的收件箱取材数据——形状对齐 `packages/contracts/src/inbox.ts` 的 `InboxItem`（`.strict()`）。 */
export const INBOX_ITEMS = [
  {
    id: "in-b1", kind: "feedback", code: "B-1", title: "上传三个文件只读了一个",
    body: "在调研助手里一次拖了三个 PDF，agent 只引用了第一个，另外两个像没上传。",
    structured: null, feedbackKind: "缺陷", sourceStatus: "待处理", stage: "backlog",
    statusReason: null, severe: true, votes: 12, reporter: "林晚 · 增长组",
    createdAt: "2026-09-03T01:40:00.000Z",
    github: { kind: "issue", number: 142, url: "https://github.com/boardx/workspacex/issues/142", state: "open" },
    linkedFeedbackId: null, resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
  },
  {
    id: "in-b2", kind: "feedback", code: "B-2", title: "批准卡不记得上次的 token 预算",
    body: "每次批准都要重填 token 预算，第三次之后就不想用了。",
    structured: null, feedbackKind: "缺陷", sourceStatus: "已进入迭代", stage: "doing",
    statusReason: null, severe: false, votes: 7, reporter: "周珂 · 平台组",
    createdAt: "2026-09-02T02:14:00.000Z",
    github: { kind: "pr", number: 145, url: "https://github.com/boardx/workspacex/pull/145", state: "draft" },
    linkedFeedbackId: null, resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
  },
  {
    id: "in-b4", kind: "feedback", code: "B-4", title: "导出 PDF 偶尔缺最后一页",
    body: "长报告导出成 PDF 时，最后一页有概率丢失，重导一次又正常。",
    structured: null, feedbackKind: "缺陷", sourceStatus: "已修复", stage: "done",
    statusReason: null, severe: false, votes: 9, reporter: "陈屿 · 交付组",
    createdAt: "2026-08-20T03:00:00.000Z",
    github: { kind: "pr", number: 130, url: "https://github.com/boardx/workspacex/pull/130", state: "merged" },
    linkedFeedbackId: null, resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
  },
  {
    id: "in-r3", kind: "feedback", code: "R-3", title: "批量邀请支持粘贴邮箱列表",
    body: "一次邀请几十个人得一个个填，希望能粘贴一整列邮箱。",
    structured: null, feedbackKind: "需求", sourceStatus: "不做", stage: "archived",
    statusReason: "与即将上线的 SCIM 目录同步重叠，暂不单独做手工批量邀请。", severe: false, votes: 4,
    reporter: "叶蓁 · HR", createdAt: "2026-08-10T08:30:00.000Z",
    github: null, linkedFeedbackId: null, resolvedByDesignId: null, exception: null, submittedByMe: false, votedByMe: false,
  },
  {
    id: "in-e1", kind: "exception", code: "E-1", title: "ASR 转写服务连接超时",
    body: "语音转写在高峰期出现连接超时，影响长语音反馈与会议录音。",
    structured: null, feedbackKind: null, sourceStatus: "待处理", stage: "backlog",
    statusReason: null, severe: true, votes: 0, reporter: null, createdAt: "2026-09-03T05:00:00.000Z",
    github: null, linkedFeedbackId: null, resolvedByDesignId: null,
    // `devNote`/`tags` 是契约 `InboxExceptionMeta` 的必填位（2026-09-05 补投影）。
    // ⚠ 这份夹具是 `.mjs`，不过 tsc——漏掉这两个键不会有类型报错，而是让 drawer 里
    //   `tags.map` 在 undefined 上炸。加字段时这里要跟着改。
    exception: { location: "asr-gateway / ws", count: 47, affectedUsers: 12, devNote: null, tags: ["asr", "P1"] },
    submittedByMe: false, votedByMe: false,
  },
];

const FEEDBACK_EVENTS = [
  {
    id: "evt-1", fromStatus: null, toStatus: "待处理", reason: null, actorId: "sys",
    notified: false, emailSubject: null, emailText: null, createdAt: "2026-09-03T01:40:00.000Z",
  },
];

/** stage → 源状态：反馈/系统异常各一套，同契约 `stageOf` 的映射表（这里只是取材夹具，不是第二份实现）。 */
const FEEDBACK_STATUS_OF_STAGE = { backlog: "待处理", doing: "已进入迭代", done: "已修复", archived: "不做" };
const EXCEPTION_STATUS_OF_STAGE = { backlog: "待处理", doing: "已转入开发", archived: "不做" };
const STAGE_OF_FEEDBACK_STATUS = Object.fromEntries(Object.entries(FEEDBACK_STATUS_OF_STAGE).map(([s, v]) => [v, s]));
const STAGE_OF_EXCEPTION_STATUS = Object.fromEntries(Object.entries(EXCEPTION_STATUS_OF_STAGE).map(([s, v]) => [v, s]));

/** 拦 `/inbox*`、`/feedback/:id/status`、`/feedback/:id/events`、`/system/error-logs/:id`。 */
export async function routeInbox(page, { empty }) {
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const items = empty ? [] : INBOX_ITEMS.map((i) => ({ ...i }));

  await page.route((url) => new URL(url).pathname === "/inbox", (route) => {
    const u = new URL(route.request().url());
    const kind = u.searchParams.get("kind");
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    const filtered = items.filter(
      (i) => (kind ? i.kind === kind : true) && (q ? `${i.title}${i.code}`.toLowerCase().includes(q) : true),
    );
    return json(route, { items: filtered, nextCursor: null, sources: { exception: "included" } });
  });

  await page.route((url) => new URL(url).pathname === "/inbox/counts", (route) => {
    const byStage = { backlog: 0, doing: 0, done: 0, archived: 0 };
    const byKind = { feedback: 0, exception: 0, design: 0 };
    for (const i of items) { byStage[i.stage]++; byKind[i.kind]++; }
    return json(route, { byStage, byKind, total: items.length, sources: { exception: "included" } });
  });

  await page.route((url) => /^\/feedback\/[^/]+\/status$/.test(new URL(url).pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]);
    const item = items.find((i) => i.id === id);
    if (!item) return json(route, { reasonCode: "FEEDBACK_NOT_FOUND" }, 404);
    const body = route.request().postDataJSON() ?? {};
    item.sourceStatus = body.status;
    item.stage = STAGE_OF_FEEDBACK_STATUS[body.status] ?? item.stage;
    item.statusReason = body.reason ?? null;
    return json(route, { status: item.sourceStatus });
  });

  await page.route((url) => /^\/feedback\/[^/]+\/events$/.test(new URL(url).pathname), (route) => json(route, { events: FEEDBACK_EVENTS }));

  await page.route((url) => /^\/system\/error-logs\/[^/]+$/.test(new URL(url).pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop());
    const item = items.find((i) => i.id === id);
    if (!item) return json(route, { reasonCode: "NOT_FOUND" }, 404);
    const body = route.request().postDataJSON() ?? {};
    if (body.status) {
      item.sourceStatus = body.status;
      item.stage = STAGE_OF_EXCEPTION_STATUS[body.status] ?? item.stage;
    }
    if (body.statusReason !== undefined) item.statusReason = body.statusReason;
    return json(route, { status: item.sourceStatus });
  });
}

/**
 * 固定的设计工作台取材数据（UC-17.8 B4.6）——形状对齐
 * `packages/contracts/src/design-workbench.ts` 的 `DesignProject`（`.strict()`）。
 *
 * ⚠ B4.5 起 `workbench-screen.tsx`/`detail-screen.tsx` 打真实 `/pm-designs*`，取材页不再
 *   靠 `DesignLoopProvider` 的本地 seed 出这两屏的数据——同草稿/收件箱两块在 B1/B3.4 走过的
 *   同一条路：由本脚本 `page.route()` 拦截提供固定夹具，不连真库（同一台机器随时能截出同一张图）。
 */
const DESIGN_WORKBENCH_CHAT_REPLY = "好的，我记下了这个调整，稍后会更新原型画布。";
/**
 * 迭代 2：真栈里节点 id 由服务端 `ensurePrototypeIds` 落库时补齐（契约 design-prototype.ts）；本夹具是
 * 前端 mock，没有服务端那一步，所以这里按同一规则（遍历序 n1、n2…）补上——选中态要靠 id 寻址。
 */
function withIds(roots) {
  let k = 0;
  const fill = (n) => ({ ...n, id: n.id ?? `n${(k += 1)}`, ...(Array.isArray(n.children) ? { children: n.children.map(fill) } : {}) });
  return roots.map(fill);
}

export const DESIGN_PROJECTS = [
  {
    id: "proj-empty-states", name: "反馈分诊看板重设计", template: "wireframe",
    problem: "运营现在要在多个屏之间来回切才能看到一条反馈的处理状态，希望有一个统一看板。",
    criteria: ["明确问题与目标范围", "给出交互方案与边界情况处理", "列出验收标准供工程对齐"],
    frames: ["草稿页 1", "草稿页 2", "草稿页 3"], prototype: [], frameNotes: [],
    pushed: false, pushedAt: null, linkedFeedbackId: "in-b1",
    chat: [
      { role: "user", text: "运营现在要在多个屏之间来回切才能看到一条反馈的处理状态，希望有一个统一看板。", at: "2026-09-03T02:00:00.000Z" },
      { role: "ai", text: DESIGN_WORKBENCH_CHAT_REPLY, at: "2026-09-03T02:00:05.000Z" },
    ],
    ownerId: "u-pm-1", ownerName: "苏木 · PM",
    createdAt: "2026-09-03T02:00:00.000Z", updatedAt: "2026-09-03T02:05:00.000Z",
  },
  {
    id: "proj-mobile-invite", name: "移动端批量邀请", template: "mobile",
    problem: "", criteria: ["明确问题与目标范围", "给出交互方案与边界情况处理", "列出验收标准供工程对齐"],
    frames: ["草稿页 1", "草稿页 2", "草稿页 3"], prototype: [], frameNotes: [],
    pushed: true, pushedAt: "2026-09-02T10:00:00.000Z", linkedFeedbackId: null, chat: [],
    ownerId: "u-pm-1", ownerName: "苏木 · PM",
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z",
  },
  // UC-17.8 B5.3：已由模型整页生成原型的项目——`prototype` 两页组件树，与 `frames` 同长。
  // 用于 `detail-prototype-*` 截图（契约束 `design-prototype` 的 ui.md 材料）。
  {
    id: "proj-chat-ui", name: "对话助手移动端", template: "mobile",
    problem: "客服团队要一个像 ChatGPT 的内部对话助手：会话列表、消息流、输入区、发送/停止、空态与加载态。",
    criteria: ["首屏即可发出第一条消息", "生成中可随时停止", "历史会话可回看与继续"],
    frames: ["聊天", "历史会话", "用量"],
    // 迭代 8：每页交互说明（模型随整页写回给出）
    frameNotes: [
      "首屏即可发消息；生成中「发送」变「停止」，点停止保留已生成的部分；空态显示三条示例问题。",
      "按最近更新排序；搜索匹配标题与首条消息；左滑删除，删除前二次确认。",
      "",
    ],
    prototype: withIds([
      {
        type: "stack", props: { direction: "column", gap: "sm" },
        children: [
          { type: "navbar", props: { title: "对话助手", left: "☰", right: "新对话" } },
          {
            type: "stack", props: { fill: true, gap: "sm", padding: "sm" },
            children: [
              { type: "stack", props: { direction: "row", gap: "sm", align: "end" }, children: [{ type: "card", children: [{ type: "text", props: { content: "帮我把这段退款政策改成客户能看懂的话。" } }] }] },
              { type: "stack", props: { direction: "row", gap: "sm" }, children: [
                { type: "avatar", props: { name: "AI" } },
                { type: "card", children: [
                  { type: "text", props: { content: "好的。简版：7 天内未使用可全额退款；已使用按剩余天数按比例退。" } },
                  { type: "badge", props: { label: "正在生成…", tone: "info" } },
                ] },
              ] },
            ],
          },
          { type: "stack", props: { direction: "row", gap: "sm", align: "end", padding: "sm" }, children: [
            { type: "input", props: { placeholder: "发送消息", multiline: true } },
            { type: "button", props: { label: "停止", variant: "danger" } },
          ] },
        ],
      },
      {
        type: "stack", props: { direction: "column", gap: "sm" },
        children: [
          { type: "navbar", props: { title: "历史会话", left: "返回", right: "编辑" } },
          { type: "input", props: { placeholder: "搜索会话" } },
          { type: "tabs", props: { items: ["全部", "已收藏"], active: 0 } },
          { type: "list", props: { items: ["退款政策改写", "周报润色", "英文邮件翻译", "面试题整理"], leading: "dot" } },
          { type: "spacer", props: { size: "lg" } },
          { type: "button", props: { label: "开始新对话", variant: "primary", full: true } },
        ],
      },
      // 迭代 6：新原语一页——hero / grid+stat / progress / chip / switch / checkbox / bottomnav
      {
        type: "stack", props: { direction: "column", gap: "sm", padding: "sm" },
        children: [
          { type: "hero", props: { title: "本月用量", subtitle: "已用 68%，按当前速度月底前够用。", cta: "升级套餐" } },
          { type: "grid", props: { columns: 2, gap: "sm" }, children: [
            { type: "stat", props: { label: "对话数", value: "1,284", delta: "+12% 环比", tone: "success" } },
            { type: "stat", props: { label: "平均响应", value: "2.4s", delta: "-0.3s", tone: "success" } },
          ] },
          { type: "progress", props: { value: 68, label: "配额" } },
          { type: "stack", props: { direction: "row", gap: "sm" }, children: [
            { type: "chip", props: { label: "本周", selected: true } }, { type: "chip", props: { label: "本月" } }, { type: "chip", props: { label: "全部" } },
          ] },
          { type: "switch", props: { label: "用量提醒", on: true } },
          { type: "checkbox", props: { label: "包含测试对话", checked: false } },
          { type: "bottomnav", props: { items: ["聊天", "历史", "用量", "我的"], active: 2 } },
        ],
      },
    ]),
    pushed: false, pushedAt: null, linkedFeedbackId: null,
    githubIssueUrl: null, githubIssueNumber: null,
    chat: [
      { role: "user", text: "给我设计一个 chat 的 UI，模拟 chatgpt", at: "2026-09-06T02:00:00.000Z" },
      { role: "ai", text: "画好了两页：「聊天」是消息流 + 输入区（含生成中的停止按钮），「历史会话」是可搜索的会话列表。要改哪里直接说。", at: "2026-09-06T02:00:40.000Z", source: "model" },
    ],
    ownerId: "u-pm-1", ownerName: "苏木 · PM",
    createdAt: "2026-09-06T02:00:00.000Z", updatedAt: "2026-09-06T02:00:40.000Z",
  },
];

/**
 * 拦 `/pm-designs*`：列表 / 建 / 改 / 删 / 追加对话 / 推送。
 * `slow`：`listMyProjects` 故意挂起不 resolve，用于截「加载中」骨架屏（真实请求在飞）。
 */
export async function routeDesignWorkbench(page, { empty = false, slow = false, failList = false } = {}) {
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const projects = empty ? [] : DESIGN_PROJECTS.map((p) => ({ ...p, chat: [...p.chat] }));

  await page.route((url) => new URL(url).pathname === "/pm-designs", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      if (slow) return; // 故意不 fulfill：截图时页面停在 loading 态。
      if (failList) return json(route, { reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503);
      return json(route, { items: projects });
    }
    if (req.method() === "POST") {
      const body = req.postDataJSON() ?? {};
      if (!body.name || String(body.name).trim() === "") return json(route, { reasonCode: "NAME_REQUIRED" }, 400);
      // 截「正在把…整理成设计稿」的生成中过渡（workbench-generating）：故意晚 2s 才 fulfill，
      // 给 playwright 留出时间在真实等待期间截图——不是摆一张固定图，`createProject` 真的还没返回。
      if (body.name === "移动端登录页重设计") await new Promise((r) => setTimeout(r, 2000));
      const project = {
        id: "proj-new", name: body.name, template: body.template ?? "mobile",
        problem: body.problem ?? "", criteria: DESIGN_PROJECTS[0].criteria, frames: DESIGN_PROJECTS[0].frames,
        pushed: false, pushedAt: null, linkedFeedbackId: body.linkedFeedbackId ?? null, chat: [],
        ownerId: "u-pm-1", ownerName: "苏木 · PM",
        createdAt: NOW, updatedAt: NOW,
      };
      return json(route, { project }, 201);
    }
    return json(route, {}, 405);
  });

  await page.route((url) => /^\/pm-designs\/[^/]+$/.test(new URL(url).pathname), (route) => {
    const req = route.request();
    const id = decodeURIComponent(new URL(req.url()).pathname.split("/")[2]);
    const project = projects.find((p) => p.id === id);
    if (req.method() === "PATCH") {
      if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
      const body = req.postDataJSON() ?? {};
      Object.assign(project, body, { updatedAt: NOW });
      return json(route, { project });
    }
    if (req.method() === "DELETE") {
      if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
      return json(route, { projectId: id });
    }
    return json(route, {}, 405);
  });

  await page.route((url) => /^\/pm-designs\/[^/]+\/chat$/.test(new URL(url).pathname), async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]);
    const project = projects.find((p) => p.id === id);
    if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    const body = route.request().postDataJSON() ?? {};
    // B5.3 截「正在生成」过渡：这句故意晚 3s 才 fulfill（真实等待，不是摆图），同 createProject 的做法。
    if (String(body.text ?? "").includes("附件")) await new Promise((r) => setTimeout(r, 3000));
    project.chat = [...project.chat, { role: "user", text: body.text, at: NOW }, { role: "ai", text: "改好了：输入区右侧加了附件按钮，AI 回复右上角加了复制。要不要顺手把发送键做成图标？", at: NOW, source: "model" }];
    project.updatedAt = NOW;
    return json(route, { project, reply: { source: "model", applied: [], suggestions: ["输入区加附件按钮", "给 AI 回复加复制", "设计设置页"] } });
  });

  // 迭代 5：人直接改画布——夹具只回显（不真的算 patch；截图不需要）
  await page.route((url) => /^\/pm-designs\/[^/]+\/prototype\/patch$/.test(new URL(url).pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]);
    const project = projects.find((p) => p.id === id);
    if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    return json(route, { project });
  });
  // 迭代 3：版本历史——夹具里 proj-chat-ui 有两版（v1 首次整页、v2 patch 改文案），其余项目为空。
  const versionsOf = (p) => (p.id !== "proj-chat-ui" ? [] : [
    { id: "proj-chat-ui-v2", seq: 2, source: "model", summary: "把「发送」改成了生成中的「停止」，并给 AI 回复加了正在生成的标记。", frames: p.frames, notes: p.frameNotes, createdAt: "2026-09-06T02:00:40.000Z", prototype: p.prototype },
    { id: "proj-chat-ui-v1", seq: 1, source: "model", summary: "画好了两页：「聊天」是消息流 + 输入区，「历史会话」是可搜索的会话列表。", frames: p.frames, notes: p.frameNotes, createdAt: "2026-09-06T02:00:10.000Z", prototype: p.prototype },
  ]);
  await page.route((url) => /^\/pm-designs\/[^/]+\/versions$/.test(new URL(url).pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]);
    const project = projects.find((p) => p.id === id);
    if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    return json(route, { items: versionsOf(project).map(({ prototype: _p, ...rest }) => rest) });
  });
  await page.route((url) => /^\/pm-designs\/[^/]+\/versions\/[^/]+$/.test(new URL(url).pathname), (route) => {
    const [, , id, , versionId] = new URL(route.request().url()).pathname.split("/").map(decodeURIComponent);
    const project = projects.find((p) => p.id === id);
    const version = project && versionsOf(project).find((v) => v.id === versionId);
    if (!version) return json(route, { reasonCode: "VERSION_NOT_FOUND" }, 404);
    return json(route, { version });
  });

  // 迭代 3：版本历史——夹具里 proj-chat-ui 有两版（v1 首次整页、v2 patch 改文案），其余项目为空。
  const versionsOf = (p) => (p.id !== "proj-chat-ui" ? [] : [
    { id: "proj-chat-ui-v2", seq: 2, source: "model", summary: "把「发送」改成了生成中的「停止」，并给 AI 回复加了正在生成的标记。", frames: p.frames, createdAt: "2026-09-06T02:00:40.000Z", prototype: p.prototype },
    { id: "proj-chat-ui-v1", seq: 1, source: "model", summary: "画好了两页：「聊天」是消息流 + 输入区，「历史会话」是可搜索的会话列表。", frames: p.frames, createdAt: "2026-09-06T02:00:10.000Z", prototype: p.prototype },
  ]);
  await page.route((url) => /^\/pm-designs\/[^/]+\/versions$/.test(new URL(url).pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]);
    const project = projects.find((p) => p.id === id);
    if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    return json(route, { items: versionsOf(project).map(({ prototype: _p, ...rest }) => rest) });
  });
  await page.route((url) => /^\/pm-designs\/[^/]+\/versions\/[^/]+$/.test(new URL(url).pathname), (route) => {
    const [, , id, , versionId] = new URL(route.request().url()).pathname.split("/").map(decodeURIComponent);
    const project = projects.find((p) => p.id === id);
    const version = project && versionsOf(project).find((v) => v.id === versionId);
    if (!version) return json(route, { reasonCode: "VERSION_NOT_FOUND" }, 404);
    return json(route, { version });
  });

  await page.route((url) => /^\/pm-designs\/[^/]+\/push$/.test(new URL(url).pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]);
    const project = projects.find((p) => p.id === id);
    if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    project.pushed = true;
    project.pushedAt = NOW;
    return json(route, { project, inboxCode: "D-3" });
  });
}
