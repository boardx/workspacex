import type { GuidedResearchDirection, GuidedResearchOutlineSection } from "@/lib/guided-research-api";
import type { GuidedResearchBrief } from "@/lib/mock/guided-research";
import type { GuidedResearchDemoState } from "@/lib/mock/guided-research-demo-state";

export type ResearchEditableSnapshot =
  | { step: "brief"; value: GuidedResearchBrief }
  | { step: "directions"; value: GuidedResearchDirection[] }
  | { step: "outline"; value: GuidedResearchOutlineSection[] }
  | { step: "search"; value: GuidedResearchDemoState }
  | { step: "report"; value: Pick<GuidedResearchDemoState, "reportSummary"> };

type ReadonlyOutlineSection = Omit<GuidedResearchOutlineSection, "questions"> & { readonly questions: readonly string[] };
type ReadonlyDemoState = Omit<GuidedResearchDemoState, "completedTaskIds" | "sourceDecisions"> & {
  readonly completedTaskIds: readonly string[];
  readonly sourceDecisions: Readonly<GuidedResearchDemoState["sourceDecisions"]>;
};

export type ResearchEditableSnapshotInput =
  | { step: "brief"; value: Readonly<GuidedResearchBrief> }
  | { step: "directions"; value: readonly Readonly<GuidedResearchDirection>[] }
  | { step: "outline"; value: readonly Readonly<ReadonlyOutlineSection>[] }
  | { step: "search"; value: Readonly<ReadonlyDemoState> }
  | { step: "report"; value: Readonly<Pick<GuidedResearchDemoState, "reportSummary">> };

export type ResearchSkillSuggestion =
  | { step: "brief"; prompt: string; text: string; value: GuidedResearchBrief }
  | { step: "directions"; prompt: string; text: string; value: GuidedResearchDirection[] }
  | { step: "outline"; prompt: string; text: string; value: GuidedResearchOutlineSection[] }
  | { step: "search"; prompt: string; text: string; value: GuidedResearchDemoState }
  | { step: "report"; prompt: string; text: string; value: Pick<GuidedResearchDemoState, "reportSummary"> };

export interface ResearchSkillState {
  version: 1;
  messages: Array<{ id: string; role: "user" | "skill"; text: string }>;
  pendingSuggestion: ResearchSkillSuggestion | null;
  undoSnapshot: ResearchEditableSnapshot | null;
}

function storageKey(sessionKey: string): string {
  return `wsx.guidedResearch.skill.v1.${sessionKey}`;
}

function emptyState(): ResearchSkillState {
  return { version: 1, messages: [], pendingSuggestion: null, undoSnapshot: null };
}

function nextOrder(items: readonly { order: number }[]): number {
  return items.reduce((highest, item) => Math.max(highest, item.order), -1) + 1;
}

function isDirection(value: unknown): value is GuidedResearchDirection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GuidedResearchDirection>;
  return typeof candidate.id === "string"
    && typeof candidate.title === "string"
    && typeof candidate.description === "string"
    && typeof candidate.enabled === "boolean"
    && typeof candidate.order === "number";
}

function isOutlineSection(value: unknown): value is GuidedResearchOutlineSection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GuidedResearchOutlineSection>;
  return typeof candidate.id === "string"
    && typeof candidate.title === "string"
    && Array.isArray(candidate.questions)
    && candidate.questions.every((question) => typeof question === "string")
    && typeof candidate.enabled === "boolean"
    && typeof candidate.order === "number";
}

function isBrief(value: unknown): value is GuidedResearchBrief {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GuidedResearchBrief>;
  return typeof candidate.topic === "string"
    && typeof candidate.goal === "string"
    && typeof candidate.timeRange === "string"
    && typeof candidate.region === "string"
    && typeof candidate.focus === "string";
}

function isDemoState(value: unknown): value is GuidedResearchDemoState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GuidedResearchDemoState>;
  return candidate.version === 1
    && typeof candidate.sessionId === "string"
    && Array.isArray(candidate.completedTaskIds)
    && candidate.completedTaskIds.every((id) => typeof id === "string")
    && typeof candidate.sourceDecisions === "object"
    && candidate.sourceDecisions !== null
    && Object.values(candidate.sourceDecisions).every((decision) => decision === "accepted" || decision === "excluded")
    && typeof candidate.reportSummary === "string";
}

function isSnapshot(value: unknown): value is ResearchEditableSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { step?: unknown; value?: unknown };
  if (candidate.step === "brief") return isBrief(candidate.value);
  if (candidate.step === "directions") return Array.isArray(candidate.value) && candidate.value.every(isDirection);
  if (candidate.step === "outline") return Array.isArray(candidate.value) && candidate.value.every(isOutlineSection);
  if (candidate.step === "search") return isDemoState(candidate.value);
  return candidate.step === "report"
    && typeof candidate.value === "object"
    && candidate.value !== null
    && typeof (candidate.value as { reportSummary?: unknown }).reportSummary === "string";
}

function isSuggestion(value: unknown): value is ResearchSkillSuggestion {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { step?: unknown; prompt?: unknown; text?: unknown; value?: unknown };
  return typeof candidate.prompt === "string"
    && typeof candidate.text === "string"
    && isSnapshot({ step: candidate.step, value: candidate.value });
}

function isResearchSkillState(value: unknown): value is ResearchSkillState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ResearchSkillState>;
  return candidate.version === 1
    && Array.isArray(candidate.messages)
    && candidate.messages.every((message) => typeof message === "object"
      && message !== null
      && typeof message.id === "string"
      && (message.role === "user" || message.role === "skill")
      && typeof message.text === "string")
    && (candidate.pendingSuggestion === null || isSuggestion(candidate.pendingSuggestion))
    && (candidate.undoSnapshot === null || isSnapshot(candidate.undoSnapshot));
}

export function loadResearchSkillState(sessionKey: string): ResearchSkillState;
export function loadResearchSkillState(sessionKey: string, step: ResearchEditableSnapshot["step"]): ResearchSkillState;
export function loadResearchSkillState(sessionKey: string, step?: ResearchEditableSnapshot["step"]): ResearchSkillState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(storageKey(sessionKey));
    if (!raw) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (!isResearchSkillState(parsed)) return emptyState();
    if (!step) return parsed;
    return {
      ...parsed,
      pendingSuggestion: parsed.pendingSuggestion?.step === step ? parsed.pendingSuggestion : null,
      undoSnapshot: parsed.undoSnapshot?.step === step ? parsed.undoSnapshot : null,
    };
  } catch {
    return emptyState();
  }
}

export function saveResearchSkillState(sessionKey: string, state: ResearchSkillState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(sessionKey), JSON.stringify(state));
  } catch {
    // Storage can be unavailable or full; the caller still retains its in-memory state.
  }
}

export function clearResearchSkillState(sessionKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(sessionKey));
  } catch {
    // Storage can be unavailable; mounted state is discarded on navigation.
  }
}

export function suggestionForResearchPrompt(
  prompt: string,
  snapshot: ResearchEditableSnapshotInput,
): ResearchSkillSuggestion {
  if (snapshot.step === "brief") {
    return {
      step: "brief",
      prompt,
      text: `建议将研究目标聚焦为：${prompt}`,
      value: { ...snapshot.value, goal: `${snapshot.value.goal}；${prompt}` },
    };
  }
  if (snapshot.step === "directions") {
    const order = nextOrder(snapshot.value);
    return {
      step: "directions",
      prompt,
      text: `建议新增研究方向：${prompt}`,
      value: [...snapshot.value, {
        id: `direction-${snapshot.value.length + 1}`,
        title: prompt,
        description: "补充这一方向的范围、关键证据与反证条件。",
        enabled: true,
        order,
      }],
    };
  }
  if (snapshot.step === "outline") {
    const order = nextOrder(snapshot.value);
    return {
      step: "outline",
      prompt,
      text: `建议新增报告章节：${prompt}`,
      value: [...snapshot.value.map((item) => ({ ...item, questions: [...item.questions] })), {
        id: `outline-${snapshot.value.length + 1}`,
        title: prompt,
        questions: [`${prompt}需要回答什么？`],
        enabled: true,
        order,
      }],
    };
  }
  if (snapshot.step === "search") {
    return {
      step: "search",
      prompt,
      text: "建议检查当前检索任务的来源可信度，并排除与研究问题无关的来源。",
      value: {
        ...snapshot.value,
        completedTaskIds: [...snapshot.value.completedTaskIds],
        sourceDecisions: { ...snapshot.value.sourceDecisions },
      },
    };
  }
  return {
    step: "report",
    prompt,
    text: `建议在摘要中补充：${prompt}`,
    value: { reportSummary: snapshot.value.reportSummary ? `${snapshot.value.reportSummary}\n\n${prompt}` : prompt },
  };
}

export function applyResearchSkillSuggestion(
  suggestion: ResearchSkillSuggestion,
  snapshot: ResearchEditableSnapshotInput,
): ResearchEditableSnapshot {
  if (suggestion.step !== snapshot.step) return cloneResearchEditableSnapshot(snapshot);
  if (suggestion.step === "brief") return { step: "brief", value: { ...suggestion.value } };
  if (suggestion.step === "directions") return { step: "directions", value: suggestion.value.map((item) => ({ ...item })) };
  if (suggestion.step === "outline") return { step: "outline", value: suggestion.value.map((item) => ({ ...item, questions: [...item.questions] })) };
  if (suggestion.step === "search") {
    return {
      step: "search",
      value: {
        ...suggestion.value,
        completedTaskIds: [...suggestion.value.completedTaskIds],
        sourceDecisions: { ...suggestion.value.sourceDecisions },
      },
    };
  }
  return { step: "report", value: { ...suggestion.value } };
}

export function cloneResearchEditableSnapshot(snapshot: ResearchEditableSnapshotInput): ResearchEditableSnapshot {
  if (snapshot.step === "brief") return { step: "brief", value: { ...snapshot.value } };
  if (snapshot.step === "directions") return { step: "directions", value: snapshot.value.map((item) => ({ ...item })) };
  if (snapshot.step === "outline") return { step: "outline", value: snapshot.value.map((item) => ({ ...item, questions: [...item.questions] })) };
  if (snapshot.step === "search") {
    return {
      step: "search",
      value: {
        ...snapshot.value,
        completedTaskIds: [...snapshot.value.completedTaskIds],
        sourceDecisions: { ...snapshot.value.sourceDecisions },
      },
    };
  }
  return { step: "report", value: { ...snapshot.value } };
}
