/**
 * Redis-backed opaque session tokens -- domain §3 ① and ②, the credential format this
 * bundle was signed off to decide.
 *
 * ## Why opaque token + Redis and not JWT
 *
 * I-5 requires that a password reset invalidates all existing sessions IMMEDIATELY. A JWT
 * cannot do that: it is valid until it expires, so "immediately" needs a revocation
 * blacklist -- which is a stateful store consulted on every request, i.e. this design with
 * an extra moving part and a window during which the old token still works. domain.md calls
 * that a head-on conflict rather than a preference, and the sign-off took the recommendation.
 *
 * ## Why this replaces `InMemorySessionStore` rather than deferring
 *
 * `InMemorySessionStore` is process-local: it survives neither a restart nor a second
 * replica. Before F20 that was harmless, because nothing issued a session. After F20 ships,
 * it means "everybody is logged out" on the first deploy -- gap A-3, which the sign-off
 * called "known and must be changed".
 *
 * ⚠ It does NOT replace `application/identity/ports.ts`'s `SessionStore`. That one holds
 * project-scoped CONTEXT keyed by user (what `switchOrganization` clears, O-12); this one
 * maps a bearer token to an identity. Same word, two different things -- see the note on
 * `SessionTokenStore`.
 *
 * ## Redis unavailable => refuse, never degrade
 *
 * Every method lets the connection error propagate. It is tempting to make `findByToken`
 * return null on failure, because that "fails closed" -- but it does not: the Guard turns
 * null into 401 `unauthenticated`, which tells the user their session ended and sends them
 * to log in, which also fails, with the same misleading message. A thrown error becomes 503
 * `auth_unavailable`, which is true. Same rule as identity's `AUTH_SERVICE_UNAVAILABLE`.
 */
import { createHash, randomBytes } from "node:crypto";
import Redis from "ioredis";
import type { SessionTokenStore } from "../../application/auth/ports";
import type { SessionRecord } from "../../domain/auth/session-lifetime";
import { UNKNOWN_DEVICE } from "../../domain/auth/device-fingerprint";

export interface RedisConfig {
  readonly host: string;
  readonly port: number;
  /** Namespaces keys so parallel test workers do not revoke each other's sessions. */
  readonly keyPrefix: string;
}

export function redisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    // Non-default 56379, matching docker-compose.dev.yml: the dev stack must not collide
    // with a Redis the developer already runs.
    port: Number(process.env.REDIS_PORT ?? "56379"),
    // Defaults to the database name so a vitest worker running with WORKSPACEX_DB=wsx_f20
    // is isolated in Redis exactly as it is in PostgreSQL. Without this, two workers share
    // one keyspace and `revokeAllForUser` in one run revokes the other run's fixtures --
    // which surfaces as a flaky assertion, not as an error.
    keyPrefix: process.env.REDIS_PREFIX ?? `wsx:${process.env.WORKSPACEX_DB ?? "workspacex"}:`,
  };
}

/**
 * The stored shape. Kept flat and explicit rather than `JSON.stringify(record)` so that
 * adding a field to `SessionRecord` is a compile error here instead of a field that
 * silently reads back as `undefined` for every session issued before the change.
 */
interface StoredSession {
  id: string;
  userId: string;
  currentOrgId: string | null;
  issuedAt: number;
  expiresAt: number;
  revokedAt: number | null;
  /* ── F03 的三个字段。同一条记录，见 `SessionRecord` 上的说明 ── */
  device: string;
  location: string | null;
  lastActiveAt: number;
}

/**
 * 读回一条记录。
 *
 * ⚠ 这个函数存在的唯一原因是 **F03 之前签发的会话没有 device/location/lastActiveAt**。
 * 直接 `JSON.parse(...) as StoredSession` 会让这三个字段读成 `undefined`，
 * 而 TypeScript 一个字都不会说——于是设备列表里出现 `undefined` 设备，
 * `shouldTouchLastActive` 拿 `now - undefined = NaN` 去比较，恒为 false，
 * 「最后活跃」永远不更新。三个症状没有一个会报错。
 *
 * 兜底值是**明写的**而不是「随便给个空」：`UNKNOWN_DEVICE` 是契约允许的诚实值，
 * `location: null` 是「不知道」，`lastActiveAt` 退回 `issuedAt` 是这条记录唯一确知的活跃时刻。
 */
function parseStored(raw: string): StoredSession {
  const s = JSON.parse(raw) as Partial<StoredSession> & { issuedAt: number };
  return {
    id: s.id!,
    userId: s.userId!,
    currentOrgId: s.currentOrgId ?? null,
    issuedAt: s.issuedAt,
    expiresAt: s.expiresAt!,
    revokedAt: s.revokedAt ?? null,
    device: s.device ?? UNKNOWN_DEVICE,
    location: s.location ?? null,
    lastActiveAt: s.lastActiveAt ?? s.issuedAt,
  };
}

/**
 * The token is the bearer credential; the KEY is its hash.
 *
 * Anyone who can read the Redis keyspace (a `KEYS *`, a memory dump, a monitoring
 * integration that samples key names) would otherwise be holding live session tokens. With
 * the key hashed, the keyspace is useless for impersonation. SHA-256 rather than a slow
 * hash for the same reason as reset tokens: the input is 256 bits of CSPRNG output, so
 * there is nothing to brute-force.
 */
function tokenKey(prefix: string, token: string): string {
  return `${prefix}session:${createHash("sha256").update(token).digest("hex")}`;
}

function userKey(prefix: string, userId: string): string {
  return `${prefix}user-sessions:${userId}`;
}

export class RedisSessionTokenStore implements SessionTokenStore {
  private readonly redis: Redis;
  private connecting: Promise<unknown> | null = null;

  constructor(
    private readonly cfg: RedisConfig,
    client?: Redis,
  ) {
    this.redis =
      client ??
      new Redis({
        host: cfg.host,
        port: cfg.port,
        // Fail fast rather than queue forever. The default (`maxRetriesPerRequest: 20`,
        // offline queueing) turns "Redis is down" into requests that hang, and a hung
        // request is reported by users as "the site is slow", which is the wrong thing to
        // go debug. One retry, then throw -- and the Guard turns the throw into 503.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        // Connect on first COMMAND, not at construction.
        //
        // The composition root builds this at module init, and the process must still boot
        // when Redis is down -- `/healthz` and every public route have nothing to do with
        // sessions. Eager connection also broke `verify-runtime-gates.sh` G7, which spawns
        // the real app with NODE_ENV=production and no Redis in front of it.
        lazyConnect: true,
      });

    // ioredis is an EventEmitter, and an 'error' event with no listener is an UNCAUGHT
    // exception in Node -- i.e. a Redis blip would take the whole API process down.
    //
    // Swallowing it here is not degradation: the same failure still rejects the in-flight
    // command's promise, which propagates to the Guard and becomes 503 `auth_unavailable`.
    // This listener only stops a connection-level event from killing the process; it never
    // makes a failed lookup look like a successful one.
    this.redis.on("error", () => undefined);
  }

  /**
   * Establish the connection before the first command, exactly once.
   *
   * `lazyConnect` + `enableOfflineQueue: false` is the combination that keeps the process
   * bootable without Redis AND stops requests hanging during an outage -- but the two
   * together mean the very FIRST command races the handshake and is rejected with
   * "Stream isn't writeable". That surfaced as a 500 on the first login of a fresh process
   * and then a clean 200 on every subsequent one, which reads as a flaky test rather than
   * as what it is.
   *
   * The promise is cached on failure too, then cleared, so a failed first attempt does not
   * permanently poison the store: the next request retries the connection and either
   * succeeds or throws again -- and a throw is 503 `auth_unavailable`, not a degraded allow.
   */
  private async ready(): Promise<void> {
    if (this.redis.status === "ready") return;
    if (!this.connecting) {
      this.connecting = this.redis
        .connect()
        .catch((e: unknown) => {
          // "already connecting/connected" is a benign race between two concurrent callers.
          if (e instanceof Error && /already connect/i.test(e.message)) return;
          throw e;
        })
        .finally(() => {
          this.connecting = null;
        });
    }
    await this.connecting;
  }

  async issue(record: SessionRecord): Promise<string> {
    await this.ready();
    // The token is NOT derived from the record: it is independent CSPRNG output, so holding
    // a session id (which appears in logs and audit rows) never yields the token.
    const token = randomToken();
    const key = tokenKey(this.cfg.keyPrefix, token);
    const ttlSeconds = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));

    const stored: StoredSession = {
      id: record.id,
      userId: record.userId,
      currentOrgId: record.currentOrgId,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
      device: record.device,
      location: record.location,
      lastActiveAt: record.lastActiveAt,
    };

    // The index and the record are written together. If the index write were skipped on
    // failure, `revokeAllForUser` would return a count that is quietly too low -- and that
    // number is the contract's only evidence that I-5 held.
    await this.redis
      .multi()
      .set(key, JSON.stringify(stored), "EX", ttlSeconds)
      .sadd(userKey(this.cfg.keyPrefix, record.userId), key)
      // The index must outlive the longest session it points at, or revocation starts
      // missing sessions that are still valid. One extra day of slack.
      .expire(userKey(this.cfg.keyPrefix, record.userId), ttlSeconds + 86_400)
      .exec();

    return token;
  }

  async findByToken(token: string): Promise<SessionRecord | null> {
    await this.ready();
    const raw = await this.redis.get(tokenKey(this.cfg.keyPrefix, token));
    if (raw === null) return null;
    return parseStored(raw);
  }

  /**
   * I-5 + I-7: mark every live session revoked, keep the records, return the count.
   *
   * ⚠ Marks rather than deletes. `DEL` would be one line shorter and would destroy the
   * answer to "who was kicked and when" -- one of the four events uc-1-1 R6 requires to be
   * auditable -- and would collapse `SESSION_REVOKED` into `SESSION_EXPIRED` for the user,
   * which usecases.md keeps apart on purpose.
   *
   * ⚠ Already-revoked sessions are NOT counted again. Counting them would make a second
   * reset report the same number as the first, and the number is the evidence.
   */
  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    await this.ready();
    const index = userKey(this.cfg.keyPrefix, userId);
    const keys = await this.redis.smembers(index);
    let revoked = 0;
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw === null) {
        // Expired naturally; drop it from the index so it does not grow without bound.
        await this.redis.srem(index, key);
        continue;
      }
      const s = parseStored(raw);
      if (s.revokedAt !== null) continue;
      s.revokedAt = at.getTime();
      // KEEPTTL: the record must not outlive its natural expiry just because it was
      // revoked, and must not have its expiry reset to the default either.
      await this.redis.set(key, JSON.stringify(s), "KEEPTTL");
      revoked += 1;
    }
    return revoked;
  }

  /**
   * `changeOwnPassword`（#638 delta，迭代 2）—— 同 `revokeAllForUser`，但跳过
   * `exceptSessionId` 那一条。实现上就是 `revokeAllForUser` 的循环体多一个 `continue`
   * 分支，两者刻意保持同一套标记/幂等/KEEPTTL 处置，避免两份几乎一样的逻辑各自漂移。
   */
  async revokeAllForUserExcept(userId: string, exceptSessionId: string, at: Date): Promise<number> {
    await this.ready();
    const index = userKey(this.cfg.keyPrefix, userId);
    const keys = await this.redis.smembers(index);
    let revoked = 0;
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw === null) {
        await this.redis.srem(index, key);
        continue;
      }
      const s = parseStored(raw);
      if (s.id === exceptSessionId) continue;
      if (s.revokedAt !== null) continue;
      s.revokedAt = at.getTime();
      await this.redis.set(key, JSON.stringify(s), "KEEPTTL");
      revoked += 1;
    }
    return revoked;
  }

  /**
   * F22: point THIS session at another organization.
   *
   * ⚠ `KEEPTTL`, exactly as in `revokeAllForUser`. Without it the `SET` resets the key to no
   * expiry at all, and a session that was 3 days from lapsing becomes immortal -- a 30-day
   * limit (AUTH_POLICY.sessionDays) that any org switch quietly lifts. Nothing reports it;
   * the session simply never ends.
   *
   * ⚠ Not a read-modify-write guarded by WATCH. The only field written is `currentOrgId`,
   * the only other writer is `revokeAllForUser`, and losing that race in either direction is
   * benign: revoke-then-switch leaves a revoked session pointed at a new org (still
   * rejected by `checkSession`), switch-then-revoke leaves it revoked. A revoked session is
   * unusable whichever way the interleaving falls, so the transaction would buy nothing.
   *
   * ⚠ Deliberately does NOT resurrect an expired/absent key: returns false and lets the use
   * case answer SESSION_REVOKED. Re-creating the record would mint a live session out of a
   * token that no longer had one.
   */
  async setCurrentOrg(token: string, orgId: string): Promise<boolean> {
    await this.ready();
    const key = tokenKey(this.cfg.keyPrefix, token);
    const raw = await this.redis.get(key);
    if (raw === null) return false;
    const s = parseStored(raw);
    if (s.revokedAt !== null) return false;
    s.currentOrgId = orgId;
    await this.redis.set(key, JSON.stringify(s), "KEEPTTL");
    return true;
  }

  /**
   * F03：吊销**一条**会话。归属校验、幂等、标记不删行 —— 三条都在这里。
   *
   * ⚠ 归属校验用的是**记录里的 `userId`**，不是索引集合里有没有这个 key。
   *   用索引判断看起来等价，实际不是：索引里可能残留一条已自然过期、
   *   key 已被 Redis 回收的会话，那时 `SISMEMBER` 仍为真而记录并不存在。
   *
   * ⚠ 先读记录再比对 `userId`，比对不上返回 null —— 与「不存在」**同一个返回值**。
   *   分开会让调用者能区分「这个 sessionId 是别人的」和「这个 sessionId 不存在」，
   *   也就是一个会话 id 存在性探测器。
   *
   * ⚠ 已经吊销过的直接把**原来的** `revokedAt` 返回（幂等重放）。刷新时间戳会让
   *   「这台设备什么时候被踢的」得到一个错误答案，而那是 uc-1-1 R6 要求可审计的事件之一。
   *
   * ⚠ 不做 WATCH/事务，与 `setCurrentOrg` 同一条理由：并发两路踢同一条，
   *   两路读到的 `revokedAt` 要么都是 null（写入同一批时间戳，差值在毫秒级、
   *   且第二路会看到第一路的值而幂等返回），要么其中一路已看到标记。
   *   两种交错的**最终状态都是「已吊销」**，这正是 `usecases.md` 要的「最终状态唯一」。
   */
  async revokeSession(
    userId: string,
    sessionId: string,
    at: Date,
  ): Promise<{ revokedAt: number; device: string } | null> {
    await this.ready();
    const index = userKey(this.cfg.keyPrefix, userId);
    const keys = await this.redis.smembers(index);
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw === null) {
        await this.redis.srem(index, key);
        continue;
      }
      const s = parseStored(raw);
      if (s.id !== sessionId) continue;
      // 索引是按 userId 建的，所以这一条按理必然属于他。仍然显式比对：
      // 索引写错（或将来有人复用 key）时，这行是唯一会挡住越权吊销的东西。
      if (s.userId !== userId) return null;
      if (s.revokedAt !== null) return { revokedAt: s.revokedAt, device: s.device };
      s.revokedAt = at.getTime();
      // KEEPTTL：被踢不等于延寿，也不等于立刻消失（I-7 要求记录还在）。
      await this.redis.set(key, JSON.stringify(s), "KEEPTTL");
      return { revokedAt: s.revokedAt, device: s.device };
    }
    return null;
  }

  /**
   * F03：推进 `lastActiveAt`。
   *
   * ⚠ 不复活、不延寿：记录不在就什么都不做，`KEEPTTL` 保住原有到期时间。
   *   少了 `KEEPTTL`，一个每分钟被访问一次的会话就**永不过期**——
   *   30 天上限被一个展示字段悄悄取消，而没有任何东西会报错。
   * ⚠ 已吊销的会话不再更新：它不再「活跃」，继续推进这个字段会让审计里
   *   出现「被踢之后还在活动」的记录。
   */
  async touch(token: string, at: Date): Promise<void> {
    await this.ready();
    const key = tokenKey(this.cfg.keyPrefix, token);
    const raw = await this.redis.get(key);
    if (raw === null) return;
    const s = parseStored(raw);
    if (s.revokedAt !== null) return;
    s.lastActiveAt = at.getTime();
    await this.redis.set(key, JSON.stringify(s), "KEEPTTL");
  }

  async listForUser(userId: string): Promise<readonly SessionRecord[]> {
    await this.ready();
    const keys = await this.redis.smembers(userKey(this.cfg.keyPrefix, userId));
    const out: SessionRecord[] = [];
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (raw !== null) out.push(parseStored(raw));
    }
    return out;
  }

  /**
   * FIXTURE CLEANUP ONLY. Deletes the records outright.
   *
   * ⚠ This is NOT revocation and must never be called from a use case. Revocation marks
   * (I-7) precisely so that "who was kicked, and when" stays answerable; this erases that.
   * It exists because test files run in parallel against one Redis and each needs to start
   * from a known count -- the same reason `resetOrgs` deletes rows rather than relying on
   * whatever the previous file left behind.
   *
   * The alternative, a second ioredis client in the test helper that reconstructs the key
   * scheme, would put the key layout in two places -- and the copy would keep "working"
   * against a scheme that had changed, silently cleaning nothing.
   */
  async purgeForUser(userId: string): Promise<void> {
    await this.ready();
    const index = userKey(this.cfg.keyPrefix, userId);
    const keys = await this.redis.smembers(index);
    if (keys.length > 0) await this.redis.del(...keys);
    await this.redis.del(index);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * 256 bits of CSPRNG output, base64url.
 *
 * Not a UUID. A UUIDv4 carries 122 bits of entropy and, more importantly, looks like an
 * identifier -- which invites someone to log it, put it in a URL, or use it as a database
 * key. The token format is a storage concern and lives here rather than behind
 * `TokenFactory` for that reason: nothing outside this file ever constructs one.
 */
function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
