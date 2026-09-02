"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { X, Bug, Lightbulb, Check, Loader2, ThumbsUp, Mic, ImagePlus } from "lucide-react";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { useAsrDraft } from "@/lib/use-asr-draft";
import {
  FEEDBACK_KINDS,
  currentAppVersion,
  fetchFeedbackAttachmentObjectUrl,
  listFeedback,
  structureFeedbackDraft,
  submitFeedback,
  uploadFeedbackAttachment,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackTarget,
} from "@/lib/live-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 契约 `submitFeedback.in.attachmentIds` 的上限（`.max(4)`）——见 `feedback-loop.ts`。 */
const MAX_ATTACHMENTS = 4;

/**
 * 把一次失败翻译成人能读的一句话。
 *
 * ⚠ `TypeError: Failed to fetch` 是浏览器对「请求根本没拿到响应」的统一措辞——服务端正在
 *   重启、网络断了、反代把连接切了，浏览器一律只给这一句英文。原样显示给用户等于什么都
 *   没说。2026-09-02 devapp 实测：一次部署重启窗口里点提交/传图，屏上就是这行英文，
 *   看起来像功能坏了，实际是那一分钟里服务端不在。这里把它翻成「无法连接服务器」并
 *   建议稍后重试；带 `reasonCode` 的契约错误照旧原样给出（那些才是功能层面的失败）。
 */
function describeFailure(err: unknown): string {
  if (err instanceof ApiError) return err.reasonCode ?? `http_${err.status}`;
  if (err instanceof TypeError) return "无法连接服务器（可能正在部署或网络中断），请稍后重试";
  return String(err);
}

/**
 * FB-2 —— 提交反馈的弹层。**两个标签页：提交 / 我提过的。**
 *
 * ## 为什么「我提过的」和提交表单在同一个弹层里
 *
 * 反馈的死法从来不是「没人提」，是「提了没人答，于是没人再提」。
 * 把状态放在一个需要另找入口才能看到的地方，等于没有答复。
 * 提交完成后本弹层**自动切到这个标签页**——提交人立刻看到自己那条排在第一行、
 * 状态是「待处理」，而不是一个 toast 闪过之后什么都没留下。
 *
 * ## 上下文是**显式展示**的，不是偷偷带上的
 *
 * 「将附带：当前页面 X · 版本 Y」这行字是设计的一部分（I-F1）。
 * 一个悄悄收集当前路由的表单，和一个说明自己收集了什么的表单，
 * 在功能上一样、在信任上不一样。
 *
 * ## 未登录/接口不可用时，弹层**如实显示失败**，不假装提交成功
 *
 * 乐观提交在这里是有害的：反馈是一次性的表达，用户以为提交成功就不会再提第二次。
 * 所以先等服务端，成功了才切标签页（同 `message-rating.tsx` 的第 ② 条纪律）。
 */

const KIND_ICON: Record<FeedbackKind, typeof Bug> = { 缺陷: Bug, 需求: Lightbulb };

const STATUS_TONE: Record<FeedbackStatus, "warning" | "ai" | "primary" | "neutral"> = {
  待处理: "warning",
  已进入迭代: "ai",
  已修复: "primary",
  不做: "neutral",
};

const TITLE_MAX = 120;
const DETAIL_MAX = 4000;

/**
 * FB-5——一张待提交的图片附件。`previewUrl` 是**本地** `URL.createObjectURL(file)`，
 * 不是后端下载地址：上传成功之前后端还没有这个字节，上传成功之后也没必要再多打
 * 一次下载请求去显示一张浏览器已经有原始 `File` 的图——同 `fetchFeedbackAttachmentObjectUrl`
 * 只用于「我提过的」列表里回看**别的**（已经离开这次会话的）反馈的既有附件。
 */
interface PendingAttachment {
  readonly localId: string;
  readonly file: File;
  readonly previewUrl: string;
  readonly status: "uploading" | "done" | "failed";
  readonly attachmentId?: string;
  readonly error?: string;
}

function targetHeading(target: FeedbackTarget, label: string | null): string {
  if (target.kind === "product") return "对产品提反馈";
  const noun = target.kind === "agent" ? "Agent" : "Skill";
  // ⚠ 名字缺失时退回 id，**不写「未命名」**：反馈要能被分诊的人对上具体对象，
  //   一个 id 不好看但准确，「未命名」好看但指向不了任何东西。
  const shown = label ?? (target.kind === "agent" ? target.agentId : target.skillId);
  return `对 ${noun}「${shown}」提反馈`;
}

export function FeedbackDialog({
  target,
  targetLabel,
  onClose,
}: {
  target: FeedbackTarget;
  targetLabel: string | null;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [tab, setTab] = React.useState<"submit" | "mine">("submit");
  const [kind, setKind] = React.useState<FeedbackKind>("缺陷");
  const [title, setTitle] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = React.useState<string | null>(null);

  // FB-5——语音草稿。`voiceTranscript` 是转录**过程中**的原文，只用来在停止录音那一刻
  // 喂给 `structureFeedbackDraft`；转录本身不直接写进 `detail`，因为口述常常语序不通顺，
  // "说完自动填表单、人工再改"是人类明确要的交互（见文件头此前的设计签核记录）。
  const [voiceTranscript, setVoiceTranscript] = React.useState("");
  const [structuring, setStructuring] = React.useState(false);
  const [structureError, setStructureError] = React.useState<string | null>(null);
  const wasRecordingRef = React.useRef(false);

  // FB-5——图片附件。见 `PendingAttachment` 头注：上传发生在"选择文件"那一刻，
  // 不是"点提交"那一刻——用户可能边说边贴图，提交时只是把已经攒好的 id 列表带上。
  const [attachments, setAttachments] = React.useState<readonly PendingAttachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const appVersion = currentAppVersion();
  const titleRef = React.useRef<HTMLInputElement>(null);

  const speech = useAsrDraft({
    getBaseText: () => voiceTranscript,
    onTranscript: setVoiceTranscript,
    sessionToken: getStoredSessionToken() ?? "",
  });

  // 录音真正结束（回到 idle，且此前确实录过）——这一刻才把整段转录交给
  // `structureFeedbackDraft` 整理。不是每次 partial 更新都调，那样会打爆这条元任务接口。
  React.useEffect(() => {
    if (speech.listening || speech.connecting || speech.stopping) {
      wasRecordingRef.current = true;
      return;
    }
    if (!wasRecordingRef.current) return;
    wasRecordingRef.current = false;
    const transcript = voiceTranscript.trim();
    if (transcript === "") return;
    setStructuring(true);
    setStructureError(null);
    structureFeedbackDraft(transcript)
      .then((draft) => {
        setKind(draft.kind);
        setTitle(draft.title);
        setDetail(draft.detail);
      })
      .catch((err) => {
        setStructureError(describeFailure(err));
      })
      .finally(() => setStructuring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在录音状态的边沿触发，voiceTranscript 只在触发那一刻读一次快照。
  }, [speech.listening, speech.connecting, speech.stopping]);

  // 弹层关闭/卸载时释放本地预览的 object URL，不留内存泄漏。
  React.useEffect(() => {
    return () => {
      for (const a of attachments) URL.revokeObjectURL(a.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在卸载时跑一次，用最新的 attachments 靠 ref 语义（数组引用变化本来就该重新挂 cleanup）。
  }, [attachments]);

  // 一张图的上传（首次与「重试」共用同一条路径）。⚠ 重试用的是当初选中的那个 `File`，
  // 不要求用户重新打开文件选择器——部署重启那种一分钟的失败窗口过后，点一下就能补上。
  const runUpload = React.useCallback((localId: string, file: File) => {
    setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, status: "uploading", error: undefined } : a)));
    uploadFeedbackAttachment(file)
      .then((out) => {
        setAttachments((prev) =>
          prev.map((a) => (a.localId === localId ? { ...a, status: "done", attachmentId: out.attachmentId } : a)),
        );
      })
      .catch((err) => {
        const reason = describeFailure(err);
        setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, status: "failed", error: reason } : a)));
      });
  }, []);

  const addAttachments = React.useCallback((files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) return;
    const picked = Array.from(files).slice(0, room);
    for (const file of picked) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      setAttachments((prev) => [...prev, { localId, file, previewUrl, status: "uploading" }]);
      runUpload(localId, file);
    }
  }, [attachments.length, runUpload]);

  const removeAttachment = React.useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Esc 关闭。⚠ 挂在 window 上而不是容器上：焦点可能在遮罩、也可能在某个输入框里，
  // 容器级监听会因为焦点跑到 portal 之外而漏掉按键。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const attachmentsUploading = attachments.some((a) => a.status === "uploading");
  const canSubmit = title.trim() !== "" && detail.trim() !== "" && !busy && !attachmentsUploading;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const attachmentIds = attachments
        .filter((a): a is PendingAttachment & { attachmentId: string } => a.status === "done" && a.attachmentId !== undefined)
        .map((a) => a.attachmentId);
      // ⚠ 没有附件时**不带这个键**（不是传 `attachmentIds: undefined`）——同文件头「请求体
      //   恰好几个字段」的既有纪律：多一个值为 undefined 的键，`JSON.stringify` 之后看不出
      //   区别，但 `Object.keys` 断言与任何按键名做的中间层处理都会看出区别。
      const out = await submitFeedback({
        kind,
        target,
        title: title.trim(),
        detail: detail.trim(),
        // I-F1：发生位置由客户端给——服务端不可能知道用户站在哪一屏。
        occurredRoute: pathname ?? null,
        appVersion,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
      setJustSubmitted(out.feedbackId);
      setTitle("");
      setDetail("");
      for (const a of attachments) URL.revokeObjectURL(a.previewUrl);
      setAttachments([]);
      setVoiceTranscript("");
      setTab("mine");
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="feedback-dialog-backdrop">
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="提交反馈"
        data-testid="feedback-dialog"
        className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border p-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-14 font-semibold" data-testid="feedback-dialog-title">
              {targetHeading(target, targetLabel)}
            </h2>
            <p className="mt-0.5 text-11 text-muted-foreground">
              提了会有人看：每条反馈都有状态与去向，在「我提过的」里跟进。
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭" data-testid="feedback-dialog-close">
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex gap-1 border-b border-border px-4 pt-2" role="tablist">
          <TabButton active={tab === "submit"} onClick={() => setTab("submit")} testid="feedback-tab-submit">
            提交
          </TabButton>
          <TabButton active={tab === "mine"} onClick={() => setTab("mine")} testid="feedback-tab-mine">
            我提过的
          </TabButton>
        </div>

        {tab === "submit" ? (
          <div className="flex flex-col gap-3 overflow-y-auto p-4" data-testid="feedback-form">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-11 font-medium text-muted-foreground">这是什么</legend>
              <div className="flex gap-1.5">
                {FEEDBACK_KINDS.map((k) => {
                  const Icon = KIND_ICON[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                      data-testid={`feedback-kind-${k}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-12 transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        kind === k
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-card-foreground hover:bg-muted",
                      )}
                    >
                      <Icon aria-hidden className="h-3.5 w-3.5" />
                      {k}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1">
              <span className="text-11 font-medium text-muted-foreground">
                一句话说清楚 <span className="font-normal">（{title.length}/{TITLE_MAX}）</span>
              </span>
              <input
                ref={titleRef}
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === "缺陷" ? "点了没反应 / 显示的数字不对…" : "希望能记住上次的选择…"}
                data-testid="feedback-title-input"
                className="h-8 rounded-md border border-border-subtle bg-panel px-2 text-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-11 font-medium text-muted-foreground">
                详细说说 <span className="font-normal">（{detail.length}/{DETAIL_MAX}）</span>
              </span>
              <textarea
                value={detail}
                maxLength={DETAIL_MAX}
                onChange={(e) => setDetail(e.target.value)}
                rows={5}
                placeholder={
                  kind === "缺陷"
                    ? "你当时在做什么、期望看到什么、实际看到什么。"
                    : "你想解决的是什么问题？现在是怎么绕过去的？"
                }
                data-testid="feedback-detail-input"
                className="resize-y rounded-md border border-border-subtle bg-panel p-2 text-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            {/* FB-5——语音输入。说完自动整理成标题/正文，人工再改，不直接替用户点提交。 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={speech.listening ? "destructive" : "outline"}
                  size="sm"
                  className="gap-1"
                  data-testid="feedback-voice-button"
                  aria-pressed={speech.listening}
                  disabled={speech.connecting || speech.stopping || structuring}
                  onClick={() => (speech.listening ? speech.stop() : speech.start())}
                >
                  {speech.connecting || speech.stopping || structuring ? (
                    <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mic aria-hidden className="h-3.5 w-3.5" />
                  )}
                  {speech.connecting ? "正在连接…"
                    : speech.stopping ? "正在停止…"
                    : structuring ? "AI 整理中…"
                    : speech.listening ? "停止说话" : "说一段话，AI 帮你整理"}
                </Button>
                {speech.listening && (
                  <span className="text-10 text-muted-foreground" data-testid="feedback-voice-live-transcript">
                    {voiceTranscript.trim() === "" ? "在听…" : voiceTranscript}
                  </span>
                )}
              </div>
              {speech.error !== null && (
                <p className="text-11 text-destructive" data-testid="feedback-voice-error">{speech.error}</p>
              )}
              {structureError !== null && (
                <p className="text-11 text-destructive" data-testid="feedback-structure-error">
                  没能把这段话整理成表单（{structureError}）。你说的话还在——可以自己填标题和正文。
                </p>
              )}
            </div>

            {/* FB-5——图片附件。2026-09-02：这一轮**没有脱敏**（人类明确裁决先出功能），
                见后端 `upload-feedback-attachment.ts` 头注——已知限制，不是遗漏。 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  data-testid="feedback-attachment-input"
                  onChange={(e) => {
                    addAttachments(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={attachments.length >= MAX_ATTACHMENTS}
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="feedback-attachment-add"
                >
                  <ImagePlus aria-hidden className="h-3.5 w-3.5" />
                  加图片（{attachments.length}/{MAX_ATTACHMENTS}）
                </Button>
              </div>
              {attachments.length > 0 && (
                <ul className="flex flex-wrap gap-2" data-testid="feedback-attachment-list">
                  {attachments.map((a) => (
                    <li key={a.localId} className="flex w-16 flex-col items-center gap-0.5" data-testid={`feedback-attachment-${a.localId}`}>
                      <div className="relative h-16 w-16">
                        {/* eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图（同 chat-attachment-preview-modal.tsx 既有先例） */}
                        <img
                          src={a.previewUrl}
                          alt=""
                          className={cn(
                            "h-16 w-16 rounded-md border border-border-subtle object-cover",
                            a.status === "failed" && "opacity-40",
                          )}
                        />
                        {a.status === "uploading" && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-inverse/30">
                            <Loader2 aria-hidden className="h-4 w-4 animate-spin text-white" />
                          </div>
                        )}
                        <button
                          type="button"
                          aria-label="移除这张图片"
                          data-testid={`feedback-attachment-remove-${a.localId}`}
                          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-inverse text-inverse-foreground"
                          onClick={() => removeAttachment(a.localId)}
                        >
                          <X aria-hidden className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      {a.status === "failed" && (
                        <>
                          {/* 错误全文放 title；行内只留一行截断——64px 宽的缩略图下面放不下一整句。 */}
                          <p
                            className="w-16 truncate text-9 text-destructive"
                            title={a.error}
                            data-testid={`feedback-attachment-error-${a.localId}`}
                          >
                            {a.error}
                          </p>
                          <button
                            type="button"
                            className="text-9 text-primary underline-offset-2 transition-colors duration-fast hover:underline"
                            data-testid={`feedback-attachment-retry-${a.localId}`}
                            onClick={() => runUpload(a.localId, a.file)}
                          >
                            重试上传
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* I-F1：收集了什么，明写出来。见文件头。 */}
            <p className="text-10 text-muted-foreground" data-testid="feedback-context-notice">
              将一并附带：当前页面 <code className="font-mono">{pathname ?? "（未知）"}</code>
              {appVersion === null ? " · 版本未知" : ` · 版本 ${appVersion}`} · 你的账号。
              {" "}正文只有组织管理员和你自己能看到。
            </p>

            {error !== null && (
              <p className="text-11 text-destructive" data-testid="feedback-submit-error">
                没能提交（{error}）。这条反馈没有被保存，可以再试一次。
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!canSubmit}
                onClick={() => void send()}
                data-testid="feedback-submit"
              >
                {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                提交
              </Button>
            </div>
          </div>
        ) : (
          <MyFeedbackList highlightId={justSubmitted} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active, onClick, children, testid,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testid: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "rounded-t-md px-3 py-1.5 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-b-2 border-primary font-medium text-card-foreground"
          : "border-b-2 border-transparent text-muted-foreground hover:text-card-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 「我提过的」。
 *
 * ⚠ 空态说的是「你还没提过」，**不是**「暂无数据」——后者读起来像加载失败。
 * ⚠ 加载失败**不退化成空列表**：一个因为断网而空的列表，与一个真的什么都没有的
 *   列表，在界面上必须分得开，否则用户会以为自己提的那条丢了。
 */
function MyFeedbackList({ highlightId }: { highlightId: string | null }) {
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "ready"; items: readonly FeedbackItem[] } | { kind: "failed"; reason: string }
  >({ kind: "loading" });

  const load = React.useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", items: await listFeedback({ kind: "mine" }) });
    } catch (err) {
      setState({ kind: "failed", reason: describeFailure(err) });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <p className="p-4 text-12 text-muted-foreground" data-testid="feedback-mine-loading">正在读取…</p>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="flex flex-col items-start gap-2 p-4" data-testid="feedback-mine-failed">
        <p className="text-12 text-muted-foreground">
          没能读到你提过的反馈（{state.reason}）。它们没有丢，只是这次没取到。
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()}>重试</Button>
      </div>
    );
  }
  if (state.items.length === 0) {
    return (
      <p className="p-4 text-12 text-muted-foreground" data-testid="feedback-mine-empty">
        你还没提过反馈。
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5 overflow-y-auto p-4" data-testid="feedback-mine-list">
      {state.items.map((item) => (
        <li
          key={item.id}
          data-testid={`feedback-mine-item-${item.id}`}
          className={cn(
            "flex flex-col gap-1 rounded-md border p-2.5",
            item.id === highlightId ? "border-primary bg-ai-tint/30" : "border-border-subtle bg-panel",
          )}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
            <Badge tone="outline">{item.kind}</Badge>
            <span className="min-w-0 flex-1 truncate text-12 font-medium">{item.title}</span>
            <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
              <ThumbsUp aria-hidden className="h-3 w-3" />
              {item.votes}
            </span>
            {item.id === highlightId && (
              <span className="inline-flex items-center gap-1 text-11 text-primary" data-testid="feedback-just-submitted">
                <Check aria-hidden className="h-3 w-3" />
                刚提交
              </span>
            )}
          </div>
          {/* 提交人对自己那条恒可见正文（D3），所以这里 detail 必然非 null；
              仍然写成条件渲染而不是 `item.detail!`——一个断言在契约变化时会静默地
              变成运行时崩溃，而条件渲染只是少显示一行。 */}
          {item.detail !== null && (
            <p className="whitespace-pre-wrap text-11 text-muted-foreground">{item.detail}</p>
          )}
          {/* 附件与正文同一条 D3 门控（见后端 `list-feedback.ts` 头注）——`attachments`
              非空必然伴随 `detail` 非空，这里不再重复判一次 detail！==null。 */}
          {item.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" data-testid={`feedback-mine-attachments-${item.id}`}>
              {item.attachments.map((a) => (
                <li key={a.id}>
                  <AttachmentThumbnail url={a.url} />
                </li>
              ))}
            </ul>
          )}
          {item.statusReason !== null && (
            <p className="text-11 text-card-foreground" data-testid={`feedback-status-reason-${item.id}`}>
              处理说明：{item.statusReason}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 「我提过的」列表里的一张附件缩略图——同 `fetchAvatarObjectUrl` 的既有先例：下载路由
 * 要求 `Authorization` 头，`<img src>` 带不了，所以先 `fetch` 取字节再转 `Blob URL`。
 */
function AttachmentThumbnail({ url }: { url: string }) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    fetchFeedbackAttachmentObjectUrl(url)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        created = u;
        setObjectUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (created !== null) URL.revokeObjectURL(created);
    };
  }, [url]);

  if (failed) {
    return <div className="flex h-12 w-12 items-center justify-center rounded-md border border-border-subtle text-9 text-muted-foreground">?</div>;
  }
  if (objectUrl === null) {
    return <div className="h-12 w-12 animate-pulse rounded-md bg-muted" aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图（同 chat-attachment-preview-modal.tsx 既有先例）
  return <img src={objectUrl} alt="" className="h-12 w-12 rounded-md border border-border-subtle object-cover" />;
}
