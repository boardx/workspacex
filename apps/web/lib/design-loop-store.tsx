"use client";
import * as React from "react";

/**
 * UC-17.8 研发闭环（反馈 → 设计 → 排期）—— **PM 设计工作台的客户端共享状态（原型）**。
 *
 * ⚠ **收件箱不再在这里**（UC-17.8 B3.4，2026-09-04）：收件箱真栈化，切到
 *   `packages/contracts/src/inbox.ts` 的 `listInbox`/`getInboxCounts`（`lib/live-inbox.ts`），
 *   看板拖拽换列改走 `feedbackLoop.operations.triageFeedback` /
 *   `systemErrorLogs.operations.updateSystemErrorLifecycle`。本 store 不再持有收件箱 mock
 *   （`MockInboxItem`/`InboxStatus`/`setStatus`/`archiveWithReason`/`seedInbox` 等，删除）。
 * ⚠ **草稿也不在这里**（UC-17.8 B1，2026-09-04）：草稿走 `feedback-loop` 契约的
 *   `*FeedbackDraft*` 六条操作（`lib/live-feedback.ts`）。
 * ⚠ 剩下的 PM 设计工作台（`projects`）**仍是原型 mock**（B4，下个 sprint 才真栈化）——
 *   一个 React context + localStorage，让「深化 → 工作台」「推送 → 收件箱」这两条端到端
 *   路径能点通、能截图，不是权威数据源。
 * ⚠ Provider 只挂**一处**：`components/shell/app-shell.tsx`（D5）。壳层之外的独立页
 *   （设计详情全屏页）各自挂自己的一份，那是它们不在壳里，不是第二份权威。
 *
 * `deepenFeedback` 的入参（`code`/`title`/`body`）由调用方（真栈收件箱屏）从
 * `InboxItem` 里取，本 store 不再自己保有一份反馈/异常条目去查——那份唯一事实源
 * 现在是 `listInbox`。
 */

export type MockProjectTemplate = "mobile" | "ui" | "wireframe";

export interface ChatTurn {
  readonly role: "user" | "ai";
  readonly text: string;
}

export interface Project {
  readonly id: string;
  name: string;
  template: MockProjectTemplate;
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

export const TEMPLATE_LABEL: Record<MockProjectTemplate, string> = {
  mobile: "移动端设计",
  ui: "UI 原型",
  wireframe: "线框图",
};
export const TEMPLATE_EMOJI: Record<MockProjectTemplate, string> = {
  mobile: "📱",
  ui: "🎨",
  wireframe: "🧩",
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
  projects: Project[];
}

export interface DesignLoopApi extends StoreShape {
  createProject: (input: { name: string; template: MockProjectTemplate; problem?: string; linkedFeedback?: string }) => string;
  updateProject: (id: string, patch: Partial<Pick<Project, "name" | "template" | "problem">>) => void;
  deleteProject: (id: string) => void;
  appendProjectChat: (id: string, text: string) => void;
  /**
   * 推送到收件箱。⚠ 本轮（B4 之前）收件箱没有 `design` 数据（见 `inbox.ts` 文件头），
   * 这里返回的 `code` 只用于本地 `Project.resolvedInbox` 展示，**不会**真的出现在
   * `listInbox` 的结果里——推送动作本身仍是原型。
   */
  pushProject: (id: string, note?: string) => string;
  /**
   * 从一条收件箱条目（反馈/系统异常）深化出一个设计项目。入参来自调用方已经拿到的
   * `InboxItem`（`code`/`title`/`body`），本 store 不再自己查——收件箱的权威数据源
   * 现在是 `listInbox`，不是这个 store。
   */
  deepenFeedback: (input: { code: string; title: string; body: string | null }) => string;
}

const DesignLoopContext = React.createContext<DesignLoopApi | null>(null);

const LS_KEY = "design-loop-prototype-v1";

function loadInitial(seed: StoreShape): StoreShape {
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) {
      // 旧持久化里可能还带原型期的 `drafts`/`inbox`——两者都已真栈化，不再读，也不再写回。
      const parsed = JSON.parse(raw) as Partial<StoreShape> & { drafts?: unknown; inbox?: unknown };
      return { projects: parsed.projects ?? seed.projects };
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
    () => ({ projects: seed?.projects ?? seedProjects() }),
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
    const nextDesignCode = (projects: Project[]) => {
      const nums = projects
        .map((p) => p.resolvedInbox)
        .filter((c): c is string => typeof c === "string" && c.startsWith("D-"))
        .map((c) => Number(c.slice(2)))
        .filter((n) => Number.isFinite(n));
      return `D-${(nums.length ? Math.max(...nums) : 0) + 1}`;
    };

    return {
      ...state,
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
          code = nextDesignCode(s.projects);
          void note; // 原型不再往一份不存在的收件箱写条目——推送笔记本轮无处落地，留给 B4。
          return {
            ...s,
            projects: s.projects.map((p) => (p.id === id ? { ...p, pushed: true, resolvedInbox: code, updated: nowIso() } : p)),
          };
        });
        return code;
      },
      deepenFeedback: (input) => {
        let projId = "";
        setState((s) => {
          projId = rid("proj");
          const project: Project = {
            id: projId, name: input.title, template: "wireframe", emoji: TEMPLATE_EMOJI.wireframe,
            owner: "我 · PM", updated: nowIso(), pushed: false, linkedFeedback: input.code,
            problem: input.body ?? "", criteria: [...DEFAULT_CRITERIA], frames: ["草稿页 1", "草稿页 2", "草稿页 3"],
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
