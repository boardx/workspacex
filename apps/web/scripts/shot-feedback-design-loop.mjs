// 截图生成器 —— UC-17.8 研发闭环（反馈 → 设计 → 排期）。签核第 ① 件（UI）材料。
// 取材页 /preview/feedback-design-loop（渲染真组件 + 固定 seed，不写 localStorage）。
// 草稿（UC-17.8 B1 真栈）：由本脚本 `page.route()` 拦 `/feedback/drafts*` 提供固定数据——
// 同 shot-feedback-loop.mjs 的范式，不再 seed localStorage 草稿。
// 收件箱（UC-17.8 B3.4 真栈）：同样由 `page.route()` 拦 `/inbox`、`/inbox/counts`、
// `/feedback/:id/status`、`/feedback/:id/events`、`/system/error-logs/:id` 提供固定数据/回执——
// `DesignLoopProvider` 不再持有收件箱 mock，屏幕自己打这几条真实契约路径。
// 浅/深两态都拍；每屏至少默认/空/校验失败/成功，外加看板拖放悬停、drawer、生成中过渡、推送成功页。
// 设计工作台（UC-17.8 B4.6）：`workbench-*`/`detail-*` 这 16 张不落进 OUT，改落进
// `<OUT 的上级>/design-workbench/`——它们是契约束 `design-workbench` 自己的 ui.md 材料，
// 有自己的目录（`ui-material-map.json` 一束一目录），不与本脚本其余场景的目录混在一起。
// 用法：BASE=http://localhost:3187 OUT=/abs/path node scripts/shot-feedback-design-loop.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3187";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });
const DESIGN_WORKBENCH_OUT = join(dirname(OUT), "design-workbench");
const outDirFor = (file) => (file.startsWith("workbench-") || file.startsWith("detail-") ? DESIGN_WORKBENCH_OUT : OUT);

const ROOT = '[data-testid="feedback-design-loop-preview"]';

/** 固定的草稿取材数据。⚠ 与契约 `FeedbackDraft` 同形，字段少一个屏上就少一块。 */
const NOW = "2026-09-03T02:14:00.000Z";
const DRAFTS = [
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
async function routeDrafts(page, { empty }) {
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
const INBOX_ITEMS = [
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
    exception: { location: "asr-gateway / ws", count: 47, affectedUsers: 12 }, submittedByMe: false, votedByMe: false,
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
async function routeInbox(page, { empty }) {
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
const DESIGN_PROJECTS = [
  {
    id: "proj-empty-states", name: "反馈分诊看板重设计", template: "wireframe",
    problem: "运营现在要在多个屏之间来回切才能看到一条反馈的处理状态，希望有一个统一看板。",
    criteria: ["明确问题与目标范围", "给出交互方案与边界情况处理", "列出验收标准供工程对齐"],
    frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
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
    frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
    pushed: true, pushedAt: "2026-09-02T10:00:00.000Z", linkedFeedbackId: null, chat: [],
    ownerId: "u-pm-1", ownerName: "苏木 · PM",
    createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z",
  },
];

/**
 * 拦 `/pm-designs*`：列表 / 建 / 改 / 删 / 追加对话 / 推送。
 * `slow`：`listMyProjects` 故意挂起不 resolve，用于截「加载中」骨架屏（真实请求在飞）。
 */
async function routeDesignWorkbench(page, { empty = false, slow = false, failList = false } = {}) {
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

  await page.route((url) => /^\/pm-designs\/[^/]+\/chat$/.test(new URL(url).pathname), (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[2]);
    const project = projects.find((p) => p.id === id);
    if (!project) return json(route, { reasonCode: "PROJECT_NOT_FOUND" }, 404);
    const body = route.request().postDataJSON() ?? {};
    project.chat = [...project.chat, { role: "user", text: body.text, at: NOW }, { role: "ai", text: DESIGN_WORKBENCH_CHAT_REPLY, at: NOW }];
    project.updatedAt = NOW;
    return json(route, { project });
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

/** [file, scene, state, theme, prepare, viewport] */
const SHOTS = [
  // 快速反馈弹窗
  ["dialog-default-light.png", "dialog", "default", "light", null],
  ["dialog-default-dark.png", "dialog", "default", "dark", null],
  ["dialog-req-light.png", "dialog", "default", "light", clickReq],
  ["dialog-draft-saved-light.png", "dialog", "default", "light", saveDraft],
  // 反馈草稿
  ["drafts-default-light.png", "drafts", "default", "light", null],
  ["drafts-default-dark.png", "drafts", "default", "dark", null],
  ["drafts-empty-light.png", "drafts-empty", "empty", "light", null],
  ["drafts-edit-drawer-light.png", "drafts", "default", "light", openFirstDraft],
  ["drafts-refine-light.png", "drafts", "default", "light", openRefine],
  // 运营收件箱
  ["inbox-board-light.png", "inbox-board", "default", "light", null],
  ["inbox-board-dark.png", "inbox-board", "default", "dark", null],
  ["inbox-board-draghover-light.png", "inbox-board", "default", "light", hoverColumn],
  ["inbox-list-light.png", "inbox-board", "default", "light", switchList],
  ["inbox-drawer-light.png", "inbox-board", "default", "light", openInboxDrawer],
  ["inbox-decline-invalid-light.png", "inbox-board", "default", "light", openDecline],
  ["inbox-success-light.png", "inbox-board", "default", "light", startProcessing],
  ["inbox-empty-light.png", "inbox-empty", "empty", "light", null],
  ["inbox-loading-light.png", "inbox-board", "loading", "light", null],
  ["inbox-denied-light.png", "inbox-board", "denied", "light", null],
  ["inbox-depfailed-light.png", "inbox-board", "dep-failed", "light", null],
  // PM 设计工作台
  ["workbench-default-light.png", "workbench", "default", "light", null],
  ["workbench-default-dark.png", "workbench", "default", "dark", null],
  ["workbench-empty-light.png", "workbench-empty", "empty", "light", null],
  ["workbench-new-dialog-light.png", "workbench", "default", "light", openNewDesign],
  ["workbench-new-invalid-light.png", "workbench", "default", "light", openNewDesignEmpty],
  // 新增（UC-17.8 B4.6，B4.5 切真栈后才有的三态 + 一个真实等待过渡）
  ["workbench-loading-light.png", "workbench", "loading", "light", null],
  ["workbench-denied-light.png", "workbench", "denied", "light", null],
  ["workbench-depfailed-light.png", "workbench", "dep-failed", "light", null],
  ["workbench-generating-light.png", "workbench", "default", "light", createSlow],
  // 设计详情全屏（深色 IDE）
  ["detail-canvas-dark.png", "detail", "default", "dark", null],
  ["detail-spec-dark.png", "detail", "default", "dark", openSpec],
  ["detail-push-confirm-dark.png", "detail", "default", "dark", openPushConfirm],
  ["detail-push-success-dark.png", "detail", "default", "dark", doPush],
  // 新增（UC-17.8 B4.6，B4.5 切真栈后才有的两态）
  ["detail-loading-dark.png", "detail-loading", "default", "dark", null],
  ["detail-depfailed-dark.png", "detail-depfailed", "default", "dark", null],
  ["detail-missing-dark.png", "detail-missing", "default", "dark", null],
];

async function clickReq(page) { await click(page, '[data-testid="feedback-kind-需求"]'); }
async function saveDraft(page) {
  await page.fill('[data-testid="feedback-detail-input"]', "批准卡不记得上次的 token 预算，每次都要重填。");
  await click(page, '[data-testid="feedback-save-draft"]');
  await page.waitForSelector('[data-testid="feedback-draft-saved"]', { timeout: 4000 });
}
async function openFirstDraft(page) { await clickFirst(page, '[data-testid^="draft-open-"]', '[data-testid="draft-edit-drawer"]'); }
async function openRefine(page) { await clickFirst(page, '[data-testid^="draft-refine-"]', '[data-testid="draft-refine-overlay"]'); }
async function hoverColumn(page) {
  const card = page.locator('[data-testid="inbox-card-B-1"]').first();
  const col = page.locator('[data-testid="inbox-column-doing"]').first();
  await card.hover();
  await page.mouse.down();
  const box = await col.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(300);
}
async function switchList(page) { await click(page, '[data-testid="inbox-view-list"]'); await page.waitForSelector('[data-testid="inbox-list"]'); }
async function openInboxDrawer(page) { await clickUntil(page, '[data-testid="inbox-card-B-1"]', '[data-testid="inbox-drawer"]'); }
async function openDecline(page) {
  await clickUntil(page, '[data-testid="inbox-card-B-1"]', '[data-testid="inbox-drawer"]');
  await clickUntil(page, '[data-testid="inbox-action-decline"]', '[data-testid="inbox-decline-form"]');
}
async function startProcessing(page) {
  await clickUntil(page, '[data-testid="inbox-card-B-1"]', '[data-testid="inbox-drawer"]');
  await clickUntil(page, '[data-testid="inbox-action-start"]', '[data-testid="saved"]');
}
async function openNewDesign(page) { await clickUntil(page, '[data-testid="workbench-new"]', '[data-testid="project-dialog"]'); }
async function openNewDesignEmpty(page) {
  await clickUntil(page, '[data-testid="workbench-new"]', '[data-testid="project-dialog"]');
  await page.fill('[data-testid="project-dialog-name"]', "abc");
  await page.fill('[data-testid="project-dialog-name"]', "");
}
async function createSlow(page) {
  await clickUntil(page, '[data-testid="workbench-new"]', '[data-testid="project-dialog"]');
  await page.fill('[data-testid="project-dialog-name"]', "移动端登录页重设计");
  await click(page, '[data-testid="project-dialog-submit"]');
  await page.waitForSelector('[data-testid="workbench-generating"]', { timeout: 4000 });
}
async function openSpec(page) { await clickUntil(page, '[data-testid="design-detail-tab-spec"]', '[data-testid="design-detail-spec"]'); }
async function openPushConfirm(page) { await clickUntil(page, '[data-testid="design-detail-push"]', '[data-testid="design-push-confirm"]'); }
async function doPush(page) {
  await clickUntil(page, '[data-testid="design-detail-push"]', '[data-testid="design-push-confirm"]');
  await clickUntil(page, '[data-testid="design-push-confirm-submit"]', '[data-testid="design-push-success"]');
}

async function click(page, sel) { await page.locator(sel).first().click({ timeout: 4000 }); }
async function clickFirst(page, sel, expect) { await clickUntil(page, sel, expect); }
async function clickUntil(page, selector, expect, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if ((await page.locator(expect).count()) > 0) return;
    await page.locator(selector).first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  throw new Error(`clickUntil: ${expect} never appeared after clicking ${selector}`);
}

async function gotoReady(page, url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(ROOT, { state: "attached", timeout: 8000 });
      return;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`场景加载失败：${url}`);
}

// 可选 SHOTS_FILTER：正则，只跑文件名匹配的条目（调试/重跑单个屏用，默认跑全部）。
const filterRe = process.env.SHOTS_FILTER ? new RegExp(process.env.SHOTS_FILTER) : null;
const shotsToRun = filterRe ? SHOTS.filter(([file]) => filterRe.test(file)) : SHOTS;

mkdirSync(DESIGN_WORKBENCH_OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
for (const [file, scene, state, theme, prepare] of shotsToRun) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: theme, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await routeDrafts(page, { empty: scene === "drafts-empty" });
  await routeInbox(page, { empty: scene === "inbox-empty" });
  await routeDesignWorkbench(page, {
    empty: scene === "workbench-empty",
    slow: scene === "detail-loading",
    failList: scene === "detail-depfailed",
  });
  await gotoReady(page, `/preview/feedback-design-loop?scene=${scene}&state=${state}`);
  await page.waitForTimeout(500);
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDirFor(file)}/${file}` });
  console.log(`✓ ${file}`);
  await context.close();
}
await browser.close();
console.log("done");
