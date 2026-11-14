"use client";
import { MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
/** Callbacks belong to the workspace host; this component adds no transport. */
export function WorkspaceCommunicationActions({ onTeam, onAssistant, teamOpen = false, assistantOpen = false, assistantDisabled = false }: {
  onTeam: () => void; onAssistant: () => void; teamOpen?: boolean; assistantOpen?: boolean; assistantDisabled?: boolean;
}) {
  return <nav aria-label="沟通插件" className="flex flex-wrap items-center gap-2" data-testid="workspace-communication-actions">
    <Button type="button" size="sm" variant={assistantOpen ? "secondary" : "ghost"} disabled={assistantDisabled} onClick={onAssistant} aria-expanded={assistantOpen} data-testid="workspace-open-assistant"><Sparkles aria-hidden className="mr-1.5 h-4 w-4" />AI 引导师</Button>
    <Button type="button" size="sm" variant={teamOpen ? "secondary" : "outline"} onClick={onTeam} aria-expanded={teamOpen} data-testid="workspace-open-team"><MessageCircle aria-hidden className="mr-1.5 h-4 w-4" />小组讨论</Button>
  </nav>;
}
