import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { FolderPlus, MessageSquare, Plus } from "lucide-react";

/**
 * PJ-02「从对话建项目」UI 先行原型入口 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ **纯前端 mock，不接后端，也不改任何生产屏**。这里只是签核材料：
 *   两个候选入口位置各画一张，由人类选一个（或都否）。选定后才动
 *   `personal-chat-screen.tsx` / `landing-panel.tsx`。
 *
 * ## 为什么入口只能在「个人对话」
 *
 * 真栈 chat 分两条线：
 * · **项目对话**（`chat-read-screen.tsx`）**必须有 projectId**，没有就渲染
 *   `chat-missing-project-context`，文案逐字「请先选择项目——对话属于具体项目」。
 *   在那里放「建项目」是先有鸡还是先有蛋。
 * · **个人对话**（`personal-chat-screen.tsx`）无项目上下文，左栏那句
 *   「不挂靠任何项目，仅自己可见」正是这条入口的起点。
 *
 * ⇒ coord-main 2026-08-13 裁：入口放个人对话。
 *
 * ## 这一版后端零新增
 *
 * 复用**已经真实存在**的 `POST /projects`（F117 后端 / F158 前端向导，均已 passing）：
 * `kind: "workshop"` + `blueprintVersionId: null`（空白新建路径）。
 * 与 PJ-01 的向导**共用同一条创建路径**，符合 #991 裁决 ①「createProject 单门」。
 *
 * ⚠ **对话与新项目之间不留溯源关系**（coord-main 2026-08-13 裁）：留关系需要新字段/新表
 *   ⇒ 契约新增面 ⇒ 得走 delta。这一版先把闭环打通，溯源留待将来另提。
 *
 * query 参数（预览手段）：?variant= thread-actions | landing-actions ；?state= idle | confirm
 */

const VARIANTS = {
  "thread-actions": {
    title: "候选 A —— 线程操作区（左栏）",
    why: "常驻、好找；与「新建对话」并列，紧接着那句「不挂靠任何项目」，语义上是它的毕业路径。",
    cost: "左栏是全局常驻区，多一个按钮就多一分永久占用；且它与「新建对话」视觉权重接近，可能被误点。",
  },
  "landing-actions": {
    title: "候选 B —— 落地动作集（「选一条结论落地」）",
    why: "语义最准：该区已有「开一场深度研究」这种「把一段对话变成更大的东西」的动作，建项目是它的同族兄弟，不是新范式。",
    cost: "只在落地页出现，不常驻；用户要先走到那一屏才看得到。",
  },
} as const;

type VariantKey = keyof typeof VARIANTS;

const THREAD_TITLE = "供应链韧性：三个待验证假设";

export default function ChatCreateProjectPreviewPage({
  searchParams,
}: {
  searchParams: { variant?: string; state?: string };
}) {
  const variant: VariantKey =
    searchParams.variant === "landing-actions" ? "landing-actions" : "thread-actions";
  const confirming = searchParams.state === "confirm";
  const meta = VARIANTS[variant];

  return (
    <main className="min-h-screen bg-background p-6 text-foreground" data-testid="chat-create-project-preview">
      <nav className="mb-4 flex flex-wrap items-center gap-2 text-11">
        <span className="text-muted-foreground">候选：</span>
        {(Object.keys(VARIANTS) as VariantKey[]).map((k) => (
          <Link
            key={k}
            href={`/preview/chat-create-project?variant=${k}`}
            className={k === variant ? "rounded bg-inverse px-2 py-1 text-inverse-foreground" : "rounded border border-border px-2 py-1"}
          >
            {VARIANTS[k].title}
          </Link>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        <Link
          href={`/preview/chat-create-project?variant=${variant}&state=${confirming ? "idle" : "confirm"}`}
          className="rounded border border-border px-2 py-1"
        >
          {confirming ? "回到入口态" : "看确认态"}
        </Link>
      </nav>

      <header className="mb-4 flex flex-col gap-1">
        <h1 className="text-16 font-semibold">{meta.title}</h1>
        <p className="text-12 text-muted-foreground">支持它的理由：{meta.why}</p>
        <p className="text-12 text-muted-foreground">它的代价：{meta.cost}</p>
        {/* 签核材料上最该被看见的一句话，不能用低对比色——初版用 text-warning-foreground
            在浅底上几乎隐形，截图里读不出来 */}
        <p className="mt-1 self-start rounded border border-warning/40 bg-warning/10 px-2 py-1 text-11 font-medium text-foreground">
          原型材料 · 纯 mock 不接后端 · 未改动任何生产屏
        </p>
      </header>

      <div className="max-w-md">
        {variant === "thread-actions" ? (
          <ThreadActionsVariant confirming={confirming} />
        ) : (
          <LandingActionsVariant confirming={confirming} />
        )}
      </div>
    </main>
  );
}

/** 候选 A：左栏线程操作区——复刻 `personal-chat-screen.tsx` 该区的真实结构 */
function ThreadActionsVariant({ confirming }: { confirming: boolean }) {
  return (
    <Card className="overflow-hidden" data-testid="chat-create-project-variant-thread-actions">
      <div className="px-3 py-2.5">
        <h2 className="text-12 font-semibold">个人对话</h2>
      </div>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <Button variant="outline" size="sm" className="justify-start">
          <Plus aria-hidden className="h-3.5 w-3.5" />
          新建对话
        </Button>
        <p className="text-10 text-muted-foreground">不挂靠任何项目，仅自己可见</p>

        {/* ← PJ-02 新增的就是这一个按钮 */}
        <Separator />
        <Button variant="outline" size="sm" className="justify-start" data-testid="chat-create-project-entry">
          <FolderPlus aria-hidden className="h-3.5 w-3.5" />
          从这段对话建项目
        </Button>
        <p className="text-10 text-muted-foreground">把这条个人线程里的结论，变成一个大家能一起推进的项目</p>
      </div>
      {confirming ? <ConfirmPanel /> : null}
    </Card>
  );
}

/** 候选 B：落地动作集——复刻 `landing-panel.tsx` 的「选一条结论落地」分组 */
function LandingActionsVariant({ confirming }: { confirming: boolean }) {
  return (
    <Card className="overflow-hidden p-3" data-testid="chat-create-project-variant-landing-actions">
      <h2 className="mb-2 text-12 font-semibold">选一条结论落地</h2>
      <div className="flex flex-col gap-3">
        <ActionGroup title="研究" actions={["存为洞察", "加入报告", "开一场深度研究"]} />
        {/* ← PJ-02 新增的是这一组里的这一项 */}
        <div className="flex flex-col gap-1.5">
          <h3 className="text-10 font-medium uppercase tracking-wide text-muted-foreground">立项</h3>
          <Button variant="outline" size="sm" className="justify-start" data-testid="chat-create-project-entry">
            <FolderPlus aria-hidden className="h-3.5 w-3.5" />
            从这段对话建项目
          </Button>
        </div>
      </div>
      {confirming ? <ConfirmPanel /> : null}
    </Card>
  );
}

function ActionGroup({ title, actions }: { title: string; actions: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-10 font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {actions.map((a) => (
        <Button key={a} variant="ghost" size="sm" className="justify-start text-muted-foreground">
          <MessageSquare aria-hidden className="h-3.5 w-3.5" />
          {a}
        </Button>
      ))}
    </div>
  );
}

/**
 * 确认态 —— 两个候选共用同一个确认面板（入口位置可选，确认交互不该有两套）。
 *
 * 只收一个字段：项目名（预填对话标题、可改）。其余按契约固定：
 * `kind: "workshop"`、`blueprintVersionId: null`。
 */
function ConfirmPanel() {
  return (
    <div className="border-t border-border bg-panel p-3" data-testid="chat-create-project-confirm">
      <p className="mb-2 text-12 font-medium">建一个项目</p>
      <label className="mb-1 block text-10 text-muted-foreground" htmlFor="cp-name">项目名（预填对话标题，可改）</label>
      <Input id="cp-name" defaultValue={THREAD_TITLE} className="h-8" data-testid="chat-create-project-name" />
      <ul className="mt-2 flex list-disc flex-col gap-0.5 pl-4 text-10 text-muted-foreground">
        <li>建为<strong>工作坊</strong>，不套用蓝本（蓝本服务尚未实现，见 #991）</li>
        <li>这段对话<strong>不会</strong>被搬进新项目，也不会记录来源关系（本版范围）</li>
        <li>建成后跳转到新项目</li>
      </ul>
      <div className="mt-2 flex justify-end gap-1.5">
        <Button variant="ghost" size="sm">取消</Button>
        <Button variant="primary" size="sm" data-testid="chat-create-project-submit">建项目</Button>
      </div>
    </div>
  );
}
