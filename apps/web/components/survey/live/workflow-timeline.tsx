"use client";

import * as React from "react";

export type SurveyWorkflowStep = readonly [string, string];

type WorkflowTimelineProps = {
  steps: readonly SurveyWorkflowStep[];
  activeStep: string;
  onSelect: (step: string) => void;
};

/** Shared workflow navigation used by design, publishing, and response views. */
export function WorkflowTimeline({ steps, activeStep, onSelect }: WorkflowTimelineProps) {
  return (
    <nav aria-label="问卷工作流" className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-4xl items-center overflow-x-auto px-5 py-2">
        {steps.map(([id, label], index) => {
          const active = activeStep === id;
          const last = index === steps.length - 1;
          return (
            <React.Fragment key={id}>
              <button
                type="button"
                aria-label={`${index + 1}. ${label}`}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(id)}
                className={`flex min-w-32 shrink-0 items-center justify-center gap-2 rounded-control border-b-2 px-3 py-2 text-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-28 sm:flex-1 ${active ? "border-primary bg-muted font-semibold text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}
              >
                <span className="text-12 tabular-nums">
                  {index + 1}
                </span>
                {label}
              </button>
              {!last && <span aria-hidden="true" className="mx-1 h-px min-w-5 flex-1 bg-border" />}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}
