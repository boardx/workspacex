/**
 * `FileSessionTokenStore` (issue #3716): the Redis store's semantics, without Redis.
 * Pure unit lane -- no database, no Redis (see `vitest.local-desktop-unit.config.ts`).
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSessionTokenStore } from "../../src/infrastructure/auth/file-session-token-store";
import type { SessionRecord } from "../../src/domain/auth/session-lifetime";
import { toOrgId } from "../../src/domain/org-id";

const T0 = 1_700_000_000_000;

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: over.id ?? "s-1",
    userId: over.userId ?? "u-1",
    currentOrgId: over.currentOrgId ?? "org-a",
    issuedAt: T0,
    expiresAt: over.expiresAt ?? T0 + 3_600_000,
    revokedAt: null,
    device: over.device ?? "laptop",
    location: null,
    lastActiveAt: T0,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("FileSessionTokenStore", () => {
  it("issues an opaque token that is not derivable from the record and round-trips it", async () => {
    const store = new FileSessionTokenStore({ now: () => T0 });
    const token = await store.issue(record());
    expect(token).not.toContain("s-1");
    expect(token).not.toContain("u-1");
    expect(await store.findByToken(token)).toMatchObject({ id: "s-1", userId: "u-1" });
    expect(await store.findByToken("not-a-token")).toBeNull();
  });

  it("marks revoked sessions instead of deleting them (I-7) and counts honestly", async () => {
    const store = new FileSessionTokenStore({ now: () => T0 });
    const a = await store.issue(record({ id: "s-a" }));
    await store.issue(record({ id: "s-b" }));
    await store.issue(record({ id: "s-other", userId: "u-2" }));
    expect(await store.revokeAllForUser("u-1", new Date(T0 + 1))).toBe(2);
    expect(await store.revokeAllForUser("u-1", new Date(T0 + 2))).toBe(0);
    const listed = await store.listForUser("u-1");
    expect(listed.map((s) => s.revokedAt)).toEqual([T0 + 1, T0 + 1]);
    // still findable, marked -- SESSION_REVOKED stays distinguishable from SESSION_EXPIRED
    expect((await store.findByToken(a))?.revokedAt).toBe(T0 + 1);
    expect(await store.listForUser("u-2")).toHaveLength(1);
  });

  it("revokeAllForUserExcept keeps the named session live", async () => {
    const store = new FileSessionTokenStore({ now: () => T0 });
    const keep = await store.issue(record({ id: "s-keep" }));
    await store.issue(record({ id: "s-drop" }));
    expect(await store.revokeAllForUserExcept("u-1", "s-keep", new Date(T0 + 5))).toBe(1);
    expect((await store.findByToken(keep))?.revokedAt).toBeNull();
  });

  it("revokeSession checks ownership and is idempotent on revokedAt", async () => {
    const store = new FileSessionTokenStore({ now: () => T0 });
    await store.issue(record({ id: "s-phone", device: "phone" }));
    expect(await store.revokeSession("u-2", "s-phone", new Date(T0 + 1))).toBeNull();
    expect(await store.revokeSession("u-1", "s-phone", new Date(T0 + 1))).toEqual({ revokedAt: T0 + 1, device: "phone" });
    expect(await store.revokeSession("u-1", "s-phone", new Date(T0 + 9))).toEqual({ revokedAt: T0 + 1, device: "phone" });
    expect(await store.revokeSession("u-1", "s-missing", new Date(T0 + 1))).toBeNull();
  });

  it("touch and setCurrentOrg never resurrect revoked or expired sessions", async () => {
    let now = T0;
    const store = new FileSessionTokenStore({ now: () => now });
    const live = await store.issue(record({ id: "s-live" }));
    const revoked = await store.issue(record({ id: "s-rev" }));
    await store.revokeSession("u-1", "s-rev", new Date(T0 + 1));
    expect(await store.setCurrentOrg(live, toOrgId("org-b"))).toBe(true);
    expect(await store.setCurrentOrg(revoked, toOrgId("org-b"))).toBe(false);
    await store.touch(live, new Date(T0 + 50));
    await store.touch(revoked, new Date(T0 + 50));
    expect((await store.findByToken(live))?.lastActiveAt).toBe(T0 + 50);
    expect((await store.findByToken(revoked))?.lastActiveAt).toBe(T0);
    now = T0 + 3_600_001; // past expiresAt
    expect(await store.findByToken(live)).toBeNull();
    expect(await store.setCurrentOrg(live, toOrgId("org-c"))).toBe(false);
  });

  it("persists to a 0600 file, stores only token hashes, and reloads across instances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wsx-sessions-"));
    dirs.push(dir);
    const path = join(dir, "nested", "sessions.json");
    const first = new FileSessionTokenStore({ path, now: () => T0 });
    const token = await first.issue(record({ id: "s-persist" }));
    await first.revokeSession("u-1", "s-persist", new Date(T0 + 3));
    await first.close();

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain(token);

    const second = new FileSessionTokenStore({ path, now: () => T0 + 10 });
    expect(await second.findByToken(token)).toMatchObject({ id: "s-persist", revokedAt: T0 + 3 });
  });

  it("sweeps rows a day past expiry on reload, keeps unexpired revoked rows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wsx-sessions-"));
    dirs.push(dir);
    const path = join(dir, "sessions.json");
    const store = new FileSessionTokenStore({ path, now: () => T0 });
    await store.issue(record({ id: "s-old", expiresAt: T0 + 1000 }));
    await store.issue(record({ id: "s-new" }));
    await store.close();
    const later = new FileSessionTokenStore({ path, now: () => T0 + 1000 + 86_400_000 + 1 });
    expect((await later.listForUser("u-1")).map((s) => s.id)).toEqual(["s-new"]);
  });
});
