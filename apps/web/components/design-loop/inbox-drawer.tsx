"use client";
import * as React from "react";
import { X, Sparkles, Play, Check, Undo2, Ban, Loader2, Github, Paperclip, MessageSquare, Mail, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INBOX_KIND_LABEL, type InboxGithubRef, type InboxItem, type InboxStage } from "@/lib/live-inbox";
import {
  listFeedbackStatusEvents,
  getFeedbackGithubIssue,
  listFeedbackGithubIssueComments,
  commentOnFeedbackGithubIssue,
  type FeedbackStatusEvent,
  type FeedbackGithubIssueStatus,
  type FeedbackIssueDraft,
  type GithubIssueComment,
} from "@/lib/live-feedback";
import { STRUCTURED_FIELDS, FeedbackStructuredView } from "@/components/feedback/feedback-structured";
import { GithubBadge, SevereBadge } from "./badges";
import { useDialogFocus } from "./use-dialog-focus";
import { CardMeta, ItemStatusBadge, KindLabel, describeFailure, formatRelative, type NavigateLink } from "./inbox-shared";
import { TagEditor } from "./inbox-tags";

/**
 * 2026-09-08——运营收件箱的详情 drawer，从 `inbox-screen.tsx` 拆出（该文件已撞 2000 行上限）。
 * 设计取舍全部记在 `inbox-screen.tsx` 文件头（drawer 时间线只有反馈有 / GitHub 徽标展开才现查升级 /
 * 转入开发与建 issue 绑定 / issue 草稿整合全部字段 / 评论区 / 拖拽每条边都有键盘可达的按钮）。
 * 这里只搬代码，不改任何一条取舍。
 */

/** 缺陷/需求 → issue 标签，同旧 `admin/feedback-screen.tsx`（B3.6 已删除）的 `KIND_ISSUE_LABEL`，不重造第二份映射就手写一遍值。 */
const INBOX_KIND_ISSUE_LABEL: Record<"缺陷" | "需求", string> = { 缺陷: "bug", 需求: "enhancement" };

/** 附件 MIME → 人能看的类型名（表单附件清单 + issue 正文附件清单共用）。 */
const ATTACHMENT_MIME_LABEL: Record<string, string> = {
  "image/png": "PNG 图片",
  "image/jpeg": "JPEG 图片",
  "image/webp": "WebP 图片",
  "application/pdf": "PDF",
  "text/plain": "文本",
  "text/markdown": "Markdown",
};
function attachmentLabel(mime: string): string {
  return ATTACHMENT_MIME_LABEL[mime] ?? mime;
}

/**
 * 2026-09-05——issue 草稿**整合反馈的全部字段**（人类指令「提交的内容要整合 issues 的所有字段」）：
 * 编号 / 类型 / 正文 / 结构化字段 / 提交人 / 提交时间 / 票数 / 附件清单 / 回到收件箱的链接。
 * 结构化字段的「哪几项、叫什么」复用 `STRUCTURED_FIELDS`（唯一字段表），不在这里再抄一份。
 * 附件在这里只列**清单**（数量 / 类型 / 附件 id）——真正的文件由服务端 `triageFeedback` 推到
 * GitHub 并把图片 `![]()` / 文件链接追加到正文末尾，这里不编造一个前端拿不到的公开 URL。
 * `inboxUrl`：当前页面 `?open=<id>`，让 issue 里的人能一键回到这条反馈；SSR/测试没有 `window` 时省略。
 */
export function buildInboxIssueDraft(item: InboxItem): FeedbackIssueDraft {
  // GitHub 正文是 Markdown，这里的加粗是给 GitHub 渲染的，不是 JSX 文案（lint-design 的 MD 规则只盯 JSX）。
  const B = "**";
  const bold = (t: string) => `${B}${t}${B}`;
  const lines: string[] = [];
  const detail = item.body ?? "(正文仅组织管理员与提交人可见，分诊时请补充必要的复现上下文。)";
  lines.push(detail.trim(), "");
  if (item.feedbackKind !== null && item.structured != null) {
    const rows = STRUCTURED_FIELDS[item.feedbackKind]
      .map((f) => ({ f, v: (item.structured as Record<string, string | undefined>)[f.key] }))
      .filter((x): x is { f: (typeof STRUCTURED_FIELDS)[typeof item.feedbackKind][number]; v: string } => typeof x.v === "string" && x.v.trim() !== "");
    if (rows.length > 0) {
      lines.push("### 结构化信息");
      for (const { f, v } of rows) lines.push(f.multiline ? `${bold(f.label)}\n${v.trim()}\n` : `- ${bold(f.label)}：${v.trim()}`);
      lines.push("");
    }
  }
  lines.push("### 反馈信息");
  lines.push(`- ${bold("编号")}：${item.code}`);
  lines.push(`- ${bold("类型")}：${item.feedbackKind ?? INBOX_KIND_LABEL[item.kind]}`);
  lines.push(`- ${bold("提交人")}：${item.reporter ?? "（不可见）"}`);
  lines.push(`- ${bold("提交时间")}：${new Date(item.createdAt).toLocaleString("zh-CN")}`);
  lines.push(`- ${bold("票数")}：${item.votes}`);
  lines.push(`- ${bold("当前状态")}：${item.sourceStatus}`);
  if (item.attachments.length > 0) {
    lines.push("", `### 附件（${item.attachments.length} 个，随 issue 上传）`);
    for (const a of item.attachments) lines.push(`- ${attachmentLabel(a.mime)} · ${a.id}`);
  }
  const inboxUrl =
    typeof window !== "undefined" && window.location !== undefined
      ? `${window.location.origin}${window.location.pathname}?open=${encodeURIComponent(item.id)}`
      : null;
  lines.push("", "---", `来源：运营收件箱 · 反馈 ID ${item.id}${inboxUrl !== null ? ` · ${inboxUrl}` : ""}`);
  return {
    title: item.title,
    body: lines.join("\n"),
    labels: ["user-feedback", ...(item.feedbackKind !== null ? [INBOX_KIND_ISSUE_LABEL[item.feedbackKind]] : [])],
  };
}

/**
 * 2026-09-05「转开发」——设计方案的 issue 草稿。
 *
 * 与 `buildInboxIssueDraft`（反馈那侧）分开写而不是加分支：两者的正文骨架**没有一行是共享的**
 * ——反馈那份讲的是"谁报的、多少人投票、怎么复现"，方案这份讲的是"要做成什么样、验收标准是
 * 什么、源自哪条反馈"。硬塞进一个函数会变成一串 `item.kind === ...` 的三元表达式，
 * 两边的措辞都会被对方拖住。
 *
 * ⚠ 能放进来的只有**收件箱条目身上有的字段**：`criteria`/`frames` 住在 `DesignProject` 上，
 *   收件箱投影没有带它们（契约 `InboxItem` 的"仅某类"字段表里 design 那几行是"—"）。
 *   正文里因此写了一句"验收标准见方案详情页"并附上回链，而不是编造几条读不到的验收标准。
 */
export function buildDesignIssueDraft(item: InboxItem): FeedbackIssueDraft {
  const B = "**";
  const bold = (t: string) => `${B}${t}${B}`;
  const lines: string[] = [];
  lines.push(item.body ?? "（这个方案没有填写背景说明。）", "");
  lines.push("### 方案信息");
  lines.push(`- ${bold("编号")}：${item.code}`);
  lines.push(`- ${bold("负责人")}：${item.reporter ?? "（不可见）"}`);
  lines.push(`- ${bold("创建时间")}：${new Date(item.createdAt).toLocaleString("zh-CN")}`);
  if (item.linkedFeedbackId !== null) lines.push(`- ${bold("源自反馈")}：${item.linkedFeedbackId}`);
  const inboxUrl =
    typeof window !== "undefined" && window.location !== undefined
      ? `${window.location.origin}${window.location.pathname}?open=${encodeURIComponent(item.id)}`
      : null;
  lines.push("", "验收标准与原型画布页见方案详情页（下方链接）。");
  lines.push("", "---", `来源：PM 设计工作台 · 方案 ID ${item.id}${inboxUrl !== null ? ` · ${inboxUrl}` : ""}`);
  return { title: item.title, body: lines.join("\n"), labels: ["design-handoff"] };
}

/**
 * issue #2752 ②——系统异常转「不做」每次都要手填理由，量一大就是重复劳动。反馈类
 * 保持空白（每条反馈的「不做」理由都该是具体的、针对这条反馈的），只给系统异常
 * 一个可编辑的默认模板，省下"每次现想怎么写"这一步，不是不让改。
 */
const DEFAULT_EXCEPTION_DECLINE_REASON = "系统自动生成的异常，评估后判定为已知噪音或不影响用户的低优先级问题，本轮不做单独处理。";

/**
 * drawer 现查回来的 GitHub 状态换算成要展示的徽标——契约头注的派生规则（`inbox.ts`
 * `InboxGithubRef` 头注）：`linkedPullRequestsAvailable` 且非空 ⇒ 取
 * `merged` > `open` > `closed` 优先级的第一条，升级成 PR；否则用现查回来的 issue
 * 真实开关覆盖列表推断值。`check` 为 `null`（还没查/查失败）时调用方自己决定退回
 * 列表推断值，这个函数不处理那一半。
 */
function upgradeGithubBadge(status: FeedbackGithubIssueStatus): InboxGithubRef {
  if (status.linkedPullRequestsAvailable && status.linkedPullRequests.length > 0) {
    const priority = ["merged", "open", "closed"] as const;
    for (const state of priority) {
      const pr = status.linkedPullRequests.find((p) => p.state === state);
      if (pr) return { kind: "pr", number: pr.number, url: pr.url, state: pr.state };
    }
  }
  return { kind: "issue", number: status.number, url: status.url, state: status.state };
}

type GithubCheck =
  | { kind: "n/a" }
  | { kind: "loading" }
  | { kind: "ready"; status: FeedbackGithubIssueStatus }
  | { kind: "failed" };

/** 贴边详情 drawer：top:54px 贴导航栏下方，right:0 到视口底部，左侧遮罩关闭。 */
export function InboxDrawer({
  item, busy, openDecline, openIssueForm, onClose, onStatus, onArchive, onCreateIssue, onDeepen, onOpenWorkbench, onNavigateLink,
  onSaveExceptionDev, onSaveTags, onFilterTag,
}: {
  item: InboxItem;
  busy: boolean;
  /** B3.7——drawer 里的关联标点击后换成目标条目的 drawer。 */
  onNavigateLink: NavigateLink;
  /** 从看板拖到「不做」列打开：直接展开理由表单，不用再点一次「不做…」。 */
  openDecline: boolean;
  /** 2026-09-05——从「开始处理」/拖进「进行中」进来的、尚无 issue 的反馈：直接展开 issue 确认表单。 */
  openIssueForm: boolean;
  onClose: () => void;
  onStatus: (s: InboxStage) => void;
  onArchive: (reason: string) => void;
  /** B3.5——建 issue 编辑器确认后调用，走 `triageFeedback(id, "已进入迭代", null, issueDraft)`。 */
  onCreateIssue: (issueDraft: FeedbackIssueDraft) => void;
  onDeepen: () => void;
  onOpenWorkbench: () => void;
  /** 2026-09-05——系统异常的开发备注保存（只对 `kind === "exception"` 有意义）。 */
  onSaveExceptionDev: (patch: { devNote?: string | null }) => void;
  /** 2026-09-08——三类统一的标签保存（写路径按 `kind` 选，见 `inbox-screen.tsx` 的 `saveTags`）。 */
  onSaveTags: (tags: readonly string[]) => void;
  /** 2026-09-08——点 drawer 里的标签 ⇒ 关掉 drawer 按它筛选。 */
  onFilterTag: (tag: string) => void;
}) {
  const [declining, setDeclining] = React.useState(openDecline);
  const [reason, setReason] = React.useState(item.kind === "exception" ? DEFAULT_EXCEPTION_DECLINE_REASON : "");
  const canConfirm = reason.trim() !== "";
  const canDeepen = item.kind === "feedback" && (item.stage === "backlog" || item.stage === "doing") && item.resolvedByDesignId === null;
  /** 见文件头：转入开发要先建 issue，只对 `backlog` 且尚无 issue 的反馈成立（`doing → doing` 不会建 issue）。 */
  const needsIssueBeforeDoing = item.kind === "feedback" && item.stage === "backlog" && item.github === null;

  const [events, setEvents] = React.useState<
    { kind: "loading" } | { kind: "ready"; items: readonly FeedbackStatusEvent[] } | { kind: "failed" } | { kind: "n/a" }
  >(item.kind === "feedback" ? { kind: "loading" } : { kind: "n/a" });

  React.useEffect(() => {
    if (item.kind !== "feedback") return;
    let cancelled = false;
    setEvents({ kind: "loading" });
    void listFeedbackStatusEvents(item.id)
      .then((rows) => { if (!cancelled) setEvents({ kind: "ready", items: rows }); })
      .catch(() => { if (!cancelled) setEvents({ kind: "failed" }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.kind]);

  /** B3.5——drawer 展开且这条反馈挂着 github 时现查升级，见文件头。看板/列表卡片不现查。 */
  const githubPresent = item.kind === "feedback" && item.github !== null;
  const [githubCheck, setGithubCheck] = React.useState<GithubCheck>(githubPresent ? { kind: "loading" } : { kind: "n/a" });

  React.useEffect(() => {
    if (item.kind !== "feedback" || item.github === null) {
      setGithubCheck({ kind: "n/a" });
      return;
    }
    let cancelled = false;
    setGithubCheck({ kind: "loading" });
    void getFeedbackGithubIssue(item.id)
      .then((status) => { if (!cancelled) setGithubCheck({ kind: "ready", status }); })
      .catch(() => { if (!cancelled) setGithubCheck({ kind: "failed" }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.kind, githubPresent]);

  const displayedGithub: InboxGithubRef | null =
    item.github === null ? null : githubCheck.kind === "ready" ? upgradeGithubBadge(githubCheck.status) : item.github;

  const [issueDraft, setIssueDraft] = React.useState<FeedbackIssueDraft | null>(() =>
    openIssueForm && needsIssueBeforeDoing ? buildInboxIssueDraft(item) : null,
  );
  const [labelsText, setLabelsText] = React.useState(() => (issueDraft === null ? "" : issueDraft.labels.join(", ")));
  const openIssueDraftForm = () => {
    const draft = item.kind === "design" ? buildDesignIssueDraft(item) : buildInboxIssueDraft(item);
    setIssueDraft(draft);
    setLabelsText(draft.labels.join(", "));
  };

  /** 评论区（见文件头）：仅挂着 issue 的反馈；`n/a` 时整块不渲染。 */
  const [comments, setComments] = React.useState<
    { kind: "n/a" } | { kind: "loading" } | { kind: "ready"; items: readonly GithubIssueComment[] } | { kind: "failed" }
  >(githubPresent ? { kind: "loading" } : { kind: "n/a" });
  const [commentBody, setCommentBody] = React.useState("");
  const [commentBusy, setCommentBusy] = React.useState(false);
  const [commentError, setCommentError] = React.useState<string | null>(null);
  const loadComments = React.useCallback(async () => {
    setComments({ kind: "loading" });
    try {
      const rows = await listFeedbackGithubIssueComments(item.id);
      setComments({ kind: "ready", items: rows });
    } catch {
      setComments({ kind: "failed" });
    }
  }, [item.id]);
  React.useEffect(() => {
    if (!githubPresent) {
      setComments({ kind: "n/a" });
      return;
    }
    let cancelled = false;
    setComments({ kind: "loading" });
    void listFeedbackGithubIssueComments(item.id)
      .then((rows) => { if (!cancelled) setComments({ kind: "ready", items: rows }); })
      .catch(() => { if (!cancelled) setComments({ kind: "failed" }); });
    return () => { cancelled = true; };
  }, [item.id, githubPresent]);
  const submitComment = async () => {
    const body = commentBody.trim();
    if (body === "") return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      await commentOnFeedbackGithubIssue(item.id, body);
      setCommentBody("");
      await loadComments();
    } catch (err) {
      setCommentError(`评论没发出去（${describeFailure(err)}）`);
    } finally {
      setCommentBusy(false);
    }
  };

  /** B6.5：打开时焦点进 drawer、Esc 关闭、关闭后焦点回到触发卡片（见 `use-dialog-focus.ts`）。 */
  const panelRef = React.useRef<HTMLElement>(null);
  useDialogFocus(panelRef, onClose);

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 top-[54px] z-40 bg-inverse/30" onClick={onClose} aria-hidden data-testid="inbox-drawer-scrim" />
      {/* 宽度：28rem 上限 + max-w-full ⇒ 375 下自然全宽（U8，不另写断点）。 */}
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${item.code} ${item.title}`}
        data-testid="inbox-drawer"
        className="fixed bottom-0 right-0 top-[54px] z-40 flex w-[28rem] max-w-full flex-col overflow-hidden border-l border-border bg-card shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <header className="flex items-start justify-between gap-2 border-b border-border p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-11 text-muted-foreground">{item.code}</span>
              <ItemStatusBadge item={item} />
              <KindLabel item={item} />
              {item.severe && <SevereBadge />}
            </div>
            <h3 className="mt-1.5 text-16 font-semibold leading-snug">{item.title}</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭详情" data-testid="inbox-drawer-close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          {item.body === null ? (
            <p className="whitespace-pre-wrap text-13 italic text-muted-foreground" data-testid="inbox-drawer-body-withheld">
              正文仅组织管理员与提交人可见。
            </p>
          ) : (
            <p className="whitespace-pre-wrap text-13 text-card-foreground">{item.body}</p>
          )}
          {/* UC-17.8 D1：反馈类条目的结构化字段。 */}
          {item.kind === "feedback" && item.structured != null && item.feedbackKind !== null && (
            <FeedbackStructuredView
              kind={item.feedbackKind}
              structured={item.structured}
              testid={`inbox-drawer-structured-${item.id}`}
            />
          )}

          <dl className="grid grid-cols-2 gap-2 text-11">
            {item.kind === "exception" ? (
              <>
                <Meta label="发生位置" value={item.exception?.location ?? "—"} />
                <Meta label="发生次数" value={`${item.exception?.count ?? 0} 次`} />
                <Meta label="首次发生" value={new Date(item.createdAt).toLocaleString("zh-CN")} />
                <Meta label="最近发生" value={item.exception !== null ? new Date(item.exception.lastSeenAt).toLocaleString("zh-CN") : "—"} />
                <Meta label="影响用户" value={item.exception?.affectedUsers !== null && item.exception?.affectedUsers !== undefined ? `${item.exception.affectedUsers} 人` : "—"} />
              </>
            ) : (
              <>
                <Meta label="提交人" value={item.reporter ?? "—"} />
                <Meta label="提交时间" value={new Date(item.createdAt).toLocaleString("zh-CN")} />
                <Meta label="票数" value={String(item.votes)} />
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-1.5" data-testid="inbox-drawer-github">
            <CardMeta item={item} onNavigateLink={onNavigateLink} />
            {item.github !== null && (
              githubCheck.kind === "loading" ? (
                <span className="h-4 w-24 animate-pulse rounded-control bg-muted" data-testid="inbox-drawer-github-loading" />
              ) : (
                <>
                  {displayedGithub !== null && <GithubBadge {...displayedGithub} />}
                  {/* 徽标升级成 PR 后 issue 本体也要能点开；每条关联 PR 各一枚可点的徽标（见文件头）。 */}
                  {githubCheck.kind === "ready" && displayedGithub?.kind === "pr" && (
                    <GithubBadge kind="issue" number={githubCheck.status.number} url={githubCheck.status.url} state={githubCheck.status.state} />
                  )}
                  {githubCheck.kind === "ready" &&
                    githubCheck.status.linkedPullRequests
                      .filter((pr) => !(displayedGithub?.kind === "pr" && displayedGithub.number === pr.number))
                      .map((pr) => <GithubBadge key={pr.number} kind="pr" number={pr.number} url={pr.url} state={pr.state} />)}
                </>
              )
            )}
            {githubCheck.kind === "failed" && (
              <span className="text-10 text-muted-foreground" data-testid="inbox-drawer-github-check-failed">
                GitHub 状态现查失败，显示为列表推断值
              </span>
            )}
          </div>

          {/* 2026-09-08——标签，三类统一（契约 `InboxItem.tags`）。同一份编辑器也挂在卡片上。 */}
          <div className="rounded-card border border-border-subtle bg-panel p-2.5">
            <p className="mb-1 text-10 font-medium text-muted-foreground">标签</p>
            <TagEditor tags={item.tags} onChange={onSaveTags} onFilter={onFilterTag} busy={busy} testidPrefix="inbox-drawer" />
          </div>

          {/* 2026-09-08——同一异常折叠后的发生记录（契约 `InboxExceptionMeta.occurrences`）：
              这就是"看重复发生日期"的地方，不再靠重复卡片表达次数。 */}
          {item.kind === "exception" && item.exception !== null && item.exception.count > 1 && (
            <div data-testid="inbox-drawer-occurrences">
              <p className="mb-1.5 flex items-center gap-1 text-10 font-medium text-muted-foreground">
                <History aria-hidden className="h-3 w-3" />
                发生记录（共 {item.exception.count} 次
                {item.exception.count > item.exception.occurrences.length ? `，显示最近 ${item.exception.occurrences.length} 次` : ""}）
              </p>
              <ol className="flex flex-col gap-1 border-l border-border pl-3 text-11">
                {item.exception.occurrences.map((at, i) => (
                  <li key={`${at}-${i}`} className="flex items-baseline gap-1.5">
                    <span className="text-card-foreground">{new Date(at).toLocaleString("zh-CN")}</span>
                    <span className="text-muted-foreground">{formatRelative(at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {item.statusReason !== null && (
            <div className="rounded-card border border-border-subtle bg-panel p-2.5" data-testid="inbox-drawer-reason">
              <p className="text-10 font-medium text-muted-foreground">不做的理由</p>
              <p className="mt-0.5 text-12">{item.statusReason}</p>
            </div>
          )}

          {/* 2026-09-05——系统异常的开发备注与标签（见契约 `InboxExceptionMeta` 头注）。
              异常没有提交人、没有 issue、没有时间线，「转入开发」此前只留下一个状态标签，
              看不出转给谁、要怎么修；这一块是异常这条线上唯一能承载那份上下文的地方。 */}
          {item.kind === "exception" && item.exception !== null && (
            <ExceptionDevPanel devNote={item.exception.devNote} busy={busy} onSave={onSaveExceptionDev} />
          )}

          {/* 时间线：仅反馈有对应源操作（见文件头），系统异常今天没有等价接口。 */}
          {item.kind === "feedback" && (
            <div>
              <p className="mb-1.5 text-10 font-medium text-muted-foreground">时间线</p>
              {events.kind === "loading" && <p className="text-11 text-muted-foreground">读取中…</p>}
              {events.kind === "failed" && <p className="text-11 text-muted-foreground" data-testid="inbox-drawer-timeline-failed">时间线没读到，稍后重试。</p>}
              {events.kind === "ready" && (
                <ol className="flex flex-col gap-2 border-l border-border pl-3" data-testid="inbox-drawer-timeline">
                  {events.items.length === 0 && <li className="text-11 text-muted-foreground">还没有状态变更记录。</li>}
                  {events.items.map((e, i) => (
                    <li key={i} className="text-11">
                      <span className="text-card-foreground">{e.toStatus}</span>
                      <span className="ml-1.5 text-muted-foreground">{new Date(e.createdAt).toLocaleDateString("zh-CN")}</span>
                      {e.notified && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-muted-foreground" title={e.emailSubject ?? undefined} data-testid="inbox-drawer-timeline-notified">
                          <Mail aria-hidden className="h-3 w-3" /> 已邮件通知提交人
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* issue 评论区（见文件头）：看得到开发那边在 issue 上写了什么，也能直接回。 */}
          {comments.kind !== "n/a" && (
            <div data-testid="inbox-github-comments">
              <p className="mb-1.5 flex items-center gap-1 text-10 font-medium text-muted-foreground">
                <MessageSquare aria-hidden className="h-3 w-3" /> GitHub Issue 评论
              </p>
              {comments.kind === "loading" && <p className="text-11 text-muted-foreground">读取中…</p>}
              {comments.kind === "failed" && (
                <p className="text-11 text-muted-foreground" data-testid="inbox-github-comments-failed">
                  评论没读到。<button type="button" className="underline underline-offset-2" onClick={() => void loadComments()}>重试</button>
                </p>
              )}
              {comments.kind === "ready" && (
                <ol className="flex flex-col gap-2" data-testid="inbox-github-comments-list">
                  {comments.items.length === 0 && <li className="text-11 text-muted-foreground">issue 下还没有评论。</li>}
                  {comments.items.map((c) => (
                    <li key={c.id} className="rounded-card border border-border-subtle bg-panel p-2" data-testid={`inbox-github-comment-${c.id}`}>
                      <div className="flex items-center justify-between gap-2 text-10 text-muted-foreground">
                        <span>{c.author ?? "（未知账号）"}</span>
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 transition-colors duration-fast hover:text-card-foreground hover:underline">
                          {new Date(c.createdAt).toLocaleString("zh-CN")}
                        </a>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-12 text-card-foreground">{c.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                <Textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={2}
                  maxLength={4000}
                  placeholder="在 GitHub issue 下发一条评论…"
                  aria-label="GitHub issue 评论"
                  data-testid="inbox-github-comment-input"
                />
                {commentError !== null && <p className="text-10 text-destructive" data-testid="inbox-github-comment-error">{commentError}</p>}
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={commentBusy || commentBody.trim() === ""}
                    onClick={() => void submitComment()}
                    data-testid="inbox-github-comment-submit"
                  >
                    {commentBusy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                    发评论
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 操作区：随状态显示可用动作 */}
        <footer className="flex flex-col gap-2 border-t border-border p-4">
          {issueDraft !== null ? (
            <div className="flex flex-col gap-1.5" data-testid="inbox-issue-form">
              <p className="text-11 font-medium text-muted-foreground">
                转入开发会同时在 boardx/workspacex 建一个 GitHub issue，请确认内容后提交（可编辑）：
              </p>
              {/* 附件清单只对反馈有意义：设计方案没有附件这个概念（`design_projects` 没有附件表）。 */}
              {item.kind !== "design" && (
              <div className="rounded-card border border-border-subtle bg-panel p-2 text-11" data-testid="inbox-issue-attachments">
                <p className="flex items-center gap-1 font-medium text-muted-foreground">
                  <Paperclip aria-hidden className="h-3 w-3" />
                  {item.attachments.length === 0
                    ? "这条反馈没有附件。"
                    : `${item.attachments.length} 个附件将随 issue 上传到 GitHub：`}
                </p>
                {item.attachments.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                    {item.attachments.map((a) => (
                      <li key={a.id} className="font-mono text-10" data-testid={`inbox-issue-attachment-${a.id}`}>
                        {attachmentLabel(a.mime)} · {a.id}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-10 text-muted-foreground">标题</span>
                <input
                  value={issueDraft.title}
                  onChange={(e) => setIssueDraft({ ...issueDraft, title: e.target.value })}
                  data-testid="inbox-issue-title"
                  className="h-8 rounded-control border border-border-subtle bg-card px-2 text-12"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-10 text-muted-foreground">正文</span>
                <Textarea
                  value={issueDraft.body}
                  onChange={(e) => setIssueDraft({ ...issueDraft, body: e.target.value })}
                  rows={5}
                  data-testid="inbox-issue-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-10 text-muted-foreground">标签（逗号分隔）</span>
                <input
                  value={labelsText}
                  onChange={(e) => {
                    setLabelsText(e.target.value);
                    setIssueDraft({
                      ...issueDraft,
                      labels: e.target.value.split(",").map((l) => l.trim()).filter((l) => l !== ""),
                    });
                  }}
                  data-testid="inbox-issue-labels"
                  className="h-8 rounded-control border border-border-subtle bg-card px-2 font-mono text-12"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setIssueDraft(null); setLabelsText(""); }}>取消</Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy || issueDraft.title.trim() === ""}
                  onClick={() => onCreateIssue(issueDraft)}
                  data-testid="inbox-issue-submit"
                >
                  {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                  确认转入开发，创建 issue
                </Button>
              </div>
            </div>
          ) : declining ? (
            <div className="flex flex-col gap-2" data-testid="inbox-decline-form">
              <label htmlFor="inbox-decline-reason" className="text-11 font-medium text-muted-foreground">
                为什么不做？理由会记入时间线，团队以后能查到。
              </label>
              <Textarea
                id="inbox-decline-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="例如：与即将上线的能力重叠，本轮不单独做。"
                data-testid="inbox-decline-reason"
              />
              {!canConfirm && (
                <p className="text-10 text-muted-foreground" data-testid="err-reason">不做必须写清理由，否则无法确认。</p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDeclining(false);
                    setReason(item.kind === "exception" ? DEFAULT_EXCEPTION_DECLINE_REASON : "");
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!canConfirm || busy}
                  onClick={() => onArchive(reason.trim())}
                  data-testid="inbox-decline-confirm"
                >
                  {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                  确认不做
                </Button>
              </div>
            </div>
          ) : item.kind === "design" ? (
            <div className="flex flex-wrap gap-2">
              {item.github === null ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={openIssueDraftForm}
                  data-testid="inbox-action-design-handoff"
                >
                  <Github aria-hidden className="h-3.5 w-3.5" /> 转入开发（建 GitHub Issue）
                </Button>
              ) : (
                <p className="text-11 text-muted-foreground" data-testid="inbox-design-handed-off">
                  已转入开发，见上方 issue 徽标。
                </p>
              )}
              {/* ⚠ 文案如实：`onOpenWorkbench` 落到 `/platform-admin/design-workbench`（工作台首页），
                  不带方案 id——写"打开方案详情"会承诺一个这个回调今天做不到的跳转。 */}
              <Button variant="outline" size="sm" onClick={onOpenWorkbench} data-testid="inbox-action-open-design-self">
                去设计工作台
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {item.stage === "backlog" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => (needsIssueBeforeDoing ? openIssueDraftForm() : onStatus("doing"))}
                  data-testid="inbox-action-start"
                >
                  {needsIssueBeforeDoing ? <Github aria-hidden className="h-3.5 w-3.5" /> : <Play aria-hidden className="h-3.5 w-3.5" />}
                  {needsIssueBeforeDoing ? "转入开发（建 GitHub Issue）" : "开始处理"}
                </Button>
              )}
              {item.stage === "doing" && (
                <>
                  {item.kind === "feedback" && (
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => onStatus("done")} data-testid="inbox-action-done">
                      <Check aria-hidden className="h-3.5 w-3.5" /> 标记已修复
                    </Button>
                  )}
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus("backlog")} data-testid="inbox-action-back">
                    <Undo2 aria-hidden className="h-3.5 w-3.5" /> 退回待处理
                  </Button>
                </>
              )}
              {(item.stage === "done" || item.stage === "archived") && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => onStatus("backlog")} data-testid="inbox-action-reopen">
                  <Undo2 aria-hidden className="h-3.5 w-3.5" /> 重新打开
                </Button>
              )}
              {canDeepen && (
                <Button variant="ai" size="sm" onClick={onDeepen} data-testid="inbox-action-deepen">
                  <Sparkles aria-hidden className="h-3.5 w-3.5" /> 用 PM 设计工作台深化
                </Button>
              )}
              {item.resolvedByDesignId !== null && (
                <Button variant="outline" size="sm" onClick={onOpenWorkbench} data-testid="inbox-action-open-design">
                  查看方案
                </Button>
              )}
              {(item.stage === "backlog" || item.stage === "doing") && (
                <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setDeclining(true)} data-testid="inbox-action-decline">
                  <Ban aria-hidden className="h-3.5 w-3.5" /> 不做…
                </Button>
              )}
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-card-foreground">{value}</dd>
    </div>
  );
}

/**
 * 系统异常的「开发备注」编辑块（2026-09-05；标签部分已于 2026-09-08 上提为三类共用的
 * `TagEditor`，写路径仍是 `updateSystemErrorLifecycle`）。
 *
 * 备注只在改动后才允许保存：`dirty` 为假时按钮禁用——避免把一次没有改动的点击变成一次
 * 真实写入（`updated_at` 会动，时间线上看起来像"有人改过"，实际没有）。
 */
function ExceptionDevPanel({
  devNote, busy, onSave,
}: {
  devNote: string | null;
  busy: boolean;
  onSave: (patch: { devNote?: string | null }) => void;
}) {
  const [draft, setDraft] = React.useState(devNote ?? "");
  // 服务端回写（乐观更新落地或回滚）之后，把编辑框拉回权威值——除非用户正在编辑。
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (!touched) setDraft(devNote ?? "");
  }, [devNote, touched]);

  const trimmed = draft.trim();
  const dirty = trimmed !== (devNote ?? "").trim();

  return (
    <div className="rounded-card border border-border-subtle bg-panel p-2.5" data-testid="inbox-drawer-exception-dev">
      <p className="text-10 font-medium text-muted-foreground">开发备注</p>
      <Textarea
        value={draft}
        onChange={(e) => { setTouched(true); setDraft(e.target.value); }}
        rows={3}
        placeholder="转给谁 / 怎么复现 / 已知线索"
        aria-label="开发备注"
        disabled={busy}
        className="mt-1 text-12"
        data-testid="inbox-drawer-devnote-input"
      />
      <div className="mt-1.5 flex justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !dirty}
          onClick={() => { setTouched(false); onSave({ devNote: trimmed === "" ? null : trimmed }); }}
          data-testid="inbox-drawer-devnote-save"
        >
          保存备注
        </Button>
      </div>
    </div>
  );
}
