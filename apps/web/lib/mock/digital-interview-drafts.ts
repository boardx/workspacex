import { findMockDigitalExpert } from "@/lib/mock/digital-expert-personas";

export type MockInterviewStep = 1 | 2 | 3 | 4 | 5;

export interface MockInterviewQuestion {
  readonly questionId: string;
  readonly expertId: string;
  readonly text: string;
  readonly origin: "generated" | "manual";
  readonly purpose: string;
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
  readonly removedGeneratedQuestionIds: readonly string[];
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
    removedGeneratedQuestionIds: [],
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

const DEFAULT_QUESTION_TEMPLATES = [
  { purpose: "决策流程", text: (role: string) => `从${role}视角，谁参与决策，各自负责什么环节？` },
  { purpose: "否决风险", text: (role: string) => `从${role}视角，哪些条件会导致否决或延后决策？` },
  { purpose: "依据案例", text: (role: string) => `从${role}视角，做出判断时最看重哪些依据？请举一个实际案例。` },
] as const;

export function createDefaultMockInterviewQuestions(expertId: string): readonly MockInterviewQuestion[] {
  const role = mockExpertRole(expertId);
  return DEFAULT_QUESTION_TEMPLATES.map((template, index) => ({
    questionId: `${expertId}:generated:${index + 1}`,
    expertId,
    text: template.text(role),
    origin: "generated" as const,
    purpose: template.purpose,
  }));
}

export function reconcileMockInterviewQuestions(
  selectedExpertIds: readonly string[],
  questions: readonly MockInterviewQuestion[],
  removedGeneratedQuestionIds: readonly string[] = [],
): readonly MockInterviewQuestion[] {
  const uniqueExpertIds = Array.from(new Set(selectedExpertIds));
  const selected = new Set(uniqueExpertIds);
  const removed = new Set(removedGeneratedQuestionIds);
  const kept = questions.filter((question) => selected.has(question.expertId));
  return uniqueExpertIds.flatMap((expertId) => {
    const expertQuestions = kept.filter((question) => question.expertId === expertId);
    const existingById = new Map(expertQuestions.map((question) => [question.questionId, question]));
    const defaults = createDefaultMockInterviewQuestions(expertId);
    const defaultIds = new Set(defaults.map((question) => question.questionId));
    const generated = defaults
      .filter((question) => !removed.has(question.questionId))
      .map((question) => existingById.get(question.questionId) ?? question);
    const supplemental = expertQuestions.filter((question) => !defaultIds.has(question.questionId));
    return [...generated, ...supplemental];
  });
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
          selectedExpertIds: normalizeExpertIds(draft.selectedExpertIds),
          questions: normalizeQuestions(draft.questions),
          removedGeneratedQuestionIds: normalizeStringArray(draft.removedGeneratedQuestionIds),
          currentStep,
          reportMarkdown: typeof draft.reportMarkdown === "string" ? draft.reportMarkdown : "",
          skillMessages: Array.isArray(draft.skillMessages) ? draft.skillMessages : [],
          pendingSuggestion: draft.pendingSuggestion ?? null,
          undoSnapshot: normalizeUndoSnapshot(draft.undoSnapshot),
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

function normalizeQuestions(value: unknown): readonly MockInterviewQuestion[] {
  if (!Array.isArray(value)) return [];
  const expertOccurrences = new Map<string, number>();
  return value.flatMap((question) => {
    if (!question || typeof question !== "object") return [];
    const candidate = question as Partial<MockInterviewQuestion>;
    if (typeof candidate.expertId !== "string" || typeof candidate.text !== "string") return [];
    const generatedDefaults = createDefaultMockInterviewQuestions(candidate.expertId);
    const occurrence = expertOccurrences.get(candidate.expertId) ?? 0;
    expertOccurrences.set(candidate.expertId, occurrence + 1);
    const fallback = generatedDefaults[Math.min(occurrence, generatedDefaults.length - 1)]!;
    const isSupplementalLegacyQuestion = occurrence >= generatedDefaults.length && typeof candidate.questionId !== "string";
    return [{
      questionId: typeof candidate.questionId === "string" ? candidate.questionId : isSupplementalLegacyQuestion ? `${candidate.expertId}:legacy:${occurrence + 1}` : fallback.questionId,
      expertId: candidate.expertId,
      text: candidate.text,
      origin: candidate.origin === "manual" || isSupplementalLegacyQuestion ? "manual" : "generated",
      purpose: typeof candidate.purpose === "string" ? candidate.purpose : isSupplementalLegacyQuestion ? "历史问题" : fallback.purpose,
    }];
  });
}

function normalizeExpertIds(value: unknown): readonly string[] {
  return Array.from(new Set(normalizeStringArray(value)));
}

function normalizeStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeUndoSnapshot(value: unknown): MockDigitalInterviewUndoSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MockDigitalInterviewUndoSnapshot>;
  return {
    topic: typeof candidate.topic === "string" ? candidate.topic : "",
    selectedExpertIds: normalizeExpertIds(candidate.selectedExpertIds),
    questions: normalizeQuestions(candidate.questions),
    reportMarkdown: typeof candidate.reportMarkdown === "string" ? candidate.reportMarkdown : "",
  };
}

function mockExpertRole(expertId: string): string {
  return findMockDigitalExpert(expertId)?.role ?? "该专家的专业";
}

function isMockInterviewStep(value: unknown): value is MockInterviewStep {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function write(draft: MockDigitalInterviewDraft): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [draft.interviewId]: draft }));
}
