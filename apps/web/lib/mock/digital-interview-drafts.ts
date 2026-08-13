export type MockInterviewStep = 1 | 2 | 3 | 4 | 5;

export interface MockInterviewQuestion {
  readonly expertId: string;
  readonly text: string;
}

export interface MockSkillMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface MockSkillSuggestion {
  readonly target: "topic" | "experts" | "questions" | "report";
  readonly text: string;
  readonly applied: boolean;
}

export interface MockDigitalInterviewDraft {
  readonly interviewId: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic: string;
  readonly status: "draft";
  readonly sourceQuickInterviewId: string | null;
  readonly selectedExpertIds: readonly string[];
  readonly questions: readonly MockInterviewQuestion[];
  readonly currentStep: MockInterviewStep;
  readonly reportMarkdown: string;
  readonly skillMessages: readonly MockSkillMessage[];
  readonly pendingSuggestion: MockSkillSuggestion | null;
  readonly undoSnapshot: MockDigitalInterviewUndoSnapshot | null;
  readonly reportId: string | null;
  readonly updatedAt: string;
  readonly version: number;
}

export interface MockDigitalInterviewUndoSnapshot {
  readonly topic: string;
  readonly selectedExpertIds: readonly string[];
  readonly questions: readonly MockInterviewQuestion[];
  readonly reportMarkdown: string;
}

const STORAGE_KEY = "wsx.mockDigitalInterviewDrafts.v1";

export function createMockDigitalInterviewDraft(input: {
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic?: string;
}): MockDigitalInterviewDraft {
  if (typeof window === "undefined") throw new Error("MOCK_BROWSER_REQUIRED");
  const draft: MockDigitalInterviewDraft = {
    interviewId: `mock-batch-${crypto.randomUUID()}`,
    name: input.name.trim(),
    tags: normalizeTags(input.tags),
    topic: input.topic?.trim() ?? "",
    status: "draft",
    sourceQuickInterviewId: null,
    selectedExpertIds: [],
    questions: [],
    currentStep: 1,
    reportMarkdown: "",
    skillMessages: [{
      id: `skill-${crypto.randomUUID()}`,
      role: "assistant",
      text: "我是访谈 Skill 助手，可以和你一起优化主题、专家、问题和报告结构。",
    }],
    pendingSuggestion: null,
    undoSnapshot: null,
    reportId: null,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
  write(draft);
  return draft;
}

export function loadMockDigitalInterviewDraft(interviewId: string): MockDigitalInterviewDraft | null {
  if (!interviewId.startsWith("mock-batch-") || typeof window === "undefined") return null;
  return readAll()[interviewId] ?? null;
}

export function updateMockDigitalInterviewDraft(
  interviewId: string,
  updater: (draft: MockDigitalInterviewDraft) => MockDigitalInterviewDraft,
): MockDigitalInterviewDraft {
  const current = loadMockDigitalInterviewDraft(interviewId);
  if (!current) throw new Error("MOCK_INTERVIEW_NOT_FOUND");
  const next = { ...updater(current), interviewId, updatedAt: new Date().toISOString(), version: current.version + 1 };
  write(next);
  return next;
}

export function listMockDigitalInterviewDrafts(): readonly MockDigitalInterviewDraft[] {
  return Object.values(readAll()).sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 5);
}

function readAll(): Record<string, MockDigitalInterviewDraft> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<MockDigitalInterviewDraft>>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([interviewId, draft]) => {
        if (!draft || typeof draft !== "object" || typeof draft.name !== "string") return [];
        const currentStep = isMockInterviewStep(draft.currentStep) ? draft.currentStep : 1;
        return [[interviewId, {
          ...draft,
          interviewId,
          name: draft.name,
          tags: Array.isArray(draft.tags) ? normalizeTags(draft.tags) : [],
          topic: typeof draft.topic === "string" ? draft.topic : "",
          status: "draft",
          sourceQuickInterviewId: typeof draft.sourceQuickInterviewId === "string" ? draft.sourceQuickInterviewId : null,
          selectedExpertIds: Array.isArray(draft.selectedExpertIds) ? draft.selectedExpertIds : [],
          questions: Array.isArray(draft.questions) ? draft.questions : [],
          currentStep,
          reportMarkdown: typeof draft.reportMarkdown === "string" ? draft.reportMarkdown : "",
          skillMessages: Array.isArray(draft.skillMessages) ? draft.skillMessages : [],
          pendingSuggestion: draft.pendingSuggestion ?? null,
          undoSnapshot: draft.undoSnapshot ?? null,
          reportId: typeof draft.reportId === "string" ? draft.reportId : null,
          updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : new Date(0).toISOString(),
          version: typeof draft.version === "number" ? draft.version : 1,
        } satisfies MockDigitalInterviewDraft]];
      }),
    );
  } catch {
    return {};
  }
}

function isMockInterviewStep(value: unknown): value is MockInterviewStep {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function write(draft: MockDigitalInterviewDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [draft.interviewId]: draft }));
}
