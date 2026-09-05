"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X, Bug, Lightbulb, Check, Loader2, ThumbsUp, ImagePlus, FileText, PencilRuler, Maximize2, Minimize2, AlertTriangle, Pause } from "lucide-react";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { useAsrDraft } from "@/lib/use-asr-draft";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";
import { useComposerVoiceSession, SILENCE_AUTO_PAUSE_AFTER_SECONDS } from "@/lib/use-composer-voice-session";
import { ComposerVoiceControl, formatElapsed } from "@/components/chat/chat-composer-voice-control";
import { ComposerStatusBar, type ComposerStatusAction } from "@/components/chat/chat-composer-status-bar";
import {
  FEEDBACK_ATTACHMENT_ACCEPT,
  FEEDBACK_ATTACHMENT_LIMIT,
  FEEDBACK_KINDS,
  createFeedbackDraft,
  currentAppVersion,
  fetchFeedbackAttachmentObjectUrl,
  isImageAttachmentMime,
  listFeedback,
  resolveFeedbackAttachmentMime,
  structureFeedbackDraft,
  submitFeedback,
  uploadFeedbackAttachment,
  type FeedbackAttachmentMime,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackStructured,
  type FeedbackTarget,
} from "@/lib/live-feedback";
import { FeedbackStructuredView, STRUCTURED_FIELDS } from "./feedback-structured";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/files/overlay";
import { cn } from "@/lib/utils";

/** 附件上限与类型白名单都从契约来（UC-17.8 D3），本文件不写第二份。 */
const MAX_ATTACHMENTS = FEEDBACK_ATTACHMENT_LIMIT;

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

/**
 * UC-17.8 D1 —— 结构化字段随 `submitFeedback.structured` **单独**发送，不再并进正文
 * （原型期 `composeDetail` 把字段拼进正文的做法已撤）。字段集与键名见
 * `feedback-structured.tsx` 的 `STRUCTURED_FIELDS`（键 = 契约 `BugStructuredFields` /
 * `ReqStructuredFields` 的键）。全空 ⇒ 不带 `structured` 键（同 `attachmentIds` 先例）。
 */
export function buildStructured(kind: FeedbackKind, fields: Record<string, string>): FeedbackStructured | undefined {
  const out: Record<string, string> = {};
  for (const f of STRUCTURED_FIELDS[kind]) {
    const v = (fields[f.key] ?? "").trim();
    if (v !== "") out[f.key] = v;
  }
  return Object.keys(out).length === 0 ? undefined : (out as FeedbackStructured);
}

const STATUS_TONE: Record<FeedbackStatus, "warning" | "ai" | "primary" | "neutral"> = {
  待处理: "warning",
  已进入迭代: "ai",
  已修复: "primary",
  不做: "neutral",
  已归档: "neutral",
};

const TITLE_MAX = 120;
const DETAIL_MAX = 4000;

/**
 * 「套用模板」——常见 issue 模板的复现步骤/期望结果/实际结果结构，按 `kind` 分两套。
 * 仓库里没有 `.github/ISSUE_TEMPLATE/`（见勘探），这里按业界通行的 bug/需求 issue
 * 模板结构写死；用户点按钮后填进「详细说说」，自己把占位内容替换掉。
 */
const FEEDBACK_TEMPLATES: Record<FeedbackKind, string> = {
  缺陷: "复现步骤：\n1. \n2. \n3. \n\n期望结果：\n\n\n实际结果：\n",
  需求: "背景 / 想解决的问题：\n\n\n期望的效果：\n\n\n现在是怎么绕过去的：\n",
};

/**
 * 2026-09-02 人类要求：表单去掉「一句话说清楚」，只留「详细说说」。契约的 `title` 仍然
 * 必填（`.min(1).max(120)`，后台列表靠它），所以标题从正文**派生**：AI 整理过就用 AI 给的
 * 标题；否则取正文第一句（到第一个句号/换行为止），截到 120 字。这里不发明第二个字段。
 */
export function deriveFeedbackTitle(detail: string): string {
  const firstLine = detail.trim().split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const firstSentence = firstLine.split(/[。！？!?]/)[0] ?? "";
  const picked = (firstSentence.trim() !== "" ? firstSentence : firstLine).trim();
  return picked.slice(0, TITLE_MAX);
}

/**
 * FB-5——一张待提交的图片附件。`previewUrl` 是**本地** `URL.createObjectURL(file)`，
 * 不是后端下载地址：上传成功之前后端还没有这个字节，上传成功之后也没必要再多打
 * 一次下载请求去显示一张浏览器已经有原始 `File` 的图——同 `fetchFeedbackAttachmentObjectUrl`
 * 只用于「我提过的」列表里回看**别的**（已经离开这次会话的）反馈的既有附件。
 */
interface PendingAttachment {
  readonly localId: string;
  readonly file: File;
  /** UC-17.8 D3：经 `resolveFeedbackAttachmentMime` 解出的真实类型，上传时原样带上。 */
  readonly mime: FeedbackAttachmentMime;
  /** 图片才有本地预览；PDF/文本没有 blob 缩略图，用文件类型图标 + 文件名。 */
  readonly previewUrl: string | null;
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
  onDraftSaved,
}: {
  target: FeedbackTarget;
  targetLabel: string | null;
  onClose: () => void;
  /**
   * 存草稿成功后的去向。缺省 = 关弹层并跳 `/platform-admin/feedback-drafts`；
   * 取材页（`/preview/feedback-design-loop`）传一个不导航的回调好把「已存草稿」回执拍下来。
   */
  onDraftSaved?: (draftId: string) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [tab, setTab] = React.useState<"submit" | "mine">("submit");
  /** 弹层默认是一个居中的卡片，内容多（review 阶段的字段 + 附件 + 语音）时容易顶到 85vh 上限
   * 反复滚动，看起来"挤"。加一个全屏切换：用户自己决定要不要把弹层撑满视口，
   * 不是默认就全屏（大多数反馈很短，居中卡片够用，默认全屏反而显得突兀）。 */
  const [fullscreen, setFullscreen] = React.useState(false);
  /**
   * issue #2679 ②——渐进式展示：一开始只有「详细说说」一个框 + 语音输入，不把
   * 「这是什么／复现频率／期望结果／实际结果／复现步骤」等字段一次性摊开。用户写完
   * 正文（或说完一段话）点「下一步」，AI 把这段话结构化成 kind/title/结构化字段
   * （复用已有的 `structureFeedbackDraft`，与语音路径同一个用例），进入 `review`
   * 阶段——这时候才展示这些字段，用户可以看着改，改完再真正提交。AI 结构化失败
   * 也照样进 `review`（用 `deriveFeedbackTitle` 兜底当标题），不拿"整理失败"挡住
   * "我要看到并填写这些字段"这个诉求——两件事不该互相卡住。
   */
  const [stage, setStage] = React.useState<"compose" | "review">("compose");
  const [kind, setKind] = React.useState<FeedbackKind>("缺陷");
  const [detail, setDetail] = React.useState("");
  /** review 阶段可编辑的标题；compose 阶段还没有标题概念。 */
  const [title, setTitle] = React.useState("");
  /** UC-17.8 D1 结构化补充字段，键 = 契约字段名（`STRUCTURED_FIELDS`）。 */
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [draftSaved, setDraftSaved] = React.useState(false);
  const [draftBusy, setDraftBusy] = React.useState(false);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = React.useState<string | null>(null);

  // FB-5——语音。**与 chat composer 同一套交互**（人类 2026-09-02 实测反馈：转录文字
  // 没有出来）：转录一边说一边**实时写进「详细说说」**（`getBaseText`/`onTranscript`
  // 与 composer 的 textarea 完全同型），用户始终看得见自己说的话；停止之后再把这段
  // 文字交给 `structureFeedbackDraft` 整理成标题/正文——整理失败，原话还在框里，
  // 不会"说了半天什么都没出来"。此前的做法是把转录存在一个只在录音中才显示的
  // 小字里、停止后才去整理，整理慢或失败时屏上就是空的。
  const [structuring, setStructuring] = React.useState(false);
  const [structureError, setStructureError] = React.useState<string | null>(null);
  const detailRef = React.useRef("");
  detailRef.current = detail;

  // FB-5——图片附件。见 `PendingAttachment` 头注：上传发生在"选择文件"那一刻，
  // 不是"点提交"那一刻——用户可能边说边贴图，提交时只是把已经攒好的 id 列表带上。
  const [attachments, setAttachments] = React.useState<readonly PendingAttachment[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  /** 图片区域正被拖着东西悬停——只用来切一下描边样式，不影响能不能放（`addAttachments` 自己会截到上限）。 */
  const [dragOver, setDragOver] = React.useState(false);
  /** issue #2679 ③——点开预览用：待提交附件的本地 blob URL，或「我提过的」列表里已加载出的 blob URL。 */
  const [preview, setPreview] = React.useState<{ url: string; name: string } | null>(null);

  const appVersion = currentAppVersion();
  const detailInputRef = React.useRef<HTMLTextAreaElement>(null);

  // issue #2679 ①——麦克风设备选择。复用 chat composer 同一套 hook（`wsx.micDeviceId`，
  // 记的是全站唯一一份选择，不在这里另开一份），只在开始录音那一刻把 `deviceId` 交给
  // `useAsrDraft`（同 chat composer 的既有边界：选择是纯 UI 状态，使用才触达采音层）。
  const micDevices = useAudioInputDevices();
  const speech = useAsrDraft({
    getBaseText: () => detailRef.current,
    onTranscript: (fullText) => setDetail(fullText),
    sessionToken: getStoredSessionToken() ?? "",
    deviceId: micDevices.selectedDeviceId ?? undefined,
  });
  /**
   * 2026-09-04 人类反馈：这里的录音/转录体验要与 chat composer 看齐——不是重新发明
   * 一套（此前的 `VoiceRecordingBar` 是自己攒的一颗胶囊，视觉与状态机都是本文件独有的
   * 一份）。composer 那套「分段胶囊按钮 + 底部状态栏」（暂停/继续/静音提示/转录后
   * 可撤销）已经在 `use-composer-voice-session.ts` / `chat-composer-voice-control.tsx` /
   * `chat-composer-status-bar.tsx` 里落成可复用的 hook + 组件，这里直接复用同一份，
   * 而不是维护第二套「录音怎么显示」的规则——同一件事只该有一处实现。
   */
  const voice = useComposerVoiceSession(speech, {
    setDraft: (text) => setDetail(text),
    getDraft: () => detailRef.current,
  });

  // 录音真正「完成」（`voice.phase` 落到 `done`——composer 语义下的「转录后编辑」态，
  // 用户点了「说完了/停止」而不是「暂停」或「丢弃」）——这一刻才把整段转录交给
  // `structureFeedbackDraft` 整理。不是每次 partial 更新都调，那样会打爆这条元任务接口；
  // 也不是每次「暂停」都调——暂停之后用户可能还要继续说，此时结构化字段还没到齐。
  const prevVoicePhaseRef = React.useRef(voice.phase);
  React.useEffect(() => {
    const prev = prevVoicePhaseRef.current;
    prevVoicePhaseRef.current = voice.phase;
    if (prev === voice.phase) return;
    if (voice.phase !== "done") return;
    const transcript = detailRef.current.trim();
    if (transcript === "") return;
    setStructuring(true);
    setStructureError(null);
    structureFeedbackDraft(transcript)
      .then((draft) => {
        setKind(draft.kind);
        setTitle(draft.title);
        setDetail(draft.detail);
        // UC-17.8 B2.4：模型按 kind 拆出的结构化字段非 null 才填进对应输入框；null ⇒ 只填正文。
        if (draft.structured != null) {
          const filled: Record<string, string> = {};
          for (const [k, v] of Object.entries(draft.structured)) if (typeof v === "string") filled[k] = v;
          setFields(filled);
        }
      })
      .catch((err) => {
        setStructureError(describeFailure(err));
        // 整理失败也进 review：转录已经在「详细说说」里，标题退回派生规则，
        // 用户自己能看到并填写各字段，不必被"AI 没整理成功"卡住。
        setTitle(deriveFeedbackTitle(transcript));
      })
      .finally(() => {
        setStructuring(false);
        setStage("review");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 `voice.phase` 落到 done 的边沿触发，正文只在触发那一刻读一次快照（ref）。
  }, [voice.phase]);

  /**
   * 录音状态栏——与 chat composer 同一份文案/操作模式（`copilotkit-v2-panel-body.tsx`
   * 的 `composerStatusBar` 计算），只是砍掉本弹层用不到的两态（`stopping` 这里合并进
   * "整理中" 展示、`agent.isRunning`/附件上传中那两条属于 chat 场景不适用）。
   * `done` 态本弹层不需要单独一条状态栏——「已转录」之后紧接着就是 `structuring`
   * 把它整理进 review 阶段的字段，用户看到的是字段本身，不是再多一条「已转录 N 字」。
   */
  const voiceStatusBar: React.ReactNode = (() => {
    const chars = voice.transcribedChars;
    if (voice.phase === "connecting") {
      return (
        <ComposerStatusBar tone="neutral" testId="feedback-voice-connecting" icon={<Loader2 className="h-4 w-4 animate-spin" />}
          title="正在连接语音识别" description="请稍候，正在申请麦克风并建立连接"
          actions={[{ label: "取消", onClick: voice.discard, testId: "feedback-voice-cancel" }]} />
      );
    }
    if (voice.phase === "listening" && voice.silenceHint) {
      return (
        <ComposerStatusBar tone="warning" testId="feedback-voice-listening" icon={<AlertTriangle className="h-4 w-4" />}
          title={`${voice.silentSeconds} 秒未听到声音`}
          description={`请靠近麦克风，或换一个设备${voice.autoPause ? ` · 静音 ${SILENCE_AUTO_PAUSE_AFTER_SECONDS} 秒后自动暂停` : ""}`}
          actions={[
            { label: "换麦克风", onClick: voice.requestDeviceMenu, testId: "feedback-voice-switch-device" },
            { label: "停止", onClick: voice.finish, variant: "solid-destructive", testId: "feedback-voice-stop" },
          ]} />
      );
    }
    if (voice.phase === "listening") {
      return (
        <ComposerStatusBar tone="destructive" testId="feedback-voice-listening"
          icon={<span className="h-2 w-2 animate-pulse rounded-pill bg-destructive" />}
          title={`正在听 ${formatElapsed(voice.totalSeconds)}`}
          description={`文字实时写入「详细说说」 · 已 ${chars} 字 · 说完点「停止」`}
          actions={[
            { label: "暂停", onClick: voice.pause, testId: "feedback-voice-pause" },
            { label: "停止", onClick: voice.finish, variant: "solid-destructive", testId: "feedback-voice-stop" },
          ]} />
      );
    }
    if (voice.phase === "stopping" || structuring) {
      return (
        <ComposerStatusBar tone="neutral" testId="feedback-voice-stopping" icon={<Loader2 className="h-4 w-4 animate-spin" />}
          title={voice.phase === "stopping" ? "正在停止" : "AI 整理中…"}
          description={voice.phase === "stopping" ? "等待最后一段转录落定" : undefined} />
      );
    }
    if (voice.phase === "paused") {
      return (
        <ComposerStatusBar tone="neutral" testId="feedback-voice-paused" icon={<Pause className="h-4 w-4" />}
          title={`已暂停 ${formatElapsed(voice.totalSeconds)}`}
          description={`已转录 ${chars} 字 · 继续录音会接在后面`}
          actions={[
            { label: "丢弃", onClick: voice.discard, testId: "feedback-voice-cancel" },
            { label: "继续", onClick: voice.start, testId: "feedback-voice-resume" },
            { label: "完成", onClick: voice.finish, variant: "solid", testId: "feedback-voice-finish" },
          ]} />
      );
    }
    if (voice.phase === "error") {
      const denied = speech.status === "denied";
      const unsupported = speech.status === "unsupported";
      const actions: ComposerStatusAction[] = [];
      if (denied) {
        actions.push({
          label: "查看如何开启",
          onClick: () => window.open("https://support.google.com/chrome/answer/2693767", "_blank", "noopener"),
          testId: "feedback-voice-permission-help",
        });
      }
      if (!unsupported) actions.push({ label: "重试", onClick: voice.start, variant: "solid", testId: "feedback-voice-retry" });
      return (
        <ComposerStatusBar tone="warning" testId="feedback-voice-error" icon={<AlertTriangle className="h-4 w-4" />}
          title={denied ? "浏览器未授权麦克风" : unsupported ? "此浏览器不支持语音输入" : "语音识别暂时不可用"}
          description={denied ? "在地址栏左侧的站点设置中允许麦克风，然后重试" : speech.error}
          actions={actions} />
      );
    }
    return null;
  })();

  // 弹层关闭/卸载时释放本地预览的 object URL，不留内存泄漏。
  React.useEffect(() => {
    return () => {
      for (const a of attachments) if (a.previewUrl !== null) URL.revokeObjectURL(a.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在卸载时跑一次，用最新的 attachments 靠 ref 语义（数组引用变化本来就该重新挂 cleanup）。
  }, [attachments]);

  // 一张图的上传（首次与「重试」共用同一条路径）。⚠ 重试用的是当初选中的那个 `File`，
  // 不要求用户重新打开文件选择器——部署重启那种一分钟的失败窗口过后，点一下就能补上。
  const runUpload = React.useCallback((localId: string, file: File, mime: FeedbackAttachmentMime) => {
    setAttachments((prev) => prev.map((a) => (a.localId === localId ? { ...a, status: "uploading", error: undefined } : a)));
    uploadFeedbackAttachment(file, mime)
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

  /** 被拒收的文件名（类型不在契约白名单）；再选一次或改正文就清掉。 */
  const [rejectedFiles, setRejectedFiles] = React.useState<readonly string[]>([]);

  const addAttachments = React.useCallback((files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) return;
    // UC-17.8 D3：客户端预检——类型不在契约白名单的文件**不上传**，并逐个点名说明。
    //   不是静默丢掉：用户拖了一个 zip 进来没反应，会以为是功能坏了。
    const rejected: string[] = [];
    const accepted: { file: File; mime: FeedbackAttachmentMime }[] = [];
    for (const file of Array.from(files)) {
      const mime = resolveFeedbackAttachmentMime(file);
      if (mime === null) rejected.push(file.name);
      else accepted.push({ file, mime });
    }
    setRejectedFiles(rejected);
    for (const { file, mime } of accepted.slice(0, room)) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewUrl = isImageAttachmentMime(mime) ? URL.createObjectURL(file) : null;
      setAttachments((prev) => [...prev, { localId, file, mime, previewUrl, status: "uploading" }]);
      runUpload(localId, file, mime);
    }
  }, [attachments.length, runUpload]);

  const removeAttachment = React.useCallback((localId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target && target.previewUrl !== null) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.localId !== localId);
    });
  }, []);

  /** 剩余空间放不下完整模板时，说给用户听的一句话；套用成功或改了正文就清掉。 */
  const [templateNotice, setTemplateNotice] = React.useState<string | null>(null);

  /**
   * 把模板填进「详细说说」。正文是空的（或全是空白）就直接换成模板；已经写了点东西，
   * 追加在后面而不是覆盖——点错了不该把用户已经写的话吞掉。
   *
   * ⚠ 剩余空间不够放下**完整**模板时**不插入半截**——半截模板（比如「复现步骤：
   * 1. 」在第十个字被切断）看不出结构，用户会以为自己点坏了，比不给还糟。这里改成
   * 拒绝这次操作并如实说明，正文原样不动，不是静默截断。
   */
  const applyTemplate = React.useCallback(() => {
    const template = FEEDBACK_TEMPLATES[kind];
    if (detail.trim() === "") {
      setDetail(template);
      setTemplateNotice(null);
    } else {
      const merged = `${detail}\n\n${template}`;
      if (merged.length > DETAIL_MAX) {
        setTemplateNotice(
          `正文剩下的空间放不下完整模板（还差 ${merged.length - DETAIL_MAX} 字）。先删一点，或者手动照着「复现步骤/期望结果/实际结果」写。`,
        );
        return; // 正文原样不动
      }
      setDetail(merged);
      setTemplateNotice(null);
    }
    detailInputRef.current?.focus();
  }, [kind, detail]);

  React.useEffect(() => {
    detailInputRef.current?.focus();
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
  // detail.length 上限也在这里判——不只依赖 textarea 的 maxLength（那只挡键入/粘贴，
  // 挡不住 setDetail 之类的程序化写入，见 applyTemplate 头注），提交前有第二道闸。
  const canSubmit = title.trim() !== "" && detail.trim() !== "" && detail.length <= DETAIL_MAX && !busy && !attachmentsUploading;

  const uploadedAttachmentIds = () =>
    attachments
      .filter((a): a is PendingAttachment & { attachmentId: string } => a.status === "done" && a.attachmentId !== undefined)
      .map((a) => a.attachmentId);

  const resetForm = () => {
    setTitle("");
    setDetail("");
    setFields({});
    setStage("compose");
    for (const a of attachments) if (a.previewUrl !== null) URL.revokeObjectURL(a.previewUrl);
    setAttachments([]);
  };

  /**
   * issue #2679 ②——compose → review 的过渡。正文交给 `structureFeedbackDraft`
   * 整理出 kind/title/结构化字段（打字路径与语音路径此前各走各的：语音有整理、
   * 打字只在最终提交前顺手起个标题——这里让打字路径也在**进入 review 之前**整理，
   * 用户才看得到"AI 猜的分类/字段对不对"，而不是一步submit到底看不见）。
   * 整理失败不挡住"看到并编辑这些字段"这个诉求，退回 `deriveFeedbackTitle` 兜底、
   * 照样进 review——同语音路径失败时的既有处置（见上方 useEffect）。
   */
  const proceedToReview = async () => {
    const text = detail.trim();
    if (text === "") return;
    setStructuring(true);
    setStructureError(null);
    try {
      const draft = await structureFeedbackDraft(text);
      setKind(draft.kind);
      setTitle(draft.title);
      setDetail(draft.detail);
      if (draft.structured != null) {
        const filled: Record<string, string> = {};
        for (const [k, v] of Object.entries(draft.structured)) if (typeof v === "string") filled[k] = v;
        setFields(filled);
      }
    } catch (err) {
      setStructureError(describeFailure(err));
      setTitle(deriveFeedbackTitle(text));
    } finally {
      setStructuring(false);
      setStage("review");
    }
  };

  /**
   * UC-17.8 B1：「存为草稿」走真栈 `createFeedbackDraft`。成功 ⇒ 清空表单、去草稿列表；
   * 失败 ⇒ 明说「草稿没有被保存」且**不清空**（同直接提交的 V3 纪律：用户以为存上了就不会再存第二次）。
   */
  const saveDraft = async () => {
    setDraftBusy(true);
    setDraftError(null);
    try {
      const attachmentIds = uploadedAttachmentIds();
      const structured = buildStructured(kind, fields);
      const out = await createFeedbackDraft({
        kind,
        target,
        detail: detail.trim(),
        occurredRoute: pathname ?? null,
        appVersion,
        ...(structured !== undefined ? { structured } : {}),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      });
      resetForm();
      setDraftSaved(true);
      if (onDraftSaved) {
        onDraftSaved(out.draftId);
      } else {
        onClose();
        router.push("/platform-admin/feedback-drafts");
      }
    } catch (err) {
      setDraftError(describeFailure(err));
    } finally {
      setDraftBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      // issue #2679 ②：进 review 之前已经跑过一次 `structureFeedbackDraft`（打字走
      // `proceedToReview`，语音走上方 `useEffect`），`title` 是那次结果（或其失败兜底
      // `deriveFeedbackTitle`），用户在 review 阶段还可能手改过——这里直接用当下的
      // `title` 状态，不再于提交时二次调用同一个 AI 用例（此前 issue #2638 加的那次
      // "打字路径顺手起标题"已经被 review 阶段的整理覆盖，留着会多打一次不必要的请求）。
      const finalTitle = title.trim();
      const attachmentIds = uploadedAttachmentIds();
      const structured = buildStructured(kind, fields);
      // ⚠ 没有附件 / 结构化字段全空时**不带这个键**（不是传 `undefined`）——同文件头「请求体
      //   恰好几个字段」的既有纪律：多一个值为 undefined 的键，`JSON.stringify` 之后看不出
      //   区别，但 `Object.keys` 断言与任何按键名做的中间层处理都会看出区别。
      const out = await submitFeedback({
        kind,
        target,
        title: finalTitle,
        detail: detail.trim(),
        // I-F1：发生位置由客户端给——服务端不可能知道用户站在哪一屏。
        occurredRoute: pathname ?? null,
        appVersion,
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        ...(structured !== undefined ? { structured } : {}),
      });
      setJustSubmitted(out.feedbackId);
      resetForm();
      setTab("mine");
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn("fixed inset-0 z-50 flex items-center justify-center", fullscreen ? "p-0" : "p-4")}
      data-testid="feedback-dialog-backdrop"
    >
      <div className="absolute inset-0 bg-inverse/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="提交反馈"
        data-testid="feedback-dialog"
        data-fullscreen={fullscreen}
        className={cn(
          "relative flex w-full flex-col overflow-hidden border-border bg-card shadow-lg",
          fullscreen ? "h-full max-w-none rounded-none border-0" : "h-[min(85vh,54rem)] max-w-2xl rounded-lg border",
        )}
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
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFullscreen((v) => !v)}
              aria-label={fullscreen ? "退出全屏" : "全屏"}
              data-testid="feedback-dialog-fullscreen-toggle"
            >
              {fullscreen ? <Minimize2 aria-hidden className="h-4 w-4" /> : <Maximize2 aria-hidden className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="关闭" data-testid="feedback-dialog-close">
              <X aria-hidden className="h-4 w-4" />
            </Button>
          </div>
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
          <div className="flex flex-col gap-3 overflow-y-auto p-4" data-testid="feedback-form" data-stage={stage}>
            {/* issue #2679 ②——review 阶段才展示「这是什么」与结构化字段（复现频率/期望结果/
                实际结果/复现步骤……）；compose 阶段只有正文框 + 语音，见文件顶部 `stage` 头注。 */}
            {stage === "review" && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-11 text-muted-foreground" data-testid="feedback-review-hint">
                    AI 帮你整理好了下面这些，看看对不对，改完再提交。
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="shrink-0 text-11 text-muted-foreground"
                    onClick={() => setStage("compose")}
                    data-testid="feedback-back-to-compose"
                  >
                    ← 返回重新说
                  </Button>
                </div>

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

                {/* issue #2679 ②——review 阶段才有的可编辑标题；契约 `title` 必填，
                    此前一直是从正文派生、不给编辑入口，这里让用户能直接看到并改。 */}
                <label className="flex flex-col gap-1 text-11 font-medium text-muted-foreground">
                  标题 <span className="font-normal">（{title.length}/{TITLE_MAX}）</span>
                  <input
                    value={title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                    data-testid="feedback-title-input"
                    className="rounded-md border border-border-subtle bg-panel px-2 py-1 text-13 text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>

                {/* UC-17.8 D1 结构化字段集：随类型切换，随 `structured` 单独发送；留空则不带键。 */}
                <fieldset className="flex flex-col gap-2" data-testid={kind === "缺陷" ? "feedback-fields-bug" : "feedback-fields-req"}>
                  <legend className="text-11 font-medium text-muted-foreground">
                    {kind === "缺陷" ? "说清楚这个缺陷" : "说清楚这个需求"}
                  </legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {STRUCTURED_FIELDS[kind].map((f) => {
                      const shared = {
                        value: fields[f.key] ?? "",
                        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                          setFields((prev) => ({ ...prev, [f.key]: e.target.value }));
                          setDraftSaved(false);
                        },
                        "data-testid": `feedback-field-${f.testid}`,
                        className: "rounded-md border border-border-subtle bg-panel px-2 py-1 text-12 text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      };
                      return (
                        <label key={f.key} className={cn("flex flex-col gap-1 text-10 text-muted-foreground", f.multiline && "sm:col-span-3")}>
                          {f.label}
                          {f.multiline ? <textarea rows={3} {...shared} /> : <input {...shared} />}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </>
            )}

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="feedback-detail-input" className="text-11 font-medium text-muted-foreground">
                  详细说说 <span className="font-normal">（{detail.length}/{DETAIL_MAX}）</span>
                </label>
                {/* 按当前 kind 套用对应模板（复现步骤/期望结果/实际结果，或需求版）；已有内容不覆盖，追加在后面。
                    compose 阶段还没有 kind/结构化字段的概念，模板按钮跟着挪到 review 阶段。 */}
                {stage === "review" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="gap-1 text-11 text-muted-foreground"
                    onClick={applyTemplate}
                    data-testid="feedback-template-button"
                  >
                    <FileText aria-hidden className="h-3 w-3" />
                    套用模板
                  </Button>
                )}
              </div>
              <textarea
                id="feedback-detail-input"
                ref={detailInputRef}
                value={detail}
                maxLength={DETAIL_MAX}
                onChange={(e) => { setDetail(e.target.value); setTemplateNotice(null); }}
                rows={stage === "compose" ? 8 : 6}
                placeholder={
                  stage === "compose"
                    ? "说说是什么问题——什么都行，先写下来或说出来，下一步 AI 会帮你整理成标题、复现步骤这些字段。"
                    : kind === "缺陷"
                      ? "你当时在做什么、期望看到什么、实际看到什么。第一句会作为标题。"
                      : "你想解决的是什么问题？现在是怎么绕过去的？第一句会作为标题。"
                }
                data-testid="feedback-detail-input"
                className="resize-y rounded-md border border-border-subtle bg-panel p-2 text-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {templateNotice !== null && (
                <p className="text-11 text-destructive" data-testid="feedback-template-notice">{templateNotice}</p>
              )}
            </div>

            {/* FB-5——语音输入：**复用 chat composer 同一套组件**（分段胶囊按钮 + 底部状态栏），
                不再是本文件自己攒的一份，见上方 `voice` hook 头注。 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-11 text-muted-foreground">
                  说一段话，边说边转成文字，说完 AI 帮你整理成标题、复现步骤这些字段。
                </p>
                <ComposerVoiceControl
                  status={speech.status}
                  phase={voice.phase}
                  elapsedSeconds={voice.totalSeconds}
                  level={speech.level}
                  disabled={structuring}
                  onStart={voice.start}
                  onStop={voice.finish}
                  onResume={voice.start}
                  // 本弹层不像 chat composer 那样必须先有一条会话线程才谈得上"录音"——
                  // 未登录时点开始，`useAsrDraft` 自然会在真正连接时报出鉴权失败
                  // （同它此前的既有行为），这里不重复加一道前置拦截。
                  onRequireSession={() => true}
                  devices={micDevices.devices}
                  selectedDeviceId={micDevices.selectedDeviceId}
                  onSelectDevice={micDevices.select}
                  autoPause={voice.autoPause}
                  onAutoPauseChange={voice.setAutoPause}
                  deviceMenuRequest={voice.deviceMenuRequest}
                />
              </div>
              {voiceStatusBar !== null && (
                <div className="overflow-hidden rounded-md">{voiceStatusBar}</div>
              )}
              {structureError !== null && (
                <p className="text-11 text-destructive" data-testid="feedback-structure-error">
                  没能把这段话整理成表单（{structureError}）。你说的话已经在「详细说说」里——可以自己改标题和正文。
                </p>
              )}
            </div>

            {stage === "compose" ? (
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={detail.trim() === "" || structuring}
                  onClick={() => void proceedToReview()}
                  data-testid="feedback-proceed-review"
                >
                  {structuring && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                  下一步
                </Button>
              </div>
            ) : (
            <>
            {/* FB-5——附件。2026-09-02：这一轮**没有脱敏**（人类明确裁决先出功能），
                见后端 `upload-feedback-attachment.ts` 头注——已知限制，不是遗漏。
                2026-09-03：加拖拽上传——点按钮和拖拽是同一条 `addAttachments` 路径，
                只是触发方式不同，上传时机、上限、失败重试都不用另写一遍。
                UC-17.8 D3：类型放宽到契约 `FeedbackAttachmentMime`（图片 + PDF + 纯文本/Markdown），
                `accept` 与预检都从它派生。 */}
            <div
              className={cn(
                "flex flex-col gap-1.5 rounded-md border border-dashed p-2 transition-colors",
                dragOver ? "border-primary bg-ai-tint/20" : "border-transparent",
              )}
              data-testid="feedback-attachment-dropzone"
              onDragOver={(e) => {
                if (attachments.length >= MAX_ATTACHMENTS) return;
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addAttachments(e.dataTransfer.files);
              }}
            >
              {/* UC-17.8 R4.1：达到 5 个上限后，整个上传入口**隐藏**（不是置灰）。 */}
              {attachments.length < MAX_ATTACHMENTS ? (
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={FEEDBACK_ATTACHMENT_ACCEPT}
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
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="feedback-attachment-add"
                  >
                    <ImagePlus aria-hidden className="h-3.5 w-3.5" />
                    加文件（{attachments.length}/{MAX_ATTACHMENTS}）
                  </Button>
                  <span className="text-10 text-muted-foreground">或把文件拖拽到这里</span>
                </div>
              ) : (
                <p className="text-10 text-muted-foreground" data-testid="feedback-attachment-full">已到 {MAX_ATTACHMENTS} 个上限，删掉一个再加。</p>
              )}
              {rejectedFiles.length > 0 && (
                <p className="text-10 text-destructive" data-testid="feedback-attachment-rejected">
                  {rejectedFiles.join("、")}：不支持的文件类型，没有上传。只收图片、PDF、纯文本/Markdown。
                </p>
              )}
              {attachments.length > 0 && (
                <ul className="flex flex-wrap gap-2" data-testid="feedback-attachment-list">
                  {attachments.map((a) => (
                    <li key={a.localId} className="flex w-16 flex-col items-center gap-0.5" data-testid={`feedback-attachment-${a.localId}`}>
                      <div className="relative h-16 w-16">
                        {a.previewUrl !== null ? (
                          // issue #2679 ③——点开预览，不再是一张点不动的静态缩略图。
                          // `type="button"` 包一层：缩略图本身也在承担「移除」按钮的定位上下文，
                          // 点击区域与右上角的 X 分得开，不会互相抢事件。
                          <button
                            type="button"
                            className="block h-16 w-16 overflow-hidden rounded-md"
                            onClick={() => setPreview({ url: a.previewUrl!, name: a.file.name })}
                            aria-label={`预览 ${a.file.name}`}
                            data-testid={`feedback-attachment-open-${a.localId}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图（同 chat-attachment-preview-modal.tsx 既有先例） */}
                            <img
                              src={a.previewUrl}
                              alt=""
                              loading="lazy"
                              className={cn(
                                "h-16 w-16 border border-border-subtle object-cover",
                                a.status === "failed" && "opacity-40",
                              )}
                            />
                          </button>
                        ) : (
                          // PDF / 文本没有 blob 预览：文件类型图标 + 文件名（UC-17.8 D3）。
                          <div
                            className={cn(
                              "flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-border-subtle bg-panel p-1",
                              a.status === "failed" && "opacity-40",
                            )}
                            data-testid={`feedback-attachment-file-${a.localId}`}
                            title={a.file.name}
                          >
                            <FileText aria-hidden className="h-5 w-5 text-muted-foreground" />
                            <span className="w-full truncate text-center text-9 text-muted-foreground">{a.file.name}</span>
                          </div>
                        )}
                        {a.status === "uploading" && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-inverse/30">
                            <Loader2 aria-hidden className="h-4 w-4 animate-spin text-white" />
                          </div>
                        )}
                        <button
                          type="button"
                          aria-label="移除这个附件"
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
                            onClick={() => runUpload(a.localId, a.file, a.mime)}
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
            {draftError !== null && (
              <p className="text-11 text-destructive" data-testid="feedback-draft-error">
                没能存草稿（{draftError}）。草稿没有被保存，你写的还在，可以再试一次。
              </p>
            )}
            {draftSaved && (
              <p className="text-11 text-primary" data-testid="feedback-draft-saved">
                已存为草稿。在「反馈草稿」里继续完善，想清楚了再提交到收件箱。
              </p>
            )}

            {/* 底部左：更复杂的直接去工作台；右：存草稿 / 直接提交。
                UC-17.8 B6.1：「去 PM 设计工作台」是纯路由跳转——工作台 B4.5 起真栈化，
                原型 mock store（曾用 Provider 是否在场判这条入口可见）已删，链接恒可见。 */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href="/platform-admin/design-workbench"
                data-testid="feedback-workbench-link"
                className="inline-flex items-center gap-1 text-11 text-primary transition-colors duration-fast hover:underline"
              >
                <PencilRuler aria-hidden className="h-3 w-3" />
                更复杂？直接在 PM 设计工作台从头设计
              </Link>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
                {/* UC-17.8 B1：存草稿是真栈（不依赖 mock Provider）。草稿允许空正文（契约
                    `createFeedbackDraft.in.detail` 无 `.min(1)`），但一个什么都没写的草稿没有意义，
                    这里仍要求正文非空——「先占个位」由用户写第一句来占。 */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canSubmit || draftBusy}
                  onClick={() => void saveDraft()}
                  data-testid="feedback-save-draft"
                >
                  {draftBusy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : draftSaved ? <Check aria-hidden className="h-3.5 w-3.5" /> : null}
                  {draftSaved ? "已存草稿" : "存为草稿"}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!canSubmit}
                  onClick={() => void send()}
                  data-testid="feedback-submit"
                >
                  {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                  直接提交
                </Button>
              </div>
            </div>
            </>
            )}
          </div>
        ) : (
          <MyFeedbackList highlightId={justSubmitted} />
        )}
      </div>
      {/* issue #2679 ③——点开待提交附件的预览；本地 blob URL 已经在浏览器里，不需要再发请求。 */}
      {preview !== null && (
        <Modal
          testid="feedback-attachment-preview"
          title={preview.name}
          onClose={() => setPreview(null)}
          width="lg"
        >
          <div className="grid min-h-[240px] place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图 */}
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[60vh] max-w-full rounded-md object-contain"
              data-testid="feedback-attachment-preview-image"
            />
          </div>
        </Modal>
      )}
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
        "-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary font-medium text-card-foreground"
          : "border-transparent text-muted-foreground hover:text-card-foreground",
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
    <ul className="flex flex-col gap-1 overflow-y-auto p-3" data-testid="feedback-mine-list">
      {state.items.map((item) => (
        <li
          key={item.id}
          data-testid={`feedback-mine-item-${item.id}`}
          className={cn(
            "flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5",
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
              变成运行时崩溃，而条件渲染只是少显示一行。
              issue #2637 ②——列表太长、单条太高：正文原来是不限行数的
              `whitespace-pre-wrap`，一条几百字的反馈能把整个列表撑到只剩一两条可见。
              这里收成最多两行（`line-clamp-2`），看全文回「提交」标签页自己那条记录，
              或者本来就在这条反馈的详情里——列表的职责是"扫一眼状态"，不是"重读一遍"。 */}
          {item.detail !== null && item.detail.trim() !== "" && (
            <p className="line-clamp-2 text-11 text-muted-foreground" title={item.detail}>{item.detail}</p>
          )}
          {/* UC-17.8 D1：结构化字段与正文同一条 D3 门控，null 不渲染区块。 */}
          <FeedbackStructuredView kind={item.kind} structured={item.structured} testid={`feedback-mine-structured-${item.id}`} compact />
          {/* 附件与正文同一条 D3 门控（见后端 `list-feedback.ts` 头注）——`attachments`
              非空必然伴随 `detail` 非空，这里不再重复判一次 detail！==null。
              issue #2637 ②——缩略图默认全加载：`AttachmentThumbnail` 内部已经改成
              进入视口才发起下载（见其头注），这里只是把尺寸从 48px 降到 36px，
              配合更矮的行高。 */}
          {item.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1" data-testid={`feedback-mine-attachments-${item.id}`}>
              {item.attachments.map((a) => (
                <li key={a.id}>
                  <AttachmentThumbnail url={a.url} />
                </li>
              ))}
            </ul>
          )}
          {item.statusReason !== null && (
            <p className="line-clamp-1 text-11 text-card-foreground" title={item.statusReason} data-testid={`feedback-status-reason-${item.id}`}>
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
 *
 * issue #2637 ②——人类实测反馈"默认图片加载慢"：根因不是图片本身大，是**一次性**：
 * 列表一渲染，`state.items` 里每一条的每一张附件都立刻各发一个带鉴权的 `fetch`，
 * 一条有十几条历史反馈、每条带几张图时，这十几个并发下载会互相抢带宽，先看到的
 * 反而是最下面暂时看不到的那几张图先跑完、上面能看到的反而在排队。这里加一个
 * `IntersectionObserver`：缩略图卡片先占位（骨架屏），真正滚进视口那一刻才发起
 * 下载——不在视口里的图片压根不占这次的网络与内存。观察者一旦命中一次就断开
 * （`once: true` 语义），不需要持续监听一张已经加载完的图。
 */
function AttachmentThumbnail({ url }: { url: string }) {
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [inView, setInView] = React.useState(false);
  // issue #2679 ③——点开预览，用的是同一份已经在骨架屏加载完的 objectUrl，
  // 点开不再多发一次请求（既有 `useAuthedImageSrc` 那套惯例：一份字节，多处复用）。
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const node = rootRef.current;
    if (node === null) return;
    // 环境没有 IntersectionObserver（极老浏览器/测试环境）——退化为立即加载，
    // 而不是永远占位不出结果。
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }, // 提前一点点触发，滚到眼前时图已经在路上，不是刚开始加载。
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!inView) return;
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
  }, [inView, url]);

  return (
    <div ref={rootRef} className="h-9 w-9">
      {failed ? (
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle text-9 text-muted-foreground">?</div>
      ) : objectUrl === null ? (
        <div className="h-9 w-9 animate-pulse rounded-md bg-muted" aria-hidden />
      ) : (
        <>
          <button
            type="button"
            className="block h-9 w-9 overflow-hidden rounded-md border border-border-subtle"
            onClick={() => setOpen(true)}
            aria-label="预览附件"
            data-testid="feedback-mine-attachment-open"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图（同 chat-attachment-preview-modal.tsx 既有先例） */}
            <img src={objectUrl} alt="" loading="lazy" className="h-9 w-9 object-cover" />
          </button>
          {open && (
            <Modal testid="feedback-mine-attachment-preview" title="附件预览" onClose={() => setOpen(false)} width="lg">
              <div className="grid min-h-[240px] place-items-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- blob URL，不是可优化的远程图 */}
                <img src={objectUrl} alt="" className="max-h-[60vh] max-w-full rounded-md object-contain" data-testid="feedback-mine-attachment-preview-image" />
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}

