export interface GuidedResearchDemoState {
  version: 1;
  sessionId: string;
  completedTaskIds: string[];
  sourceDecisions: Record<string, "accepted" | "excluded">;
  reportSummary: string;
}

type SourceDecision = GuidedResearchDemoState["sourceDecisions"][string];

function storageKey(sessionId: string): string {
  return `wsx.guidedResearch.demo.v1.${sessionId}`;
}

function fixture(sessionId: string): GuidedResearchDemoState {
  return {
    version: 1,
    sessionId,
    completedTaskIds: [],
    sourceDecisions: {},
    reportSummary: "",
  };
}

function isSourceDecisions(value: unknown): value is GuidedResearchDemoState["sourceDecisions"] {
  return typeof value === "object" && value !== null
    && Object.values(value).every((decision) => decision === "accepted" || decision === "excluded");
}

function isDemoState(value: unknown, sessionId: string): value is GuidedResearchDemoState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<GuidedResearchDemoState>;
  return candidate.version === 1
    && candidate.sessionId === sessionId
    && Array.isArray(candidate.completedTaskIds)
    && candidate.completedTaskIds.every((id) => typeof id === "string")
    && isSourceDecisions(candidate.sourceDecisions)
    && typeof candidate.reportSummary === "string";
}

export function loadGuidedResearchDemoState(sessionId: string): GuidedResearchDemoState {
  if (typeof window === "undefined") return fixture(sessionId);
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return fixture(sessionId);
    const parsed: unknown = JSON.parse(raw);
    return isDemoState(parsed, sessionId) ? parsed : fixture(sessionId);
  } catch {
    return fixture(sessionId);
  }
}

export function saveGuidedResearchDemoState(state: GuidedResearchDemoState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(state.sessionId), JSON.stringify(state));
}

export function clearGuidedResearchDemoState(sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(sessionId));
  } catch {
    // The server rollback remains authoritative if browser storage is unavailable.
  }
}

export function advanceDemoTask(state: GuidedResearchDemoState, taskId: string): GuidedResearchDemoState {
  if (state.completedTaskIds.includes(taskId)) return state;
  return { ...state, completedTaskIds: [...state.completedTaskIds, taskId] };
}

export function decideDemoSource(
  state: GuidedResearchDemoState,
  sourceId: string,
  decision: SourceDecision,
): GuidedResearchDemoState {
  return { ...state, sourceDecisions: { ...state.sourceDecisions, [sourceId]: decision } };
}
