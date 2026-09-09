/** Review-only Skill trial download proposal. No controller or download bytes are implemented.
 * Reuses the existing /downloads/:token redemption channel, grant store, token minting,
 * expiry policy and atomic one-time consumption. It adds a real skill-trial source kind;
 * trial IDs and Skill version IDs must not masquerade as artifact-version IDs.
 */
import { z } from "zod";
import { TrialRun, TrialRunArtifact } from "./skills";
import { operations as files } from "./files";
const Id = z.string().trim().min(1).max(200);
const Time = z.string().datetime({ offset: true });
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Metadata = TrialRunArtifact.omit({ objectKey: true });
const Downloadable = Metadata.extend({ availability: z.literal("downloadable"), artifactId: Id, sha256: Digest }).strict();
const Unavailable = Metadata.extend({ availability: z.literal("unavailable"), reason: z.literal("legacy-metadata-missing") }).strict();
export const PublicSkillTrialArtifact = z.discriminatedUnion("availability", [Downloadable, Unavailable]);
/** Old rows may lack a stable ID or a byte-derived digest. A read cannot invent either. */
export const StoredSkillTrialArtifact = TrialRunArtifact.extend({ artifactId: Id.nullable().optional(), sha256: Digest.nullable().optional() }).strict();
/** Stable IDs identify one artifact within a trial. Multiple legacy rows without IDs
 * remain readable as unavailable; a duplicate known ID must never look downloadable.
 */
export const StoredSkillTrialArtifacts = z.array(StoredSkillTrialArtifact).refine(rows => {
  const ids = rows.flatMap(row => row.artifactId ? [row.artifactId] : []);
  return new Set(ids).size === ids.length;
}, "stored trial artifact IDs must be unique");
export function projectSkillTrialArtifact(value: z.infer<typeof StoredSkillTrialArtifact>): z.infer<typeof PublicSkillTrialArtifact> {
  const row = StoredSkillTrialArtifact.parse(value);
  const metadata = { name: row.name, mime: row.mime, sizeBytes: row.sizeBytes };
  return row.artifactId && row.sha256 ? { ...metadata, availability: "downloadable", artifactId: row.artifactId, sha256: row.sha256 }
    : { ...metadata, availability: "unavailable", reason: "legacy-metadata-missing" };
}
export const PublicSkillTrialRun = TrialRun.extend({ artifacts: z.array(PublicSkillTrialArtifact).default([]) }).strict();
const Input = z.object({ trialRunId: Id, artifactId: Id }).strict();
const DownloadUrl = files.issueDownloadUrl.out.shape.url.refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      /^\/downloads\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch { return false; }
}, "download URL must use the existing token redemption path");
/** Explicit decision-field delta: this is an actor-scoped trial authorization receipt,
 * not an identity.authorize/project-permission decision. The other public fields reuse
 * files.issueDownloadUrl. Integration must extend the common grant/audit decision type.
 */
const Output = files.issueDownloadUrl.out.omit({ permissionDecisionId: true }).extend({
  url: DownloadUrl, expiresAt: files.issueDownloadUrl.out.shape.expiresAt.pipe(Time), trialAuthorizationDecisionId: Id,
}).strict();
export const operations = {
  issueSkillTrialArtifactDownloadUrl: {
    method: "POST", path: "/skill-trial-runs/:trialRunId/artifacts/:artifactId/download-url", in: Input, out: Output,
    // Cross-actor, cross-organization and artifact mismatch all return the same bare 404.
    err: ["UNAUTHENTICATED", "NOT_FOUND", "ARTIFACT_DOWNLOAD_UNAVAILABLE", "INTEGRITY_CHECK_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;
const StoredTrial = z.object({
  orgId: Id, actorId: Id, trialRunId: Id, versionId: Id, status: z.literal("succeeded"),
  artifacts: StoredSkillTrialArtifacts,
}).strict();
const Locator = z.object({
  sourceKind: z.literal("skill-trial"), trialRunId: Id, skillVersionId: Id,
  artifact: TrialRunArtifact.extend({ artifactId: Id, sha256: Digest }).strict(),
}).strict();
/** Server-only: principal is session-derived, subject is findForActor's stored row,
 * authorization is its durable decision, grant is the prepared persistent grant, and
 * delivery is minted by the configured common DownloadUrlBuilder. Never accept these
 * fields from an HTTP caller. This correlates metadata; it does not execute auth,
 * token hashing, byte hashing, SQL consumption or the audit transaction.
 */
export const skillTrialArtifactDownloadExchange = z.object({
  request: Input, response: Output,
  stored: z.object({
    principal: z.object({ orgId: Id, userId: Id }).strict(),
    trial: StoredTrial,
    authorization: z.object({ decisionId: Id, orgId: Id, actorId: Id, trialRunId: Id, artifactId: Id, allowed: z.literal(true) }).strict(),
    grant: z.object({ grantId: Id, tokenHash: Digest, orgId: Id, principalUserId: Id, locator: Locator, trialAuthorizationDecisionId: Id,
      expiresAt: Time, oneTime: files.issueDownloadUrl.out.shape.oneTime }).strict(),
    delivery: z.object({ url: DownloadUrl, expiresAt: Time }).strict(),
    now: Time,
    // Ephemeral server issuance context, not a persisted raw-token receipt. The shared
    // mintDownloadToken produces raw/hash together; downloadExpiry supplies expiresAt
    // from its existing TTL constant. Never persist/log rawToken or accept this context
    // from clients. Schema correlation does not prove token randomness or hash bytes.
    minted: z.object({ grantId: Id, rawToken: z.string().regex(/^[A-Za-z0-9_-]+$/), tokenHash: Digest,
      redemptionOrigin: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "https:" && url.origin === value; }),
      issuedAt: Time, expiresAt: Time }).strict(),
  }).strict(),
}).strict().refine(({ request, response, stored }) => {
  const { principal, trial, authorization, grant, delivery, minted, now } = stored;
  const artifact = trial.artifacts.find(row => row.artifactId === request.artifactId);
  const target = grant.locator.artifact;
  return grant.grantId === minted.grantId && grant.tokenHash === minted.tokenHash &&
    new URL(delivery.url).origin === minted.redemptionOrigin && new URL(delivery.url).pathname === `/downloads/${minted.rawToken}` &&
    Date.parse(minted.issuedAt) <= Date.parse(now) && Date.parse(minted.expiresAt) > Date.parse(now) &&
    grant.expiresAt === minted.expiresAt && !!artifact?.artifactId && !!artifact.sha256 && request.trialRunId === trial.trialRunId &&
    principal.orgId === trial.orgId && principal.userId === trial.actorId &&
    authorization.orgId === trial.orgId && authorization.actorId === trial.actorId &&
    authorization.trialRunId === trial.trialRunId && authorization.artifactId === artifact.artifactId &&
    grant.orgId === trial.orgId && grant.principalUserId === trial.actorId &&
    grant.locator.trialRunId === trial.trialRunId && grant.locator.skillVersionId === trial.versionId &&
    target.artifactId === artifact.artifactId && target.sha256 === artifact.sha256 &&
    target.objectKey === artifact.objectKey && target.name === artifact.name && target.mime === artifact.mime && target.sizeBytes === artifact.sizeBytes &&
    grant.trialAuthorizationDecisionId === authorization.decisionId && response.trialAuthorizationDecisionId === authorization.decisionId &&
    response.url === delivery.url && response.expiresAt === delivery.expiresAt && response.expiresAt === grant.expiresAt;
}, "trial download must bind the authorized actor, stored trial artifact and common-channel grant");
