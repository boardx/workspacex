/**
 * `SessionTokenStore` without Redis -- the desktop / local build (issue #3716, PROP-LOCAL-WORKSPACE-001).
 *
 * ## Why this exists
 *
 * The cloud composition stores opaque session tokens in Redis (`redis-session-token-store.ts`,
 * F20). A single-user desktop install has no Redis and must not need one: the whole point of
 * "WorkspaceX Local" is that everything runs inside one installer on one machine. The
 * application port (`SessionTokenStore`) already isolates the rest of the kernel from the
 * storage choice, so this is one more infrastructure adapter, selected at the composition
 * root by `KERNEL_SESSION_STORE=file` (default stays `redis`; cloud behaviour is unchanged).
 *
 * ## Semantics mirrored from the Redis store, on purpose
 *
 *   - the token is random and never derivable from the record; the file stores only the
 *     sha256 of the token, same as the Redis key (a leaked file yields no bearer tokens);
 *   - revocation MARKS, it never deletes (I-7) -- `listForUser` still returns revoked rows;
 *   - expiry is enforced on read (Redis used TTL; here `findByToken` / `touch` /
 *     `setCurrentOrg` treat an expired record as absent, and a sweep drops rows whose
 *     `expiresAt` is older than the same 24h grace Redis gave the user index);
 *   - `revokeSession` is idempotent and returns the FIRST `revokedAt`;
 *   - `touch` / `setCurrentOrg` never resurrect a revoked or expired session.
 *
 * ## Durability model
 *
 * All records live in memory; every mutation is written through to one JSON file with a
 * rename-into-place so a crash mid-write leaves the previous file intact. The file is
 * created `0600`. `path` may be omitted for an in-memory store (tests, ephemeral runs).
 * Writes are serialised through a single promise chain so two overlapping mutations cannot
 * interleave their snapshots.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionTokenStore } from "../../application/auth/ports";
import type { SessionRecord } from "../../domain/auth/session-lifetime";
import type { OrgId } from "../../domain/org-id";

export const SESSION_STORE_KIND_ENV = "KERNEL_SESSION_STORE";
export const FILE_SESSION_STORE_PATH_ENV = "KERNEL_SESSION_STORE_FILE";

/** Same grace Redis gave the per-user index: a row lingers a day past expiry, then is swept. */
const EXPIRED_ROW_GRACE_MS = 86_400_000;

interface StoredSession {
  id: string;
  userId: string;
  currentOrgId: string | null;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
  device: string;
  location: string | null;
  lastActiveAt: number;
}

interface FileShape {
  readonly version: 1;
  /** keyed by sha256(token) */
  readonly sessions: Record<string, StoredSession>;
}

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function toRecord(s: StoredSession): SessionRecord {
  return { ...s };
}

export interface FileSessionTokenStoreOptions {
  /** Absent = in-memory only. */
  readonly path?: string;
  readonly now?: () => number;
}

export class FileSessionTokenStore implements SessionTokenStore {
  async health(): Promise<boolean> { return true; }
  private readonly sessions = new Map<string, StoredSession>();
  private readonly path: string | undefined;
  private readonly now: () => number;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: FileSessionTokenStoreOptions = {}) {
    this.path = options.path;
    this.now = options.now ?? (() => Date.now());
    if (this.path !== undefined) this.load(this.path);
  }

  private load(path: string): void {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    const parsed = JSON.parse(raw) as Partial<FileShape>;
    if (parsed.version !== 1 || typeof parsed.sessions !== "object" || parsed.sessions === null) {
      throw new Error(`unrecognised session store file at ${path}`);
    }
    for (const [key, s] of Object.entries(parsed.sessions)) this.sessions.set(key, { ...s });
    this.sweep();
  }

  /** Drop rows that are past expiry + grace. Revoked-but-unexpired rows stay (I-7). */
  private sweep(): void {
    const cutoff = this.now() - EXPIRED_ROW_GRACE_MS;
    for (const [key, s] of this.sessions) if (s.expiresAt < cutoff) this.sessions.delete(key);
  }

  private persist(): Promise<void> {
    if (this.path === undefined) return Promise.resolve();
    const path = this.path;
    const snapshot: FileShape = { version: 1, sessions: Object.fromEntries(this.sessions) };
    const body = JSON.stringify(snapshot);
    this.writeChain = this.writeChain.then(() => {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, body, { mode: 0o600 });
      renameSync(tmp, path);
    });
    return this.writeChain;
  }

  private live(s: StoredSession | undefined): StoredSession | null {
    if (s === undefined) return null;
    if (s.expiresAt <= this.now()) return null;
    return s;
  }

  private *rowsOf(userId: string): IterableIterator<StoredSession> {
    for (const s of this.sessions.values()) if (s.userId === userId) yield s;
  }

  async issue(record: SessionRecord): Promise<string> {
    const token = randomToken();
    this.sessions.set(tokenKey(token), {
      id: record.id,
      userId: record.userId,
      currentOrgId: record.currentOrgId,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      device: record.device,
      location: record.location,
      lastActiveAt: record.lastActiveAt,
    });
    this.sweep();
    await this.persist();
    return token;
  }

  async findByToken(token: string): Promise<SessionRecord | null> {
    const s = this.live(this.sessions.get(tokenKey(token)));
    return s === null ? null : toRecord(s);
  }

  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const s of this.rowsOf(userId)) {
      if (s.revokedAt !== null) continue;
      s.revokedAt = at.getTime();
      revoked += 1;
    }
    if (revoked > 0) await this.persist();
    return revoked;
  }

  async revokeAllForUserExcept(userId: string, exceptSessionId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const s of this.rowsOf(userId)) {
      if (s.id === exceptSessionId || s.revokedAt !== null) continue;
      s.revokedAt = at.getTime();
      revoked += 1;
    }
    if (revoked > 0) await this.persist();
    return revoked;
  }

  async listForUser(userId: string): Promise<readonly SessionRecord[]> {
    return [...this.rowsOf(userId)].map(toRecord);
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    at: Date,
  ): Promise<{ readonly revokedAt: number; readonly device: string } | null> {
    for (const s of this.sessions.values()) {
      if (s.id !== sessionId) continue;
      if (s.userId !== userId) return null;
      if (s.revokedAt !== null) return { revokedAt: s.revokedAt, device: s.device };
      s.revokedAt = at.getTime();
      await this.persist();
      return { revokedAt: s.revokedAt, device: s.device };
    }
    return null;
  }

  async touch(token: string, at: Date): Promise<void> {
    const s = this.live(this.sessions.get(tokenKey(token)));
    if (s === null || s.revokedAt !== null) return;
    s.lastActiveAt = at.getTime();
    await this.persist();
  }

  async setCurrentOrg(token: string, orgId: OrgId): Promise<boolean> {
    const s = this.live(this.sessions.get(tokenKey(token)));
    if (s === null || s.revokedAt !== null) return false;
    s.currentOrgId = orgId;
    await this.persist();
    return true;
  }

  /** Test helper, same name as the Redis store's. */
  async purgeForUser(userId: string): Promise<void> {
    for (const [key, s] of this.sessions) if (s.userId === userId) this.sessions.delete(key);
    await this.persist();
  }

  async close(): Promise<void> {
    await this.writeChain;
  }
}

/**
 * Composition-root selector. `redis` (default) keeps today's behaviour byte-for-byte;
 * `file` is the desktop build. Anything else is a configuration error, reported at boot.
 */
export function sessionStoreKindFromEnv(): "redis" | "file" {
  const kind = process.env[SESSION_STORE_KIND_ENV] ?? "redis";
  if (kind !== "redis" && kind !== "file") {
    throw new Error(`${SESSION_STORE_KIND_ENV} must be "redis" or "file" (got ${kind})`);
  }
  return kind;
}

export function fileSessionStoreFromEnv(): FileSessionTokenStore {
  const path = process.env[FILE_SESSION_STORE_PATH_ENV];
  if (path === undefined || path === "") {
    throw new Error(`${FILE_SESSION_STORE_PATH_ENV} is required when ${SESSION_STORE_KIND_ENV}=file`);
  }
  return new FileSessionTokenStore({ path });
}
