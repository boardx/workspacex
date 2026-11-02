import type { MessageKey } from "./messages";
const keys: Record<string, MessageKey | undefined> = {
  me: "ui.me",
  "home": "navigation.home",
  "chat": "navigation.chat",
  "projects": "navigation.projects",
  "whiteboard": "navigation.whiteboard",
  "research": "navigation.research",
  "interview": "navigation.interview",
  "recording": "navigation.recording",
  "survey": "navigation.survey",
  "design-workbench": "navigation.design-workbench",
  "feedback-drafts": "navigation.feedback-drafts",
  "brain": "navigation.brain",
  "tasks": "navigation.tasks",
  "workflows": "navigation.workflows",
  "agent-directory": "navigation.agent-directory",
  "work-skill-catalog": "navigation.work-skill-catalog",
  "admin": "navigation.admin",
  "templates": "navigation.templates",
  "skills": "navigation.skills",
  "agent-runtime": "navigation.agent-runtime",
  "org-admin": "navigation.org-admin",
  "asset-governance": "navigation.asset-governance",
  "agent-interrupts": "navigation.agent-interrupts",
  "plan-control": "navigation.plan-control",
  "agent-kernel": "navigation.agent-kernel",
  "chat-knowledge-graph": "navigation.chat-knowledge-graph",
  "canvas": "navigation.canvas",
  "billing-preview": "navigation.billing-preview",
  "platform-admin": "navigation.platform-admin",
  "files": "navigation.files"
};
export function navigationLabel(key: string, fallback: string, t: (key: MessageKey) => string) { const message = keys[key]; return message ? t(message) : fallback; }

import type { NavSegment } from "@/lib/navigation";
const groupKeys: Record<string, MessageKey | undefined> = { work: "navigation.group.work", studio: "navigation.group.studio", capabilities: "navigation.group.capabilities", administration: "navigation.group.administration" };
export function localizeNavigation(segments: NavSegment[], t: (key: MessageKey) => string): NavSegment[] {
  return segments.map((segment) => ({ ...segment, label: segment.key && groupKeys[segment.key] ? t(groupKeys[segment.key]!) : segment.label, items: segment.items.map((item) => ({ ...item, label: navigationLabel(item.key, item.label, t) })) }));
}
