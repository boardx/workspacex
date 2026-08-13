"use client";

import * as React from "react";
import { ApiError } from "@/lib/api-client";
import { loadDigitalInterview } from "@/lib/interview-api";
import type { MockDigitalInterviewDraft } from "@/lib/mock/digital-interview-drafts";
import { DigitalInterviewWorkflow } from "./digital-interview-workflow";

export function DigitalInterviewSetup({ interviewId }: { interviewId: string }) {
  const [draft, setDraft] = React.useState<MockDigitalInterviewDraft | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let active = true;
    void loadDigitalInterview(interviewId).then(
      (loaded) => active && setDraft(loaded as MockDigitalInterviewDraft),
      (cause) => active && setError(cause instanceof ApiError ? cause.reasonCode ?? cause.message : cause instanceof Error ? cause.message : "DEPENDENCY_UNAVAILABLE"),
    );
    return () => { active = false; };
  }, [interviewId]);

  if (error) return <State text={`加载访谈失败：${error}`} />;
  if (!draft) return <State text="正在恢复访谈草稿…" />;
  if (!draft.interviewId.startsWith("mock-batch-")) return <State text="正式访谈流程正在接入，本页当前只展示 Mock 草稿。" />;
  return <DigitalInterviewWorkflow initialDraft={draft} />;
}

function State({ text }: { text: string }) {
  return <main className="flex flex-1 items-center justify-center p-10 text-sm text-muted-foreground">{text}</main>;
}
