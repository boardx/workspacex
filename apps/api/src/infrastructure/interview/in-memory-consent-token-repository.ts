/**
 * In-memory 实现（F86）—— 两种令牌 + 渲染快照的仓储。
 *
 * ⚠ 这是**过渡实现**，不是最终形态：真正的 Postgres 版本需要访谈/受访者的持久化表，
 * 而那张地基（F82「访谈范围模型」以外，受访者/subject 的落库）在本 feature 开工时
 * 仍在并发实现、尚未合并 main。F86 的 issue 明确允许「实现你自己的最小端口 stub」，
 * 这份文件就是那个 stub：接口形状（`SigningTokenRepository` / `PortalTokenRepository` /
 * `ConsentSnapshotRepository`）与真正的 Postgres 版本一致，换掉这一个文件、
 * 不改调用方（三个 use case），是这层抽象存在的全部意义。
 *
 * 进程内、不跨副本、重启即丢——与 `in-memory-session-store.ts` 同一立场，直说而不是藏。
 *
 * ⚠ 「条件核销」在这里用「Map 里查出来后立刻同步改写」模拟条件 UPDATE 的原子性：
 *   Node 单线程 + 没有 `await` 穿插在读判定与写之间，这段临界区不会被并发请求打断。
 *   真正的 Postgres 版本仍然必须是一条 `UPDATE … WHERE consumed_at IS NULL` 的语句，
 *   不能照抄这里的「先读后写」写法——那边有真正的并发。
 */
import type { ConsentRenderParams } from "../../domain/interview/consent-token";
import type {
  ConsentRenderParamsProvider,
  ConsentSessionFacts,
  ConsentSessionFactsProvider,
  ConsentSnapshotInput,
  ConsentSnapshotRepository,
  ConsentSnapshotRow,
  ConsumeSigningTokenInput,
  IssuePortalTokenInput,
  IssueSigningTokenInput,
  PortalTokenLookupResult,
  PortalTokenRepository,
  PortalTokenRow,
  SigningTokenLookupResult,
  SigningTokenRepository,
  SigningTokenRow,
} from "../../application/interview/consent-token-ports";

export class InMemorySigningTokenRepository implements SigningTokenRepository {
  private readonly byToken = new Map<string, SigningTokenRow>();

  async issue(input: IssueSigningTokenInput): Promise<SigningTokenRow> {
    const row: SigningTokenRow = {
      tokenId: input.tokenId,
      token: input.token,
      interviewId: input.interviewId,
      subjectId: input.subjectId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      consumedAt: null,
      revokedAt: null,
    };
    this.byToken.set(input.token, row);
    return row;
  }

  async findActive(token: string, now: Date): Promise<SigningTokenLookupResult> {
    const row = this.byToken.get(token);
    return this.classify(row, now);
  }

  async consume(input: ConsumeSigningTokenInput): Promise<SigningTokenLookupResult> {
    const row = this.byToken.get(input.token);
    const classified = this.classify(row, input.now);
    if (!classified.ok) return classified;

    // 条件写：本进程内没有 await 穿插，这里的「读了再写」等价于一次原子核销。
    const consumed: SigningTokenRow = { ...classified.row, consumedAt: input.now };
    this.byToken.set(input.token, consumed);
    return { ok: true, row: consumed };
  }

  private classify(row: SigningTokenRow | undefined, now: Date): SigningTokenLookupResult {
    if (row === undefined) return { ok: false, reason: "not-found" };
    if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
    if (row.consumedAt !== null) return { ok: false, reason: "consumed" };
    if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
    return { ok: true, row };
  }
}

export class InMemoryPortalTokenRepository implements PortalTokenRepository {
  private readonly byToken = new Map<string, PortalTokenRow>();
  private readonly byTokenId = new Map<string, string>();

  async issue(input: IssuePortalTokenInput): Promise<PortalTokenRow> {
    const row: PortalTokenRow = {
      tokenId: input.tokenId,
      token: input.token,
      interviewId: input.interviewId,
      subjectId: input.subjectId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.byToken.set(input.token, row);
    this.byTokenId.set(input.tokenId, input.token);
    return row;
  }

  async findActive(token: string, now: Date): Promise<PortalTokenLookupResult> {
    const row = this.byToken.get(token);
    if (row === undefined) return { ok: false, reason: "not-found" };
    if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
    if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
    return { ok: true, row };
  }

  async findByTokenId(tokenId: string): Promise<PortalTokenRow | null> {
    const token = this.byTokenId.get(tokenId);
    if (token === undefined) return null;
    return this.byToken.get(token) ?? null;
  }

  async revoke(tokenId: string, now: Date): Promise<{ readonly revoked: boolean }> {
    const token = this.byTokenId.get(tokenId);
    if (token === undefined) return { revoked: false };
    const row = this.byToken.get(token);
    if (row === undefined) return { revoked: false };
    if (row.revokedAt !== null) return { revoked: false }; // 幂等重放：已撤销过，本次未新撤销任何东西
    this.byToken.set(token, { ...row, revokedAt: now });
    return { revoked: true };
  }
}

export class InMemoryConsentSnapshotRepository implements ConsentSnapshotRepository {
  private readonly bySnapshotId = new Map<string, ConsentSnapshotRow>();
  // F96：按 (interviewId, subjectId) 找到最早落盘的那一份——门户回看用的是原始快照，
  // 不是最近一次；同一受访者只会有一份 submitConsent 产出的原始快照。
  private readonly bySubject = new Map<string, string>();

  async save(input: ConsentSnapshotInput): Promise<ConsentSnapshotRow> {
    const row: ConsentSnapshotRow = { ...input };
    this.bySnapshotId.set(input.snapshotId, row);
    const key = `${input.interviewId}:${input.subjectId}`;
    if (!this.bySubject.has(key)) this.bySubject.set(key, input.snapshotId);
    return row;
  }

  /** 测试直读，绕过用例层，用来断言"存储里到底存的是什么"（同 `consent-render-fakes.ts` 的 `peek` 纪律）。 */
  peek(snapshotId: string): ConsentSnapshotRow | undefined {
    return this.bySnapshotId.get(snapshotId);
  }

  async findBySubject(interviewId: string, subjectId: string): Promise<ConsentSnapshotRow | null> {
    const snapshotId = this.bySubject.get(`${interviewId}:${subjectId}`);
    if (snapshotId === undefined) return null;
    return this.bySnapshotId.get(snapshotId) ?? null;
  }
}

/** 测试/开发期的固定渲染变量来源——真正实现读项目的「材料保留期」等参数（F82 之后接入）。 */
export class FixedConsentRenderParamsProvider implements ConsentRenderParamsProvider {
  constructor(private readonly byInterviewId: Map<string, Partial<ConsentRenderParams> | null>) {}

  async get(interviewId: string): Promise<Partial<ConsentRenderParams> | null> {
    return this.byInterviewId.get(interviewId) ?? null;
  }
}

export class FixedConsentSessionFactsProvider implements ConsentSessionFactsProvider {
  constructor(private readonly byKey: Map<string, ConsentSessionFacts>) {}

  async get(interviewId: string, subjectId: string): Promise<ConsentSessionFacts> {
    const facts = this.byKey.get(`${interviewId}:${subjectId}`);
    if (facts === undefined) {
      throw new Error(
        `FixedConsentSessionFactsProvider: no facts registered for ${interviewId}/${subjectId}`,
      );
    }
    return facts;
  }
}
