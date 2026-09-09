import { describe, expect, it } from "vitest";
import { GithubSourceConnection, GithubSourceConnectionTransaction, operations, sourceConnectionExchanges } from "../src/skill-source-connections";
const connection = { connectionId: "connection-1", revision: 1, provider: "github", scope: "personal", displayName: "My source", status: "active", updatedAt: "2026-09-10T00:00:00Z" };
const pending = { transactionId: "transaction-1", expiresAt: "2026-09-10T00:30:00Z", returnTarget: { kind: "import" }, status: "pending", authorizationUrl: `https://github.com/login/oauth/authorize?client_id=demo&state=${"s".repeat(32)}&code_challenge_method=S256&code_challenge=${"a".repeat(43)}` };
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
    expect(GithubSourceConnectionTransaction.safeParse({ transactionId: pending.transactionId, expiresAt: pending.expiresAt, returnTarget: pending.returnTarget, status: "completed", connection: { ...connection, status: "revoked" } }).success).toBe(false);
  });
  it("does not skip explicit repository confirmation or correlate another connection response", () => {
    const completed = { transactionId: pending.transactionId, expiresAt: pending.expiresAt, returnTarget: pending.returnTarget, status: "completed", connection };
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
    const selected = { transactionId: "transaction-1", expectedSelectionRevision: 1, repositoryIds: ["repo-1"] };
    expect(operations.confirmSourceRepositories.in.safeParse(selected).success).toBe(true);
    expect(operations.confirmSourceRepositories.in.safeParse({ ...selected, repositoryIds: [] }).success).toBe(false);
    expect(operations.confirmSourceRepositories.in.safeParse({ ...selected, repositoryIds: ["repo-1", "repo-1"] }).success).toBe(false);
  });
});
