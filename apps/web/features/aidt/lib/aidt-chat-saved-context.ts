import { getThread, getThreadArtifactSource, listThreadArtifacts } from "@/lib/live-chat";
import { isAidtModuleEnabled } from "./aidt-module-config";

/** An explicit selection; neither stage association nor review is inferred from a title. */
export type AidtSavedContextReference = Readonly<{
  stageNumber: number;
  threadId: string;
  artifactId: string;
  expectedImmutableRevision?: string;
  /** A private draft may reach a plenary AI reply only after a student explicitly chooses that disclosure. */
  includePrivateDraft?: boolean;
}>;
export type AidtSavedContextItem = Readonly<{
  stageNumber: number;
  threadId: string;
  artifactId: string;
  messageId: string;
  title: string;
  mode: "draft" | "live" | "pinned";
  immutableRevision: string;
  version: number | null;
  savedBy: string;
  savedAt: string;
  markdown: string;
  truncated: boolean;
  reviewStatus: "not-confirmed";
  evidenceStatus: "not-verified";
  visibility: "group-source" | "private-draft-explicitly-shared";
}>;
export type AidtSavedContextIssue = Readonly<{ stageNumber: number; reason: "unavailable" | "version-changed" | "private-draft" | "limit" }>;
export type AidtSavedChatContext = Readonly<{
  status: "not-selected" | "ready" | "partial" | "failed";
  items: readonly AidtSavedContextItem[];
  issues: readonly AidtSavedContextIssue[];
}>;
export const AIDT_EMPTY_SAVED_CONTEXT: AidtSavedChatContext = { status: "not-selected", items: [], issues: [] };
const MAX_REFERENCES = 12, MAX_ITEM_CHARS = 3000, MAX_TOTAL_CHARS = 18000;
class ContextReadIssue extends Error { constructor(readonly reason: AidtSavedContextIssue["reason"]) { super(reason); } }
function clip(text: string, length: number): string {
  const part = text.slice(0, length);
  return /[\uD800-\uDBFF]$/.test(part) ? part.slice(0, -1) : part;
}

/** Read-only adaptation of native Chat/Artifact ports; never creates or confirms a record. */
export async function loadAidtSavedChatContext({ projectId, sessionToken, references, signal }: {
  projectId: string;
  sessionToken: string;
  references: readonly AidtSavedContextReference[];
  signal?: AbortSignal;
}): Promise<AidtSavedChatContext> {
  const assertCurrent = () => { if (signal?.aborted || !isAidtModuleEnabled()) throw new Error("AIDT_CONTEXT_CHANGED"); };
  assertCurrent();
  if (!references.length) return AIDT_EMPTY_SAVED_CONTEXT;
  if (references.length > MAX_REFERENCES) return { status: "failed", items: [], issues: [{ stageNumber: 0, reason: "limit" }] };
  const threads = new Map<string, Promise<Awaited<ReturnType<typeof listThreadArtifacts>>>>();
  const readThread = (threadId: string) => {
    const prior = threads.get(threadId); if (prior) return prior;
    const task = (async () => {
      assertCurrent();
      const result = await getThread(threadId, projectId, sessionToken); assertCurrent();
      if (result.thread.projectId !== projectId || result.thread.visibilityScope !== "plenary") throw new ContextReadIssue("unavailable");
      const artifacts = await listThreadArtifacts(threadId, projectId, sessionToken); assertCurrent(); return artifacts;
    })();
    threads.set(threadId, task); return task;
  };
  const items: AidtSavedContextItem[] = [], issues: AidtSavedContextIssue[] = [], seen = new Set<string>();
  let remaining = MAX_TOTAL_CHARS;
  // Bounded sequential reads avoid loading an entire group's history or flooding the service.
  for (const ref of references) {
    assertCurrent();
    const key = JSON.stringify([ref.stageNumber, ref.threadId, ref.artifactId]); if (seen.has(key)) continue; seen.add(key);
    try {
      if (!Number.isInteger(ref.stageNumber) || ref.stageNumber < 1 || ref.stageNumber > 6 || !ref.threadId || !ref.artifactId) throw new ContextReadIssue("unavailable");
      const list = await readThread(ref.threadId); assertCurrent();
      const artifact = list.items.find((entry) => entry.artifactId === ref.artifactId);
      if (!artifact?.hasSource) throw new ContextReadIssue("unavailable");
      if (artifact.mode === "draft" && !ref.includePrivateDraft) throw new ContextReadIssue("private-draft");
      const source = await getThreadArtifactSource(ref.threadId, ref.artifactId, projectId, sessionToken); assertCurrent();
      if (ref.expectedImmutableRevision && source.immutableRevision !== ref.expectedImmutableRevision) throw new ContextReadIssue("version-changed");
      if (source.version !== artifact.version) throw new ContextReadIssue("version-changed");
      if (!source.markdown.trim()) throw new ContextReadIssue("unavailable");
      if (remaining <= 0) throw new ContextReadIssue("limit");
      const markdown = clip(source.markdown, Math.min(MAX_ITEM_CHARS, remaining)); remaining -= markdown.length;
      items.push({ stageNumber: ref.stageNumber, threadId: ref.threadId, artifactId: ref.artifactId, messageId: artifact.messageId, title: artifact.title,
        mode: artifact.mode, immutableRevision: source.immutableRevision, version: source.version, savedBy: source.savedBy, savedAt: source.savedAt,
        markdown, truncated: markdown.length < source.markdown.length, reviewStatus: "not-confirmed", evidenceStatus: "not-verified",
        visibility: artifact.mode === "draft" ? "private-draft-explicitly-shared" : "group-source" });
    } catch (error: unknown) {
      assertCurrent();
      issues.push({ stageNumber: ref.stageNumber, reason: error instanceof ContextReadIssue ? error.reason : "unavailable" });
    }
  }
  return { status: issues.length ? items.length ? "partial" : "failed" : "ready", items, issues };
}
