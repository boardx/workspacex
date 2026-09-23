"use client";
import { FeedbackTagsInput, commitFeedbackTags } from "@/components/feedback/feedback-tags";
import * as React from "react";
import { Plus, X, Trash2, MessageSquare, Paperclip, Send, ShieldAlert, PlugZap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
import { humanTime } from "@/lib/human-time";
import {
  FEEDBACK_ATTACHMENT_LABEL,
  FEEDBACK_KINDS,
  deleteFeedbackDraft,
  listMyFeedbackDrafts,
  submitFeedbackDraft,
  updateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackKind,
} from "@/lib/live-feedback";
import { FeedbackStructuredView } from "@/components/feedback/feedback-structured";
import { useDialogFocus } from "./use-dialog-focus";

/**
 * UC-17.8 B1 —— 反馈草稿屏（真栈：`feedback-loop` 契约的六条 `*FeedbackDraft*` 操作）。
 *
 * ## 三态是数据驱动的，不是 `state` prop 驱动的
 *
 * `state` prop 只给取材页/七态矩阵强制展示 loading / denied / dep-failed 用；`default` 下
 * 屏自己 `listMyFeedbackDrafts()`：读取中 ⇒ `loading`、失败 ⇒ `dep-failed`（说清「草稿没有丢」，
 * 可重试）、空 ⇒ `empty`——三者是三种不同的事实，不许把失败画成空态。
 *
 * ## 「继续完善」浮层里**没有一句是前端造的 AI 文案**
 *
 * 发送 = `updateFeedbackDraft({ appendChat: { role: "user", kind: "message", text } })`，
 * 然后用服务端回的**整条** `draft.chat` 重渲染。首次澄清问题与回执都由服务端追加
 * （契约 `refineSeeded`），前端不再本地 seed——原型期那份 `REFINE_SEED`/`REFINE_ACK` 已删。
 * UC-17.8 B5.1：AI 记录带 `source`（`designAiCollab.AiReplySource`）——`fallback` 时在气泡里
 * 挂一个「固定回执」小标识，布局不变；文案仍全部来自服务端。
 *
 * ## `DRAFT_EMPTY` 要翻成可行动的话
 *
 * 空正文的草稿在提交口被拒（契约 `submitFeedbackDraft.err`）。屏上要说的是「先写点正文」并给
 * 一个能点的「去编辑」，不是把 reasonCode 原样丢给用户。
 */

const KIND_OPTIONS = FEEDBACK_KINDS.map((k) => ({ value: k, label: k }));

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; items: readonly FeedbackDraft[] }
  | { kind: "failed"; reason: string };

/**
 * 迭代 33：这三处（工作台首页 / 草稿列表 / 收件箱）原来各抄了一份
 * 「reasonCode 取不到就拼 HTTP 状态、再不行 String(err)」。迭代 27 只把详情页那一份
 * 换成了人话表，而这三屏恰恰是用户**第一眼**看到的地方。同一事实不得声明在两处：
 * 统一走 `lib/design-failure.ts`，并由 `lint-user-facing-error-text` 机械挡住回潮。
 */

function isDraftEmpty(err: unknown): boolean {
  return err instanceof ApiError && err.reasonCode === "DRAFT_EMPTY";
}

export function DesignLoopDraftsScreen({
  state = "default",
  onNewDraft,
  onSubmitted,
}: {
  state?: UiState;
  onNewDraft?: () => void;
  /** 草稿提交成收件箱条目之后——参数是**反馈** id（不再是草稿 id）。 */
  onSubmitted?: (feedbackId: string) => void;
}) {
  const [list, setList] = React.useState<ListState>({ kind: "loading" });
  const [editId, setEditId] = React.useState<string | null>(null);
  const [refineId, setRefineId] = React.useState<string | null>(null);
  /** 提交/删除失败——按草稿记，不是全局一条：用户要知道**哪一条**没成功。 */
  const [actionError, setActionError] = React.useState<{ draftId: string; empty: boolean; reason: string } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  /**
   * 迭代 34：**删草稿之前先问一句**。
   *
   * 草稿是用户手里**唯一**的那一份（没有回收站、没有撤销，契约里也没有恢复操作），
   * 而删除入口有两个：卡片右下角那个垃圾桶图标（挨着「直接提交」，4px 间距），
   * 以及编辑抽屉底部的「删除草稿」。两个都是点一下就没。
   * 确认只做一层：谁点的都落到这同一个确认，不在两处各写一遍。
   */
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setList({ kind: "loading" });
    try {
      setList({ kind: "ready", items: await listMyFeedbackDrafts() });
    } catch (err) {
      setList({ kind: "failed", reason: describeFailure(err) });
    }
  }, []);

  React.useEffect(() => {
    if (state !== "default") return;
    void load();
  }, [load, state]);

  const replaceDraft = (next: FeedbackDraft) =>
    setList((prev) => (prev.kind === "ready" ? { kind: "ready", items: prev.items.map((d) => (d.id === next.id ? next : d)) } : prev));
  const removeDraft = (id: string) =>
    setList((prev) => (prev.kind === "ready" ? { kind: "ready", items: prev.items.filter((d) => d.id !== id) } : prev));

  const submit = async (draftId: string) => {
    setBusyId(draftId);
    setActionError(null);
    try {
      const out = await submitFeedbackDraft(draftId);
      removeDraft(draftId);
      setRefineId(null);
      setEditId(null);
      onSubmitted?.(out.feedbackId);
    } catch (err) {
      setActionError({ draftId, empty: isDraftEmpty(err), reason: describeFailure(err) });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (draftId: string) => {
    setBusyId(draftId);
    setActionError(null);
    try {
      await deleteFeedbackDraft(draftId);
      removeDraft(draftId);
      if (editId === draftId) setEditId(null);
      if (refineId === draftId) setRefineId(null);
    } catch (err) {
      setActionError({ draftId, empty: false, reason: describeFailure(err) });
    } finally {
      setBusyId(null);
    }
  };

  if (state === "loading" || (state === "default" && list.kind === "loading")) {
    return (
      <div className="flex flex-col gap-2 p-6" data-testid="loading">
        {[0, 1, 2].map((n) => (
          <div key={n} className="h-20 animate-pulse rounded-card bg-muted" />
        ))}
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="denied">
        <ShieldAlert aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">反馈管理仅本人与运营可见</p>
        <p className="max-w-sm text-12 text-muted-foreground">草稿是你私有的中间态，别人看不到。登录后即可管理自己的草稿。</p>
      </div>
    );
  }
  if (state === "dep-failed" || (state === "default" && list.kind === "failed")) {
    const reason = state === "default" && list.kind === "failed" ? list.reason : null;
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="dep-failed">
        <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">草稿列表暂时读不到</p>
        <p className="max-w-sm text-12 text-muted-foreground">
          你的草稿没有丢，只是这次没取到{reason !== null ? `（${reason}）` : ""}。稍后重试。
        </p>
        <Button size="sm" variant="outline" className="mt-1" onClick={() => void load()} data-testid="drafts-retry">重试</Button>
      </div>
    );
  }

  const drafts: readonly FeedbackDraft[] = state === "default" && list.kind === "ready" ? list.items : [];
  const editing = drafts.find((d) => d.id === editId) ?? null;
  const refining = drafts.find((d) => d.id === refineId) ?? null;

  return (
    <div className="flex h-full flex-col" data-testid="design-loop-drafts">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h1 className="text-16 font-semibold">反馈草稿</h1>
          <p className="text-11 text-muted-foreground">先存下来，想清楚边界后再提交到收件箱。草稿只有你自己看得到。</p>
        </div>
        <Button variant="primary" size="sm" onClick={onNewDraft} data-testid="drafts-new">
          <Plus aria-hidden className="h-3.5 w-3.5" /> 新建反馈草稿
        </Button>
      </div>

      {actionError !== null && (
        <div
          className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-card border border-destructive/40 bg-destructive/5 px-3 py-2 text-12"
          role="alert"
          data-testid={actionError.empty ? "drafts-submit-empty" : "drafts-action-error"}
        >
          {actionError.empty ? (
            <>
              <span>这条草稿的正文还是空的，收件箱不收空反馈——先写一句发生了什么，再提交。</span>
              <Button size="xs" variant="outline" onClick={() => { setActionError(null); setEditId(actionError.draftId); }} data-testid="drafts-submit-empty-edit">
                去写正文
              </Button>
            </>
          ) : (
            <span>没能完成这次操作（{actionError.reason}）。草稿没有被改动，可以再试一次。</span>
          )}
          <button type="button" className="ml-auto rounded-control p-0.5 text-muted-foreground transition-colors duration-fast hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="关闭提示" onClick={() => setActionError(null)}>
            <X aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {confirmDelete !== null && (
        <div
          className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-card border border-destructive/40 bg-destructive/5 px-3 py-2 text-12"
          role="alertdialog"
          aria-label="确认删除草稿"
          data-testid="drafts-delete-confirm"
        >
          <span>删掉这条草稿？它只有这一份，删了找不回来。</span>
          <Button size="xs" variant="outline" onClick={() => { const id = confirmDelete; setConfirmDelete(null); void remove(id); }} data-testid="drafts-delete-confirm-yes">
            删掉
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(null)} data-testid="drafts-delete-confirm-no">
            不删了
          </Button>
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">暂无草稿。</p>
          {/*
            * 迭代 34：原文是「或在快速反馈里选『存为草稿』」——而"快速反馈"在哪，这一屏上
            * 一个字都没说。指向一个用户找不到的入口，等于没指。说这一屏自己能做的那件事。
            */}
          <p className="max-w-sm text-12 text-muted-foreground">
            草稿是你写一半的想法，只有你自己看得到。写好了再决定要不要提交给团队。
          </p>
          <Button variant="outline" size="sm" onClick={onNewDraft} className="mt-1">
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建反馈草稿
          </Button>
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" data-testid="drafts-list">
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              busy={busyId === draft.id}
              onEdit={() => setEditId(draft.id)}
              onRefine={() => setRefineId(draft.id)}
              onDelete={() => setConfirmDelete(draft.id)}
              onSubmit={() => void submit(draft.id)}
            />
          ))}
        </ul>
      )}

      {editing !== null && (
        <EditDrawer
          draft={editing}
          onClose={() => setEditId(null)}
          onSaved={replaceDraft}
          onDelete={() => { setEditId(null); setConfirmDelete(editing.id); }}
          onRefine={() => { setEditId(null); setRefineId(editing.id); }}
        />
      )}

      {refining !== null && (
        <RefineOverlay
          draft={refining}
          busy={busyId === refining.id}
          onClose={() => setRefineId(null)}
          onSubmit={() => void submit(refining.id)}
          onUpdated={replaceDraft}
        />
      )}
    </div>
  );
}

function DraftCard({
  draft, busy, onEdit, onRefine, onDelete, onSubmit,
}: {
  draft: FeedbackDraft;
  busy: boolean;
  onEdit: () => void;
  onRefine: () => void;
  onDelete: () => void;
  onSubmit: () => void;
}) {
  const Icon = draft.attachments.length > 0 ? Paperclip : MessageSquare;
  return (
    <li
      data-testid={`draft-card-${draft.id}`}
      className="flex items-start gap-3 rounded-card border border-border-subtle bg-card p-3 transition-colors duration-fast hover:border-primary"
    >
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-start gap-3 text-left" data-testid={`draft-open-${draft.id}`}>
        <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-control bg-panel text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded-control border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{draft.kind}</span>
            <span className="truncate text-13 font-medium">{draft.title ?? "（未命名草稿）"}</span>
          </div>
          <p className="mt-0.5 line-clamp-2 text-11 text-muted-foreground">{draft.detail}</p>
          <p className="mt-1 text-10 text-muted-foreground">
            {/*
              * 迭代 34：原来是 `toLocaleDateString("zh-CN")`——**连时分都没有**，
              * 今天刚改的和上周改的在屏上长得一样，而草稿列表最需要的就是"哪条是我刚写的"。
              * 时间格式走 `lib/human-time` 这一份（版本历史 / 分享弹窗 / 访客页 / 对话气泡同源），
              * 这是第四处收敛进来的副本。
              */}
            改于 {humanTime(draft.updatedAt)}
            {draft.chat.length > 0 && `　完善过 ${Math.ceil(draft.chat.length / 2)} 轮`}
            {draft.attachments.length > 0 && `　${draft.attachments.length} 个附件`}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button variant="ai" size="xs" onClick={onRefine} disabled={busy} data-testid={`draft-refine-${draft.id}`}>继续完善</Button>
        <div className="flex gap-1">
          {/*
            * 迭代 34：「直接提交」此前不说提交之后会发生什么。页头写着「草稿只有你自己看得到」，
            * 那么提交恰恰是**把它从"只有你看得到"变成别人看得到**的那一步——这件事得在按下之前说。
            */}
          <Button variant="outline" size="xs" onClick={onSubmit} disabled={busy} title="提交之后这条会进收件箱，团队里的人就看得到了；草稿列表里不再保留" data-testid={`draft-submit-${draft.id}`}>
            {busy && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
            提交给团队
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete} disabled={busy} aria-label="删除草稿" data-testid={`draft-delete-${draft.id}`}>
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function EditDrawer({
  draft, onClose, onSaved, onDelete, onRefine,
}: {
  draft: FeedbackDraft;
  onClose: () => void;
  onSaved: (draft: FeedbackDraft) => void;
  onDelete: () => void;
  onRefine: () => void;
}) {
  const [kind, setKind] = React.useState<FeedbackKind>(draft.kind);
  const [detail, setDetail] = React.useState(draft.detail);
  const [tags, setTags] = React.useState<readonly string[]>(draft.tags ?? []);
  const [tagDraft, setTagDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * 迭代 34：**关掉抽屉就把改动丢了，而且一个字都不说。**
   *
   * 点遮罩、按 Esc、点右上角 ×——三条路都是直接 `onClose()`，用户刚写的一段正文瞬间消失。
   * 草稿本来就是"写一半的想法"，写一半正是它的常态；这一屏最不该做的事就是悄悄扔掉它。
   *
   * 修法不是弹二次确认打断他，而是**先替他存下来**：关闭时若有未保存改动就跑一次 `save()`，
   * 存成功才关。存失败则留在原地并把原因显示出来（`error` 那条已有的提示），不假装存好了。
   */
  const dirtyRef = React.useRef(false);
  const closeRef = React.useRef<() => void>(onClose);
  const requestClose = React.useCallback(() => { closeRef.current(); }, []);
  /** B6.5：焦点进 drawer / Esc 关闭 / 关闭后焦点回到触发卡片（见 `use-dialog-focus.ts`）。 */
  const panelRef = React.useRef<HTMLElement>(null);
  useDialogFocus(panelRef, requestClose);

  /** 只发**改了**的字段（契约四个都 optional）；什么都没改就不打空请求，直接算保存成功。 */
  const save = async (): Promise<boolean> => {
    const patch: { kind?: FeedbackKind; detail?: string; tags?: string[] } = {};
    try {
      const next = commitFeedbackTags(tags, tagDraft);
      if (JSON.stringify(next) !== JSON.stringify(draft.tags ?? [])) patch.tags = next;
    } catch { setError("标签格式无效，请使用普通分类标签"); return false; }
    if (kind !== draft.kind) patch.kind = kind;
    if (detail !== draft.detail) patch.detail = detail;
    if (Object.keys(patch).length === 0) return true;
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateFeedbackDraft(draft.id, patch));
      return true;
    } catch (err) {
      setError(describeFailure(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    kind !== draft.kind ||
    detail !== draft.detail ||
    JSON.stringify(tags) !== JSON.stringify(draft.tags ?? []) ||
    tagDraft.trim() !== "";
  dirtyRef.current = dirty;
  closeRef.current = () => {
    if (!dirtyRef.current) { onClose(); return; }
    void save().then((ok) => { if (ok) onClose(); });
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 top-[54px] z-40 bg-inverse/30" onClick={requestClose} aria-hidden />
      {/* 宽度：26rem 上限 + max-w-full ⇒ 375 下自然全宽（U8）。 */}
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="编辑草稿"
        data-testid="draft-edit-drawer"
        className="fixed bottom-0 right-0 top-[54px] z-40 flex w-[26rem] max-w-full flex-col border-l border-border bg-card shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <header className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-14 font-semibold">编辑草稿</h3>
          <Button variant="ghost" size="icon" onClick={requestClose} aria-label="关闭" data-testid="draft-edit-close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex flex-col gap-1">
            <span className="text-11 font-medium text-muted-foreground">类型</span>
            <Select options={KIND_OPTIONS} value={kind} onValueChange={(v) => setKind(v as FeedbackKind)} data-testid="draft-edit-type" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="draft-edit-body" className="text-11 font-medium text-muted-foreground">正文</label>
            <Textarea id="draft-edit-body" value={detail} onChange={(e) => setDetail(e.target.value)} rows={8} data-testid="draft-edit-body" />
          </div>
          <FeedbackTagsInput tags={tags} onChange={setTags} draft={tagDraft} onDraftChange={setTagDraft} disabled={saving} />
          {draft.structured !== null && (
            <div className="flex flex-col gap-1">
              <span className="text-11 font-medium text-muted-foreground">结构化字段</span>
              <FeedbackStructuredView kind={draft.kind} structured={draft.structured} testid={`draft-edit-structured-${draft.id}`} />
            </div>
          )}
          {draft.attachments.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-11 font-medium text-muted-foreground">附件</span>
              <ul className="flex flex-col gap-1">
                {draft.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-1.5 rounded-control bg-panel px-2 py-1 text-11 text-muted-foreground">
                    <Paperclip aria-hidden className="h-3 w-3" />
                    {/* 迭代 34：契约里没有文件名，屏上唯一能说明"这是什么"的就是类型——那就别写 MIME。 */}
                    {FEEDBACK_ATTACHMENT_LABEL[a.mime]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dirty && (
            <p className="text-10 text-muted-foreground" data-testid="draft-edit-dirty">
              改动会在关闭时自动保存。
            </p>
          )}
          {error !== null && (
            <p className="text-11 text-destructive" data-testid="draft-edit-error">没能保存（{error}）。草稿还是原来的样子，可以再试一次。</p>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-border p-4">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete} data-testid="draft-edit-delete">
            <Trash2 aria-hidden className="h-3.5 w-3.5" /> 删除草稿
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void save()} data-testid="draft-edit-save">
              {saving && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
              保存
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={() => void save().then((ok) => { if (ok) onRefine(); })}
              data-testid="draft-edit-refine"
            >
              继续完善
            </Button>
          </div>
        </footer>
      </aside>
    </>
  );
}

function RefineOverlay({
  draft, busy, onClose, onSubmit, onUpdated,
}: {
  draft: FeedbackDraft;
  busy: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onUpdated: (draft: FeedbackDraft) => void;
}) {
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  /** B6.5：焦点进浮层 / Esc 关闭 / 关闭后焦点回到触发按钮（见 `use-dialog-focus.ts`）。 */
  const panelRef = React.useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, onClose);

  React.useEffect(() => {
    const node = scrollRef.current;
    // jsdom 没有 `scrollTo`；滚到底只是便利，不是功能。
    if (node && typeof node.scrollTo === "function") node.scrollTo({ top: node.scrollHeight });
  }, [draft.chat.length]);

  const send = async () => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    setSending(true);
    setSendError(null);
    try {
      onUpdated(await updateFeedbackDraft(draft.id, { appendChat: { role: "user", kind: "message", text: trimmed } }));
      setText("");
    } catch (err) {
      // 发失败：这句话还留在输入框里，不清空。
      setSendError(describeFailure(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="draft-refine-overlay">
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      {/* B6.5（U8）：md 以下左右两栏改为上下堆叠——375 下 2/5 宽的原文栏只剩 ~130px，结构化字段的
          dd 被压到 0 宽（实测被三档溢出断言抓到）。原文栏限高 38% 自身滚动，对话栏占剩余高度。 */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="继续完善草稿"
        className="relative flex h-[min(680px,88vh)] w-full max-w-4xl flex-col overflow-hidden rounded-card border border-border bg-card shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex-row"
      >
        {/* 左：草稿原文 */}
        <div className="flex max-h-[38%] shrink-0 flex-col gap-3 overflow-y-auto border-b border-border bg-panel p-4 md:max-h-none md:w-2/5 md:border-b-0 md:border-r">
          <div className="flex items-center gap-1.5">
            <span className="rounded-control border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{draft.kind}</span>
            <h3 className="text-14 font-semibold">{draft.title ?? "（未命名草稿）"}</h3>
          </div>
          <p className="whitespace-pre-wrap text-12 text-card-foreground">{draft.detail}</p>
          {draft.structured !== null && (
            <FeedbackStructuredView kind={draft.kind} structured={draft.structured} testid={`draft-refine-structured-${draft.id}`} compact />
          )}
          {draft.attachments.length > 0 && (
            <p className="text-11 text-muted-foreground">附件 {draft.attachments.length} 个</p>
          )}
        </div>
        {/* 右：设计协作对话——每一句都是服务端 `draft.chat` 里的，前端不造 AI 文案 */}
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border p-3">
            <h4 className="text-13 font-medium">设计协作</h4>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭" data-testid="draft-refine-close">
              <X aria-hidden className="h-4 w-4" />
            </Button>
          </header>
          <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" data-testid="draft-refine-chat">
            {draft.chat.length === 0 && (
              <p className="text-11 text-muted-foreground" data-testid="draft-refine-chat-empty">
                还没有对话。说说这条反馈的边界、优先级、影响范围，AI 会先问你一个澄清问题。
              </p>
            )}
            {draft.chat.map((turn, i) => (
              <div
                key={`${turn.at}-${i}`}
                data-testid={`draft-refine-turn-${turn.role}-${turn.kind}`}
                className={cn(
                  "max-w-[85%] rounded-card px-2.5 py-1.5 text-12",
                  turn.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-panel text-card-foreground",
                  turn.kind === "edit" && "italic opacity-80",
                )}
              >
                {turn.kind === "edit" ? `（改了正文）${turn.text}` : turn.text}
                {/* B5.1：模型不可用时服务端退回固定回执并标 source=fallback——如实显示，不装成模型说的 */}
                {turn.role === "ai" && turn.source === "fallback" && (
                  <span className="ml-1.5 rounded-control border border-border px-1 text-10 text-muted-foreground" data-testid="draft-refine-turn-fallback">
                    固定回执
                  </span>
                )}
              </div>
            ))}
          </div>
          {sendError !== null && (
            <p className="px-3 text-11 text-destructive" data-testid="draft-refine-send-error">没能发出去（{sendError}）。这句话还在输入框里。</p>
          )}
          <div className="flex items-end gap-2 border-t border-border p-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="补充边界、优先级、影响范围…"
              data-testid="draft-refine-input"
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon"
              disabled={text.trim() === "" || sending}
              onClick={() => void send()}
              aria-label="发送"
              data-testid="draft-refine-send"
            >
              {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-3">
            <Button variant="ghost" size="sm" onClick={onClose}>先关闭</Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={onSubmit} data-testid="draft-refine-submit">
              {busy && <Loader2 aria-hidden className="h-3 w-3 animate-spin" />}
              准备好，提交到收件箱
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
