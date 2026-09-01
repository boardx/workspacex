/**
 * `isRecognisedConnectionFailure` (the classifier `RedisSessionTokenStore.issue()` uses to
 * decide "wrap this as `SessionStoreUnavailableError`" vs "rethrow unchanged") -- pinned
 * against the LITERAL error shapes ioredis actually produces (see the classifier's own doc
 * comment for the source references), plus an adapter-level pass showing `issue()` itself
 * applies it correctly end to end, with a fake `Redis` client injected via
 * `RedisSessionTokenStore`'s second constructor argument -- no real Redis needed (PR #2440
 * independent review, finding #2's "adapter/integration counter-evidence" ask).
 */
import { describe, expect, it } from "vitest";
import type Redis from "ioredis";
import {
  isRecognisedConnectionFailure, RedisSessionTokenStore,
} from "../../src/infrastructure/auth/redis-session-token-store";
import { SessionStoreUnavailableError } from "../../src/application/auth/ports";
import type { SessionRecord } from "../../src/domain/auth/session-lifetime";

describe("isRecognisedConnectionFailure -- the literal ioredis shapes", () => {
  it("recognises the exact 'Connection is closed.' message (CONNECTION_CLOSED_ERROR_MSG, the 2026-09-01 incident's shape)", () => {
    expect(isRecognisedConnectionFailure(new Error("Connection is closed."))).toBe(true);
  });

  it("recognises MaxRetriesPerRequestError by name (duck-typed, not instanceof -- see the classifier's doc comment for why)", () => {
    const err = new Error("Reached the max retries per request limit (which is 1).");
    err.name = "MaxRetriesPerRequestError";
    expect(isRecognisedConnectionFailure(err)).toBe(true);
  });

  it("recognises common Node network error codes (ECONNREFUSED etc.)", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:56379"), { code: "ECONNREFUSED" });
    expect(isRecognisedConnectionFailure(err)).toBe(true);
  });

  it("does NOT recognise a differently-worded Error -- a near-miss message is not the same as the real one", () => {
    expect(isRecognisedConnectionFailure(new Error("connection closed"))).toBe(false); // different case/punctuation
    expect(isRecognisedConnectionFailure(new Error("Redis connection error"))).toBe(false);
  });

  it("does NOT recognise a programming-bug shape (TypeError, no connection-related message or code)", () => {
    expect(isRecognisedConnectionFailure(new TypeError("Cannot read properties of undefined (reading 'foo')"))).toBe(false);
  });

  it("does NOT recognise a non-Error thrown value", () => {
    expect(isRecognisedConnectionFailure("just a string")).toBe(false);
    expect(isRecognisedConnectionFailure(null)).toBe(false);
    expect(isRecognisedConnectionFailure(undefined)).toBe(false);
  });
});

/**
 * A fake shaped exactly like the subset of ioredis's `Redis` client that
 * `RedisSessionTokenStore` actually calls (`on`, `status`, `connect`, `multi().set().sadd()
 * .expire().exec()`), injected via the constructor's second (test-only) parameter. This
 * exercises `issue()`'s real try/catch and the classifier together, without a network.
 */
function fakeRedisClient(execImpl: () => Promise<unknown>): Redis {
  const multiChain = {
    set: () => multiChain,
    sadd: () => multiChain,
    expire: () => multiChain,
    exec: execImpl,
  };
  return {
    status: "ready", // `ready()` short-circuits when already "ready" -- skip connect() entirely
    on: () => undefined,
    connect: async () => undefined,
    multi: () => multiChain,
  } as unknown as Redis;
}

const RECORD: SessionRecord = {
  id: "sess-1", userId: "u-1", currentOrgId: null,
  issuedAt: Date.now(), expiresAt: Date.now() + 3_600_000, revokedAt: null,
  device: "Chrome on macOS", location: null, lastActiveAt: Date.now(),
};

describe("RedisSessionTokenStore.issue() -- applies the classifier end to end", () => {
  it("a recognised connection failure from .exec() is wrapped as SessionStoreUnavailableError", async () => {
    const store = new RedisSessionTokenStore(
      { host: "unused", port: 0, keyPrefix: "wsx:test:" },
      fakeRedisClient(async () => { throw new Error("Connection is closed."); }),
    );

    await expect(store.issue(RECORD)).rejects.toBeInstanceOf(SessionStoreUnavailableError);
  });

  it("an unrecognised error from .exec() is rethrown UNCHANGED -- not wrapped, not swallowed", async () => {
    const bug = new TypeError("stored is not JSON-serialisable");
    const store = new RedisSessionTokenStore(
      { host: "unused", port: 0, keyPrefix: "wsx:test:" },
      fakeRedisClient(async () => { throw bug; }),
    );

    await expect(store.issue(RECORD)).rejects.toBe(bug);
  });

  it("control: a working client still returns a token (proves the fake is otherwise faithful)", async () => {
    const store = new RedisSessionTokenStore(
      { host: "unused", port: 0, keyPrefix: "wsx:test:" },
      fakeRedisClient(async () => [[null, "OK"], [null, 1], [null, 1]]),
    );

    await expect(store.issue(RECORD)).resolves.toEqual(expect.any(String));
  });
});
