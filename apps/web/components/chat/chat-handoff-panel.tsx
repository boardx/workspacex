"use client";
import * as React from "react";
import { ArrowRight, FileText, Lock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatStreamSlotsContext } from "@/components/chat/chat-stream-slots";
import { getAgentDirectoryCard, type AgentDirectoryCard } from "@/lib/agent-directory";
import {
  HANDOFF_SOURCE_UNAVAILABLE_COPY, cancelHandoff, confirmHandoff, handoffFailureText, handoffQuestionText, handoffRejectedText,
  handoffStatusText, listThreadHandoffs, type ConfirmHandoffResult, type HandoffEvidenceItem, type HandoffView, type ThreadHandoffs,
} from "@/lib/agent-handoff";

/**
 * AG07 聊天 handoff 卡片（契约束 agent-role ui.md：`handoff-confirm-card` / `handoff-confirm` / `handoff-cancel`）。
 *
 * UIUX r1 屏 4（P0-1）：卡片不再是钉在线程头下的整宽横条，而是**消息流里 Agent 的一条消息**——
 * 头像 + 名字 + 时间，经 `ChatStreamSlotsContext` 交给面板摆放：
 *   1. 来源线程：Agent 发出的转交请求排在消息流末尾（`tail`）——目标数字人（头像 + 角色）、为什么转、
 *      交接了什么（问题 / 范围 / 资料 / 未决），主按钮「确认转交并新开对话」、次按钮「不用了」。
 *      确认后服务端在接收方新开线程，`onOpenThread` 跳过去；不在本地预测结果。
 *   2. 转交新开的线程：来源卡排在消息流开头（`lead`），说明「从哪里转交来、交接了什么」；
 *      引用按**发起人**身份重读，无权 / 不存在的一律显示「无法展示此来源」（E8），不带任何内容。
 *
 * 谁能看见是服务端的裁决（只给发起人本人）；这里不做权限判断。`refreshKey` 变化时重读。
 */
export function ChatHandoffStream({
  threadId,
  sessionToken,
  refreshKey = 0,
  onOpenThread,
  load = listThreadHandoffs,
  confirm = confirmHandoff,
  cancel = cancelHandoff,
  loadAgent = getAgentDirectoryCard,
  children,
}: {
  threadId: string | null;
  sessionToken?: string;
  refreshKey?: number;
  onOpenThread?: (result: ConfirmHandoffResult, view: HandoffView) => void;
  load?: typeof listThreadHandoffs;
  confirm?: typeof confirmHandoff;
  cancel?: typeof cancelHandoff;
  loadAgent?: (agentId: string) => Promise<AgentDirectoryCard>;
  children: React.ReactNode;
}) {
  const [data, setData] = React.useState<ThreadHandoffs | null>(null);
  const [reloadTick, setReloadTick] = React.useState(0);
  const agents = useAgentCards(data, loadAgent);

  React.useEffect(() => {
    if (!threadId) { setData(null); return; }
    let live = true;
    load(threadId, sessionToken).then(
      (value) => { if (live) setData(value); },
      // 读失败不打扰聊天：卡片只是缺席，主对话照常可用。
      () => { if (live) setData(null); },
    );
    return () => { live = false; };
  }, [threadId, sessionToken, refreshKey, reloadTick, load]);

  const slots = React.useMemo(() => {
    if (!data || (data.requested.length === 0 && data.origin === null)) return { lead: null, tail: null };
    const lead = data.origin ? (
      <div data-testid="chat-handoff-panel" className="pb-3">
        <HandoffOriginCard handoff={data.origin.handoff} evidence={data.origin.evidence} agents={agents} />
      </div>
    ) : null;
    const tail = data.requested.length > 0 ? (
      <div data-testid="chat-handoff-panel" className="flex flex-col gap-3 pt-3">
        {data.requested.map((view) => (
          <HandoffRequestMessage
            key={view.handoffId}
            view={view}
            agents={agents}
            onConfirm={async () => {
              const result = await confirm(view.handoffId, sessionToken);
              setReloadTick((n) => n + 1);
              onOpenThread?.(result, view);
            }}
            onCancel={async () => {
              await cancel(view.handoffId, sessionToken);
              setReloadTick((n) => n + 1);
            }}
          />
        ))}
      </div>
    ) : null;
    return { lead, tail };
  }, [data, agents, confirm, cancel, sessionToken, onOpenThread]);

  return <ChatStreamSlotsContext.Provider value={slots}>{children}</ChatStreamSlotsContext.Provider>;
}

type AgentCards = ReadonlyMap<string, AgentDirectoryCard>;

/** 卡片上的头像 / 名字 / 角色取自 Agent 目录；读不到（无权、已下线）就回退到首字母，不报错。 */
function useAgentCards(data: ThreadHandoffs | null, loadAgent: (agentId: string) => Promise<AgentDirectoryCard>): AgentCards {
  const [cards, setCards] = React.useState<AgentCards>(() => new Map());
  const ids = React.useMemo(() => {
    const views = [...(data?.requested ?? []), ...(data?.origin ? [data.origin.handoff] : [])];
    return [...new Set(views.flatMap((v) => [v.sourceAgentId, v.targetAgentId]).filter((id): id is string => !!id))].sort().join(",");
  }, [data]);
  React.useEffect(() => {
    if (ids === "") return;
    let live = true;
    void Promise.all(ids.split(",").map((id) => loadAgent(id).then((card) => [id, card] as const, () => null))).then((rows) => {
      if (!live) return;
      setCards(new Map(rows.filter((row): row is readonly [string, AgentDirectoryCard] => row !== null)));
    });
    return () => { live = false; };
  }, [ids, loadAgent]);
  return cards;
}

function initialsOf(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join("") || "助手";
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 来源的文件类型 → 中文短语（不把 `application/pdf` 这种标识摆给用户）。 */
function mimeLabel(mime: string): string {
  if (mime.includes("pdf")) return "PDF 文档";
  if (mime.startsWith("image/")) return "图片";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) return "表格";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "演示文稿";
  if (mime.includes("word") || mime.startsWith("text/")) return "文档";
  return "文件";
}

/** 以 Agent 的一条消息呈现：头像 + 名字 + 时间，正文是卡片。 */
function AgentMessageFrame({
  agent, fallbackName, createdAt, testId, children,
}: {
  agent: AgentDirectoryCard | undefined;
  fallbackName: string;
  createdAt: string;
  testId: string;
  children: React.ReactNode;
}) {
  const name = agent?.name ?? fallbackName;
  const time = timeOf(createdAt);
  return (
    <article className="flex w-full gap-3" data-testid={testId}>
      <Avatar initials={agent?.initials ?? initialsOf(name)} avatarKey={agent?.avatar?.key ?? null} tone="ai" size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <header className="flex items-baseline gap-2">
          <span className="text-13 font-medium text-card-foreground" data-testid="handoff-message-author">{name}</span>
          {time && <time className="text-11 text-muted-foreground" dateTime={createdAt} data-testid="handoff-message-time">{time}</time>}
        </header>
        {children}
      </div>
    </article>
  );
}

function roleOf(agent: AgentDirectoryCard | undefined, name: string): string | null {
  return agent?.roleLabel && agent.roleLabel !== name ? agent.roleLabel : null;
}

/** 目标数字人：头像 + 名字 + 角色——这张卡最重要的一件事。 */
function TargetRow({ view, agent }: { view: HandoffView; agent: AgentDirectoryCard | undefined }) {
  const name = agent?.name ?? view.targetName ?? "对应角色";
  return (
    <div className="flex items-center gap-2.5" data-testid="handoff-target">
      <Avatar initials={agent?.initials ?? initialsOf(name)} avatarKey={agent?.avatar?.key ?? null} tone="ai" size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-13 font-semibold text-card-foreground">{name}</p>
        <p className="truncate text-11 text-muted-foreground">{roleOf(agent, name) ?? "数字人同事"}</p>
      </div>
    </div>
  );
}

/** 交接了什么：问题 / 已确认范围 / 资料 / 未决事项。空字段不渲染（不出现「引用 无」）。 */
function PacketSummary({ view }: { view: HandoffView }) {
  const { packet } = view;
  const rows: { label: string; value: React.ReactNode; testId?: string }[] = [
    { label: "问题", value: handoffQuestionText(view), testId: "handoff-question" },
  ];
  if (packet.confirmedScope.trim() !== "") rows.push({ label: "已确认范围", value: packet.confirmedScope });
  if (packet.evidenceRefs.length > 0) rows.push({ label: "资料", value: `${packet.evidenceRefs.length} 份（接收方将按你的权限重新读取）` });
  if (packet.openItems.length > 0) {
    rows.push({
      label: "未决事项",
      value: <ul className="flex list-disc flex-col gap-0.5 pl-4">{packet.openItems.map((item) => <li key={item}>{item}</li>)}</ul>,
    });
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="text-11 font-medium text-muted-foreground">交接内容</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-12">
        {rows.map((row) => (
          <React.Fragment key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-card-foreground" data-testid={row.testId}>{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

function statusTone(view: HandoffView): "ai" | "success" | "warning" | "neutral" {
  if (view.status === "requested") return "ai";
  if (view.status === "confirmed") return "success";
  if (view.status === "rejected") return "warning";
  return "neutral";
}

function HandoffRequestMessage({
  view,
  agents,
  onConfirm,
  onCancel,
}: {
  view: HandoffView;
  agents: AgentCards;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const [inFlight, setInFlight] = React.useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const target = agents.get(view.targetAgentId ?? "");
  const targetName = target?.name ?? view.targetName ?? "对应角色";
  const targetRole = roleOf(target, targetName);
  const pending = view.status === "requested";

  const run = async (which: "confirm" | "cancel", fn: () => Promise<void>) => {
    setInFlight(which);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(handoffFailureText(e, targetName));
    } finally {
      setInFlight(null);
    }
  };

  return (
    <AgentMessageFrame agent={agents.get(view.sourceAgentId)} fallbackName="当前助手" createdAt={view.createdAt} testId="handoff-agent-message">
      <section
        className="flex flex-col gap-3 rounded-card border border-border bg-card p-3 shadow-sm"
        data-testid="handoff-confirm-card"
        data-handoff-status={view.status}
        aria-label={`建议转交给 ${targetName}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-12 text-muted-foreground">建议转交给</p>
          <Badge tone={statusTone(view)} data-testid="handoff-status">{handoffStatusText(view)}</Badge>
        </div>
        <TargetRow view={view} agent={target} />
        <p className="text-12 text-card-foreground" data-testid="handoff-why">
          这件事超出了我的职责，{targetName}{targetRole ? `（${targetRole}）` : ""}更适合接手。确认后会新开一个和 TA 的对话，下面的交接内容会一起带过去。
        </p>
        <PacketSummary view={view} />
        {view.status === "rejected" && view.notAllowedReason && (
          <p className="rounded-md bg-warning-tint px-3 py-2 text-12 text-warning-tint-foreground" role="status">
            {handoffRejectedText(view)}
          </p>
        )}
        {pending && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              data-testid="handoff-confirm"
              disabled={inFlight !== null}
              onClick={() => void run("confirm", onConfirm)}
            >
              {inFlight === "confirm" ? "正在转交…" : "确认转交并新开对话"}
              {inFlight === null && <ArrowRight aria-hidden className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid="handoff-cancel"
              disabled={inFlight !== null}
              onClick={() => void run("cancel", onCancel)}
            >
              {inFlight === "cancel" ? "正在取消…" : "不用了"}
            </Button>
          </div>
        )}
        {error && (
          <p className="text-12 text-destructive" role="alert" data-testid="handoff-error">{error}</p>
        )}
      </section>
    </AgentMessageFrame>
  );
}

function HandoffOriginCard({
  handoff, evidence, agents,
}: {
  handoff: HandoffView;
  evidence: readonly HandoffEvidenceItem[];
  agents: AgentCards;
}) {
  const source = agents.get(handoff.sourceAgentId);
  const target = agents.get(handoff.targetAgentId ?? "");
  const targetName = target?.name ?? handoff.targetName ?? "对应角色";
  return (
    <AgentMessageFrame agent={source} fallbackName="上一位助手" createdAt={handoff.createdAt} testId="handoff-origin-message">
      <section className="flex flex-col gap-3 rounded-card border border-border bg-card p-3 shadow-sm" data-testid="handoff-origin-card" aria-label="转交来的对话">
        <div className="flex items-center justify-between gap-2">
          <p className="text-12 text-card-foreground">这是转交给 {targetName} 的对话</p>
          <Badge tone="success">已转交</Badge>
        </div>
        <TargetRow view={handoff} agent={target} />
        <PacketSummary view={handoff} />
        {evidence.length > 0 && (
          <ul className="flex flex-col gap-1" data-testid="handoff-evidence">
            {evidence.map((item) => (
              <li
                key={item.ref}
                className="flex items-center gap-1.5 text-12"
                data-testid="handoff-evidence-item"
                data-readable={item.readable ? "true" : "false"}
              >
                {item.readable ? (
                  <>
                    <FileText aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-card-foreground">可查看的来源 · {mimeLabel(item.mime)}</span>
                  </>
                ) : (
                  <>
                    <Lock aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">{HANDOFF_SOURCE_UNAVAILABLE_COPY}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-11 text-muted-foreground" data-testid="handoff-origin-draft-hint">
          {targetName}还没有开始处理：确认下方输入框里的交接草稿（可补充）后发送，TA 就会接手。
        </p>
      </section>
    </AgentMessageFrame>
  );
}
