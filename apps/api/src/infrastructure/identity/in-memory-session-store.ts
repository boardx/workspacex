/**
 * In-memory session store and authorization cache.
 *
 * Process-local, so it does not survive a restart and does not work across replicas. That
 * is stated rather than hidden: real session storage (Redis) arrives with phase-01
 * `01-auth`, together with the credential format this kernel deliberately did not decide.
 *
 * What matters for F01 is that the SHAPE is right -- clearing project-scoped context and
 * invalidating cached verdicts have to be observable operations. Swapping the backing store
 * later changes this file and nothing else.
 */
import { randomUUID } from "node:crypto";
import type {
  AuthorizationCache,
  SessionContext,
  SessionStore,
} from "../../application/identity/ports";

const EMPTY: SessionContext = {
  currentOrgId: null,
  currentProjectId: null,
  currentStageId: null,
  contextPackId: null,
  draftRefs: [],
};

export class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, SessionContext>();

  async get(userId: string): Promise<SessionContext> {
    return this.map.get(userId) ?? EMPTY;
  }

  async setOrg(userId: string, orgId: string): Promise<void> {
    this.map.set(userId, { ...(await this.get(userId)), currentOrgId: orgId });
  }

  async setProjectScoped(userId: string, patch: Partial<SessionContext>): Promise<void> {
    this.map.set(userId, { ...(await this.get(userId)), ...patch });
  }

  /**
   * Everything project-scoped is reset; `currentOrgId` deliberately survives because the
   * caller sets it immediately afterwards. Listing the fields explicitly rather than
   * spreading EMPTY means a NEW project-scoped field added later will not be silently
   * forgotten here -- it will fail to compile.
   */
  async clearProjectScoped(userId: string): Promise<void> {
    const cur = await this.get(userId);
    this.map.set(userId, {
      currentOrgId: cur.currentOrgId,
      currentProjectId: null,
      currentStageId: null,
      contextPackId: null,
      draftRefs: [],
    });
  }
}

export class InMemoryAuthorizationCache implements AuthorizationCache {
  private readonly byUser = new Map<string, Map<string, unknown>>();

  private bucket(userId: string): Map<string, unknown> {
    let b = this.byUser.get(userId);
    if (!b) {
      b = new Map();
      this.byUser.set(userId, b);
    }
    return b;
  }

  async get(key: string): Promise<unknown | null> {
    const [userId] = key.split("|");
    return this.bucket(userId ?? "").get(key) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const [userId] = key.split("|");
    this.bucket(userId ?? "").set(key, value);
  }

  async invalidateUser(userId: string): Promise<void> {
    this.byUser.delete(userId);
  }

  async size(userId: string): Promise<number> {
    return this.byUser.get(userId)?.size ?? 0;
  }
}

/**
 * decisionId generator.
 *
 * UUIDs, not a counter. A decisionId is written into a Context Pack and read back later to
 * answer "why was I shown this" -- a per-process counter collides across restarts and
 * across replicas, and the collision surfaces as an audit trail pointing at the wrong
 * decision, which is worse than having none.
 *
 * Tests inject `CountingDecisionIdFactory` instead, where determinism is what is wanted.
 */
export class UuidDecisionIdFactory {
  next(): string {
    return randomUUID();
  }
}

/** Deterministic ids for tests. Never wired into the composition root. */
export class CountingDecisionIdFactory {
  private n = 0;
  constructor(private readonly prefix = "d") {}
  next(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}
