"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  convertQuickDigitalInterview,
  loadQuickDigitalInterview,
  sendQuickDigitalInterviewMessage,
  startQuickDigitalInterview,
  type QuickDigitalInterview as QuickInterview,
} from "@/lib/interview-api";
import { findMockDigitalExpert } from "@/lib/mock/digital-expert-personas";

export function QuickDigitalInterview({
  interviewId,
  expertId,
}: {
  interviewId: string;
  expertId?: string;
}) {
  const { push } = useRouter();
  const [quick, setQuick] = React.useState<QuickInterview | null>(null);
  const [question, setQuestion] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [startRequestId] = React.useState(() => crypto.randomUUID());

  React.useEffect(() => {
    let active = true;
    const request = interviewId === "new" && expertId
      ? startQuickDigitalInterview(expertId, startRequestId)
      : loadQuickDigitalInterview(interviewId);

    request.then(
      (loaded) => {
        if (!active) return;
        if (interviewId === "new") push(`/itv/quick/${loaded.interviewId}`);
        setQuick(loaded);
      },
      (cause) => active && setError(errorReason(cause)),
    );
    return () => { active = false; };
  }, [expertId, interviewId, push, startRequestId]);

  async function send() {
    if (!quick || !question.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      setQuick(await sendQuickDigitalInterviewMessage(
        quick.interviewId,
        question,
        quick.version,
      ));
      setQuestion("");
    } catch (cause) {
      setError(errorReason(cause));
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    if (!quick || busy) return;
    setBusy(true);
    setError("");
    try {
      const draft = await convertQuickDigitalInterview(quick);
      push(`/itv/${draft.interviewId}/setup`);
    } catch (cause) {
      setError(errorReason(cause));
      setBusy(false);
    }
  }

  if (error && !quick) return <PageState text={`加载失败：${error}`} />;
  if (!quick) return <PageState text="正在准备快捷访谈…" />;
  const mockExpert = findMockDigitalExpert(quick.expert.expertId);

  return (
    <main data-testid="itv-quick-page" className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="border-b border-border px-6 py-5 lg:px-10">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              data-testid="itv-quick-back"
              href="/itv?tab=experts"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
              返回专家列表
            </Link>
            <h1 className="mt-3 text-2xl font-semibold">{quick.expert.displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {quick.expert.role} · 探索性对话
            </p>
          </div>
          <button
            data-testid="itv-convert-batch"
            disabled={busy}
            onClick={convert}
            className="whitespace-nowrap rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm disabled:bg-disabled disabled:text-disabled-foreground"
          >
            转为批量访谈
          </button>
        </div>
      </header>

      <section
        aria-label="对话记录"
        className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto px-6 py-8"
      >
        {mockExpert && (
          <article
            data-testid="itv-quick-expert-intro"
            className="rounded-xl border border-primary/20 bg-primary/5 p-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">关于这位专家</h2>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">Mock 专家</span>
            </div>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{mockExpert.bio}</p>
            <p className="mt-3 text-xs leading-6 text-muted-foreground">
              <span className="font-medium text-background-foreground">典型建议：</span>{mockExpert.typicalAdvice}
            </p>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              <span className="font-medium text-background-foreground">使用边界：</span>{mockExpert.materialBoundary}
            </p>
          </article>
        )}
        {quick.messages.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            直接提出第一个需要验证的问题。
          </p>
        ) : quick.messages.map((message) => (
          <article
            key={message.messageId}
            className={message.role === "user"
              ? "ml-auto max-w-2xl rounded-xl bg-primary px-4 py-3 text-primary-foreground"
              : "mr-auto max-w-2xl rounded-xl border border-border bg-card px-4 py-3"}
          >
            <p>{message.text}</p>
            {message.role === "assistant" && (
              <span className="mt-2 block text-xs text-muted-foreground">探索性回答</span>
            )}
          </article>
        ))}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </section>

      <div className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex max-w-4xl gap-3">
          <label className="sr-only" htmlFor="quick-question">访谈问题</label>
          <textarea
            id="quick-question"
            aria-label="访谈问题"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="min-h-20 flex-1 resize-none rounded-xl border border-border bg-background p-3"
            placeholder="输入你的问题…"
          />
          <button
            disabled={busy || !question.trim()}
            onClick={send}
            className="inline-flex h-12 items-center gap-2 self-end rounded-lg bg-primary px-5 text-sm text-primary-foreground shadow-sm disabled:bg-disabled disabled:text-disabled-foreground"
          >
            <Send className="size-4" aria-hidden />
            {busy ? "发送中…" : "发送"}
          </button>
        </div>
      </div>
    </main>
  );
}

function errorReason(cause: unknown) {
  if (cause instanceof ApiError) return cause.reasonCode ?? cause.message;
  if (cause instanceof Error) return cause.message;
  return "DEPENDENCY_UNAVAILABLE";
}

function PageState({ text }: { text: string }) {
  return (
    <main
      data-testid="itv-quick-state"
      className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground"
    >
      {text}
    </main>
  );
}
