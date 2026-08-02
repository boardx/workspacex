/**
 * F96 —— 内存实现，供单元测试对自助门户三项能力做纯编排断言。
 *
 * 同 `in-memory-consent-token-repository.ts`（F86）/`in-memory-withdrawal-repository.ts`
 * （F89）一个立场：本 feature 依赖的门户侧持久化地基（当前同意位历史/请求台账/文字稿存储）
 * 尚未落地为 Postgres 实现，这里只提供内存版本把编排逻辑跑通，不冒充生产可用。
 */
import { randomUUID } from "node:crypto";
import type { ConsentBits } from "../../domain/interview/portal-request";
import type {
  AppendConsentBitsChangeInput,
  ConsentBitsChangeRecord,
  CreateSubjectRequestInput,
  PortalConsentStateRepository,
  SubjectRequestRepository,
  SubjectRequestRow,
  TranscriptCopyFile,
  TranscriptCopyFileStore,
  TranscriptCopySourceReader,
  TranscriptLine,
} from "../../application/interview/portal-ports";

export class InMemoryPortalConsentStateRepository implements PortalConsentStateRepository {
  private readonly bySubject = new Map<string, ConsentBitsChangeRecord>();
  /** 测试断言用：全部历史版本，按追加顺序——证明「追加不覆盖」（I-16）。 */
  readonly history: (AppendConsentBitsChangeInput & { readonly bits: ConsentBits })[] = [];

  async getCurrentBits(subjectId: string): Promise<ConsentBitsChangeRecord | null> {
    return this.bySubject.get(subjectId) ?? null;
  }

  async appendChange(input: AppendConsentBitsChangeInput): Promise<void> {
    this.history.push(input);
    this.bySubject.set(input.subjectId, { bits: input.bits, changedAt: input.changedAt });
  }
}

export class InMemorySubjectRequestRepository implements SubjectRequestRepository {
  private readonly rows: SubjectRequestRow[] = [];

  async create(input: CreateSubjectRequestInput): Promise<SubjectRequestRow> {
    const row: SubjectRequestRow = { ...input };
    this.rows.push(row);
    return row;
  }

  async listBySubject(subjectId: string): Promise<readonly SubjectRequestRow[]> {
    return this.rows.filter((r) => r.subjectId === subjectId);
  }
}

export class FixedTranscriptCopySourceReader implements TranscriptCopySourceReader {
  constructor(private readonly byInterviewId: Map<string, readonly TranscriptLine[]>) {}

  async linesFor(interviewId: string): Promise<readonly TranscriptLine[]> {
    return this.byInterviewId.get(interviewId) ?? [];
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class InMemoryTranscriptCopyFileStore implements TranscriptCopyFileStore {
  readonly filesBySubject = new Map<string, readonly string[]>();
  /** 测试注入：下一次 `put` 强制失败一次，模拟 E5「生成失败，可重试」。 */
  failNextCall = false;

  async put(subjectId: string, lines: readonly string[], now: Date): Promise<TranscriptCopyFile> {
    if (this.failNextCall) {
      this.failNextCall = false;
      throw new Error("simulated transcript copy generation failure");
    }
    this.filesBySubject.set(subjectId, lines);
    return {
      downloadUrl: `https://files.workspacex.invalid/transcript-copy/${randomUUID()}`,
      // 短时效——这里取 1 天，具体时长本身未裁（D-8），只证明"不是永久链接"。
      expiresAt: new Date(now.getTime() + DAY_MS),
    };
  }
}
