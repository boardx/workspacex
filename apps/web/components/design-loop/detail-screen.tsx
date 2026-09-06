"use client";
import * as React from "react";
import { ArrowLeft, Send, Check, CheckCircle2, Upload, Loader2, PlugZap, FileDown, Crosshair, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { LinkBadge } from "./badges";
import { PrototypeCanvas } from "./prototype-canvas";
import { buildDesignDocMarkdown, designDocFileName } from "@/lib/design-doc-markdown";
import {
  appendProjectChat as apiAppendProjectChat,
  listMyProjects,
  pushToInbox as apiPushToInbox,
  DESIGN_WORKBENCH_CHAT_INTRO,
  findPrototypeNodePath,
  prototypeNodeLabel,
  type DesignProject,
  type DesignWritebackField,
  type ProjectTemplate,
} from "@/lib/live-design-workbench";

/** B5.2：`reply.applied` 的展示文案——键集合来自契约枚举，不另抄一份。 */
const WRITEBACK_LABEL: Record<DesignWritebackField, string> = {
  problem: "背景",
  criteria: "验收标准",
  frames: "画布页",
  prototype: "原型画布",
};

const TEMPLATE_LABEL: Record<ProjectTemplate, string> = {
  mobile: "移动端设计",
  ui: "UI 原型",
  wireframe: "线框图",
};

function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return "无法连接服务器，请稍后重试";
  return String(err);
}

/**
 * B5.3：导出设计文档——纯客户端拼 Markdown（`lib/design-doc-markdown.ts`）后触发下载。
 * 不走服务端：文档的全部素材已经在 `DesignProject` 里，多一个接口只是多一份可漂移的副本。
 * jsdom 没有 `URL.createObjectURL`，测试里 mock 它；生产浏览器真下载。
 */
function exportDoc(project: DesignProject): void {
  const now = new Date();
  const blob = new Blob([buildDesignDocMarkdown(project, now)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = designDocFileName(project, now);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; project: DesignProject }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

/**
 * PM 设计详情全屏页（Claude Code 风格深色 IDE）。
 * 用 `.dark` 强制深色 token 体系（app/globals.css 的 `.dark` 那份），不另立颜色。
 * 脱离后台三栏骨架：整屏铺满。
 *
 * UC-17.8 B4.5 —— **真栈**（契约 `designWorkbench`）。切自原型 mock store（已于 B6.1 删除）
 * 的本地 mock。
 *
 * ## 这一屏刻意的几个设计取舍
 *
 *   · **没有单条 `getProject` 契约操作，用 `listMyProjects()` 后按 `id` 客户端查找**——
 *     见 `lib/live-design-workbench.ts` 文件头。找不到这条 id（已删除/属于另一组织）时
 *     渲染既有的「找不到这个设计项目」态，不是把它当网络失败处理。
 *   · **对话面板发消息是真实 `appendProjectChat` 往返**：发送后用服务端返回的
 *     `project.chat`（用户消息 + AI 回复两条一起写入；UC-17.8 B5.2 起回复由模型生成、
 *     模型不可用时退回固定回执并标 `source: "fallback"`）整体替换本地 `chat`，
 *     `reply.applied` 非空时在最后一条 AI 气泡下显示「已更新：…」（模型写回了 `problem`/
 *     `criteria`/`frames`，右侧说明页/画布标签随返回的 `project` 一起变），
 *     不本地拼接乐观消息——服务端在同一次调用里原子写两条，本地拼接容易和它对不上
 *     （比如失败重试会拼出重复的用户消息）。发送中禁用输入框，失败恢复文本框内容
 *     以便重试，不清空用户刚打的字。
 *   · **推送成功页两个出口读真实 id**（backlog B4.5 原文）：`inboxCode` 来自
 *     `pushToInbox` 的真实返回值，不再是本地 mock 生成的 `D-` 编号；「继续设计下一个」
 *     不带 code，只是导航——出口本身不需要 code，是这条路径本来就没有引用它。
 */
export function DesignDetailScreen({
  projectId,
  onBack,
  onOpenInbox,
  onNextDesign,
}: {
  projectId: string;
  onBack?: () => void;
  onOpenInbox?: () => void;
  onNextDesign?: () => void;
}) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [tab, setTab] = React.useState<"canvas" | "spec">("canvas");
  const [frame, setFrame] = React.useState(0);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [chatError, setChatError] = React.useState<string | null>(null);
  /** B5.2：最近一轮模型回复写回了哪些字段（`reply.applied`）——挂在最后一条 AI 气泡下方，发下一句时清掉。 */
  const [lastApplied, setLastApplied] = React.useState<readonly DesignWritebackField[]>([]);
  /** 迭代 2：画布上选中的节点 id——发消息时随 `focusNodeId` 一起发，模型优先针对它改。 */
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [pushError, setPushError] = React.useState<string | null>(null);
  const [pushed, setPushed] = React.useState<{ project: DesignProject; code: string } | null>(null);
  const chatRef = React.useRef<HTMLDivElement>(null);

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const { items } = await listMyProjects();
      const found = items.find((p) => p.id === projectId) ?? null;
      setLoad(found === null ? { kind: "missing" } : { kind: "ready", project: found });
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, [projectId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const project = load.kind === "ready" ? load.project : null;
  // 迭代 2：选中节点在当前树里的路径；节点被上一轮删掉/整页重生成后找不到 ⇒ 视为未选中（不留悬空引用）。
  const focus = React.useMemo(
    () => (project !== null && selectedId !== null ? findPrototypeNodePath(project.prototype, selectedId) : null),
    [project, selectedId],
  );

  React.useEffect(() => {
    // jsdom（测试环境）没有实现 `Element.scrollTo`——同 `inbox-screen.tsx` 的既有成例，
    // 生产浏览器里才真正滚动。
    chatRef.current?.scrollTo?.({ top: chatRef.current.scrollHeight });
  }, [project?.chat.length]);

  if (load.kind === "loading") {
    return (
      <div className="dark grid h-dvh place-items-center bg-background text-background-foreground" data-testid="loading">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (load.kind === "failed") {
    return (
      <div className="dark grid h-dvh place-items-center bg-background text-background-foreground" data-testid="dep-failed">
        <div className="flex flex-col items-center gap-2 text-center">
          <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
          <p className="text-14 font-medium">这个设计项目暂时读不到（{load.reason}）</p>
          <Button variant="outline" size="sm" onClick={() => void reload()} data-testid="design-detail-retry">重试</Button>
        </div>
      </div>
    );
  }

  if (load.kind === "missing" || project === null) {
    return (
      <div className="dark grid h-dvh place-items-center bg-background text-background-foreground" data-testid="design-detail-missing">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-14 font-medium">找不到这个设计项目</p>
          <Button variant="outline" size="sm" onClick={onBack}>返回工作台</Button>
        </div>
      </div>
    );
  }

  if (pushed !== null) {
    return <PushSuccess project={pushed.project} code={pushed.code} onOpenInbox={onOpenInbox} onNextDesign={onNextDesign} />;
  }

  const send = async () => {
    const value = text.trim();
    if (value === "") return;
    setSending(true);
    setChatError(null);
    try {
      const { project: updated, reply } = await apiAppendProjectChat(project.id, value, focus !== null ? selectedId ?? undefined : undefined);
      setLoad({ kind: "ready", project: updated });
      setLastApplied(reply.applied);
      // 整页重生成（`frames` 被写回 ⇒ 树是新的，id 重新分配过）：旧的选中 id 可能撞上一个不相干的新节点，
      // 不能靠「id 字符串还找得到」判断身份延续——一律清掉。patch 保留 id，选中延续。
      if (reply.applied.includes("frames")) setSelectedId(null);
      setText("");
    } catch (err) {
      setChatError(`没能发送（${describeFailure(err)}），已保留草稿`);
      window.setTimeout(() => setChatError(null), 3000);
    } finally {
      setSending(false);
    }
  };

  const confirmPush = async (note: string) => {
    setPushBusy(true);
    setPushError(null);
    try {
      const out = await apiPushToInbox(project.id, note === "" ? undefined : note);
      setConfirming(false);
      setPushed({ project: out.project, code: out.inboxCode });
    } catch (err) {
      setPushError(`没能推送到收件箱（${describeFailure(err)}）`);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="dark flex h-dvh flex-col bg-background text-background-foreground" data-testid="design-detail">
      {/* 顶部条 */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="design-detail-back">
          <ArrowLeft aria-hidden className="h-4 w-4" /> 工作台
        </Button>
        <span className="min-w-0 truncate text-12 text-muted-foreground">工作台 / <span className="text-background-foreground">{project.name}</span></span>
        {project.linkedFeedbackId !== null && <LinkBadge text="源自反馈" testid="design-detail-linked" />}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => exportDoc(project)} data-testid="design-detail-export-doc" title="导出为 Markdown 设计文档">
            <FileDown aria-hidden className="h-3.5 w-3.5" /> 导出设计文档
          </Button>
          {project.pushed ? (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="design-detail-push">
              <Check aria-hidden className="h-3.5 w-3.5" /> 已推送到收件箱
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setConfirming(true)} data-testid="design-detail-push">
              <Upload aria-hidden className="h-3.5 w-3.5" /> 推送到收件箱
            </Button>
          )}
        </div>
      </header>

      {/* B6.5（U8）：md 以下两栏改为上下堆叠——对话面板在上、限高 40dvh 自身滚动，画布/说明占剩余高度。
          取舍：不折叠成抽屉（对话是这一屏唯一的修改入口，藏起来等于把功能藏起来）；不并排缩窄
          （360px 对话 + 260px 手机画布在 375/768 下装不下，实测 375 文档溢出 90px）。md 及以上不变。 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 左：对话面板 360px（md+）；md 以下全宽、限高 */}
        <div className="flex max-h-[40dvh] shrink-0 flex-col border-b border-border bg-panel md:max-h-none md:w-[360px] md:border-b-0 md:border-r">
          <div className="border-b border-border px-4 py-2.5 text-12 font-medium">设计协作</div>
          <div ref={chatRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" data-testid="design-detail-chat">
            {project.chat.length === 0 && (
              <div className="max-w-[90%] self-start rounded-card bg-card px-2.5 py-1.5 text-12 text-card-foreground">
                {DESIGN_WORKBENCH_CHAT_INTRO}
              </div>
            )}
            {project.chat.map((turn, i) => (
              <div
                key={i}
                data-testid={`design-detail-turn-${turn.role}`}
                className={cn(
                  "max-w-[90%] rounded-card px-2.5 py-1.5 text-12",
                  turn.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-card text-card-foreground",
                )}
              >
                {turn.text}
                {/* B5.2：模型不可用时服务端退回固定回执并标 source=fallback——如实显示，不装成模型说的 */}
                {turn.role === "ai" && turn.source === "fallback" && (
                  <span className="ml-1.5 rounded-control border border-border px-1 text-10 text-muted-foreground" data-testid="design-detail-turn-fallback">
                    固定回执
                  </span>
                )}
                {/* B5.2：这轮回复写回了哪些字段（服务端 `reply.applied`），只挂在最后一条 AI 气泡下 */}
                {turn.role === "ai" && i === project.chat.length - 1 && lastApplied.length > 0 && (
                  <div className="mt-1 text-10 text-muted-foreground" data-testid="design-detail-chat-applied">
                    已更新：{lastApplied.map((f) => WRITEBACK_LABEL[f]).join(" / ")}
                  </div>
                )}
              </div>
            ))}
          </div>
          {sending && (
            <div className="mx-3 mb-1 flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="design-detail-generating" role="status">
              <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> 正在生成，画布会整页重绘，可能需要一分钟……
            </div>
          )}
          {chatError !== null && (
            <div className="mx-3 mb-1 rounded-card bg-destructive px-2.5 py-1 text-11 text-destructive-foreground" data-testid="design-detail-chat-error" role="alert">
              {chatError}
            </div>
          )}
          {/* 迭代 2：焦点 chip——告诉用户「这句话会针对它」，可一键清除 */}
          {focus !== null && (
            <div className="mx-3 mb-1 flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="design-detail-focus">
              <Crosshair aria-hidden className="h-3 w-3 text-primary" />
              <span className="truncate">
                针对：<span className="text-background-foreground">{prototypeNodeLabel(focus.path[focus.path.length - 1]!)}</span>
                <span className="ml-1 text-10">（{project.frames[focus.frameIndex]} › {focus.path.slice(0, -1).map(prototypeNodeLabel).join(" › ") || "根"}）</span>
              </span>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="取消针对" className="ml-auto rounded-control p-0.5 transition-colors duration-fast hover:bg-card" data-testid="design-detail-focus-clear">
                <X aria-hidden className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 border-t border-border p-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              disabled={sending}
              placeholder={focus !== null ? "要怎么改这个节点？" : "告诉我要改什么，我来更新画布"}
              data-testid="design-detail-input"
              className="flex-1"
            />
            <Button
              variant="primary"
              size="icon"
              disabled={text.trim() === "" || sending}
              onClick={() => void send()}
              aria-label="发送"
              data-testid="design-detail-send"
            >
              {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* 右：画布 / 说明 两 Tab */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-1 border-b border-border px-4 pt-2">
            <DetailTab active={tab === "canvas"} onClick={() => setTab("canvas")} testid="design-detail-tab-canvas">原型画布</DetailTab>
            <DetailTab active={tab === "spec"} onClick={() => setTab("spec")} testid="design-detail-tab-spec">说明与验收标准</DetailTab>
          </div>

          {tab === "canvas" ? (
            <div className="flex min-h-0 flex-1 flex-col" data-testid="design-detail-canvas">
              <div className="flex gap-1 border-b border-border px-4 py-2">
                {project.frames.map((f, i) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrame(i)}
                    data-testid={`design-detail-frame-${i}`}
                    className={cn(
                      "rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      frame === i ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="grid flex-1 place-items-center overflow-y-auto bg-background p-6">
                <PrototypeCanvas
                  label={project.frames[frame] ?? ""}
                  root={project.prototype[frame] ?? null}
                  selectedId={focus !== null && focus.frameIndex === frame ? selectedId : null}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6" data-testid="design-detail-spec">
              <section className="mb-6">
                <h3 className="text-14 font-semibold">问题与目标</h3>
                <p className="mt-1.5 whitespace-pre-wrap text-13 text-muted-foreground">
                  {project.problem || "还没填背景。回到左边对话里说清楚要解决的问题，我会补到这里。"}
                </p>
                {project.linkedFeedbackId !== null && (
                  <p className="mt-2 text-12">
                    关联反馈：<span className="font-mono">{project.linkedFeedbackId}</span>
                  </p>
                )}
              </section>
              <section>
                <h3 className="text-14 font-semibold">验收标准</h3>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {project.criteria.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-13">
                      <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* 底部状态条 */}
      <footer className="flex items-center gap-3 border-t border-border bg-panel px-4 py-1.5 text-11 text-muted-foreground" data-testid="design-detail-statusbar">
        <span>claude-opus-4.6</span>
        <span>设计系统 WorkspaceX UI</span>
        <span>{TEMPLATE_LABEL[project.template]}</span>
        <span className="ml-auto">{project.ownerName ?? "—"} · 更新于 {new Date(project.updatedAt).toLocaleDateString("zh-CN")}</span>
      </footer>

      {confirming && (
        <PushConfirm
          project={project}
          busy={pushBusy}
          error={pushError}
          onClose={() => { if (!pushBusy) { setConfirming(false); setPushError(null); } }}
          onConfirm={(note) => void confirmPush(note)}
        />
      )}
    </div>
  );
}

function DetailTab({ active, onClick, children, testid }: { active: boolean; onClick: () => void; children: React.ReactNode; testid: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "rounded-t-control px-3 py-1.5 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-b-2 border-primary font-medium text-background-foreground" : "border-b-2 border-transparent text-muted-foreground hover:text-background-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PushConfirm({
  project, busy, error, onClose, onConfirm,
}: {
  project: DesignProject;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="design-push-confirm">
      <div className="absolute inset-0 bg-inverse/50" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="推送到收件箱" className="relative flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-5 text-card-foreground shadow-lg">
        <h3 className="text-16 font-semibold">推送「{project.name}」到收件箱</h3>
        <p className="text-12 text-muted-foreground">
          推送后会在运营收件箱生成一条「设计方案」条目（待处理），供工程排期。
          {project.linkedFeedbackId !== null && " 来源反馈会被标注「已生成」。"}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="push-note" className="text-11 font-medium text-muted-foreground">给工程的说明（可选）</label>
          <Textarea id="push-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={busy} placeholder="需要工程特别注意的边界、依赖、验收口径" data-testid="design-push-note" />
        </div>
        {error !== null && (
          <p className="text-11 text-destructive" data-testid="design-push-error" role="alert">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(note)} disabled={busy} data-testid="design-push-confirm-submit">
            {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
            确认推送
          </Button>
        </div>
      </div>
    </div>
  );
}

function PushSuccess({ project, code, onOpenInbox, onNextDesign }: { project: DesignProject; code: string; onOpenInbox?: () => void; onNextDesign?: () => void }) {
  return (
    <div className="dark flex h-dvh flex-col items-center justify-center gap-4 bg-background p-16 text-center text-background-foreground" data-testid="design-push-success">
      <CheckCircle2 aria-hidden className="h-14 w-14 text-success" />
      <div>
        <p className="text-20 font-semibold">已推送到收件箱</p>
        <p className="mt-1 text-13 text-muted-foreground">
          方案 <span className="font-mono">{code}</span> · {project.name}
          {project.linkedFeedbackId !== null && <> · 已与来源反馈互相关联</>}
        </p>
      </div>
      <p className="max-w-sm text-12 text-muted-foreground">
        运营会在收件箱看到这条待处理的设计方案，排期后进入开发。你可以继续设计下一个，或去收件箱确认。
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onNextDesign} data-testid="design-success-next">继续设计下一个</Button>
        <Button variant="primary" size="sm" onClick={onOpenInbox} data-testid="design-success-inbox">查看收件箱</Button>
      </div>
    </div>
  );
}
