"use client";

import * as React from "react";

/** Revision and step commands share one visible action region. */
export const InterviewRevisionAction = React.createContext<React.ReactNode>(null);

export function InterviewStepHeader({ title, children, testId }: {
  readonly title: string;
  readonly children?: React.ReactNode;
  readonly testId?: string;
}) {
  const revision = React.useContext(InterviewRevisionAction);
  return <header data-testid={testId ?? "itv-step-header"} className="mb-5 flex min-w-0 flex-wrap items-center justify-between gap-3 print:hidden">
    <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
    <div data-testid="itv-step-actions" className="ml-auto flex flex-wrap items-center justify-end gap-2">{revision}{children}</div>
  </header>;
}
