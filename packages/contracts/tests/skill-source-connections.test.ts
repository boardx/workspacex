import { describe, expect, it } from "vitest";
import { GithubSourceConnection, GithubSourceConnectionTransaction, operations, sourceConnectionExchanges } from "../src/skill-source-connections";
const connection = { connectionId: "connection-1", revision: 1, provider: "github", scope: "personal", displayName: "My source", status: "active", updatedAt: "2026-09-10T00:00:00Z" };
const pending = { transactionId: "transaction-1", transactionRevision: 1, reconnect: null, expiresAt: "2026-09-10T00:30:00Z", returnTarget: { kind: "import" }, status: "pending", authorizationUrl: `https://github.com/login/oauth/authorize?client_id=demo&state=${"s".repeat(32)}&code_challenge_method=S256&code_challenge=${"a".repeat(43)}` };
describe("personal source connection proposal boundaries", () => {
  it("does not accept arbitrary return URLs, tokens, owner identities, or installation grants", () => {
    const start = { returnTarget: { kind: "import" }, reconnect: null };
    expect(operations.beginGithubSourceConnection.in.safeParse(start).success).toBe(true);
    for (const extra of [{ returnUrl: "https://other.test" }, { installationId: 123 }, { accessToken: "secret" }, { actorId: "other-user" }]) expect(operations.beginGithubSourceConnection.in.safeParse({ ...start, ...extra }).success).toBe(false);
    expect(GithubSourceConnection.safeParse({ ...connection, accessToken: "secret" }).success).toBe(false);
    expect(GithubSourceConnection.safeParse({ ...connection, scope: "organization" }).success).toBe(false);
  });
  it("requires a GitHub authorization URL with state and S256 proof challenge", () => {
    expect(GithubSourceConnectionTransaction.safeParse(pending).success).toBe(true);
    for (const url of ["https://github.com.evil.test/login/oauth/authorize", "https://github.com/login/oauth/authorize?client_id=demo", pending.authorizationUrl.replace("S256", "plain")]) expect(GithubSourceConnectionTransaction.safeParse({ ...pending, authorizationUrl: url }).success).toBe(false);
    expect(GithubSourceConnectionTransaction.safeParse({ transactionId: pending.transactionId, transactionRevision: 3, reconnect: null, repositoryIds: ["repo-1"], selectionRevision: 1, expiresAt: pending.expiresAt, returnTarget: pending.returnTarget, status: "completed", connection: { ...connection, status: "revoked" } }).success).toBe(false);
  });
  it("does not skip explicit repository confirmation or correlate another connection response", () => {
    const completed = { transactionId: pending.transactionId, transactionRevision: 3, reconnect: null, repositoryIds: ["repo-1"], selectionRevision: 1, expiresAt: pending.expiresAt, returnTarget: pending.returnTarget, status: "completed", connection };
    expect(operations.beginGithubSourceConnection.out.safeParse(completed).success).toBe(false);
    expect(operations.acceptGithubSourceCallback.out.safeParse(completed).success).toBe(false);
    expect(operations.cancelSourceConnectionTransaction.out.safeParse(completed).success).toBe(false);
    const revoke = { request: { connectionId: "connection-1", expectedRevision: 1 }, response: { ...connection, revision: 2, status: "revoked" } };
    expect(sourceConnectionExchanges.revokeSourceConnection.safeParse(revoke).success).toBe(true);
    expect(sourceConnectionExchanges.revokeSourceConnection.safeParse({ ...revoke, response: { ...revoke.response, connectionId: "other" } }).success).toBe(false);
    expect(sourceConnectionExchanges.revokeSourceConnection.safeParse({ ...revoke, response: { ...revoke.response, revision: 1 } }).success).toBe(false);
  });
  it("requires versioned reconnection, revocation and unique explicit repository selection", () => {
    expect(operations.beginGithubSourceConnection.in.safeParse({ returnTarget: { kind: "upstream", skillId: "skill-1", draftId: "draft-1" }, reconnect: { connectionId: "connection-1" } }).success).toBe(false);
    expect(operations.revokeSourceConnection.in.safeParse({ connectionId: "connection-1" }).success).toBe(false);
    const selected = { transactionId: "transaction-1", expectedTransactionRevision: 2, expectedSelectionRevision: 1, repositoryIds: ["repo-1"] };
    expect(operations.confirmSourceRepositories.in.safeParse(selected).success).toBe(true);
    expect(operations.confirmSourceRepositories.in.safeParse({ ...selected, repositoryIds: [] }).success).toBe(false);
    expect(operations.confirmSourceRepositories.in.safeParse({ ...selected, repositoryIds: ["repo-1", "repo-1"] }).success).toBe(false);
  });
});

describe("source connection server-record correlation", () => {
  const { authorizationUrl: _url, ...base } = pending;
  const stored = { ...base, status: "select-repositories", transactionRevision: 2, repositorySelectionRevision: 4, reconnect: { connectionId: connection.connectionId, expectedRevision: 1 } };
  const completed = { ...base, status: "completed", transactionRevision: 3, reconnect: stored.reconnect, connection: { ...connection, revision: 2 }, repositoryIds: ["repo-2", "repo-1"], selectionRevision: 4 };
  const request = { transactionId: base.transactionId, expectedTransactionRevision: 2, expectedSelectionRevision: 4, repositoryIds: ["repo-1", "repo-2"] };
  it("preserves begin intent and rejects unknown or repeated authorization parameters", () => {
    const exchange = { request: { returnTarget: base.returnTarget, reconnect: null }, response: pending };
    expect(sourceConnectionExchanges.beginGithubSourceConnection.safeParse(exchange).success).toBe(true);
    expect(sourceConnectionExchanges.beginGithubSourceConnection.safeParse({ ...exchange, response: { ...pending, reconnect: stored.reconnect } }).success).toBe(false);
    expect(sourceConnectionExchanges.beginGithubSourceConnection.safeParse({ ...exchange, response: { ...pending, returnTarget: { kind: "connections" } } }).success).toBe(false);
    for (const suffix of ["&session_token=secret", "&state=other", "&client_id=other", "&code_challenge=other", "&code_challenge_method=S256"]) expect(GithubSourceConnectionTransaction.safeParse({ ...pending, authorizationUrl: pending.authorizationUrl + suffix }).success).toBe(false);
  });
  it("requires the selected set and original reconnect identity with both exact revisions", () => {
    const exchange = { request, stored, response: completed };
    expect(sourceConnectionExchanges.confirmSourceRepositories.safeParse(exchange).success).toBe(true);
    for (const delta of [{ repositoryIds: ["repo-3"] }, { selectionRevision: 5 }, { transactionRevision: 4 }, { reconnect: null }, { returnTarget: { kind: "connections" } }, { connection: { ...connection, connectionId: "other", revision: 2 } }, { connection: { ...connection, revision: 3 } }]) expect(sourceConnectionExchanges.confirmSourceRepositories.safeParse({ ...exchange, response: { ...completed, ...delta } }).success).toBe(false);
    expect(sourceConnectionExchanges.confirmSourceRepositories.safeParse({ ...exchange, request: { ...request, expectedTransactionRevision: 1 } }).success).toBe(false);
  });
  it("binds pages to their transaction or connection revision", () => {
    const page = { items: [], nextCursor: null, selectionRevision: 4 };
    const transaction = { request: { transactionId: base.transactionId, cursor: null }, response: { ...page, transactionId: base.transactionId } };
    expect(sourceConnectionExchanges.listSourceTransactionRepositories.safeParse(transaction).success).toBe(true);
    expect(sourceConnectionExchanges.listSourceTransactionRepositories.safeParse({ ...transaction, response: { ...transaction.response, transactionId: "other" } }).success).toBe(false);
    const connected = { request: { connectionId: connection.connectionId, expectedRevision: 2, cursor: null }, response: { ...page, connectionId: connection.connectionId, connectionRevision: 2 } };
    expect(sourceConnectionExchanges.listSourceConnectionRepositories.safeParse(connected).success).toBe(true);
    for (const delta of [{ connectionId: "other" }, { connectionRevision: 1 }]) expect(sourceConnectionExchanges.listSourceConnectionRepositories.safeParse({ ...connected, response: { ...connected.response, ...delta } }).success).toBe(false);
  });
  it("rejects callback replay, mismatched state and revision jumps against stored transaction", () => {
    const response = { ...base, status: "select-repositories", transactionRevision: 2, repositorySelectionRevision: 1 };
    const exchange = { request: { state: "s".repeat(32), code: "server-exchanges-code" }, stored: { state: "s".repeat(32), consumed: false, transaction: pending }, response };
    expect(sourceConnectionExchanges.acceptGithubSourceCallback.safeParse(exchange).success).toBe(true);
    expect(sourceConnectionExchanges.acceptGithubSourceCallback.safeParse({ ...exchange, stored: { ...exchange.stored, consumed: true } }).success).toBe(false);
    expect(sourceConnectionExchanges.acceptGithubSourceCallback.safeParse({ ...exchange, request: { ...exchange.request, state: "x".repeat(32) } }).success).toBe(false);
    for (const delta of [{ transactionRevision: 3 }, { transactionId: "other" }]) expect(sourceConnectionExchanges.acceptGithubSourceCallback.safeParse({ ...exchange, response: { ...response, ...delta } }).success).toBe(false);
  });
  it("cancels only active stored transactions and revokes without skipping revisions", () => {
    const exchange = { request: { transactionId: base.transactionId, expectedTransactionRevision: 2 }, stored, response: { ...base, status: "cancelled", transactionRevision: 3, reconnect: stored.reconnect } };
    expect(sourceConnectionExchanges.cancelSourceConnectionTransaction.safeParse(exchange).success).toBe(true);
    expect(sourceConnectionExchanges.cancelSourceConnectionTransaction.safeParse({ ...exchange, stored: completed }).success).toBe(false);
    expect(sourceConnectionExchanges.cancelSourceConnectionTransaction.safeParse({ ...exchange, response: { ...exchange.response, transactionRevision: 4 } }).success).toBe(false);
    expect(sourceConnectionExchanges.revokeSourceConnection.safeParse({ request: { connectionId: connection.connectionId, expectedRevision: 1 }, response: { ...connection, status: "revoked", revision: 3 } }).success).toBe(false);
  });
});
