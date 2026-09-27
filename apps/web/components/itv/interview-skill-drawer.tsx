"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DigitalInterviewStep, DigitalInterviewWorkflowView } from "@/lib/interview-api";
import { PersistentInterviewSkillAssistant } from "./interview-skill-assistant";

export function InterviewSkillDrawer({ open, onOpenChange, view, currentStep, onSend, onApply, onReject }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly view: DigitalInterviewWorkflowView;
  readonly currentStep: DigitalInterviewStep;
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onApply: (proposalId: string) => Promise<boolean>;
  readonly onReject: (proposalId: string) => Promise<boolean>;
}) {
  return <aside data-testid="itv-skill-drawer" aria-hidden={!open} className={open ? "fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-border bg-card shadow-2xl" : "hidden"}>
    <div className="flex justify-end p-3"><Button type="button" variant="ghost" size="icon" aria-label="关闭访谈助手" onClick={() => onOpenChange(false)}><X className="size-4" aria-hidden /></Button></div>
    <PersistentInterviewSkillAssistant view={view} currentStep={currentStep} onSend={onSend} onApply={onApply} onReject={onReject} />
  </aside>;
}
