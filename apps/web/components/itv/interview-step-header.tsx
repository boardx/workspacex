"use client";

import * as React from "react";
import { WorkflowActionBar } from "@/components/research-studio/research-workflow-actions";

/** Revision and step commands share one visible action region. */
export const InterviewRevisionAction = React.createContext<React.ReactNode>(null);

export function InterviewStepHeader({ title, children, testId }: {
  readonly title: string;
  readonly children?: React.ReactNode;
  readonly testId?: string;
}) {
  return <header data-testid={testId ?? "itv-step-header"} className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3 print:hidden">
    <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
    {children && <InterviewStepActions placement="inline">{children}</InterviewStepActions>}
  </header>;
}

/** Each step places exactly one action region after its content. */
export function InterviewStepActions({ children, placement = "footer" }: {
  readonly children?: React.ReactNode;
  readonly placement?: "inline" | "footer";
}) {
  const revision = React.useContext(InterviewRevisionAction);
  return <WorkflowActionBar data-testid="itv-step-actions" placement={placement}>{revision}{children}</WorkflowActionBar>;
}
