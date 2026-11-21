"use client";

/** Shared canonical composer surface. Controllers keep all transport, voice, permission and queue state. */
import { chatComposerSurface } from "@/components/chat/chat-composer-style";
import { useContext } from "react";
import { cn } from "@/lib/utils";

import { useI18n } from "@/lib/i18n/provider";
import { ComposerStatusBar } from "./chat-composer-status-bar";
import { QueuedMessagesPanel } from "@/components/chat/workbench/queued-messages-panel";
import { QueueNextTurnAction } from "@/components/chat/workbench/queue-next-turn-action";
import { ChildCancellationNotice } from "@/components/chat/workbench/child-cancellation-notice";
import { Loader2, ArrowUp, Paperclip, PenLine, Square } from "lucide-react";
import { ComposerVoiceControl } from "@/components/chat/chat-composer-voice-control";
import { ComposerIconButton } from "@/components/chat/chat-composer-icon-button";
import { appendTranscript } from "@/lib/use-asr-draft";
import { FocusedSkillNameContext } from "./copilotkit-v2-agent-identity";
import { CapabilityPicker } from "@/components/chat/chat-task-workbench-capability-picker";
import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";
import { ChatComposerAttachmentStrip } from "@/components/chat/chat-composer-attachments";
import { Button } from "@/components/ui/button";
import type { CopilotKitV2PanelViewProps } from "@/components/chat/copilotkit-v2-panel-body";

export type NativeChatComposerProps = Pick<CopilotKitV2PanelViewProps, "EMPTY_INPUT_REASON" | "actingAgentId" | "agent" | "agentOptions" | "archived" | "attach" | "attachDisabled" | "attachOpen" | "canWrite" | "cancellation" | "composerInputRef" | "composerMirrorRef" | "emptySendHint" | "flashEmptySendHint" | "initialChatThreadId" | "inputDraft" | "interjectPending" | "micDevices" | "onComposerScroll" | "onSelectAgent" | "onSkillMentionMounted" | "orgId" | "recomputeMention" | "runIsRunning" | "selectedAgentId" | "send" | "sendDisabled" | "sendDisabledReason" | "sendWhileRunning" | "serverQueue" | "sessionToken" | "setAttachOpen" | "setEmptySendHint" | "setError" | "setInputDraft" | "setMountedSkillsCount" | "setSkillOpenRequest" | "setSkillTrigger" | "skillMention" | "skillOpenRequest" | "skillTrigger" | "speech" | "threadId" | "voice">;

export function NativeChatComposer({EMPTY_INPUT_REASON, actingAgentId, agent, agentOptions, archived, attach, attachDisabled, attachOpen, canWrite, cancellation, composerInputRef, composerMirrorRef, emptySendHint, flashEmptySendHint, initialChatThreadId, inputDraft, interjectPending, micDevices, onComposerScroll, onSelectAgent, onSkillMentionMounted, orgId, recomputeMention, runIsRunning, selectedAgentId, send, sendDisabled, sendDisabledReason, sendWhileRunning, serverQueue, sessionToken, setAttachOpen, setEmptySendHint, setError, setInputDraft, setMountedSkillsCount, setSkillOpenRequest, setSkillTrigger, skillMention, skillOpenRequest, skillTrigger, speech, threadId, voice}: NativeChatComposerProps): JSX.Element {
  const focusedSkill = useContext(FocusedSkillNameContext);
  const { t } = useI18n();
  const dictating = speech.listening || speech.connecting;
return (<div
          className={cn(
            chatComposerSurface,
            "flex flex-col transition-colors duration-fast",
            // 2026-09-08 人类反馈（真栈截图）「选中的时候，不要有新的边框出来，就保持就可以了」——
            // 去掉 `focus-within:border-primary/60`：聚焦前后外框颜色一致，光标本身就是焦点提示。
            archived && "bg-disabled",
          )}
          data-testid="chat-task-workbench-composer"
          data-voice-phase={voice.phase}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2">
            {/*
              issue #3373 —— 待发附件住进 composer 卡片内部、输入框正上方，视觉上属于
              「我正在写的这条消息」；此前它是浮在卡片上方的一张独立宽卡片，图片没有缩略图、
              点了也不能预览。渲染件换成 `ChatComposerAttachmentStrip`（紧凑 chip + 真实缩略图
              + 点击放大预览），吃的仍是同一个 `attach` 控制器、同一条 pending 队列——
              没有第二份状态（#3346 的缺陷形状），只是换了个渲染。

              归档线程也照样渲染（不再 `archived ? null`），按 #3347 的约定禁用并写出理由：
              一条已归档的线程若还留着没发出去的附件，直接让它凭空消失比禁用更难理解。
            */}
            {attach.attachments.length > 0 ? (
              <div className="order-first min-w-0 basis-full">
                <ChatComposerAttachmentStrip
                  ctl={attach}
                  canRetry={canWrite && !archived}
                  disabled={archived || agent.isRunning}
                  disabledReason={archived ? t("chatComposer.archivedAttachments") : undefined}
                />
              </div>
            ) : null}
            {agentOptions.status === "error" ? (
              <span className="order-first basis-full text-11 text-destructive" data-testid="copilotkit-v2-agent-options-error">
                {agentOptions.message}
                <button
                  type="button"
                  className="ml-1 underline"
                  data-testid="copilotkit-v2-agent-options-retry"
                  onClick={agentOptions.retry}
                >
                  {t("ui.retry")}
                </button>
              </span>
            ) : null}
            {agentOptions.status === "ready" && agentOptions.agents.length === 0 ? (
              <span className="order-first basis-full text-11 text-muted-foreground" data-testid="copilotkit-v2-no-agents-hint">
                {t("chatComposer.noAgentsBefore")}
                <a href="/platform-admin/agent" className="mx-1 text-primary underline">{t("chatComposer.createAgent")}</a>
                {t("chatComposer.noAgentsAfter")}
              </span>
            ) : null}
            {/*
              转录方式（设计稿）：文字实时流入输入框——已确认为深色，识别中为浅灰并带光标。
              `textarea` 不能给一段文字单独上色，所以录音期间在它「底下」铺一层同字号的镜像
              （深色 = 基线 ⊕ 已落定，浅灰 = 识别中 + 闪烁光标），textarea 自己的文字透明；
              textarea 仍是真实值的唯一载体（e2e 读的是 `inputValue()`），镜像只是颜色。
            */}
            <div className="relative w-full basis-full lg:w-auto lg:min-w-32 lg:flex-1 lg:basis-0">
              {dictating ? (() => {
                const dark = appendTranscript(speech.baseText, speech.committedText);
                const full = appendTranscript(dark, speech.partialText);
                return (
                  <div
                    aria-hidden
                    ref={composerMirrorRef}
                    data-testid="chat-task-workbench-composer-live-transcript"
                    /* `overflow-hidden` 不给它自己的滚动条（滚动条归 `<textarea>`），
                       但 `scrollTop` 依旧可写——由 `syncComposerMirrorScroll` 跟随输入框。 */
                    className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-0.5 py-0.5 text-16 leading-relaxed"
                  >
                    <span className="text-card-foreground">{dark}</span>
                    <span className="text-muted-foreground">{full.slice(dark.length)}</span>
                    <span aria-hidden className="ml-px inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
                  </div>
                );
              })() : null}
              <textarea
                ref={composerInputRef}
                data-testid="copilotkit-v2-input"
                // issue #3022② —— 没有 `aria-label` 时可及名只能回落到 `placeholder`，而下面
                // 那个 placeholder 会随状态在三句话之间变（常态 / 运行中 / 归档）：屏幕阅读器
                // 读到的控件名会跟着状态变。名字与旧屏 `chat-live-message-panel.tsx` 逐字相同，
                // 迁移过来的 e2e 可以直接用回 `getByRole("textbox", { name: "消息内容" })`。
                aria-label={t("chatComposer.messageContent")}
                // 2026-09-08 人类反馈「这个框的高度，默认有一行就可以了」——默认 1 行，
                // 内容变多时由 `syncComposerHeight` 按 scrollHeight 自动长高（封顶
                // `COMPOSER_MAX_HEIGHT_PX`，超出后内部滚动）。
                rows={1}
                className={[
                  // 2026-09-08 人类反馈「选中的时候，不要有新的边框出来」——内层
                  // `<textarea>` 聚焦不再画任何 ring（`focus-visible:ring-0`），焦点由
                  // 外层卡片常驻边框 + 光标承载；`ring-0` 同时满足 `lint-design.sh`
                  // U7b（`outline-none` 须与 `focus-visible:ring-*` 同行）的机械判据。
                  "block w-full min-w-0 resize-none overflow-y-auto rounded-md bg-transparent px-0.5 py-0.5 text-16 leading-relaxed transition-colors duration-fast placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 disabled:text-disabled-foreground",
                  dictating ? "text-transparent caret-transparent" : "text-card-foreground",
                ].join(" ")}
                disabled={archived}
                placeholder={
                  archived
                    ? t("chatComposer.archived")
                    : dictating
                      ? ""
                      : runIsRunning
                        ? t("chatComposer.runningPlaceholder")
                        : t("chatComposer.placeholder")
                }
                value={inputDraft}
                // 录音期镜像层跟着输入框滚（否则透明文字滚了、可见文字不动）。
                onScroll={onComposerScroll}
                onChange={(e) => {
                  setInputDraft(e.target.value);
                  if (emptySendHint) setEmptySendHint(false);
                  // issue #2020 —— 与旧 composer 同一对挂点（onChange + onKeyUp）：
                  // 光标移动（方向键/点击）不触发 onChange，只有 onKeyUp 能覆盖。
                  recomputeMention(e.target.value, e.target.selectionStart);
                }}
                onKeyUp={(e) => recomputeMention(e.currentTarget.value, e.currentTarget.selectionStart)}
                onClick={(e) => recomputeMention(e.currentTarget.value, e.currentTarget.selectionStart)}
                onKeyDown={(e) => {
                  // issue #2130（TW-P0-5①）—— 纯 Enter 发送，Shift+Enter 换行；输入法拼字中的
                  // Enter（`isComposing`）是在确认候选词，不是要发送。
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    // 空输入按 Enter = 用户在试图发送：这一刻才把禁用理由亮出来（见 `emptySendHint`）。
                    if (sendDisabledReason === EMPTY_INPUT_REASON) { flashEmptySendHint(); return; }
                    // 其余禁用理由（录音中 / 归档 / 上传中 / 无写权限）：Enter 与发送按钮一致，一律不发。
                    if (sendDisabledReason !== null) return;
                    if (runIsRunning) { void sendWhileRunning(); return; }
                    void send();
                  }
                }}
              />
            </div>
            <div className="contents">
              {/* 左：三颗圆形图标按钮 + 已挂载 skill chip；`relative` 让技能候选浮层从这个角落向上开。 */}
              <div className="relative flex min-w-0 flex-wrap items-center gap-1.5 lg:order-first">
                <span data-testid="chat-task-workbench-composer-attach">
                  <ComposerIconButton
                    label={t("chatComposer.materials")}
                    title={sessionToken === null ? t("chatComposer.materialsLogin") : t("chatComposer.materials")}
                    data-testid="chat-attachment-input"
                    aria-haspopup="dialog"
                    aria-expanded={attachOpen}
                    disabled={attachDisabled}
                    badge={attach.attachments.length}
                    badgeTestId="chat-attachment-count"
                    onClick={() => setAttachOpen(true)}
                  >
                    <Paperclip aria-hidden className="h-4 w-4" />
                  </ComposerIconButton>
                </span>
                {/* issue #2130（TW-P0-5②「/技能」入口）—— 触发 `ChatSkillMountPanel` 的候选浮层；
                    新对话还没有线程时如实禁用（`data-placeholder-reason`），不渲染一个
                    "看起来能挂、提交必然 404"的假入口。输入框里敲 `/` 同样能打开。 */}
                {focusedSkill ? <span className="text-12 text-muted-foreground">{focusedSkill}</span> : <>
                <span data-testid="chat-task-workbench-composer-mention-skill">
                  <ComposerIconButton
                    label={t("chatComposer.skills")}
                    title={
                      initialChatThreadId === null || sessionToken === null
                        ? t("chatComposer.skillsUnavailable", { reason: sessionToken === null ? t("chatComposer.loginRequired") : t("chatComposer.conversationRequired") })
                        : skillTrigger.mountedCount > 0 ? t("chatComposer.skillsMounted", { count: skillTrigger.mountedCount }) : t("chatComposer.skillsHint")
                    }
                    data-testid="chat-skill-mount"
                    data-mounted-count={skillTrigger.mountedCount}
                    data-placeholder-reason={
                      sessionToken === null ? "login" : initialChatThreadId === null ? "no-thread" : undefined
                    }
                    aria-haspopup="listbox"
                    disabled={!canWrite || archived || initialChatThreadId === null || sessionToken === null || !skillTrigger.canOpen}
                    badge={skillTrigger.mountedCount}
                    onClick={() => setSkillOpenRequest((n) => n + 1)}
                  >
                    <PenLine aria-hidden className="h-4 w-4" />
                  </ComposerIconButton>
                </span>
                {/* issue #3440 —— composer 默认开关：打开后 PDF/Word/Excel/PPT 生成全程
                    零确认（清单之外的调用不受这个开关影响，见组件头注）。*/}
                {/* <DocumentGenerationAutoApproveToggle disabled={sessionToken === null} /> */}
                {/* issue #2770 —— 此处曾有 ✦「任务模式」与 ☑「每次都先计划」两颗开关，
                    见上方 state 区的头注：要不要先计划现在由内核自动判，不再要用户选。 */}
                {/* 2026-09-03（对照设计参照图收拢）—— 「能力：自动匹配」从卡片上方
                    独立一行并入工具行左组，与材料/技能同一排。此前
                    2026-09-02 的位置（卡片上方右对齐）是人类交付状态预览稿的像素级
                    要求；本次调整是另一轮直接人类指令，覆盖那次取舍，不是随手改动。
                    锚点与行为不变：`chat-task-workbench-composer-mention-agent` 外层
                    testid、`CapabilityPicker` 组件本体、`data-auto-match` 逐字保留。 */}
                <span data-testid="chat-task-workbench-composer-mention-agent">
                  <CapabilityPicker
                    listings={agentOptions.status === "ready" ? agentOptions.listings : null}
                    status={agentOptions.status === "ready" ? "ready" : agentOptions.status}
                    selectedAgentId={selectedAgentId}
                    onSelect={(agentId) => onSelectAgent(agentId)}
                    onListingsChanged={agentOptions.status === "ready" ? agentOptions.reload : undefined}
                    disabled={!canWrite || agentOptions.status !== "ready" || archived}
                  />
                </span>
                {initialChatThreadId !== null && orgId !== null && sessionToken !== null ? (
                  <ChatSkillMountPanel
                    variant="composer"
                    actingAgentId={actingAgentId}
                    threadId={initialChatThreadId}
                    orgId={orgId}
                    bearer={sessionToken}
                    mentionQuery={skillMention?.query ?? null}
                    /* issue #2046（CK-P2）——v2 轨道触发符 `/`（对齐 Claude Code），旧轨道缺省仍是 `#`。 */
                    mentionTriggerChar="/"
                    onMentionMounted={onSkillMentionMounted}
                    openRequest={skillOpenRequest}
                    onTriggerStateChange={setSkillTrigger}
                    onMountsChange={setMountedSkillsCount}
                  />
                ) : null}
                </>}
              </div>
              {/* 右：语音分段胶囊（唯一麦克风入口，设备菜单在它右侧箭头）+ 发送 / 停止。 */}
              <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
                {/* Temporarily hidden:
                <ChatRealtimeVoiceEntry
                  disabled={!canWrite || archived || agent.isRunning || sessionToken === null}
                  agent={selectedVoiceAgent}
                  resolveThreadId={voiceThread.resolveThreadId}
                  onEnded={voiceThread.onEnded}
                />
                */}
                <ComposerVoiceControl
                  status={speech.status}
                  phase={voice.phase}
                  reconnecting={speech.reconnecting}
                  elapsedSeconds={voice.totalSeconds}
                  level={speech.level}
                  disabled={!canWrite || archived || agent.isRunning}
                  onStart={voice.start}
                  onStop={voice.finish}
                  onResume={voice.start}
                  onRequireSession={() => {
                    if (sessionToken === null) {
                      setError({ key: "chatComposer.voiceLogin" });
                      return false;
                    }
                    return true;
                  }}
                  devices={micDevices.devices}
                  selectedDeviceId={micDevices.selectedDeviceId}
                  onSelectDevice={micDevices.select}
                  autoPause={voice.autoPause}
                  onAutoPauseChange={voice.setAutoPause}
                  inline={{
                    pause: voice.pause,
                    discard: voice.discard,
                    undo: voice.undo,
                    silenceHint: voice.silenceHint,
                    transcribedChars: voice.transcribedChars,
                    error: speech.error,
                    errorReason: speech.errorReason,
                  }}
                />
                <QueueNextTurnAction visible={runIsRunning && inputDraft.trim().length > 0} disabled={sendDisabled || interjectPending} onQueue={() => void sendWhileRunning({ forceQueue: true })} />
                {(runIsRunning || cancellation.requested) && canWrite && !archived && inputDraft.trim() === "" ? (
                  /* 设计稿：Agent 处理中，发送按钮变为「停止」（同一个位置、同一个锚点）。
                     `data-send-state="running"` 供 e2e 判"是否仍卡在运行中"，不再读 title。
                     2026-09-06：只在输入框为空时是「停止」——一旦用户敲了字，它就是「发送」
                     （运行中走 `sendWhileRunning`），否则 agent 问的「A/B」用户答不了。 */
                  <button
                    type="button"
                    data-testid="copilotkit-v2-send"
                    data-send-state="running"
                    aria-label={cancellation.requested ? t("chatComposer.stopping") : t("chatComposer.stopGeneration")}
                    title={cancellation.requested ? t("chatComposer.awaitStop") : t("chatComposer.stopGeneration")}
                    onClick={() => void cancellation.cancel()}
                    disabled={cancellation.requested || !cancellation.canCancel}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-border bg-panel-alt text-card-foreground transition-colors duration-fast hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {cancellation.requested ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <Square aria-hidden className="h-3 w-3 fill-current" />}
                  </button>
                ) : (
                  <Button
                    data-testid="copilotkit-v2-send"
                    data-send-state={sendDisabled ? "disabled" : "ready"}
                    type="button"
                    size="icon"
                    variant="primary"
                    className="shrink-0 rounded-pill"
                    disabled={sendDisabled || interjectPending}
                    title={sendDisabledReason ? t(sendDisabledReason) : t("chatComposer.send")}
                    aria-label={t("chatComposer.send")}
                    onClick={() => void (runIsRunning ? sendWhileRunning() : send())}
                  >
                    <ArrowUp aria-hidden className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          {attach.hasUploading && !archived ? (
            <ComposerStatusBar
              tone="neutral"
              testId="chat-task-workbench-composer-uploading"
              icon={<Loader2 className="h-4 w-4 animate-spin" />}
              title={t("chatComposer.uploading")}
              description={t("chatComposer.uploadingHint")}
            />
          ) : null}
          <ChildCancellationNotice text={cancellation.childNotice} />
          <QueuedMessagesPanel {...serverQueue} canWrite={canWrite} />
        </div>);
}
