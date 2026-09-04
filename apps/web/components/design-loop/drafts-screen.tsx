"use client";
import * as React from "react";
import { Plus, X, Trash2, MessageSquare, Paperclip, Send, ShieldAlert, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { useDesignLoop, TYPE_LABEL, type Draft, type DraftType } from "@/lib/design-loop-store";

const TYPE_OPTIONS = [
  { value: "bug", label: TYPE_LABEL.bug },
  { value: "req", label: TYPE_LABEL.req },
];

export function DesignLoopDraftsScreen({
  state = "default",
  onNewDraft,
  onSubmitted,
}: {
  state?: UiState;
  onNewDraft?: () => void;
  onSubmitted?: (inboxId: string) => void;
}) {
  const store = useDesignLoop();
  const [editId, setEditId] = React.useState<string | null>(null);
  const [refineId, setRefineId] = React.useState<string | null>(null);

  if (state === "loading") {
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
  if (state === "dep-failed") {
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="dep-failed">
        <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">草稿列表暂时读不到</p>
        <p className="max-w-sm text-12 text-muted-foreground">你的草稿没有丢，只是这次没取到。稍后重试。</p>
        <Button size="sm" variant="outline" className="mt-1">重试</Button>
      </div>
    );
  }

  const editing = store.drafts.find((d) => d.id === editId) ?? null;
  const refining = store.drafts.find((d) => d.id === refineId) ?? null;

  return (
    <div className="flex h-full flex-col" data-testid="design-loop-drafts">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-16 font-semibold">反馈草稿</h1>
          <p className="text-11 text-muted-foreground">先存下来，想清楚边界后再提交到收件箱。草稿只有你自己看得到。</p>
        </div>
        <Button variant="primary" size="sm" onClick={onNewDraft} data-testid="drafts-new">
          <Plus aria-hidden className="h-3.5 w-3.5" /> 新建反馈草稿
        </Button>
      </div>

      {store.drafts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center" data-testid="empty">
          <p className="text-14 font-medium">暂无草稿。</p>
          <p className="text-12 text-muted-foreground">点「新建反馈草稿」写点什么，或在快速反馈里选「存为草稿」。</p>
          <Button variant="outline" size="sm" onClick={onNewDraft} className="mt-1">
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建反馈草稿
          </Button>
        </div>
      ) : (
        <ul className="flex flex-1 flex-col gap-2 overflow-y-auto p-4" data-testid="drafts-list">
          {store.drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onEdit={() => setEditId(draft.id)}
              onRefine={() => setRefineId(draft.id)}
              onDelete={() => store.deleteDraft(draft.id)}
              onSubmit={() => {
                const id = store.submitDraft(draft.id);
                onSubmitted?.(id);
              }}
            />
          ))}
        </ul>
      )}

      {editing !== null && (
        <EditDrawer
          draft={editing}
          onClose={() => setEditId(null)}
          onSave={(patch) => store.updateDraft(editing.id, patch)}
          onDelete={() => { store.deleteDraft(editing.id); setEditId(null); }}
          onRefine={() => { setEditId(null); setRefineId(editing.id); }}
        />
      )}

      {refining !== null && (
        <RefineOverlay
          draft={refining}
          onClose={() => setRefineId(null)}
          onSubmit={() => {
            const id = store.submitDraft(refining.id);
            setRefineId(null);
            onSubmitted?.(id);
          }}
          onSeed={() => store.seedRefine(refining.id)}
          onSend={(text) => store.appendDraftChat(refining.id, text)}
        />
      )}
    </div>
  );
}

function DraftCard({
  draft, onEdit, onRefine, onDelete, onSubmit,
}: {
  draft: Draft;
  onEdit: () => void;
  onRefine: () => void;
  onDelete: () => void;
  onSubmit: () => void;
}) {
  const Icon = draft.files.length > 0 ? Paperclip : MessageSquare;
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
            <span className="rounded-control border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{TYPE_LABEL[draft.type]}</span>
            <span className="truncate text-13 font-medium">{draft.title || "（未命名草稿）"}</span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-11 text-muted-foreground">{draft.body}</p>
          <p className="mt-1 text-10 text-muted-foreground">
            {new Date(draft.createdAt).toLocaleDateString("zh-CN")}　对话 {draft.chat.length} 条
            {draft.files.length > 0 && `　附件 ${draft.files.length} 个`}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button variant="ai" size="xs" onClick={onRefine} data-testid={`draft-refine-${draft.id}`}>继续完善</Button>
        <div className="flex gap-1">
          <Button variant="outline" size="xs" onClick={onSubmit} data-testid={`draft-submit-${draft.id}`}>直接提交</Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete} aria-label="删除草稿" data-testid={`draft-delete-${draft.id}`}>
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </li>
  );
}

function EditDrawer({
  draft, onClose, onSave, onDelete, onRefine,
}: {
  draft: Draft;
  onClose: () => void;
  onSave: (patch: { type: DraftType; body: string }) => void;
  onDelete: () => void;
  onRefine: () => void;
}) {
  const [type, setType] = React.useState<DraftType>(draft.type);
  const [body, setBody] = React.useState(draft.body);
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 top-[54px] z-40 bg-inverse/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="编辑草稿"
        data-testid="draft-edit-drawer"
        className="fixed bottom-0 right-0 top-[54px] z-40 flex w-[26rem] max-w-full flex-col border-l border-border bg-card shadow-lg"
      >
        <header className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-14 font-semibold">编辑草稿</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭" data-testid="draft-edit-close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          <div className="flex flex-col gap-1">
            <span className="text-11 font-medium text-muted-foreground">类型</span>
            <Select options={TYPE_OPTIONS} value={type} onValueChange={(v) => setType(v as DraftType)} data-testid="draft-edit-type" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="draft-edit-body" className="text-11 font-medium text-muted-foreground">正文</label>
            <Textarea id="draft-edit-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} data-testid="draft-edit-body" />
          </div>
          {draft.files.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-11 font-medium text-muted-foreground">附件</span>
              <ul className="flex flex-col gap-1">
                {draft.files.map((f) => (
                  <li key={f.id} className="flex items-center gap-1.5 rounded-control bg-panel px-2 py-1 text-11 text-muted-foreground">
                    <Paperclip aria-hidden className="h-3 w-3" />
                    {f.name} · {(f.size / 1024).toFixed(0)} KB
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <footer className="flex items-center justify-between border-t border-border p-4">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete} data-testid="draft-edit-delete">
            <Trash2 aria-hidden className="h-3.5 w-3.5" /> 删除草稿
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onSave({ type, body })} data-testid="draft-edit-save">保存</Button>
            <Button variant="primary" size="sm" onClick={() => { onSave({ type, body }); onRefine(); }} data-testid="draft-edit-refine">继续完善</Button>
          </div>
        </footer>
      </aside>
    </>
  );
}

function RefineOverlay({
  draft, onClose, onSubmit, onSeed, onSend,
}: {
  draft: Draft;
  onClose: () => void;
  onSubmit: () => void;
  onSeed: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // 首次打开自动追加一条 AI 澄清问题。
  React.useEffect(() => {
    if (!draft.refineSeeded) onSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [draft.chat.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="draft-refine-overlay">
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      <div className="relative flex h-[min(680px,88vh)] w-full max-w-4xl overflow-hidden rounded-card border border-border bg-card shadow-lg">
        {/* 左：草稿原文 */}
        <div className="flex w-2/5 flex-col gap-3 overflow-y-auto border-r border-border bg-panel p-4">
          <div className="flex items-center gap-1.5">
            <span className="rounded-control border border-border px-1.5 py-0.5 text-10 text-muted-foreground">{TYPE_LABEL[draft.type]}</span>
            <h3 className="text-14 font-semibold">{draft.title || "（未命名草稿）"}</h3>
          </div>
          {draft.hasScreenshot && (
            <div className="grid h-32 place-items-center rounded-card border border-dashed border-border text-11 text-muted-foreground">
              截图占位
            </div>
          )}
          <p className="whitespace-pre-wrap text-12 text-card-foreground">{draft.body}</p>
        </div>
        {/* 右：设计协作对话 */}
        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-border p-3">
            <h4 className="text-13 font-medium">设计协作</h4>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭" data-testid="draft-refine-close">
              <X aria-hidden className="h-4 w-4" />
            </Button>
          </header>
          <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" data-testid="draft-refine-chat">
            {draft.chat.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] rounded-card px-2.5 py-1.5 text-12",
                  turn.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-panel text-card-foreground",
                )}
              >
                {turn.text}
              </div>
            ))}
          </div>
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
              disabled={text.trim() === ""}
              onClick={() => { onSend(text.trim()); setText(""); }}
              aria-label="发送"
              data-testid="draft-refine-send"
            >
              <Send aria-hidden className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-3">
            <Button variant="ghost" size="sm" onClick={onClose}>先关闭</Button>
            <Button variant="primary" size="sm" onClick={onSubmit} data-testid="draft-refine-submit">准备好，提交到收件箱</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
