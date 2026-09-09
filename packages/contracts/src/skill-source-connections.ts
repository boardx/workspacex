/** Proposed personal GitHub source connection API. No token, secret, or installation grant is accepted from the client. */
import { z } from "zod";
const Id = z.string().trim().min(1).max(200);
const Version = z.number().int().positive();
const DateTime = z.string().datetime({ offset: true });
const Repo = z.object({ repositoryId: Id, fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/), contentsPermission: z.literal("read") }).strict();
export const SourceConnectionReturnTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("import") }).strict(),
  z.object({ kind: z.literal("upstream"), skillId: Id, draftId: Id }).strict(),
  z.object({ kind: z.literal("connections") }).strict(),
]);
export const GithubSourceConnection = z.object({ connectionId: Id, revision: Version, provider: z.literal("github"), scope: z.literal("personal"),
  displayName: z.string().trim().min(1).max(200), status: z.enum(["active", "reauthorization-required", "revoked"]), updatedAt: DateTime,
}).strict();
const AuthorizeUrl = z.string().url().max(4096).refine(raw => {
  const url = new URL(raw);
  return url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize" && !url.username && !url.password && !url.hash &&
    !!url.searchParams.get("client_id") && (url.searchParams.get("state")?.length ?? 0) >= 32 && !["access_token", "refresh_token", "client_secret", "code_verifier"].some(key => url.searchParams.has(key)) && url.searchParams.get("code_challenge_method") === "S256" &&
    /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "");
}, "server-generated GitHub OAuth URL with state and S256 PKCE required");
const TransactionBase = z.object({ transactionId: Id, expiresAt: DateTime, returnTarget: SourceConnectionReturnTarget }).strict();
export const GithubSourceConnectionTransaction = z.discriminatedUnion("status", [
  TransactionBase.extend({ status: z.literal("pending"), authorizationUrl: AuthorizeUrl }).strict(),
  TransactionBase.extend({ status: z.literal("select-repositories"), repositorySelectionRevision: Version }).strict(),
  TransactionBase.extend({ status: z.literal("completed"), connection: GithubSourceConnection }).strict(),
  TransactionBase.extend({ status: z.literal("cancelled") }).strict(),
  TransactionBase.extend({ status: z.literal("failed"), reason: z.enum(["AUTHORIZATION_DENIED", "AUTHORIZATION_EXPIRED", "APP_NOT_INSTALLED", "SOURCE_ACCESS_DENIED", "DEPENDENCY_UNAVAILABLE"]) }).strict(),
]).superRefine((transaction, context) => {
  if (transaction.status === "completed" && transaction.connection.status !== "active") context.addIssue({ code: z.ZodIssueCode.custom, message: "completed connection must be active" });
});
export const SourceConnectionError = z.enum(["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "VERSION_CHANGED", "AUTHORIZATION_EXPIRED", "AUTHORIZATION_STATE_INVALID", "AUTHORIZATION_REPLAYED", "SOURCE_ACCESS_DENIED", "SOURCE_RATE_LIMITED", "CONNECTION_REVOKED", "DEPENDENCY_UNAVAILABLE"]);
const TransactionId = z.object({ transactionId: Id }).strict();
const ConnectionId = z.object({ connectionId: Id }).strict();
const PageInput = z.object({ cursor: Id.nullable() }).strict();
const RepositoryPage = z.object({ items: z.array(Repo).max(100), nextCursor: Id.nullable(), selectionRevision: Version }).strict();
export const operations = {
  listSourceConnections: { method: "GET", path: "/admin/skill-development/source-connections", in: PageInput, out: z.object({ items: z.array(GithubSourceConnection).max(100), nextCursor: Id.nullable() }).strict(), err: SourceConnectionError.options },
  getSourceConnection: { method: "GET", path: "/admin/skill-development/source-connections/:connectionId", in: ConnectionId, out: GithubSourceConnection, err: SourceConnectionError.options },
  beginGithubSourceConnection: { method: "POST", path: "/admin/skill-development/source-connections/github/transactions", in: z.object({ returnTarget: SourceConnectionReturnTarget, reconnect: z.object({ connectionId: Id, expectedRevision: Version }).strict().nullable() }).strict(), out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "pending" || transaction.status === "failed", "begin returns an authorization attempt, not a granted connection"), err: SourceConnectionError.options },
  getSourceConnectionTransaction: { method: "GET", path: "/admin/skill-development/source-connections/github/transactions/:transactionId", in: TransactionId, out: GithubSourceConnectionTransaction, err: SourceConnectionError.options },
  // Browser return handled by server: verify one-time state and actor/tenant/session, exchange code using server-held verifier.
  acceptGithubSourceCallback: { method: "GET", path: "/admin/skill-development/source-connections/github/callback", in: z.object({ state: z.string().min(32).max(512), code: z.string().min(1).max(2048) }).strict(), out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "select-repositories" || transaction.status === "failed", "callback cannot select repositories on behalf of user"), err: SourceConnectionError.options },
  listSourceTransactionRepositories: { method: "GET", path: "/admin/skill-development/source-connections/github/transactions/:transactionId/repositories", in: TransactionId.merge(PageInput), out: RepositoryPage, err: SourceConnectionError.options },
  confirmSourceRepositories: { method: "POST", path: "/admin/skill-development/source-connections/github/transactions/:transactionId/confirm", in: TransactionId.extend({ expectedSelectionRevision: Version, repositoryIds: z.array(Id).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "duplicate repository selection") }).strict(), out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "completed" || transaction.status === "failed", "repository confirmation must finish or report failure"), err: SourceConnectionError.options },
  listSourceConnectionRepositories: { method: "GET", path: "/admin/skill-development/source-connections/:connectionId/repositories", in: ConnectionId.merge(PageInput), out: RepositoryPage, err: SourceConnectionError.options },
  cancelSourceConnectionTransaction: { method: "POST", path: "/admin/skill-development/source-connections/github/transactions/:transactionId/cancel", in: TransactionId, out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "cancelled", "cancel response must be cancelled"), err: SourceConnectionError.options },
  revokeSourceConnection: { method: "POST", path: "/admin/skill-development/source-connections/:connectionId/revoke", in: ConnectionId.extend({ expectedRevision: Version }).strict(), out: GithubSourceConnection.refine(connection => connection.status === "revoked", "revocation must return a revoked connection"), err: SourceConnectionError.options },
} as const;

export const sourceConnectionExchanges = {
  getSourceConnection: z.object({ request: operations.getSourceConnection.in, response: operations.getSourceConnection.out }).strict().refine(({ request, response }) => request.connectionId === response.connectionId, "connection identity mismatch"),
  getSourceConnectionTransaction: z.object({ request: operations.getSourceConnectionTransaction.in, response: operations.getSourceConnectionTransaction.out }).strict().refine(({ request, response }) => request.transactionId === response.transactionId, "transaction identity mismatch"),
  confirmSourceRepositories: z.object({ request: operations.confirmSourceRepositories.in, response: operations.confirmSourceRepositories.out }).strict().refine(({ request, response }) => request.transactionId === response.transactionId, "confirmation transaction mismatch"),
  cancelSourceConnectionTransaction: z.object({ request: operations.cancelSourceConnectionTransaction.in, response: operations.cancelSourceConnectionTransaction.out }).strict().refine(({ request, response }) => request.transactionId === response.transactionId, "cancellation transaction mismatch"),
  revokeSourceConnection: z.object({ request: operations.revokeSourceConnection.in, response: operations.revokeSourceConnection.out }).strict().refine(({ request, response }) => request.connectionId === response.connectionId && response.revision > request.expectedRevision, "revocation must advance the requested connection revision"),
} as const;
