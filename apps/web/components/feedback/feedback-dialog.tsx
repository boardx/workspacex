"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { X, Bug, Lightbulb, Check, Loader2, ThumbsUp } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  FEEDBACK_KINDS,
  currentAppVersion,
  listFeedback,
  submitFeedback,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackStatus,
  type FeedbackTarget,
} from "@/lib/live-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

  const appVersion = currentAppVersion();
  const titleRef = React.useRef<HTMLInputElement>(null);

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

  const canSubmit = title.trim() !== "" && detail.trim() !== "" && !busy;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await submitFeedback({
        kind,
        target,
        title: title.trim(),
        detail: detail.trim(),
        // I-F1：发生位置由客户端给——服务端不可能知道用户站在哪一屏。
        occurredRoute: pathname ?? null,
        appVersion,
      });
      setJustSubmitted(out.feedbackId);
      setTitle("");
      setDetail("");
      setTab("mine");
    } catch (err) {
      setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
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
      setState({
        kind: "failed",
        reason: err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err),
      });
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
