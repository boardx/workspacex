/**
 * F20 -- `AuthController.login`'s real HTTP-error mapping for the session-store-unavailable
 * path (PR #2440 independent review, re-review "仍阻断 #1": the existing suites proved
 * `login()` throws the right `AuthError`, but nothing proved what `toHttp()` +
 * `AllExceptionsFilter` turn that into on the wire -- status code, body shape, and
 * specifically that no Redis detail leaks into it).
 *
 * ## Real `AuthController` + real `toHttp()` + real `AllExceptionsFilter`, no HTTP transport
 *
 * Every other F20 login suite boots the real app (`createApp()`) with real Postgres + Redis
 * over a real HTTP server -- the right call for testing that actual integration boundary.
 * This test is about a DIFFERENT boundary: the controller's own catch block
 * (`throw toHttp(e)`) and the global exception filter that turns a thrown NestJS exception
 * into a response body. Neither `@nestjs/testing` nor `supertest` is a dependency of this
 * package (checked before reaching for them), and adding either just for one test file would
 * be a bigger, separately-reviewable change than this fix warrants -- so instead this
 * exercises the REAL classes directly, the same way `interface/device-context.ts`'s own
 * `RequestLike` is deliberately a structural type "so this function can be tested with a
 * literal object -- no Nest, no express request" (that file's own header comment; this test
 * follows the identical, already-established pattern one layer up).
 *
 *   1. `new AuthController(...fakes)` -- a real instance, fakes only for the seven ports its
 *      constructor takes (Postgres/Redis stand-ins).
 *   2. `controller.login(body, fakeReq)` -- the REAL decorated method body, which internally
 *      calls the REAL `login()` application function and, on failure, the REAL `toHttp()`
 *      (`auth.controller.ts`'s own `try { ... } catch (e) { throw toHttp(e); }` -- not
 *      reimplemented here).
 *   3. Whatever it throws (a real `ServiceUnavailableException`/`UnauthorizedException`
 *      instance) is fed into `new AllExceptionsFilter(...).catch(e, fakeHost)` -- the REAL
 *      global filter, the same class NestJS registers as `APP_FILTER` in `kernel.module.ts`.
 *      `fakeHost`'s `getResponse()` records exactly what `res.status(...).json(...)` was
 *      called with, which is the literal wire body a real server would have sent.
 *
 * Net effect: every line between "the controller method runs" and "this is the JSON that
 * left the process" is the real, shipped code. Only the Express/HTTP socket itself is absent.
 */
import { describe, expect, it } from "vitest";
import { HttpStatus } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { AuthController } from "../../src/interface/controllers/auth.controller";
import { AllExceptionsFilter } from "../../src/interface/filters/all-exceptions.filter";
import { SessionStoreUnavailableError } from "../../src/application/auth/ports";
import type { RequestLike } from "../../src/interface/device-context";
import type { SessionTokenStore } from "../../src/application/auth/ports";

const EMAIL = "http-mapping@f20.test";
const PASSWORD = "correct-horse-battery-staple";
const USER = "u-f20-http-mapping";

const CRED = {
  userId: USER, email: EMAIL, passwordHash: "irrelevant", emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  displayName: "HTTP Mapping", avatarUrl: null,
};

const FAKE_REQ: RequestLike = { headers: { "user-agent": "vitest" }, ip: "203.0.113.7" };

function fakeSessions(issue: SessionTokenStore["issue"]): SessionTokenStore {
  return {
    issue, findByToken: async () => null, revokeAllForUser: async () => 0,
    revokeAllForUserExcept: async () => 0, listForUser: async () => [], revokeSession: async () => null,
    touch: async () => undefined, setCurrentOrg: async () => false,
  };
}

/** A real `AuthController`, every port faked except `sessions` (swappable per test). */
function makeController(sessions: SessionTokenStore): AuthController {
  return new AuthController(
    { findByEmail: async () => CRED, findByUserId: async () => CRED, updatePasswordHash: async () => undefined, updateOwnProfile: async () => CRED } as any,
    { hash: async () => "x", verify: async () => true, verifyDummy: async () => false } as any,
    { recentFor: async () => [], record: async () => undefined } as any,
    sessions,
    { issue: async () => undefined, consume: async () => null } as any,
    { sessionId: () => "sess-fake", opaqueToken: () => "token-fake" } as any,
    { send: async () => undefined } as any,
    { now: () => new Date("2026-09-01T00:00:00Z") } as any,
    { listMemberships: async () => [] } as any,
  );
}

/** Feeds a thrown exception through the REAL `AllExceptionsFilter` and records the response. */
async function throughFilter(exception: unknown): Promise<{ status: number; body: unknown }> {
  const filter = new AllExceptionsFilter(
    { info: () => undefined, error: () => undefined } as any,
  );
  let status = 0;
  let body: unknown;
  const res: any = {
    status(s: number) { status = s; return this; },
    json(b: unknown) { body = b; return this; },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ traceId: "t-http-mapping" }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  filter.catch(exception, host);
  return { status, body };
}

describe("AuthController /auth/login -- real controller+toHttp()+filter mapping for session-store failures", () => {
  it("a recognised session-store failure -> HTTP 503, body has ONLY reasonCode + traceId, no Redis message", async () => {
    const controller = makeController(fakeSessions(async () => {
      throw new SessionStoreUnavailableError(new Error("Connection is closed."));
    }));

    let thrown: unknown;
    try {
      await controller.login({ email: EMAIL, password: PASSWORD }, FAKE_REQ);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();

    const { status, body } = await throughFilter(thrown);
    expect(status).toBe(503);
    expect(body).toMatchObject({ reasonCode: "AUTH_SERVICE_UNAVAILABLE" });
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/redis/i);
    expect(raw).not.toContain("Connection is closed");
  });

  it("an unrecognised (programming-bug-shaped) failure -> HTTP 500 internal_error, NOT 503 -- not mislabelled 'service unavailable'", async () => {
    const controller = makeController(fakeSessions(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'x')");
    }));

    let thrown: unknown;
    try {
      await controller.login({ email: EMAIL, password: PASSWORD }, FAKE_REQ);
    } catch (e) {
      thrown = e;
    }
    // Unlike the recognised case, `toHttp()` does not touch this at all -- it is the raw
    // `TypeError`, which is exactly the point: it reaches `AllExceptionsFilter` untranslated.
    expect(thrown).toBeInstanceOf(TypeError);

    const { status, body } = await throughFilter(thrown);
    expect(status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body).toMatchObject({ error: "internal_error" });
    expect(body).not.toHaveProperty("reasonCode");
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/TypeError|properties of undefined/i);
  });

  it("control: a working session store returns a real session from the same controller method", async () => {
    const controller = makeController(fakeSessions(async () => "a-real-token"));

    const out = await controller.login({ email: EMAIL, password: PASSWORD }, FAKE_REQ);
    expect(out).toMatchObject({ sessionToken: "a-real-token", userId: USER });
  });
});
