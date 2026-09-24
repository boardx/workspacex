import * as React from "react";
import Link from "next/link";
import { KnowledgePanel, type PanelStatus, type PanelView } from "@/components/chat/knowledge/knowledge-panel";
import { ClaimSourceDrawer } from "@/components/chat/knowledge/claim-source-drawer";
import { AnswerKnowledgeFooter } from "@/components/chat/knowledge/answer-knowledge-footer";
import { NominationCard } from "@/components/chat/knowledge/nomination-card";
import { PromotionResultList } from "@/components/chat/knowledge/promotion-result-list";
import {
  threadKnowledgeNormal,
  threadKnowledgeIngesting,
  threadKnowledgePartialFailure,
  threadKnowledgeReadOnly,
  threadKnowledgeEmpty,
  threadKnowledgeOversize,
  threadKnowledgeErrorCode,
  claimSourcesNormal,
  claimSourcesRevoked,
  answerCitationsNormal,
  answerCitationsPersonal,
  channelHealthAllOk,
  channelHealthGraphDown,
  channelHealthVectorDown,
  promotionResultsMixed,
  nominationsNormal,
  type ThreadKnowledge,
} from "@/lib/mock/knowledge-graph";

/**
 * chat-knowledge-graph（Phase 18）UI 先行原型入口 —— ADR-023 签核第 ① 件（UI）材料。
 *
 * ⚠ 纯前端 mock，**不接后端**（硬规则 ③）。真实的抽取 / 召回 / 权限 / 级联失效都在服务端。
 *   这里做的是签核材料：人类要能点、能逐态核对（硬规则 ②⑤）。
 *
 * query（预览手段，非权限实现——真实权限在服务端，视角切换只是投影）：
 *   ?scene=<场景>&role=owner|member
 */

type SceneDef = {
  id: string;
  label: string;
  group: string;
};

const SCENES: SceneDef[] = [
  { id: "list-normal", label: "列表·正常", group: "列表(uc-18-3)" },
  { id: "list-loading", label: "列表·加载", group: "列表(uc-18-3)" },
  { id: "list-empty", label: "列表·空", group: "列表(uc-18-3)" },
  { id: "list-partial", label: "列表·部分失败", group: "列表(uc-18-3)" },
  { id: "list-error", label: "列表·错误", group: "列表(uc-18-3)" },
  { id: "list-readonly", label: "列表·只读(非所有者)", group: "列表(uc-18-3)" },
  { id: "graph-normal", label: "图·正常", group: "图(uc-18-3)" },
  { id: "graph-oversize", label: "图·超限(>200)", group: "图(uc-18-3)" },
  { id: "graph-loading", label: "图·加载", group: "图(uc-18-3)" },
  { id: "graph-error", label: "图·错误", group: "图(uc-18-3)" },
  { id: "drawer-normal", label: "来源抽屉·正常", group: "来源(uc-18-2)" },
  { id: "drawer-revoked", label: "来源抽屉·已删除", group: "来源(uc-18-5)" },
  { id: "answer-normal", label: "回答·引用+为什么召回", group: "召回(uc-18-2)" },
  { id: "answer-graph-down", label: "回答·图检索不可用", group: "召回(uc-18-2)" },
  { id: "answer-vector-down", label: "回答·向量检索不可用", group: "召回(uc-18-2)" },
  { id: "answer-personal", label: "回答·来自个人空间", group: "召回(uc-18-4)" },
  { id: "promote-results", label: "存入个人空间·逐条结果", group: "晋升(uc-18-4)" },
  { id: "nomination", label: "AI 提名·值得记住", group: "晋升(uc-18-4)" },
];

function resolveScene(raw?: string): string {
  return SCENES.some((s) => s.id === raw) ? (raw as string) : "list-normal";
}

/** 简化的三栏骨架 + 左侧五段语义导航（硬规则 ⑥：与既有设计语言一致）。 */
function ThreadShell({
  role,
  children,
  answer,
}: {
  role: string;
  children?: React.ReactNode;
  answer?: React.ReactNode;
}) {
  const NAV = ["对话", "项目", "画布", "研究", "组织"];
  return (
    <div className="flex h-[720px] w-full overflow-hidden rounded-lg border border-border bg-background" data-testid="kg-thread-shell">
      {/* 左侧五段语义导航 */}
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-border-subtle bg-card py-3">
        {NAV.map((n, i) => (
          <div
            key={n}
            className={`grid h-9 w-9 place-items-center rounded-md text-10 ${i === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {n}
          </div>
        ))}
      </nav>
      {/* 中间：会话线程 */}
      <div className="flex flex-1 flex-col border-r border-border-subtle">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <span className="text-12 font-medium">v2 上线排期</span>
          <span className="text-10 text-muted-foreground">· 个人对话 · 视角：{role === "owner" ? "所有者" : "其他成员(只读)"}</span>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <UserBubble>上次说的 v2 上线是谁定的、为什么？</UserBubble>
          <AiBubble>
            v2 版本由<strong>张三</strong>决定在下周一（9/29）上线，主要依据是<strong>客户 A</strong> 要求本季度内交付。李四负责上线前的迁移演练（该结论尚未确认）。
            {answer}
          </AiBubble>
        </div>
      </div>
      {/* 右侧：知识面板 */}
      <div className="relative flex w-96 flex-col bg-card">{children}</div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="self-end rounded-lg rounded-br-sm bg-primary px-3 py-2 text-12 text-primary-foreground">{children}</div>
  );
}
function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-lg self-start rounded-lg rounded-bl-sm border border-border-subtle bg-card px-3 py-2 text-12 leading-relaxed text-card-foreground">
      {children}
    </div>
  );
}

export default function ChatKnowledgeGraphPreviewPage({
  searchParams,
}: {
  searchParams: { scene?: string; role?: string };
}) {
  const scene = resolveScene(searchParams.scene);
  const role = searchParams.role === "member" ? "member" : "owner";

  // 面板态映射
  const panelConfigs: Record<string, { status: PanelStatus; data: ThreadKnowledge | null; view: PanelView; errorCode?: string }> = {
    "list-normal": { status: "ready", data: role === "member" ? threadKnowledgeReadOnly : threadKnowledgeNormal, view: "list" },
    "list-loading": { status: "loading", data: null, view: "list" },
    "list-empty": { status: "ready", data: threadKnowledgeEmpty, view: "list" },
    "list-partial": { status: "ready", data: threadKnowledgePartialFailure, view: "list" },
    "list-error": { status: "error", data: null, view: "list", errorCode: threadKnowledgeErrorCode },
    "list-readonly": { status: "ready", data: threadKnowledgeReadOnly, view: "list" },
    "graph-normal": { status: "ready", data: threadKnowledgeNormal, view: "graph" },
    "graph-oversize": { status: "ready", data: threadKnowledgeOversize, view: "graph" },
    "graph-loading": { status: "loading", data: null, view: "graph" },
    "graph-error": { status: "error", data: null, view: "graph", errorCode: threadKnowledgeErrorCode },
  };

  const claimLabel = (id: string) =>
    threadKnowledgeNormal.claims.find((c) => c.id === id)?.statement ?? id;

  let body: React.ReactNode;
  let answerFooter: React.ReactNode = null;

  if (panelConfigs[scene]) {
    const cfg = panelConfigs[scene];
    body = (
      <KnowledgePanel
        status={cfg.status}
        data={cfg.data}
        errorCode={cfg.errorCode}
        initialView={cfg.view}
      />
    );
  } else if (scene === "drawer-normal" || scene === "drawer-revoked") {
    body = (
      <>
        <KnowledgePanel status="ready" data={threadKnowledgeNormal} initialView="list" />
        <ClaimSourceDrawer
          data={scene === "drawer-revoked" ? claimSourcesRevoked : claimSourcesNormal}
          open
          onClose={() => {}}
        />
      </>
    );
  } else if (scene === "promote-results") {
    body = (
      <div className="flex h-full flex-col p-3" data-testid="kg-panel">
        <h2 className="mb-2 text-12 font-medium">存入个人空间 · 逐条结果</h2>
        <p className="mb-2 text-10 text-muted-foreground">部分成功，不整批回滚（uc-18-4 E4）</p>
        <PromotionResultList data={promotionResultsMixed} claimLabel={claimLabel} />
      </div>
    );
  } else if (scene === "nomination") {
    body = (
      <div className="flex h-full flex-col gap-3 p-3" data-testid="kg-panel">
        <h2 className="text-12 font-medium">会话结束 · AI 提名</h2>
        <NominationCard data={nominationsNormal} claimLabel={claimLabel} />
      </div>
    );
  } else {
    // answer-* 场景：把 footer 放进 AI 气泡
    const map: Record<string, { citations: typeof answerCitationsNormal; health: typeof channelHealthAllOk }> = {
      "answer-normal": { citations: answerCitationsNormal, health: channelHealthAllOk },
      "answer-graph-down": { citations: answerCitationsNormal, health: channelHealthGraphDown },
      "answer-vector-down": { citations: answerCitationsNormal, health: channelHealthVectorDown },
      "answer-personal": { citations: answerCitationsPersonal, health: channelHealthAllOk },
    };
    const fallback = { citations: answerCitationsNormal, health: channelHealthAllOk };
    const a = map[scene] ?? fallback;
    answerFooter = <AnswerKnowledgeFooter citations={a.citations} channelHealth={a.health} />;
    body = <KnowledgePanel status="ready" data={threadKnowledgeNormal} initialView="list" />;
  }

  return (
    <main className="min-h-screen bg-background text-background-foreground">
      <nav className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3" data-testid="kg-scene-nav">
        <span className="mr-1 text-11 font-medium text-muted-foreground">场景</span>
        {SCENES.map((s) => {
          const active = s.id === scene;
          return (
            <Link
              key={s.id}
              href={`/preview/chat-knowledge-graph?scene=${s.id}&role=${role}`}
              data-testid={`kg-scene-${s.id}`}
              data-active={active}
              className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-base ${
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
        <span className="mx-2 text-border">|</span>
        <span className="text-11 font-medium text-muted-foreground">视角</span>
        {(["owner", "member"] as const).map((r) => (
          <Link
            key={r}
            href={`/preview/chat-knowledge-graph?scene=${scene}&role=${r}`}
            data-testid={`kg-role-${r}`}
            data-active={role === r}
            className={`rounded-full border px-2.5 py-1 text-11 transition-colors duration-base ${
              role === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground hover:bg-muted"
            }`}
          >
            {r === "owner" ? "所有者" : "其他成员"}
          </Link>
        ))}
      </nav>

      <div className="mx-auto max-w-6xl p-4">
        <p className="mb-3 text-11 text-muted-foreground">
          chat-knowledge-graph 原型 · 纯前端 mock（不接后端）· ADR-023 签核第 ① 件材料 · 类型全部来自 <code>@repo/contracts</code>
        </p>
        <ThreadShell role={role} answer={answerFooter}>
          {body}
        </ThreadShell>
      </div>
    </main>
  );
}
