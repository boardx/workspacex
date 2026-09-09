/** Proposed personal GitHub source connection API. No token, secret, or installation grant is accepted from the client. */
import { z } from "zod";
const Id = z.string().trim().min(1).max(200);
const Version = z.number().int().positive();
const OAuthState = z.string().min(32).max(512);
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
  const allowed = new Set(["client_id", "state", "code_challenge_method", "code_challenge", "redirect_uri", "login", "allow_signup"]);
  const keys = [...url.searchParams.keys()];
  return keys.every(key => allowed.has(key)) && new Set(keys).size === keys.length && url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize" && !url.username && !url.password && !url.hash &&
    !!url.searchParams.get("client_id") && OAuthState.safeParse(url.searchParams.get("state")).success && !["access_token", "refresh_token", "client_secret", "code_verifier"].some(key => url.searchParams.has(key)) && url.searchParams.get("code_challenge_method") === "S256" &&
    /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "");
}, "server-generated GitHub OAuth URL with state and S256 PKCE required");
const Reconnect = z.object({ connectionId: Id, expectedRevision: Version }).strict().nullable();
const RepositoryIds = z.array(Id).min(1).max(100).refine(ids => new Set(ids).size === ids.length, "duplicate repository selection");
const TransactionBase = z.object({ transactionId: Id, transactionRevision: Version, expiresAt: DateTime, returnTarget: SourceConnectionReturnTarget, reconnect: Reconnect }).strict();
export const GithubSourceConnectionTransaction = z.discriminatedUnion("status", [
  TransactionBase.extend({ status: z.literal("pending"), authorizationUrl: AuthorizeUrl }).strict(),
  TransactionBase.extend({ status: z.literal("select-repositories"), repositorySelectionRevision: Version }).strict(),
  TransactionBase.extend({ status: z.literal("completed"), connection: GithubSourceConnection, repositoryIds: RepositoryIds, selectionRevision: Version }).strict(),
  TransactionBase.extend({ status: z.literal("cancelled") }).strict(),
  TransactionBase.extend({ status: z.literal("failed"), reason: z.enum(["AUTHORIZATION_DENIED", "AUTHORIZATION_EXPIRED", "APP_NOT_INSTALLED", "SOURCE_ACCESS_DENIED", "DEPENDENCY_UNAVAILABLE"]) }).strict(),
]).superRefine((transaction, context) => {
  if (transaction.status === "completed" && transaction.connection.status !== "active") context.addIssue({ code: z.ZodIssueCode.custom, message: "completed connection must be active" });
  if (transaction.status === "completed" && transaction.reconnect && (transaction.connection.connectionId !== transaction.reconnect.connectionId || transaction.connection.revision !== transaction.reconnect.expectedRevision + 1)) context.addIssue({ code: z.ZodIssueCode.custom, message: "reconnection must advance the original connection exactly once" });
});
export const SourceConnectionError = z.enum(["UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "VERSION_CHANGED", "AUTHORIZATION_EXPIRED", "AUTHORIZATION_STATE_INVALID", "AUTHORIZATION_REPLAYED", "SOURCE_ACCESS_DENIED", "SOURCE_RATE_LIMITED", "CONNECTION_REVOKED", "DEPENDENCY_UNAVAILABLE"]);
const TransactionId = z.object({ transactionId: Id }).strict();
const ConnectionId = z.object({ connectionId: Id }).strict();
const PageInput = z.object({ cursor: Id.nullable() }).strict();
const RepositoryPage = z.object({ items: z.array(Repo).max(100), nextCursor: Id.nullable(), selectionRevision: Version }).strict();
export const operations = {
  listSourceConnections: { method: "GET", path: "/admin/skill-development/source-connections", in: PageInput, out: z.object({ items: z.array(GithubSourceConnection).max(100), nextCursor: Id.nullable() }).strict(), err: SourceConnectionError.options },
  getSourceConnection: { method: "GET", path: "/admin/skill-development/source-connections/:connectionId", in: ConnectionId, out: GithubSourceConnection, err: SourceConnectionError.options },
  beginGithubSourceConnection: { method: "POST", path: "/admin/skill-development/source-connections/github/transactions", in: z.object({ returnTarget: SourceConnectionReturnTarget, reconnect: Reconnect }).strict(), out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "pending" || transaction.status === "failed", "begin returns an authorization attempt, not a granted connection"), err: SourceConnectionError.options },
  getSourceConnectionTransaction: { method: "GET", path: "/admin/skill-development/source-connections/github/transactions/:transactionId", in: TransactionId, out: GithubSourceConnectionTransaction, err: SourceConnectionError.options },
  // Browser return handled by server: verify one-time state and actor/tenant/session, exchange code using server-held verifier.
  acceptGithubSourceCallback: { method: "GET", path: "/admin/skill-development/source-connections/github/callback", in: z.object({ state: OAuthState, code: z.string().min(1).max(2048) }).strict(), out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "select-repositories" || transaction.status === "failed", "callback cannot select repositories on behalf of user"), err: SourceConnectionError.options },
  listSourceTransactionRepositories: { method: "GET", path: "/admin/skill-development/source-connections/github/transactions/:transactionId/repositories", in: TransactionId.merge(PageInput), out: RepositoryPage.extend({ transactionId: Id }).strict(), err: SourceConnectionError.options },
  confirmSourceRepositories: { method: "POST", path: "/admin/skill-development/source-connections/github/transactions/:transactionId/confirm", in: TransactionId.extend({ expectedTransactionRevision: Version, expectedSelectionRevision: Version, repositoryIds: RepositoryIds }).strict(), out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "completed" || transaction.status === "failed", "repository confirmation must finish or report failure"), err: SourceConnectionError.options },
  listSourceConnectionRepositories: { method: "GET", path: "/admin/skill-development/source-connections/:connectionId/repositories", in: ConnectionId.merge(PageInput).extend({ expectedRevision: Version }).strict(), out: RepositoryPage.extend({ connectionId: Id, connectionRevision: Version }).strict(), err: SourceConnectionError.options },
  cancelSourceConnectionTransaction: { method: "POST", path: "/admin/skill-development/source-connections/github/transactions/:transactionId/cancel", in: TransactionId.extend({ expectedTransactionRevision: Version }).strict(), out: GithubSourceConnectionTransaction.refine(transaction => transaction.status === "cancelled", "cancel response must be cancelled"), err: SourceConnectionError.options },
  revokeSourceConnection: { method: "POST", path: "/admin/skill-development/source-connections/:connectionId/revoke", in: ConnectionId.extend({ expectedRevision: Version }).strict(), out: GithubSourceConnection.refine(connection => connection.status === "revoked", "revocation must return a revoked connection"), err: SourceConnectionError.options },
} as const;

// These exchange records are server-side validation inputs, never client authority.
// The adapter must load the transaction by authenticated owner and consume OAuth state
// with an atomic revision CAS. Schema validation cannot make a database write atomic.
const sameContext = (a: z.infer<typeof TransactionBase>, b: z.infer<typeof TransactionBase>) =>
  a.transactionId === b.transactionId && a.expiresAt === b.expiresAt &&
  JSON.stringify(a.returnTarget) === JSON.stringify(b.returnTarget) && JSON.stringify(a.reconnect) === JSON.stringify(b.reconnect);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
export const sourceConnectionExchanges = {
  beginGithubSourceConnection: z.object({ request: operations.beginGithubSourceConnection.in, response: operations.beginGithubSourceConnection.out }).strict().refine(({ request, response }) => response.transactionRevision === 1 && JSON.stringify(request.returnTarget) === JSON.stringify(response.returnTarget) && JSON.stringify(request.reconnect) === JSON.stringify(response.reconnect), "begin must preserve connection intent and initialize revision"),
  getSourceConnection: z.object({ request: operations.getSourceConnection.in, response: operations.getSourceConnection.out }).strict().refine(({ request, response }) => request.connectionId === response.connectionId, "connection identity mismatch"),
  getSourceConnectionTransaction: z.object({ request: operations.getSourceConnectionTransaction.in, response: operations.getSourceConnectionTransaction.out }).strict().refine(({ request, response }) => request.transactionId === response.transactionId, "transaction identity mismatch"),
  acceptGithubSourceCallback: z.object({
    request: operations.acceptGithubSourceCallback.in,
    stored: z.object({ state: OAuthState, consumed: z.literal(false), transaction: GithubSourceConnectionTransaction.refine(t => t.status === "pending") }).strict(),
    response: operations.acceptGithubSourceCallback.out,
  }).strict().refine(({ request, stored, response }) => request.state === stored.state && stored.transaction.status === "pending" && new URL(stored.transaction.authorizationUrl).searchParams.get("state") === stored.state && sameContext(stored.transaction, response) && response.transactionRevision === stored.transaction.transactionRevision + 1, "callback must consume the state-resolved pending transaction exactly once"),
  listSourceTransactionRepositories: z.object({ request: operations.listSourceTransactionRepositories.in, response: operations.listSourceTransactionRepositories.out }).strict().refine(({ request, response }) => request.transactionId === response.transactionId, "repository page transaction mismatch"),
  listSourceConnectionRepositories: z.object({ request: operations.listSourceConnectionRepositories.in, response: operations.listSourceConnectionRepositories.out }).strict().refine(({ request, response }) => request.connectionId === response.connectionId && request.expectedRevision === response.connectionRevision, "repository page connection revision mismatch"),
  confirmSourceRepositories: z.object({ request: operations.confirmSourceRepositories.in, stored: GithubSourceConnectionTransaction.refine(t => t.status === "select-repositories"), response: operations.confirmSourceRepositories.out }).strict().refine(({ request, stored, response }) =>
    request.transactionId === stored.transactionId && request.expectedTransactionRevision === stored.transactionRevision && sameContext(stored, response) && response.transactionRevision === stored.transactionRevision + 1 &&
    stored.status === "select-repositories" && request.expectedSelectionRevision === stored.repositorySelectionRevision &&
    (response.status !== "completed" || response.selectionRevision === request.expectedSelectionRevision && sameSet(request.repositoryIds, response.repositoryIds)), "confirmation must preserve transaction, CAS and explicit selected set"),
  cancelSourceConnectionTransaction: z.object({ request: operations.cancelSourceConnectionTransaction.in, stored: GithubSourceConnectionTransaction.refine(t => t.status === "pending" || t.status === "select-repositories"), response: operations.cancelSourceConnectionTransaction.out }).strict().refine(({ request, stored, response }) => request.transactionId === stored.transactionId && request.expectedTransactionRevision === stored.transactionRevision && sameContext(stored, response) && response.transactionRevision === stored.transactionRevision + 1, "cancellation must advance the active transaction exactly once"),
  revokeSourceConnection: z.object({ request: operations.revokeSourceConnection.in, response: operations.revokeSourceConnection.out }).strict().refine(({ request, response }) => request.connectionId === response.connectionId && response.revision === request.expectedRevision + 1, "revocation must advance the requested connection revision exactly once"),
} as const;
