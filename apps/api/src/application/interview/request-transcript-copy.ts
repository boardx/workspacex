/**
 * `requestTranscriptCopy`（F96 / uc-6-6 R3 能力二）—— 索取本人逐字稿副本。
 *
 * ⚠ 副本**只含本人发言**——过滤在这里做，不委托给存储层：`TranscriptCopySourceReader`
 *   返回该场**全部**发言（含他人），本函数按 `speakerSubjectId === 本人` 过滤后才落盘（AC4）。
 * ⚠ 契约的 `err` 列表里**没有 `TOKEN_INVALID`**（只有 `TOKEN_SCOPE_VIOLATION`）——
 *   与 `getPortalView`/`updateConsentFromPortal` 不同，这里令牌失效统一走
 *   `TOKEN_SCOPE_VIOLATION`，不是文案疏漏，是契约本身对这三个「门户内动作」端口
 *   （本操作 / `requestErasure` / `listSubjectRequests`）做的合并（见 `usecases.md` G 组）。
 * ⚠ 生成失败**可重试，不静默失败**（E5）——失败时不落任何 `SubjectRequest` 记录，
 *   受访者再点一次就是一次全新的调用，不存在"卡在半失败状态"的记录需要清理。
 */
import { CopyGenerationFailedError, TokenScopeViolationError } from "./errors";
import type { PortalTokenRepository } from "./consent-token-ports";
import type {
  SubjectRequestRepository,
  TranscriptCopyFileStore,
  TranscriptCopySourceReader,
} from "./portal-ports";

export interface RequestTranscriptCopyDeps {
  readonly portalTokens: PortalTokenRepository;
  readonly transcripts: TranscriptCopySourceReader;
  readonly files: TranscriptCopyFileStore;
  readonly subjectRequests: SubjectRequestRepository;
  readonly newRequestId?: () => string;
  readonly now?: () => Date;
}

export interface RequestTranscriptCopyInput {
  readonly portalToken: string;
}

export interface RequestTranscriptCopyOutput {
  readonly requestId: string;
  readonly status: string;
  readonly downloadUrl: string | null;
  readonly expiresAt: string | null;
}

let seq = 0;

export async function requestTranscriptCopy(
  deps: RequestTranscriptCopyDeps,
  input: RequestTranscriptCopyInput,
): Promise<RequestTranscriptCopyOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const lookup = await deps.portalTokens.findActive(input.portalToken, now);
  if (!lookup.ok) throw new TokenScopeViolationError();
  const { subjectId, interviewId } = lookup.row;

  const allLines = await deps.transcripts.linesFor(interviewId);
  // AC4：只含本人发言——不含他人发言、研究员笔记、AI 建议、主题与洞察。这些其他类别
  // 在本仓的模型里根本不是 `TranscriptLine`（它只承载「某个 subject 说的一句话」），
  // 所以这里唯一需要做的过滤就是按 speaker 过滤，没有第二道"排除笔记/建议"的分支。
  const ownLines = allLines.filter((l) => l.speakerSubjectId === subjectId).map((l) => l.text);

  let file;
  try {
    file = await deps.files.put(subjectId, ownLines, now);
  } catch {
    throw new CopyGenerationFailedError();
  }

  const requestId = (deps.newRequestId ?? (() => `sreq-copy-${++seq}`))();
  await deps.subjectRequests.create({
    requestId,
    subjectId,
    kind: "transcript-copy",
    createdAt: now,
    withdrawalId: null,
    // ⚠ 这里的 `fixedEtaAt` 是「请求本身的预计完成时间」，不是下载链接的到期时间——
    //   请求在这次调用内已经完成，所以是 `null`；链接到期时间只在这次调用的响应体里给出。
    fixedStatus: "已生成，链接短时效且一次性",
    fixedEtaAt: null,
  });

  return {
    requestId,
    status: "已生成，链接短时效且一次性",
    downloadUrl: file.downloadUrl,
    expiresAt: file.expiresAt.toISOString(),
  };
}
