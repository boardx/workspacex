/**
 * F16 V5 -- "本地运行时没起来时显示依赖失败态并给出启动指引，绝不偷偷改用云端".
 *
 * ## Why "it returned an error" is not the assertion
 *
 * The dangerous failure here is not an unhandled exception, it is a SUCCESSFUL response
 * produced by going somewhere else. So every case below asserts two things at once:
 *
 *   * what the caller was told (a dependency failure carrying the startup hint -- not a
 *     generic 500, which clients retry, and not a 200 from a substitute)
 *   * what the PROCESS did on the network while producing it
 *
 * The second is observed the same way `local-org-zero-egress` observes it -- by watching
 * `net.Socket.prototype.connect` for the duration of the request, i.e. below the application
 * and below every dependency. An application-level "we did not call the cloud" is the claim
 * being tested; it cannot also be the evidence.
 *
 * ## The observer's own counter-proof
 *
 * Every network assertion here also asserts that the observer SAW loopback traffic. Without
 * it, "zero cloud connections" is equally true of an observer that was never installed --
 * which is this project's most repeated failure mode.
 */
import net from "node:net";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import { addCapability, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { invokeLocalModel } from "../../src/application/identity/invoke-local-model";
import {
  CloudModelForbiddenError,
  LocalRuntimeUnavailableError,
} from "../../src/application/identity/errors";
import { HttpLocalModelRuntime } from "../../src/infrastructure/identity/http-local-model-runtime";
import { ProcessEgressGuard } from "../../src/infrastructure/egress/local-egress-guard";
import type { OrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const LOCAL_ORG = "org-f16-runtime";
const USER = "u-f16-runtime";
const MODEL_ID = "cap-f16-local-llm";

let BASE: string;
let app: NestExpressApplication;
let runtimePort = 0;
let runtime: http.Server | null = null;

const auth = { "x-kernel-test-principal": `${USER}:${LOCAL_ORG}` };

/** Bring the "local runtime" up on the port the app was configured with. */
async function startRuntime(): Promise<void> {
  if (runtime) return;
  runtime = http.createServer((_req, res) => res.end("a completion from the local model"));
  await new Promise<void>((r) => runtime!.listen(runtimePort, "127.0.0.1", r));
}

async function stopRuntime(): Promise<void> {
  if (!runtime) return;
  await new Promise<void>((r) => runtime!.close(() => r()));
  runtime = null;
}

/**
 * Record every outbound connection the PROCESS opens while `fn` runs.
 *
 * Installed on the prototype, so it sees what the application, `pg`, and any dependency do --
 * the point being that "did anything reach the cloud" must not be answered by the code under
 * test.
 */
async function watchConnections<T>(fn: () => Promise<T>): Promise<{ result: T; targets: string[] }> {
  const targets: string[] = [];
  const original = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    // Same normalization trap the guard hit: `net.connect` passes `[options, cb]`.
    const flat = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
    const first = flat[0];
    if (typeof first === "object" && first !== null) {
      const o = first as { host?: string; port?: number; path?: string };
      targets.push(o.path ? `unix:${o.path}` : `${o.host ?? "localhost"}:${o.port ?? "?"}`);
    } else if (typeof first === "number") {
      targets.push(`${typeof flat[1] === "string" ? flat[1] : "localhost"}:${first}`);
    } else {
      targets.push(String(first));
    }
    return (original as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
  try {
    return { result: await fn(), targets };
  } finally {
    net.Socket.prototype.connect = original;
  }
}

const isLoopback = (t: string): boolean =>
  t.startsWith("unix:") || /^(127\.|localhost|::1|\[::1\])/.test(t);

beforeAll(async () => {
  // Pick a free loopback port, then release it: the app is configured to talk to it, and the
  // tests below decide whether anything is listening there. That is the whole "runtime is
  // down" condition, reproduced honestly rather than by injecting a failure.
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  runtimePort = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  process.env.LOCAL_RUNTIME_ENDPOINT = `http://127.0.0.1:${runtimePort}`;

  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await stopRuntime();
  await app?.close();
  await resetOrgs(LOCAL_ORG);
  delete process.env.LOCAL_RUNTIME_ENDPOINT;
});

beforeEach(async () => {
  await resetOrgs(LOCAL_ORG);
  await seedOrg({ orgId: LOCAL_ORG, kind: "personal-local", ownerUserId: USER, projectId: `${LOCAL_ORG}-p` });
  await addOrgMember(LOCAL_ORG, USER, "admin", null);
  await addCapability({
    orgId: LOCAL_ORG, id: MODEL_ID, kind: "model", name: "local-llm",
    endpoint: `http://127.0.0.1:${runtimePort}`,
  });
});

afterEach(async () => {
  await stopRuntime();
});

const callModel = (): Promise<Response> =>
  fetch(`${BASE}/identity/local-org/model-call`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ orgId: LOCAL_ORG, capabilityId: MODEL_ID, prompt: "私密材料摘要" }),
  });

describe("V5: the runtime is down", () => {
  it("the call FAILS with a dependency error and the startup hint -- and nothing left the machine", async () => {
    const { result, targets } = await watchConnections(async () => {
      const r = await callModel();
      return { status: r.status, body: (await r.json()) as Record<string, unknown> };
    });

    // 409, not 500: a 5xx says "we are broken, retry" and clients retry it automatically.
    // The truth is "start the runtime on this machine", and an automatic retry loop never
    // reaches that.
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ reasonCode: "LOCAL_RUNTIME_UNAVAILABLE" });
    // ⚠ The hint is NOT in this body, and that is deliberate: it is a contract CONSTANT the
    // frontend reads directly, so the sentence exists once. What must hold is that the code
    // is a member of the contract's closed enum -- otherwise the error boundary would have
    // dropped it and the client would receive a bare `conflict` with nothing to render.
    expect(C.LocalOrgReason.safeParse(result.body.reasonCode).success).toBe(true);
    expect(result.body.startupHint, "the hint must not be copied across the wire").toBeUndefined();

    // The network half: no cloud fallback happened while producing that failure.
    const offMachine = targets.filter((t) => !isLoopback(t));
    expect(offMachine, `the process reached off-machine hosts: ${offMachine.join(", ")}`).toEqual([]);
    // Non-vacuity: the observer really was watching (the request itself, plus PostgreSQL,
    // both on loopback).
    expect(targets.length, "the connection observer saw nothing -- it is not installed").toBeGreaterThan(0);
  });

  it("counter-proof: with the runtime UP, the same call succeeds", async () => {
    // Without this, every assertion above is satisfied by an implementation that always
    // fails -- and "the local organization never works" is not the feature.
    await startRuntime();
    const r = await callModel();
    expect(r.status, await r.clone().text()).toBe(200);
    const body = await r.json();
    const parsed = C.operations.invokeLocalModel.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect((body as { endpoint: string }).endpoint).toBe(`http://127.0.0.1:${runtimePort}`);
    expect(C.isLocalModelEndpoint((body as { endpoint: string }).endpoint)).toBe(true);
  });

  it("the status route reports the failure as a STATE, with the same hint", async () => {
    // A status endpoint that errors when the dependency is down cannot report that it is
    // down -- so this one answers 200 with `available: false`, which is what the UI renders
    // as a dependency-failure state.
    const r = await fetch(`${BASE}/identity/local-org/runtime?orgId=${LOCAL_ORG}`, { headers: auth });
    expect(r.status).toBe(200);
    const body = await r.json();
    const parsed = C.operations.getLocalRuntimeStatus.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(body).toMatchObject({
      available: false,
      failure: { code: "LOCAL_RUNTIME_UNAVAILABLE", startupHint: C.LOCAL_RUNTIME_STARTUP_HINT },
    });

    await startRuntime();
    const up = await fetch(`${BASE}/identity/local-org/runtime?orgId=${LOCAL_ORG}`, { headers: auth });
    // The other direction: `available` is read from the world, not hardcoded.
    expect((await up.json())).toMatchObject({ available: true, failure: null });
  });
});

describe("a cloud endpoint is refused, never substituted", () => {
  it("the DATABASE refuses to store a cloud endpoint in a personal-local organization", async () => {
    // The first line, and the one that does not depend on any reader remembering to filter.
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query(
          `INSERT INTO capability_listings (id, org_id, kind, name, scope, endpoint)
           VALUES ($1,$2,'model','cloud-llm','org-wide','https://api.vendor.example/v1')`,
          [`${MODEL_ID}-cloud`, LOCAL_ORG],
        ),
      ),
    ).rejects.toThrow(/local-model-only/);
  });

  it("...and a LAN endpoint too -- 'this machine' does not mean 'this network'", async () => {
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query(
          `INSERT INTO capability_listings (id, org_id, kind, name, scope, endpoint)
           VALUES ($1,$2,'model','lan-llm','org-wide','http://192.168.1.50:11434')`,
          [`${MODEL_ID}-lan`, LOCAL_ORG],
        ),
      ),
    ).rejects.toThrow(/local-model-only/);
  });

  it("counter-proof: a loopback endpoint IS accepted, and a REAL org may hold a cloud one", async () => {
    // Both halves. Without the first, the trigger could be refusing everything; without the
    // second, it could be refusing cloud endpoints product-wide, which would break F15's
    // whole point that a real organization's model policy is CONFIGURABLE.
    await asApp(LOCAL_ORG, (c) =>
      c.query(
        `INSERT INTO capability_listings (id, org_id, kind, name, scope, endpoint)
         VALUES ($1,$2,'model','second-local','org-wide','http://localhost:1234')`,
        [`${MODEL_ID}-2`, LOCAL_ORG],
      ),
    );
    const real = "org-f16-runtime-real";
    await resetOrgs(real);
    await seedOrg({ orgId: real, projectId: `${real}-p` });
    await asApp(real, (c) =>
      c.query(
        `INSERT INTO capability_listings (id, org_id, kind, name, scope, endpoint)
         VALUES ($1,$2,'model','cloud-llm','org-wide','https://api.vendor.example/v1')`,
        [`${real}-cap`, real],
      ),
    );
    await resetOrgs(real);
  });

  it("the use case refuses a cloud row WITHOUT attempting a connection", async () => {
    // The second line of defence, exercised against a row the database would not accept --
    // i.e. the state a future migration, a restore, or a bug could produce. The point is not
    // only that it refuses, but that it refuses BEFORE opening anything: a refusal that
    // happens after the connect() is a leak with a good error message.
    const guard = new ProcessEgressGuard();
    const deps = {
      repo: {
        findOrgMembership: async () => ({ orgRole: "admin" as const, teamId: null }),
        findOrganization: async () => ({
          id: LOCAL_ORG, name: "local", kind: C.LOCAL_ORG_KIND, team: null, modelPolicy: undefined,
        }),
      },
      capabilities: {
        findById: async () => ({
          facts: { id: MODEL_ID, scope: "org-wide" as const, ownerTeamId: null,
                   endpoint: "https://api.vendor.example/v1" },
          listing: null as never,
        }),
      },
      runtime: new HttpLocalModelRuntime(`http://127.0.0.1:${runtimePort}`),
      egress: guard,
    } as unknown as Parameters<typeof invokeLocalModel>[0];

    const { result, targets } = await watchConnections(async () =>
      invokeLocalModel(deps, {
        userId: USER, orgId: LOCAL_ORG as OrgId, capabilityId: MODEL_ID, prompt: "x",
      }).catch((e: unknown) => e),
    );
    expect(result).toBeInstanceOf(CloudModelForbiddenError);
    expect(targets, "a connection was opened before the refusal").toEqual([]);
  });

  it("the runtime itself cannot be pointed off-machine, and it fails at CONSTRUCTION", async () => {
    // A misconfigured endpoint is the cheapest way to break the promise: point this at a
    // hosted API and every "local" call is a cloud call while the feature reports success.
    // Refusing at construction means such a process never starts serving.
    expect(() => new HttpLocalModelRuntime("https://api.vendor.example")).toThrow(/loopback/);
    expect(() => new HttpLocalModelRuntime("http://192.168.0.10:11434")).toThrow(/loopback/);
    // ...and the valid one still constructs -- otherwise the check is just "always throw".
    expect(new HttpLocalModelRuntime("http://127.0.0.1:11434").endpoint).toBe("http://127.0.0.1:11434");
  });

  it("there is no second endpoint anywhere in the local-model path", async () => {
    // Structural, because "we did not add a fallback" is a claim about code that changes.
    // `LocalModelRuntime` has ONE endpoint field and the use case never chooses a model the
    // caller did not name, so there is no expression in this path that could evaluate to a
    // cloud address.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    for (const f of [
      "../../src/application/identity/invoke-local-model.ts",
      "../../src/infrastructure/identity/http-local-model-runtime.ts",
    ]) {
      const body = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      expect(body, `${f} names an off-machine host`).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
      expect(body, `${f} contains a fallback branch`).not.toMatch(/fallback/i);
    }
  });
});

describe("LOCAL_RUNTIME_UNAVAILABLE is raised from the use case, not invented at the edge", () => {
  it("carries the contract's hint", async () => {
    const guard = new ProcessEgressGuard();
    const deps = {
      repo: {
        findOrgMembership: async () => ({ orgRole: "admin" as const, teamId: null }),
        findOrganization: async () => ({
          id: LOCAL_ORG, name: "local", kind: C.LOCAL_ORG_KIND, team: null, modelPolicy: undefined,
        }),
      },
      capabilities: {
        findById: async () => ({
          facts: { id: MODEL_ID, scope: "org-wide" as const, ownerTeamId: null,
                   endpoint: `http://127.0.0.1:${runtimePort}` },
          listing: null as never,
        }),
      },
      runtime: new HttpLocalModelRuntime(`http://127.0.0.1:${runtimePort}`),
      egress: guard,
    } as unknown as Parameters<typeof invokeLocalModel>[0];

    const err = await invokeLocalModel(deps, {
      userId: USER, orgId: LOCAL_ORG as OrgId, capabilityId: MODEL_ID, prompt: "x",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LocalRuntimeUnavailableError);
    expect((err as LocalRuntimeUnavailableError).startupHint).toBe(C.LOCAL_RUNTIME_STARTUP_HINT);
  });
});
