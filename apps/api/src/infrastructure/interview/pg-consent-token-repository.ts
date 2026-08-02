/**
 * PostgreSQL 实现（F86 / #356）—— 替换 `in-memory-consent-token-repository.ts`。
 *
 * ## 为什么全部方法都用 `db.withoutTenant`
 *
 * 见迁移 `20260803000000_f86_consent_token_pg.sql` 文件头：这三张表故意没有
 * `org_id` 列、没有 RLS——F86 的五个用例本身就没有 orgId 流过来（受访者是揣着
 * URL 里的令牌点进来的匿名访问者）。`withTenant` 在这里既拿不到 orgId 参数，
 * 也没有意义可言；`withoutTenant` 如实反映"这条路径此刻没有租户上下文"。
 *
 * ## 条件核销 = 一条 WHERE，不是「先查后写」
 *
 * `consume()` 与 `pg-invite-link-repository.ts` 的 `consume()` 同一条纪律：
 * 全部失效条件（未核销/未撤销/未过期）都在 UPDATE 的 WHERE 里，受影响行数是
 * 「恰好一次」的唯一证明。命中零行之后**重新读一次**分类到底是哪一种失败，
 * 不能复用 UPDATE 之前的旧快照——并发的第二路要看到第一路刚写下的 consumed_at。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
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

interface SigningTokenDbRow {
  token_id: string;
  token: string;
  interview_id: string;
  subject_id: string;
  issued_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
}

const SIGNING_COLUMNS = `token_id, token, interview_id, subject_id, issued_at, expires_at, consumed_at, revoked_at`;

function toSigningRow(r: SigningTokenDbRow): SigningTokenRow {
  return {
    tokenId: r.token_id,
    token: r.token,
    interviewId: r.interview_id,
    subjectId: r.subject_id,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    consumedAt: r.consumed_at,
    revokedAt: r.revoked_at,
  };
}

/** 与 in-memory 实现的 `classify` 逐字同形——分类规则本身不该因换了存储层而漂移。 */
function classifySigning(
  row: SigningTokenDbRow | undefined,
  now: Date,
): SigningTokenLookupResult {
  if (row === undefined) return { ok: false, reason: "not-found" };
  if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
  if (row.consumed_at !== null) return { ok: false, reason: "consumed" };
  if (row.expires_at.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, row: toSigningRow(row) };
}

export class PgSigningTokenRepository implements SigningTokenRepository {
  constructor(private readonly db: DatabasePort) {}

  async issue(input: IssueSigningTokenInput): Promise<SigningTokenRow> {
    return this.db.withoutTenant(async (s) => {
      await s.query(
        `INSERT INTO interview_signing_tokens
           (token_id, token, interview_id, subject_id, issued_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.tokenId, input.token, input.interviewId, input.subjectId, input.issuedAt, input.expiresAt],
      );
      return {
        tokenId: input.tokenId,
        token: input.token,
        interviewId: input.interviewId,
        subjectId: input.subjectId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        consumedAt: null,
        revokedAt: null,
      };
    });
  }

  async findActive(token: string, now: Date): Promise<SigningTokenLookupResult> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<SigningTokenDbRow>(
        `SELECT ${SIGNING_COLUMNS} FROM interview_signing_tokens WHERE token = $1`,
        [token],
      );
      return classifySigning(r.rows[0], now);
    });
  }

  async consume(input: ConsumeSigningTokenInput): Promise<SigningTokenLookupResult> {
    return this.db.withoutTenant(async (s) => {
      // 🔴 全部失效条件都在这一条 WHERE 里——同 pg-invite-link-repository.ts consume() 的理由。
      const upd = await s.query<{ token_id: string }>(
        `UPDATE interview_signing_tokens
            SET consumed_at = $2
          WHERE token = $1
            AND consumed_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > $2
        RETURNING token_id`,
        [input.token, input.now],
      );

      if (upd.rows[0] !== undefined) {
        const r = await s.query<SigningTokenDbRow>(
          `SELECT ${SIGNING_COLUMNS} FROM interview_signing_tokens WHERE token = $1`,
          [input.token],
        );
        const row = r.rows[0];
        if (row === undefined) {
          throw new Error(`signing token ${input.token}: UPDATE 命中一行但紧接着的 SELECT 查不到它`);
        }
        return { ok: true, row: toSigningRow(row) };
      }

      // 零行：重新读一次分类到底是哪一种失败——不复用 UPDATE 之前的旧快照。
      const fresh = await s.query<SigningTokenDbRow>(
        `SELECT ${SIGNING_COLUMNS} FROM interview_signing_tokens WHERE token = $1`,
        [input.token],
      );
      const classified = classifySigning(fresh.rows[0], input.now);
      if (classified.ok) {
        throw new Error(
          `signing token ${input.token}: 条件 UPDATE 匹配零行，但分类判定为可用——` +
            `两处对同一行得出相反结论，分类漏了一个失效条件。`,
        );
      }
      return classified;
    });
  }
}

interface PortalTokenDbRow {
  token_id: string;
  token: string;
  interview_id: string;
  subject_id: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

const PORTAL_COLUMNS = `token_id, token, interview_id, subject_id, issued_at, expires_at, revoked_at`;

function toPortalRow(r: PortalTokenDbRow): PortalTokenRow {
  return {
    tokenId: r.token_id,
    token: r.token,
    interviewId: r.interview_id,
    subjectId: r.subject_id,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  };
}

function classifyPortal(row: PortalTokenDbRow | undefined, now: Date): PortalTokenLookupResult {
  if (row === undefined) return { ok: false, reason: "not-found" };
  if (row.revoked_at !== null) return { ok: false, reason: "revoked" };
  if (row.expires_at.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, row: toPortalRow(row) };
}

export class PgPortalTokenRepository implements PortalTokenRepository {
  constructor(private readonly db: DatabasePort) {}

  async issue(input: IssuePortalTokenInput): Promise<PortalTokenRow> {
    return this.db.withoutTenant(async (s) => {
      await s.query(
        `INSERT INTO interview_portal_tokens
           (token_id, token, interview_id, subject_id, issued_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [input.tokenId, input.token, input.interviewId, input.subjectId, input.issuedAt, input.expiresAt],
      );
      return {
        tokenId: input.tokenId,
        token: input.token,
        interviewId: input.interviewId,
        subjectId: input.subjectId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        revokedAt: null,
      };
    });
  }

  async findActive(token: string, now: Date): Promise<PortalTokenLookupResult> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<PortalTokenDbRow>(
        `SELECT ${PORTAL_COLUMNS} FROM interview_portal_tokens WHERE token = $1`,
        [token],
      );
      return classifyPortal(r.rows[0], now);
    });
  }

  async findByTokenId(tokenId: string): Promise<PortalTokenRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<PortalTokenDbRow>(
        `SELECT ${PORTAL_COLUMNS} FROM interview_portal_tokens WHERE token_id = $1`,
        [tokenId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toPortalRow(row);
    });
  }

  async revoke(tokenId: string, now: Date): Promise<{ readonly revoked: boolean }> {
    return this.db.withoutTenant(async (s) => {
      // 幂等：已撤销的再撤一次不算「新撤销了什么」（同 revoke-invite-links.ts 的立场）。
      const upd = await s.query<{ token_id: string }>(
        `UPDATE interview_portal_tokens
            SET revoked_at = $2
          WHERE token_id = $1 AND revoked_at IS NULL
        RETURNING token_id`,
        [tokenId, now],
      );
      return { revoked: upd.rows[0] !== undefined };
    });
  }
}

interface SnapshotDbRow {
  snapshot_id: string;
  submission_id: string;
  interview_id: string;
  subject_id: string;
  render_params: unknown;
  bit_record: boolean;
  bit_transcript: boolean;
  bit_ai_analysis: boolean;
  bit_attribution: boolean;
  submitted_at: Date;
}

const SNAPSHOT_COLUMNS = `snapshot_id, submission_id, interview_id, subject_id, render_params,
                          bit_record, bit_transcript, bit_ai_analysis, bit_attribution, submitted_at`;

function toSnapshotRow(row: SnapshotDbRow): ConsentSnapshotRow {
  return {
    snapshotId: row.snapshot_id,
    submissionId: row.submission_id,
    interviewId: row.interview_id,
    subjectId: row.subject_id,
    renderParams: row.render_params as ConsentSnapshotInput["renderParams"],
    bits: {
      record: row.bit_record,
      transcript: row.bit_transcript,
      ai_analysis: row.bit_ai_analysis,
      attribution: row.bit_attribution,
    },
    submittedAt: row.submitted_at,
  };
}

export class PgConsentSnapshotRepository implements ConsentSnapshotRepository {
  constructor(private readonly db: DatabasePort) {}

  async save(input: ConsentSnapshotInput): Promise<ConsentSnapshotRow> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<SnapshotDbRow>(
        `INSERT INTO interview_consent_snapshots
           (snapshot_id, submission_id, interview_id, subject_id, render_params,
            bit_record, bit_transcript, bit_ai_analysis, bit_attribution, submitted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING ${SNAPSHOT_COLUMNS}`,
        [
          input.snapshotId,
          input.submissionId,
          input.interviewId,
          input.subjectId,
          JSON.stringify(input.renderParams),
          input.bits.record,
          input.bits.transcript,
          input.bits.ai_analysis,
          input.bits.attribution,
          input.submittedAt,
        ],
      );
      const row = r.rows[0];
      if (row === undefined) {
        throw new Error(`interview_consent_snapshots: INSERT ... RETURNING 未返回任何行`);
      }
      return toSnapshotRow(row);
    });
  }

  /**
   * 「原始」快照 = 该 (interviewId, subjectId) 组合下 `submitted_at` 最早的一条
   * ——见 consent-token-ports.ts 的方法注释：这里找的是 `submitConsent` 那一次
   * 落盘的行，不随后续同意位变更历史改变。
   */
  async findBySubject(interviewId: string, subjectId: string): Promise<ConsentSnapshotRow | null> {
    return this.db.withoutTenant(async (s) => {
      const r = await s.query<SnapshotDbRow>(
        `SELECT ${SNAPSHOT_COLUMNS} FROM interview_consent_snapshots
          WHERE interview_id = $1 AND subject_id = $2
          ORDER BY submitted_at ASC, snapshot_id ASC
          LIMIT 1`,
        [interviewId, subjectId],
      );
      const row = r.rows[0];
      return row === undefined ? null : toSnapshotRow(row);
    });
  }
}
