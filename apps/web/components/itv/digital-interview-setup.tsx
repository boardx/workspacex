"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { loadDigitalInterview, type DigitalInterviewHistoryRow } from "@/lib/interview-api";
import { ApiError } from "@/lib/api-client";

type Draft = Pick<DigitalInterviewHistoryRow, "interviewId" | "name" | "tags" | "topic" | "status">;

export function DigitalInterviewSetup({ interviewId }: { interviewId: string }) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    void loadDigitalInterview(interviewId).then(
      (loaded) => active && setDraft(loaded),
      (cause) => active && setError(cause instanceof ApiError ? cause.reasonCode ?? cause.message : cause instanceof Error ? cause.message : "DEPENDENCY_UNAVAILABLE"),
    );
    return () => { active = false; };
  }, [interviewId]);

  if (error) return <State text={`加载访谈失败：${error}`} />;
  if (!draft) return <State text="正在恢复访谈草稿…" />;

  return (
    <main data-testid="itv-setup-page" className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-8 lg:px-10 lg:py-10">
        <Link href="/itv?tab=history" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" /> 返回历史访谈</Link>
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm lg:p-8">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="mt-1 size-6 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-medium text-primary">Mock 草稿已保存</p>
              <h1 className="mt-2 text-2xl font-semibold">{draft.name}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{draft.topic}</p>
              <div className="mt-4 flex flex-wrap gap-2">{draft.tags.map((tag) => <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}</div>
            </div>
          </div>
          <div className="mt-8 border-t border-border pt-6">
            <h2 className="text-lg font-semibold">下一步：浏览数字专家</h2>
            <p className="mt-2 text-sm text-muted-foreground">主题保存在当前浏览器的 Mock 草稿中，可先进入专家目录选择快捷访谈对象。</p>
            <Link href="/itv?tab=experts" className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm">先查看专家目录</Link>
          </div>
        </div>
      </div>
    </main>
  );
}

function State({ text }: { text: string }) {
  return <main className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">{text}</main>;
}
