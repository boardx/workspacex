/**
 * Ports for F86 —— 一次性签署令牌 + 门户长效令牌的持久化端口。
 *
 * ## 为什么「核销」（签署令牌换门户令牌）是一个方法而不是「查一下再插一条」
 *
 * 与 `invite-link-ports.ts` 头部注释同一条理由：拆成 `find` + `invalidate` + `issue`
 * 三步，调用方就必然写成先查后写，并发下两个受访者标签页同时点 `[确认并进入访谈]`
 * 会各自签出一枚门户令牌——签署令牌被「用过两次」，且没有任何报错。
 * ⇒ `consumeSigningToken` 是**一次条件写**（`WHERE consumed_at IS NULL`），
 * 真正的实现（Postgres）用条件 UPDATE 承载；本 feature 尚无可用的访谈/受访者持久化层
 * （F82 并发中未合并），因此这里只声明端口形状，配一个内存实现供本 feature 的
 * 单元测试与「先把编排跑通」使用——见 `infrastructure/interview/in-memory-consent-token-repository.ts`。
 *
 * ## 签署令牌与门户令牌为什么是两张表 / 两个方法族而不是一张「token」表 + kind 列
 *
 * 见 `domain/interview/consent-token.ts` 文件头：合并成一种令牌正是被 O-15 废弃的
 * 「24 小时单一令牌」路径。端口层延续这条分界——`SigningTokenRow` 与 `PortalTokenRow`
 * 是两个不同的类型，`issueSigningToken`/`issuePortalToken` 是两个不同的方法，
 * 没有一个「万能 token 表」的读写口子。
 */
import type { ConsentRenderParams } from "../../domain/interview/consent-token";

export type ConsentKeyValue = "record" | "transcript" | "ai_analysis" | "attribution";

export interface ConsentBitsValue {
  readonly record: boolean;
  readonly transcript: boolean;
  readonly ai_analysis: boolean;
  readonly attribution: boolean;
}

/* ─────────────────────────── 签署令牌 ─────────────────────────── */

export interface IssueSigningTokenInput {
  readonly tokenId: string;
  readonly token: string;
  readonly interviewId: string;
  readonly subjectId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface SigningTokenRow {
  readonly tokenId: string;
  readonly token: string;
  readonly interviewId: string;
  readonly subjectId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /** 非 null = 已核销（一次性用过）。核销即作废，不可能再次核销。 */
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
}

/** `findActiveSigningToken` 找不到有效令牌时的四种不可区分理由（契约 `TOKEN_INVALID` 覆盖全部四种）。 */
export type SigningTokenLookupResult =
  | { readonly ok: true; readonly row: SigningTokenRow }
  | { readonly ok: false; readonly reason: "not-found" | "expired" | "consumed" | "revoked" };

export interface ConsumeSigningTokenInput {
  readonly token: string;
  readonly now: Date;
}

export interface SigningTokenRepository {
  issue(input: IssueSigningTokenInput): Promise<SigningTokenRow>;
  /** 只读校验，**不核销**——受访者打开授权页（`getConsentPage`）多次不消耗令牌。 */
  findActive(token: string, now: Date): Promise<SigningTokenLookupResult>;
  /**
   * 条件核销：仅当 `consumed_at IS NULL ∧ revoked_at IS NULL ∧ expires_at > now` 时生效，
   * 受影响行数是「恰好一次」的唯一证明（同 `invite-link-ports.ts` I-11 的理由）。
   */
  consume(input: ConsumeSigningTokenInput): Promise<SigningTokenLookupResult>;
}

export const SIGNING_TOKEN_REPOSITORY = Symbol("SigningTokenRepository");

/* ─────────────────────────── 门户长效令牌 ─────────────────────────── */

export interface IssuePortalTokenInput {
  readonly tokenId: string;
  readonly token: string;
  readonly interviewId: string;
  readonly subjectId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface PortalTokenRow {
  readonly tokenId: string;
  readonly token: string;
  readonly interviewId: string;
  readonly subjectId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export type PortalTokenLookupResult =
  | { readonly ok: true; readonly row: PortalTokenRow }
  | { readonly ok: false; readonly reason: "not-found" | "expired" | "revoked" };

export interface PortalTokenRepository {
  issue(input: IssuePortalTokenInput): Promise<PortalTokenRow>;
  findActive(token: string, now: Date): Promise<PortalTokenLookupResult>;
  /** 受访者自助重发到本人邮箱/手机——**同一枚令牌**，不改 `expiresAt`（那由材料保留期决定）。 */
  findByTokenId(tokenId: string): Promise<PortalTokenRow | null>;
  /** 研究员单条撤销。已撤销的再撤一次幂等返回同一结果，不抛错（同 `revoke-invite-links.ts` 的立场）。 */
  revoke(tokenId: string, now: Date): Promise<{ readonly revoked: boolean }>;
}

export const PORTAL_TOKEN_REPOSITORY = Symbol("PortalTokenRepository");

/* ─────────────────────────── 同意书渲染快照 ─────────────────────────── */

export interface ConsentSnapshotInput {
  readonly snapshotId: string;
  readonly submissionId: string;
  readonly interviewId: string;
  readonly subjectId: string;
  readonly renderParams: ConsentRenderParams;
  readonly bits: ConsentBitsValue;
  readonly submittedAt: Date;
}

/** 已保存的同意书渲染快照：「当时告知了什么，事后不可回溯改写」。 */
export interface ConsentSnapshotRow extends ConsentSnapshotInput {}

export interface ConsentSnapshotRepository {
  save(input: ConsentSnapshotInput): Promise<ConsentSnapshotRow>;
  /**
   * F96 —— 自助门户回看「当初告知你的是什么」需要按受访者取回**原始**（第一份）快照。
   * ⚠ 与门户之后的同意位变更历史是两个不同的东西：这里找的是 `submitConsent` 那一次
   *   落盘的行，不随后续 `updateConsentFromPortal` 的历史版本改变（AC5）。
   *   一个 `(interviewId, subjectId)` 组合恒对应一份原始快照。
   */
  findBySubject(interviewId: string, subjectId: string): Promise<ConsentSnapshotRow | null>;
}

export const CONSENT_SNAPSHOT_REPOSITORY = Symbol("ConsentSnapshotRepository");

/* ─────────────────────────── 渲染变量来源 ─────────────────────────── */

/**
 * 读该场访谈的四个渲染变量。**不在这里生成/校验它们**——校验（是否齐全）
 * 是 `domain/interview/consent-token.ts` 的 `hasCompleteRenderParams`，
 * 这里只负责取数，取不到用 `null` 表达缺失。
 */
export interface ConsentRenderParamsProvider {
  get(interviewId: string): Promise<Partial<ConsentRenderParams> | null>;
}

export const CONSENT_RENDER_PARAMS_PROVIDER = Symbol("ConsentRenderParamsProvider");

/** 授权页的场次事实（Weber 先生 · 7 月 28 日 15:00 · 约 60 分钟）——只读展示，不含令牌本身。 */
export interface ConsentSessionFacts {
  readonly subjectAlias: string;
  readonly whenAt: string;
  readonly durationMinutes: number;
}

export interface ConsentSessionFactsProvider {
  get(interviewId: string, subjectId: string): Promise<ConsentSessionFacts>;
}

export const CONSENT_SESSION_FACTS_PROVIDER = Symbol("ConsentSessionFactsProvider");
