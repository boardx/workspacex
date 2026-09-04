"use client";
import * as React from "react";
import type { FeedbackStructured } from "./live-feedback";

/**
 * UC-17.8 研发闭环（反馈 → 设计 → 排期）—— **原型阶段的客户端共享状态**。
 *
 * ⚠ 这是 UI 先行阶段的 mock store，**不是**权威数据源：真栈化时收件箱/设计项目
 *   分别接 `feedback-loop` 契约、`system-error-logs` 契约与 deep-agent-service。这里只用
 *   一个 React context + localStorage 让「直接提交→收件箱」「深化→工作台」「推送→收件箱 +
 *   三处关联标一致」这几条端到端能点通、能截图。
 * ⚠ **草稿已经不在这里**（UC-17.8 B1，2026-09-04）：草稿走 `feedback-loop` 契约的
 *   `*FeedbackDraft*` 六条操作（`lib/live-feedback.ts`），本 store 不再持有第二份草稿状态。
 *   收件箱与设计工作台的 mock 留到 B3/B4（下个 sprint）再真栈化。
 * ⚠ Provider 只挂**一处**：`components/shell/app-shell.tsx`（D5）。壳层之外的独立页
 *   （设计详情全屏页、取材页）各自挂自己的一份，那是它们不在壳里，不是第二份权威。
 *
 * 命名刻意用拉丁码（`bug`/`req`、`backlog`/`doing`/`done`/`archived`）而不是中文显示名——
 * testid 与状态机的键不该携带业务数据（lint-design D-35）。中文只在渲染层出现，
 * 映射见 `TYPE_LABEL` / `STATUS_LABEL`。四态与现有 `feedback-loop` 契约
 * `FeedbackStatus(待处理|已进入迭代|已修复|不做)` 是同一状态机换显示名，不是第二套。
 */

export type DraftType = "bug" | "req";
export type MockInboxKind = "feedback" | "exception" | "design";
export type InboxStatus = "backlog" | "doing" | "done" | "archived";
export type ProjectTemplate = "mobile" | "ui" | "wireframe";
export type GithubState = "open" | "draft" | "merged" | "closed";
export type GithubKind = "issue" | "pr";

export interface ChatTurn {
  readonly role: "user" | "ai";
  readonly text: string;
}

export interface MockInboxItem {
  readonly id: string;
  kind: MockInboxKind;
  type?: DraftType;
  code: string;
  title: string;
  body: string;
  reporter?: string;
  time: string;
  votes: number;
  status: InboxStatus;
  reason?: string;
  /** UC-17.8 D1：反馈类条目的结构化字段（类型来自契约）；mock 种子没有，真栈化（B3）后必有。 */
  structured?: FeedbackStructured | null;
  github?: { num: number; state: GithubState; kind: GithubKind };
  linkedFeedback?: string;
  resolvedByDesign?: string;
  location?: string;
  count?: number;
  users?: number;
  severe: boolean;
  timeline: { at: string; text: string }[];
}

export interface Project {
  readonly id: string;
  name: string;
  template: ProjectTemplate;
  emoji: string;
  owner: string;
  updated: string;
  pushed: boolean;
  linkedFeedback?: string;
  resolvedInbox?: string;
  problem: string;
  criteria: string[];
  frames: string[];
  chat: ChatTurn[];
}

export const TYPE_LABEL: Record<DraftType, string> = { bug: "缺陷", req: "需求" };
export const KIND_LABEL: Record<MockInboxKind, string> = {
  feedback: "用户反馈",
  exception: "系统异常",
  design: "设计方案",
};
export const STATUS_LABEL: Record<InboxStatus, string> = {
  backlog: "待处理",
  doing: "进行中",
  done: "已完成",
  archived: "不做",
};
export const STATUS_ORDER: InboxStatus[] = ["backlog", "doing", "done", "archived"];
export const TEMPLATE_LABEL: Record<ProjectTemplate, string> = {
  mobile: "移动端设计",
  ui: "UI 原型",
  wireframe: "线框图",
};
export const TEMPLATE_EMOJI: Record<ProjectTemplate, string> = {
  mobile: "📱",
  ui: "🎨",
  wireframe: "🧩",
};
export const GITHUB_STATE_LABEL: Record<GithubState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

export const DESIGN_CHAT_ACK = "好的，我记下了这个调整，稍后会更新原型画布。";
export const DESIGN_CHAT_INTRO =
  "把你想解决的问题说清楚，我会顺着它更新右边的原型画布和验收标准。可以先从「谁在什么场景下会用到」讲起。";
export const DEFAULT_CRITERIA = [
  "明确问题与目标范围",
  "给出交互方案与边界情况处理",
  "列出验收标准供工程对齐",
];

function nowIso(): string {
  return new Date().toISOString();
}
function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── 种子数据 ────────────────────────────────────────────────────────────────
// 数量级照真实分诊台：收件箱 ≥12 条覆盖三类 × 四态，含严重标、关联标、四种 GitHub 状态。

function tl(text: string, daysAgo: number): { at: string; text: string }[] {
  return [{ at: new Date(Date.now() - daysAgo * 86400000).toISOString(), text }];
}

function seedInbox(): MockInboxItem[] {
  return [
    // 反馈 · 缺陷
    {
      id: "in-b1", kind: "feedback", type: "bug", code: "B-1", title: "上传三个文件只读了一个",
      body: "在调研助手里一次拖了三个 PDF，agent 只引用了第一个，另外两个像没上传。",
      reporter: "林晚 · 增长组", time: "2026-09-03T01:40:00.000Z", votes: 12, status: "backlog",
      github: { num: 142, state: "open", kind: "issue" }, severe: true, timeline: tl("进入收件箱", 1),
    },
    {
      id: "in-b2", kind: "feedback", type: "bug", code: "B-2", title: "批准卡不记得上次的 token 预算",
      body: "每次批准都要重填 token 预算，第三次之后就不想用了。",
      reporter: "周珂 · 平台组", time: "2026-09-02T02:14:00.000Z", votes: 7, status: "doing",
      github: { num: 145, state: "draft", kind: "pr" }, severe: false, timeline: tl("开始处理，已排期本轮迭代", 1),
    },
    {
      id: "in-b3", kind: "feedback", type: "bug", code: "B-3", title: "移动端批准卡按钮被键盘挡住",
      body: "在手机上批准时，软键盘弹出来把「批准」按钮挡住了，滚不到。",
      reporter: "许乐 · 客户成功", time: "2026-08-28T06:10:00.000Z", votes: 5, status: "backlog",
      resolvedByDesign: "D-2", severe: false, timeline: tl("进入收件箱", 6),
    },
    {
      id: "in-b4", kind: "feedback", type: "bug", code: "B-4", title: "导出 PDF 偶尔缺最后一页",
      body: "长报告导出成 PDF 时，最后一页有概率丢失，重导一次又正常。",
      reporter: "陈屿 · 交付组", time: "2026-08-20T03:00:00.000Z", votes: 9, status: "done",
      github: { num: 130, state: "merged", kind: "pr" }, severe: false, timeline: tl("已修复并上线", 3),
    },
    // 反馈 · 需求
    {
      id: "in-r1", kind: "feedback", type: "req", code: "R-1", title: "希望能按项目筛选录音",
      body: "现在录音列表是全组织的，找上周那场要翻很久。",
      reporter: "苏牧 · 咨询组", time: "2026-09-01T09:02:00.000Z", votes: 8, status: "doing",
      github: { num: 151, state: "open", kind: "issue" }, severe: false, timeline: tl("排期到本轮迭代", 2),
    },
    {
      id: "in-r2", kind: "feedback", type: "req", code: "R-2", title: "会议纪要输出固定成表格",
      body: "有时候给表格有时候给段落，下游没法直接用。",
      reporter: "何洲 · 运营组", time: "2026-08-25T14:20:00.000Z", votes: 6, status: "backlog",
      severe: false, timeline: tl("进入收件箱", 4),
    },
    {
      id: "in-r3", kind: "feedback", type: "req", code: "R-3", title: "批量邀请支持粘贴邮箱列表",
      body: "一次邀请几十个人得一个个填，希望能粘贴一整列邮箱。",
      reporter: "叶蓁 · HR", time: "2026-08-10T08:30:00.000Z", votes: 4, status: "archived",
      reason: "与即将上线的 SCIM 目录同步重叠，暂不单独做手工批量邀请。",
      severe: false, timeline: tl("转为不做：与 SCIM 同步重叠", 5),
    },
    // 系统异常
    {
      id: "in-e1", kind: "exception", code: "E-1", title: "ASR 转写服务连接超时",
      body: "语音转写在高峰期出现连接超时，影响长语音反馈与会议录音。",
      time: "2026-09-03T05:00:00.000Z", votes: 0, status: "backlog",
      location: "asr-gateway / ws", count: 47, users: 12, severe: true, timeline: tl("首次告警", 1),
    },
    {
      id: "in-e2", kind: "exception", code: "E-2", title: "附件下载偶发 403",
      body: "带鉴权的附件下载在会话续期窗口偶发 403，刷新后恢复。",
      time: "2026-09-01T11:00:00.000Z", votes: 0, status: "doing",
      location: "file-service / download", count: 18, users: 6, severe: false, timeline: tl("定位中：疑似 token 续期竞态", 2),
    },
    {
      id: "in-e3", kind: "exception", code: "E-3", title: "定时摘要任务积压",
      body: "夜间摘要 worker 队列积压，早高峰摘要延迟送达。",
      time: "2026-08-22T00:00:00.000Z", votes: 0, status: "done",
      location: "summary-worker / queue", count: 3, users: 0, severe: false, timeline: tl("扩容后恢复", 3),
    },
    // 设计方案
    {
      id: "in-d1", kind: "design", code: "D-1", title: "统一空态与错误态设计规范",
      body: "把全站空态/错误态收敛成一套可复用组件与文案规范，供各屏对齐。",
      reporter: "PM · 设计工作台", time: "2026-08-30T10:00:00.000Z", votes: 0, status: "doing",
      github: { num: 158, state: "open", kind: "issue" }, severe: false, timeline: tl("推送到收件箱，等待排期", 3),
    },
    {
      id: "in-d2", kind: "design", code: "D-2", title: "移动端批准卡键盘避让方案",
      body: "针对 B-3，给出软键盘弹出时批准操作区上移/吸底的交互方案与验收标准。",
      reporter: "PM · 设计工作台", time: "2026-08-27T10:00:00.000Z", votes: 0, status: "backlog",
      linkedFeedback: "B-3", severe: false, timeline: tl("由 B-3 深化而来", 6),
    },
    {
      id: "in-d3", kind: "design", code: "D-3", title: "反馈提交结构化字段表单",
      body: "把快速反馈的自由文本升级成按类型切换的结构化字段，降低分诊成本。",
      reporter: "PM · 设计工作台", time: "2026-08-05T10:00:00.000Z", votes: 0, status: "done",
      github: { num: 120, state: "closed", kind: "pr" }, severe: false, timeline: tl("方案已交付并上线", 8),
    },
  ];
}

function seedProjects(): Project[] {
  return [
    {
      id: "proj-empty-states", name: "统一空态与错误态设计规范", template: "ui", emoji: TEMPLATE_EMOJI.ui,
      owner: "PM 团队", updated: "2026-08-30T10:00:00.000Z", pushed: true, resolvedInbox: "D-1",
      problem: "全站空态/错误态各写各的，文案与视觉不一致，用户读不出「是没有数据还是加载失败」。",
      criteria: [...DEFAULT_CRITERIA], frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
      chat: [{ role: "ai", text: DESIGN_CHAT_INTRO }],
    },
    {
      id: "proj-keyboard-avoid", name: "移动端批准卡键盘避让方案", template: "mobile", emoji: TEMPLATE_EMOJI.mobile,
      owner: "PM 团队", updated: "2026-08-27T10:00:00.000Z", pushed: true, linkedFeedback: "B-3", resolvedInbox: "D-2",
      problem: "手机上软键盘弹出会挡住批准按钮，用户滚不到、批不了。",
      criteria: [...DEFAULT_CRITERIA], frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
      chat: [{ role: "ai", text: DESIGN_CHAT_INTRO }],
    },
    {
      id: "proj-onboarding", name: "新成员首周引导流", template: "wireframe", emoji: TEMPLATE_EMOJI.wireframe,
      owner: "PM 团队", updated: "2026-08-18T10:00:00.000Z", pushed: false,
      problem: "新成员进来找不到「第一件该做的事」，前三天流失最高。",
      criteria: [...DEFAULT_CRITERIA], frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
      chat: [{ role: "ai", text: DESIGN_CHAT_INTRO }],
    },
    {
      id: "proj-rec-filter", name: "录音库项目维度筛选", template: "ui", emoji: TEMPLATE_EMOJI.ui,
      owner: "PM 团队", updated: "2026-08-12T10:00:00.000Z", pushed: false,
      problem: "录音列表是全组织平铺的，按项目找一场要翻很久。",
      criteria: [...DEFAULT_CRITERIA], frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
      chat: [{ role: "ai", text: DESIGN_CHAT_INTRO }],
    },
  ];
}

interface StoreShape {
  inbox: MockInboxItem[];
  projects: Project[];
}

export interface DesignLoopApi extends StoreShape {
  submitDirect: (input: { type: DraftType; title: string; body: string }) => string;
  setStatus: (id: string, status: InboxStatus) => void;
  archiveWithReason: (id: string, reason: string) => void;
  createProject: (input: { name: string; template: ProjectTemplate; problem?: string; linkedFeedback?: string }) => string;
  updateProject: (id: string, patch: Partial<Pick<Project, "name" | "template" | "problem">>) => void;
  deleteProject: (id: string) => void;
  appendProjectChat: (id: string, text: string) => void;
  pushProject: (id: string, note?: string) => string;
  deepenFeedback: (inboxId: string) => string;
}

const DesignLoopContext = React.createContext<DesignLoopApi | null>(null);

const LS_KEY = "design-loop-prototype-v1";

function loadInitial(seed: StoreShape): StoreShape {
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      // 旧持久化里可能还带原型期的 `drafts`——草稿已真栈化，那份不再读，也不再写回。
      const parsed = JSON.parse(raw) as Partial<StoreShape> & { drafts?: unknown };
      return { inbox: parsed.inbox ?? seed.inbox, projects: parsed.projects ?? seed.projects };
    }
  } catch {
    /* 破损的持久化不该让原型打不开——退回种子 */
  }
  return seed;
}

export function DesignLoopProvider({
  children,
  seed,
}: {
  children: React.ReactNode;
  /** 截图/测试可注入固定初始态；不传则用种子并持久化到 localStorage。 */
  seed?: Partial<StoreShape>;
}) {
  const base = React.useMemo<StoreShape>(
    () => ({ inbox: seed?.inbox ?? seedInbox(), projects: seed?.projects ?? seedProjects() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const persist = seed === undefined;
  const [state, setState] = React.useState<StoreShape>(() => (persist ? loadInitial(base) : base));

  React.useEffect(() => {
    if (!persist) return;
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {
      /* 配额满/隐私模式：原型不因持久化失败而中断 */
    }
  }, [state, persist]);

  const api = React.useMemo<DesignLoopApi>(() => {
    const nextCode = (prefix: string, items: MockInboxItem[]) => {
      const nums = items
        .map((i) => i.code)
        .filter((c) => c.startsWith(`${prefix}-`))
        .map((c) => Number(c.slice(prefix.length + 1)))
        .filter((n) => Number.isFinite(n));
      return `${prefix}-${(nums.length ? Math.max(...nums) : 0) + 1}`;
    };

    const inboxFromDirect = (input: { type: DraftType; title: string; body: string }, inbox: MockInboxItem[]): MockInboxItem => ({
      id: rid("in"),
      kind: "feedback",
      type: input.type,
      code: nextCode(input.type === "bug" ? "B" : "R", inbox),
      title: input.title || "（未命名反馈）",
      body: input.body,
      reporter: "我 · 当前用户",
      time: nowIso(),
      votes: 0,
      status: "backlog",
      severe: false,
      timeline: [{ at: nowIso(), text: "进入收件箱（待处理）" }],
    });

    return {
      ...state,
      submitDirect: (input) => {
        let newId = "";
        setState((s) => {
          const item = inboxFromDirect(input, s.inbox);
          newId = item.id;
          return { ...s, inbox: [item, ...s.inbox] };
        });
        return newId;
      },
      setStatus: (id, status) =>
        setState((s) => ({
          ...s,
          inbox: s.inbox.map((i) =>
            i.id === id
              ? { ...i, status, reason: status === "archived" ? i.reason : undefined, timeline: [...i.timeline, { at: nowIso(), text: `状态改为「${STATUS_LABEL[status]}」` }] }
              : i,
          ),
        })),
      archiveWithReason: (id, reason) =>
        setState((s) => ({
          ...s,
          inbox: s.inbox.map((i) =>
            i.id === id ? { ...i, status: "archived", reason, timeline: [...i.timeline, { at: nowIso(), text: `转为不做：${reason}` }] } : i,
          ),
        })),
      createProject: (input) => {
        const id = rid("proj");
        const project: Project = {
          id, name: input.name, template: input.template, emoji: TEMPLATE_EMOJI[input.template],
          owner: "我 · PM", updated: nowIso(), pushed: false, linkedFeedback: input.linkedFeedback,
          problem: input.problem ?? "", criteria: [...DEFAULT_CRITERIA], frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
          chat: [{ role: "ai", text: DESIGN_CHAT_INTRO }],
        };
        setState((s) => ({ ...s, projects: [project, ...s.projects] }));
        return id;
      },
      updateProject: (id, patch) =>
        setState((s) => ({
          ...s,
          projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch, updated: nowIso() } : p)),
        })),
      deleteProject: (id) => setState((s) => ({ ...s, projects: s.projects.filter((p) => p.id !== id) })),
      appendProjectChat: (id, text) =>
        setState((s) => ({
          ...s,
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, chat: [...p.chat, { role: "user", text }, { role: "ai", text: DESIGN_CHAT_ACK }], updated: nowIso() } : p,
          ),
        })),
      pushProject: (id, note) => {
        let code = "";
        setState((s) => {
          const project = s.projects.find((p) => p.id === id);
          if (!project) return s;
          code = nextCode("D", s.inbox);
          const item: MockInboxItem = {
            id: rid("in"), kind: "design", code, title: project.name,
            body: note && note.trim() ? note.trim() : project.problem,
            reporter: "PM · 设计工作台", time: nowIso(), votes: 0, status: "backlog",
            linkedFeedback: project.linkedFeedback, severe: false,
            timeline: [{ at: nowIso(), text: "推送到收件箱（待处理）" }],
          };
          return {
            ...s,
            projects: s.projects.map((p) => (p.id === id ? { ...p, pushed: true, resolvedInbox: code, updated: nowIso() } : p)),
            inbox: [
              item,
              // 若项目来自某条反馈深化，则原反馈标「已生成 D-X」
              ...s.inbox.map((i) => (project.linkedFeedback && i.code === project.linkedFeedback ? { ...i, resolvedByDesign: code } : i)),
            ],
          };
        });
        return code;
      },
      deepenFeedback: (inboxId) => {
        let projId = "";
        setState((s) => {
          const item = s.inbox.find((i) => i.id === inboxId);
          if (!item) return s;
          projId = rid("proj");
          const project: Project = {
            id: projId, name: item.title, template: "wireframe", emoji: TEMPLATE_EMOJI.wireframe,
            owner: "我 · PM", updated: nowIso(), pushed: false, linkedFeedback: item.code,
            problem: item.body, criteria: [...DEFAULT_CRITERIA], frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
            chat: [{ role: "ai", text: DESIGN_CHAT_INTRO }],
          };
          return { ...s, projects: [project, ...s.projects] };
        });
        return projId;
      },
    };
  }, [state]);

  return <DesignLoopContext.Provider value={api}>{children}</DesignLoopContext.Provider>;
}

export function useDesignLoop(): DesignLoopApi {
  const ctx = React.useContext(DesignLoopContext);
  if (!ctx) throw new Error("useDesignLoop 必须在 <DesignLoopProvider> 内使用");
  return ctx;
}

/** 便于测试/预览用：可选地拿到 store，不在 Provider 内返回 null 而不抛错。 */
export function useOptionalDesignLoop(): DesignLoopApi | null {
  return React.useContext(DesignLoopContext);
}
