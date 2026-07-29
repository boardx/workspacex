"use client";
import * as React from "react";
import { Mic, MicOff, Plus, AudioLines, Hand, Send, Sparkles, Radio, Check } from "lucide-react";
import { StateShell } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Avatar } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { GROUP_WORKBENCH, type Sticky, type GroupViewRole } from "@/lib/mock/entry";

/**
 * 小组工作台（档案第九节 C / UC-1.2 R8「小组工作台（已画）」）——只有本组的东西。
 *
 * 组长视角在组员之上多 `向引导师举手` `提交本组产出`（UC-1.4 四视角）。
 * 「提交本组产出」是**发布类危险动作**：二次确认 + 影响范围（锁定快照、引导师可见、本环节内不可再改）。
 * 麦克风开关**常驻可见**（转录中 / 已关闭），关掉不阻断任何文字类操作。
 */
export function GroupWorkbench({ state, role }: { state: UiState; role: GroupViewRole }) {
  const [micOn, setMicOn] = React.useState(true);
  const [stickies, setStickies] = React.useState<Sticky[]>(GROUP_WORKBENCH.stickies);
  const [draft, setDraft] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [handRaised, setHandRaised] = React.useState(false);
  const [fcAccepted, setFcAccepted] = React.useState(false);
  const localSeq = React.useRef(0);

  const pushSticky = (text: string) => {
    localSeq.current += 1;
    setStickies((s) => [...s, { id: `local-${localSeq.current}`, text, author: "参与者 B", mine: true }]);
  };

  const addSticky = () => {
    const text = draft.trim();
    if (!text) return;
    pushSticky(text);
    setDraft("");
  };

  // 「语音转便签」：把最近一段口头发言转成便签（原型 mock 一句转录文本，非真实 ASR）
  const addVoiceSticky = () => pushSticky("（语音转写）灯塔项目先免费改造，用背书换后续订单");

  // FC 主持建议 → 一键转便签
  const acceptFcSuggestion = () => {
    pushSticky("机会：把回本测算做进销售话术，德国业主更认落地数字");
    setFcAccepted(true);
  };

  // 广播条 + 麦克风常驻，任何状态都显示；内容区走七态
  const chrome = (
    <div className="flex flex-col gap-3">
      <div
        data-testid="group-broadcast"
        className="flex flex-wrap items-center gap-2 rounded-md border border-ai/20 bg-ai-tint p-3"
      >
        <Radio aria-hidden className="h-4 w-4 shrink-0 text-ai-tint-foreground" />
        <span className="text-12 font-medium text-ai-tint-foreground">
          引导师广播 · {GROUP_WORKBENCH.broadcast.segment}
        </span>
        <span className="text-12 text-ai-tint-foreground">{GROUP_WORKBENCH.broadcast.title}</span>
        <Badge tone="ai" className="ml-auto font-mono">
          {GROUP_WORKBENCH.broadcast.timer}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-panel p-3">
        <div className="flex items-center gap-2">
          {micOn ? (
            <Mic aria-hidden className="h-4 w-4 text-success" />
          ) : (
            <MicOff aria-hidden className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-12" data-testid="group-mic-status">
            麦克风：{micOn ? "转录中" : "已关闭"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-11 text-muted-foreground">关掉也能贴便签、投票</span>
          <Toggle
            checked={micOn}
            onCheckedChange={setMicOn}
            label="麦克风开关"
            id="group-mic-toggle"
            data-testid="group-mic-toggle"
          />
        </div>
      </div>
    </div>
  );

  if (state !== "default") {
    return (
      <div className="flex flex-col gap-4">
        {chrome}
        <StateShell
          state={state}
          className="flex flex-col gap-4"
          skeletonRows={4}
          emptyHint="你们组还没有便签，先贴第一张，或用「语音转便签」把刚才说的转进来"
          errors={{ sticky: "便签内容不能为空" }}
          depFailure={{ what: "转录服务（ASR）暂时不可用，已排队重试；文字类操作不受影响" }}
          denial={{ layer: "project", reason: "你已被引导师移出本组名单，无法再查看本组内容" }}
          successMessage="便签已贴到本组画布"
        >
          <StickyBoard stickies={stickies} />
        </StateShell>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {chrome}

      {/* 本组画布 */}
      <div
        data-testid="group-canvas"
        className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-panel p-3"
      >
        <span className="text-12 font-medium">本组画布</span>
        <Badge tone="neutral">{GROUP_WORKBENCH.canvas.template}</Badge>
        <span className="text-11 text-muted-foreground">材料 {GROUP_WORKBENCH.canvas.materials}</span>
      </div>

      <StickyBoard stickies={stickies} />

      {/* 新增便签 */}
      <div className="flex items-center gap-2" data-testid="group-add-row">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && addSticky()}
          placeholder="写一张便签…"
          data-testid="group-add-sticky-input"
        />
        <Button variant="primary" size="lg" onClick={addSticky} data-testid="group-add-sticky" className="shrink-0">
          <Plus aria-hidden className="h-3.5 w-3.5" /> 便签
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={addVoiceSticky}
          disabled={!micOn}
          title={micOn ? undefined : "麦克风已关闭，先打开麦克风才能语音转便签"}
          data-testid="group-voice-sticky"
          className="shrink-0"
        >
          <AudioLines aria-hidden className="h-3.5 w-3.5" /> 语音转便签
        </Button>
      </div>

      {/* FC 主持建议气泡 */}
      <div
        data-testid="group-fc-suggestion"
        className="flex items-start gap-2.5 rounded-md border border-ai/20 bg-ai-tint p-3"
      >
        <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ai-tint-foreground" />
        <div className="flex flex-1 flex-col gap-2">
          <p className="text-12 text-ai-tint-foreground">{GROUP_WORKBENCH.fcSuggestion}</p>
          {fcAccepted ? (
            <span className="inline-flex items-center gap-1 self-start text-11 text-ai-tint-foreground" data-testid="group-fc-accepted">
              <Check aria-hidden className="h-3.5 w-3.5" /> 已转成一张便签，贴在本组画布上了
            </span>
          ) : (
            <Button variant="ai" size="sm" onClick={acceptFcSuggestion} data-testid="group-fc-accept" className="self-start">
              好，转成便签
            </Button>
          )}
        </div>
      </div>

      {/* 组长专属：主持权限 */}
      {role === "groupLead" && (
        <>
          <Separator />
          <div className="flex flex-col gap-2" data-testid="group-lead-actions">
            <span className="text-11 font-medium text-muted-foreground">组长的主持权限</span>
            {submitted ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-3" data-testid="group-submit-done">
                <Send aria-hidden className="h-4 w-4 text-success" />
                <span className="text-12">本组产出已提交并锁定快照，引导师已能在现场大屏看到。</span>
              </div>
            ) : submitting ? (
              <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/5 p-3" data-testid="group-submit-confirm">
                <div className="flex flex-col gap-1">
                  <span className="text-13 font-semibold">提交本组产出？</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4 text-11 text-muted-foreground" data-testid="group-submit-impact">
                    <li>会把当前 {stickies.length} 张便签锁定为快照，本环节内不可再改（引导师退回前）。</li>
                    <li>引导师与现场大屏立刻可见，其他组看不到。</li>
                    <li>提交后如需修改，得请引导师退回。</li>
                  </ul>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={() => setSubmitted(true)} data-testid="group-submit-commit">
                    确认提交
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSubmitting(false)} data-testid="group-submit-cancel">
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant={handRaised ? "secondary" : "outline"}
                    size="lg"
                    onClick={() => setHandRaised((v) => !v)}
                    aria-pressed={handRaised}
                    data-testid="group-raise-hand"
                  >
                    <Hand aria-hidden className="h-3.5 w-3.5" /> {handRaised ? "已举手 · 收回" : "向引导师举手"}
                  </Button>
                  <Button variant="primary" size="lg" onClick={() => setSubmitting(true)} data-testid="group-submit-output">
                    <Send aria-hidden className="h-3.5 w-3.5" /> 提交本组产出
                  </Button>
                </div>
                {handRaised && (
                  <span className="inline-flex items-center gap-1 text-11 text-muted-foreground" data-testid="group-hand-raised-note">
                    <Check aria-hidden className="h-3.5 w-3.5 text-success" /> 已通知引导师，等待被点到；可再次点击收回。
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StickyBoard({ stickies }: { stickies: Sticky[] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="group-stickies">
      <span className="text-11 font-medium text-muted-foreground">本组便签 · {stickies.length}</span>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {stickies.map((s) => (
          <li
            key={s.id}
            data-testid={`group-sticky-${s.id}`}
            className={
              "flex flex-col gap-1.5 rounded-md border p-3 " +
              (s.mine ? "border-primary/40 bg-accent" : "border-border-subtle bg-panel")
            }
          >
            <p className="text-12">{s.text}</p>
            <div className="flex items-center gap-1.5">
              <Avatar initials={s.author.slice(0, 1)} size="xs" tone={s.mine ? "human" : "muted"} />
              <span className="text-10 text-muted-foreground">{s.author}</span>
              {s.mine && <Badge tone="primary">你贴的</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
