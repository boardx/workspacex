import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import { z } from "zod";
import { chat, project } from "@repo/contracts";
import { ApiError, apiRequest } from "@/lib/api-client";
import { getThread, getThreadArtifactSource, landAsArtifact, listThreadArtifacts } from "@/lib/live-chat";
import { isAidtModuleEnabled } from "./aidt-module-config";

export type AidtStageId = 1 | 2 | 3 | 4 | 5 | 6;
export type AidtPersonalStageScope = { orgId: string; userId: string; projectId: string; sessionToken: string };
export type AidtPersonalStageHead = { artifactId: string; immutableRevision: string };
export type AidtPersonalStageCheckpoint = AidtPersonalStageHead & {
  threadId: string; messageId: string; stageId: AidtStageId; draft: AidtUiStageDraft;
  savedAt: string; savedBy: string; operationId: string;
  parent: AidtPersonalStageHead | null; visibility: "personal-draft";
};
export type AidtPersonalStageLoadResult = { checkpoints: AidtPersonalStageCheckpoint[]; heads: AidtPersonalStageCheckpoint[] };
export type AidtPersonalStageLoadInput = { threadId: string; stageId: number; signal?: AbortSignal };
export type AidtPersonalStageSaveInput = AidtPersonalStageLoadInput & {
  messageId: string; draft: AidtUiStageDraft; expectedHead: AidtPersonalStageHead | null; operationId: string; readOnly?: boolean;
};
export type AidtPersonalCheckpointErrorCode =
  | "AIDT_PERSONAL_CHECKPOINT_DISABLED" | "AIDT_CONTEXT_CHANGED" | "AIDT_PERSONAL_CHECKPOINT_INVALID"
  | "AIDT_PERSONAL_CHECKPOINT_TOO_LARGE" | "AIDT_PERSONAL_CHECKPOINT_READONLY" | "AIDT_PERSONAL_CHECKPOINT_SOURCE_REQUIRED"
  | "AIDT_PERSONAL_CHECKPOINT_CONFLICT" | "AIDT_PERSONAL_CHECKPOINT_WRITE_UNCONFIRMED";
export class AidtPersonalCheckpointError extends Error {
  constructor(public readonly code: AidtPersonalCheckpointErrorCode, message: string,
    public readonly heads: readonly AidtPersonalStageCheckpoint[] = [],
    public readonly checkpoint?: AidtPersonalStageCheckpoint, public readonly artifactId?: string) { super(message); this.name = "AidtPersonalCheckpointError"; }
}

const FORMAT = "workspacex.aidt.personal-stage";
const headSchema = z.object({ artifactId: z.string().min(1), immutableRevision: z.string().regex(/^artifact-v1:[1-9][0-9]*$/) }).strict();
// This is a versioned text-file format, not a new service contract. Extension
// properties survive a round-trip; known authored fields are validated in full.
const draftSchema = z.object({
  fields: z.record(z.string()), selectedIdeaId: z.string(),
  ideas: z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), image: z.string().optional(), imageName: z.string().optional() }).passthrough()),
  selectionReasons: z.record(z.string()).optional(), unboundReason: z.string().optional(),
  discoveryCards: z.array(z.object({ id: z.string(), participantCode: z.string(), headline: z.string(), headlineKind: z.enum(["quote", "student-summary"]), context: z.string(), quote: z.string(), sourceRef: z.string(), photoRef: z.string() }).passthrough()).optional(),
}).passthrough();
const fileSchema = z.object({
  format: z.literal(FORMAT), schemaVersion: z.literal(1), contentOrigin: z.literal("student-authored-unverified"), recordKind: z.literal("working-draft-not-original-evidence"), visibility: z.literal("personal-draft"),
  orgId: z.string().min(1), projectId: z.string().min(1), ownerId: z.string().min(1),
  threadId: z.string().min(1), sourceMessageId: z.string().min(1), stageId: z.number().int().min(1).max(6),
  operationId: z.string().min(1).max(200), parent: headSchema.nullable(), draft: draftSchema,
}).strict();
type CheckpointFile = z.infer<typeof fileSchema>;
type Thread = Awaited<ReturnType<typeof getThread>>;
type ReadSource = Awaited<ReturnType<typeof getThreadArtifactSource>>;
const invalid = (message: string) => new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_INVALID", message);
const title = (stageId: number) => `[AIDT personal-stage:v1:${stageId}] 学生填写的个人检查点`;

function assertCurrent(scope: AidtPersonalStageScope, input: AidtPersonalStageLoadInput): asserts input is AidtPersonalStageLoadInput & { stageId: AidtStageId } {
  if (!isAidtModuleEnabled()) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_DISABLED", "教学模块未启用，未读取或保存检查点。");
  if (input.signal?.aborted) throw new AidtPersonalCheckpointError("AIDT_CONTEXT_CHANGED", "上下文已变化，已停止当前检查点操作。");
  if (![scope.orgId, scope.userId, scope.projectId, scope.sessionToken, input.threadId].every(value => typeof value === "string" && value.trim())) throw invalid("缺少完整的小组、用户或会话上下文。");
  if (!Number.isInteger(input.stageId) || input.stageId < 1 || input.stageId > 6) throw invalid("阶段必须是1至6。");
}
function assertJson(value: unknown, stack = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || value === undefined) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || stack.has(value)) throw invalid("草稿含有不能保存为文本的内容。");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw invalid("草稿只支持结构化文字与已有材料引用。");
  stack.add(value); Object.values(value).forEach(child => assertJson(child, stack)); stack.delete(value);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function readThread(scope: AidtPersonalStageScope, input: AidtPersonalStageLoadInput): Promise<Thread> {
  assertCurrent(scope, input);
  const thread = chat.operations.getThread.out.parse(await getThread(input.threadId, scope.projectId, scope.sessionToken));
  assertCurrent(scope, input);
  if (thread.thread.id !== input.threadId || thread.thread.projectId !== scope.projectId) throw invalid("所选对话不属于当前小组。");
  return thread;
}
function decode(scope: AidtPersonalStageScope, input: AidtPersonalStageLoadInput, artifactId: string, messageId: string, source: ReadSource): AidtPersonalStageCheckpoint {
  let file: CheckpointFile;
  try { file = fileSchema.parse(JSON.parse(source.markdown)); assertJson(file); } catch { throw invalid("个人检查点内容损坏或格式不受支持，未把读取失败当作空白。"); }
  if (file.orgId !== scope.orgId || file.projectId !== scope.projectId || file.ownerId !== scope.userId || source.savedBy !== scope.userId || file.threadId !== input.threadId || file.stageId !== input.stageId || file.sourceMessageId !== messageId) throw invalid("检查点的作者、阶段或来源与当前上下文不一致。");
  return { artifactId, immutableRevision: source.immutableRevision, threadId: input.threadId, messageId, stageId: file.stageId as AidtStageId, draft: file.draft, savedAt: source.savedAt, savedBy: source.savedBy, operationId: file.operationId, parent: file.parent, visibility: "personal-draft" };
}
function headsOf(checkpoints: AidtPersonalStageCheckpoint[]): AidtPersonalStageCheckpoint[] {
  const referenced = new Set(checkpoints.flatMap(c => c.parent ? [`${c.parent.artifactId}\n${c.parent.immutableRevision}`] : []));
  const heads = checkpoints.filter(c => !referenced.has(`${c.artifactId}\n${c.immutableRevision}`));
  if (checkpoints.length && !heads.length) throw invalid("检查点来源关系异常，未自动选择内容。");
  return heads;
}
async function readCheckpoints(scope: AidtPersonalStageScope, input: AidtPersonalStageLoadInput): Promise<AidtPersonalStageLoadResult> {
  assertCurrent(scope, input);
  const listed = chat.operations.listThreadArtifacts.out.parse(await listThreadArtifacts(input.threadId, scope.projectId, scope.sessionToken));
  assertCurrent(scope, input);
  const matches = listed.items.filter(item => item.title === title(input.stageId));
  if (matches.some(item => item.mode !== "draft")) throw invalid("一个检查点已改变落地模式，不能把它当作仅自己可见的草稿。");
  const checkpoints: AidtPersonalStageCheckpoint[] = [];
  // Read in bounded batches rather than issuing one request per historical row at once.
  for (let offset = 0; offset < matches.length; offset += 6) {
    const batch = await Promise.all(matches.slice(offset, offset + 6).map(async item => {
      const source = chat.operations.getThreadArtifactSource.out.parse(await getThreadArtifactSource(input.threadId, item.artifactId, scope.projectId, scope.sessionToken));
      assertCurrent(scope, input);
      return decode(scope, input, item.artifactId, item.messageId, source);
    }));
    assertCurrent(scope, input); checkpoints.push(...batch);
  }
  checkpoints.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.artifactId.localeCompare(b.artifactId));
  return { checkpoints, heads: headsOf(checkpoints) };
}
export async function loadAidtPersonalStageCheckpoints(scopeInput: AidtPersonalStageScope, input: AidtPersonalStageLoadInput): Promise<AidtPersonalStageLoadResult> {
  const scope = { ...scopeInput }, request = { ...input };
  await readThread(scope, request);
  return readCheckpoints(scope, request);
}
function sameHead(a: AidtPersonalStageHead, b: AidtPersonalStageHead): boolean { return a.artifactId === b.artifactId && a.immutableRevision === b.immutableRevision; }
const pendingSaves = new Map<string, { signature: string; signal?: AbortSignal; task: Promise<AidtPersonalStageCheckpoint> }>();

/** Explicit personal draft only. Never creates a Chat message/run or appends to an existing Artifact. */
export function saveAidtPersonalStageCheckpoint(scopeInput: AidtPersonalStageScope, input: AidtPersonalStageSaveInput): Promise<AidtPersonalStageCheckpoint> {
  try {
    const scope = { ...scopeInput }, request = { ...input };
    assertCurrent(scope, request);
    if (request.readOnly) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_READONLY", "当前小组只读，未保存个人检查点。");
    assertJson(request.draft);
    if (request.expectedHead === undefined) throw invalid("保存前必须明确当前检查点或首次保存状态。");
    const parent = request.expectedHead === null ? null : { artifactId: request.expectedHead.artifactId, immutableRevision: request.expectedHead.immutableRevision };
    const file = fileSchema.parse({ format: FORMAT, schemaVersion: 1, contentOrigin: "student-authored-unverified", recordKind: "working-draft-not-original-evidence", visibility: "personal-draft", orgId: scope.orgId, projectId: scope.projectId, ownerId: scope.userId, threadId: request.threadId, sourceMessageId: request.messageId, stageId: request.stageId, operationId: request.operationId, parent, draft: JSON.parse(JSON.stringify(request.draft)) });
    request.draft = file.draft; request.expectedHead = file.parent;
    const payload = JSON.stringify(file), signature = stable(file);
    // Other endpoints have larger parsers; this existing landing route retains
    // Express's 100 KiB parser. Include its actual request envelope in the check.
    if (new TextEncoder().encode(JSON.stringify({ threadId: request.threadId, messageId: request.messageId, mode: "draft", title: title(request.stageId), payloadRef: payload })).byteLength > 100 * 1024) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_TOO_LARGE", "内容超出现有保存端口容量。请先上传大图或附件，再在草稿中填写引用。");
    const key = JSON.stringify([scope.orgId, scope.userId, scope.projectId, scope.sessionToken, request.threadId, request.stageId, request.operationId]);
    const pending = pendingSaves.get(key);
    if (pending) {
      if (pending.signature !== signature) throw invalid("同一次保存标识不能对应不同内容。");
      if (pending.signal !== request.signal) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_WRITE_UNCONFIRMED", "另一个保存操作仍在进行，请先重新读取，避免重复保存。");
      return pending.task;
    }
    const task = save(scope, request, file, payload).finally(() => { if (pendingSaves.get(key)?.task === task) pendingSaves.delete(key); });
    pendingSaves.set(key, { signature, signal: request.signal, task });
    return task;
  } catch (error) { return Promise.reject(error instanceof z.ZodError ? invalid("检查点字段或来源不完整，未保存。") : error); }
}
async function save(scope: AidtPersonalStageScope, input: AidtPersonalStageSaveInput, file: CheckpointFile, payload: string): Promise<AidtPersonalStageCheckpoint> {
  const thread = await readThread(scope, input);
  if (thread.thread.archived || !thread.capabilities.includes("composer.send")) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_READONLY", "当前对话没有写入权限，未保存个人检查点。");
  const op = project.operations.getProjectOverview;
  const overview = op.out.parse(await apiRequest<unknown>(op.path.replace(":projectId", encodeURIComponent(scope.projectId)), { method: op.method, sessionToken: scope.sessionToken, signal: input.signal }));
  assertCurrent(scope, input);
  if (overview.projectId !== scope.projectId || overview.status !== "active") throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_READONLY", "项目已归档或上下文不符，未保存个人检查点。");
  const before = await readCheckpoints(scope, input);
  const sameOperation = before.checkpoints.filter(c => c.operationId === file.operationId);
  if (sameOperation.length > 1) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_CONFLICT", "检测到重复保存分支，请选择并核对，不再重复创建。", before.heads);
  if (sameOperation.length === 1) {
    const existing = sameOperation[0]!;
    if (existing.messageId !== input.messageId || stable(existing.draft) !== stable(file.draft) || stable(existing.parent) !== stable(file.parent)) throw invalid("同一次保存标识已有不同内容，未覆盖原检查点。");
    return existing;
  }
  if (before.heads.length > 1 || (input.expectedHead === null ? before.heads.length !== 0 : before.heads.length !== 1 || !sameHead(before.heads[0]!, input.expectedHead))) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_CONFLICT", "服务器检查点已变化，请先读取并比较；本页文字仍保留。", before.heads);
  if (!thread.messages.some(message => message.id === input.messageId && message.authorKind === "human")) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_SOURCE_REQUIRED", "请显式选择本步已有的学生消息作来源；不会自动创建消息或调用模型。");
  assertCurrent(scope, input);
  let artifactId: string;
  try {
    const landed = chat.operations.landAsArtifact.out.parse(await landAsArtifact(input.threadId, { messageId: input.messageId, mode: "draft", title: title(input.stageId), payloadRef: payload }, scope.sessionToken));
    assertCurrent(scope, input); artifactId = landed.artifactId;
    if (landed.mode !== "draft" || landed.provenanceBacklink.conversationId !== input.threadId || landed.provenanceBacklink.messageId !== input.messageId) throw invalid("保存回执的模式或来源与请求不一致。");
  } catch (error) {
    if (error instanceof AidtPersonalCheckpointError) throw error;
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw error;
    throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_WRITE_UNCONFIRMED", "保存结果尚未确认。请先重新读取个人检查点，再决定是否重试；本页草稿保留。");
  }
  let checkpoint: AidtPersonalStageCheckpoint;
  try {
    const source = chat.operations.getThreadArtifactSource.out.parse(await getThreadArtifactSource(input.threadId, artifactId, scope.projectId, scope.sessionToken));
    assertCurrent(scope, input);
    checkpoint = decode(scope, input, artifactId, input.messageId, source);
    if (checkpoint.operationId !== file.operationId || stable(checkpoint.draft) !== stable(file.draft) || stable(checkpoint.parent) !== stable(file.parent)) throw invalid("保存内容回读不一致。");
    const after = await readCheckpoints(scope, input);
    if (!after.checkpoints.some(c => sameHead(c, checkpoint))) throw invalid("保存结果尚未出现在个人检查点列表中。");
    if (after.heads.length !== 1 || !sameHead(after.heads[0]!, checkpoint)) throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_CONFLICT", "保存后检测到并发分支，已保留各份检查点，请核对选择。", after.heads, checkpoint, artifactId);
  } catch (error) {
    if (error instanceof AidtPersonalCheckpointError && ["AIDT_CONTEXT_CHANGED", "AIDT_PERSONAL_CHECKPOINT_DISABLED", "AIDT_PERSONAL_CHECKPOINT_CONFLICT"].includes(error.code)) throw error;
    throw new AidtPersonalCheckpointError("AIDT_PERSONAL_CHECKPOINT_WRITE_UNCONFIRMED", "服务器已接收保存，但未能完整核对回读。请先重新读取；本页草稿保留。", [], undefined, artifactId);
  }
  return checkpoint;
}
