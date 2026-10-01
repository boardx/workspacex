import type { ReactNode } from "react";

export function InterviewStageFrame({ children }: { readonly children: ReactNode }) {
  return <section data-testid="itv-workbench-stage" className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-sm lg:p-7">{children}</section>;
}
