/**
 * F15 acceptance V1 -- "the capability list is organization configuration, not a product
 * built-in" (uc-0-5 R6 AC1 / R7 / R12 V1).
 *
 * ## Why this file has two halves that do not overlap
 *
 * V1 spells out both and says why the runtime half alone is not enough: "only verifying
 * that configuration can be READ, and not that there is no built-in fallback, means the
 * second customer discovers the list was hardcoded all along."
 *
 *   STATIC   -- no list of agents / skills / models / MCPs exists in product source, and no
 *               migration seeds one. Asserted by counter-proving the gate on fixtures, not
 *               by trusting its exit code: run against a directory that does not exist, the
 *               gate prints "skipping" and exits 0. This project has shipped nine gates that
 *               were green while testing nothing.
 *
 *   RUNTIME  -- BOTH directions. "An unconfigured organization returns []" is satisfied by
 *               an endpoint that returns [] unconditionally, so the configured direction is
 *               asserted in the same breath: exactly what was configured, nothing more.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import { addCapability, addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const GATE = join(ROOT, "apps/api/scripts/lint-no-builtin-capabilities.mjs");
const MIGRATIONS = join(ROOT, "apps/api/migrations");

function runGate(...args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [GATE, ...args], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const num = (out: string, key: string): number =>
  Number(new RegExp(`${key}=(\\d+)`).exec(out)?.[1] ?? -1);

/* ─────────────────────────── STATIC half ─────────────────────────── */

describe("V1 static: no built-in capability list exists in product code", () => {
  it("the real tree is clean, and the gate actually looked at it", () => {
    const r = runGate();
    expect(r.code, r.out).toBe(0);
    // Not the exit code. A gate that scanned nothing also exits 0.
    expect(num(r.out, "scanned"), "gate scanned nothing -- it is idling").toBeGreaterThan(100);
    expect(num(r.out, "violations")).toBe(0);
    expect(num(r.out, "migrations"), "no migration was read").toBeGreaterThan(0);
  });

  it("COUNTER-PROOF: a built-in list fails the gate, and the message says which one", () => {
    const r = runGate("apps/api/__fixtures__/builtin-bad");
    expect(r.code, "a fixture full of built-in lists must fail the gate").toBe(1);
    expect(r.out).toContain("built-in capability entry `Ava`");
    expect(r.out).toContain("list-shaped constant `DEFAULT_AGENTS`");
    // The case that matters most: entries that are NOT prototype names. A gate that only
    // knew six names would pass the second customer's hardcoded model list.
    expect(r.out).toContain("list-shaped constant `models`");
    // An explanation is part of the gate -- an error nobody understands gets worked around.
    expect(r.out).toContain("ORGANIZATION CONFIGURATION");
    expect(num(r.out, "violations")).toBe(4);
  });

  it("COUNTER-PROOF the other way: it does not fire on derived enums or on comments", () => {
    // An over-firing gate gets muted, which is how a gate stops testing anything at all.
    const r = runGate("apps/api/__fixtures__/builtin-good");
    expect(r.code, r.out).toBe(0);
    expect(num(r.out, "scanned")).toBe(1);
    expect(num(r.out, "violations")).toBe(0);
  });

  it("the prototype's mock data is counted as DEBT, not silently excluded", () => {
    // Excluding apps/web/lib/mock would make the gate green on the side where the built-in
    // lists actually still are. It is reported here and cannot grow UNNOTICED.
    //
    // ⚠ 2026-07-29：断言从「条数 ≤ 20」改为「文件必须在申报清单里」。
    //
    // 改的原因不是门控挡路，是**它挡的东西挑错了**。phase-01 走 ADR-003 的 UI 先行关卡，
    // 十个能力域各要用真实组件 + mock 把界面做出来供人类签核，mock 是那道关卡的**产物**，
    // 条数按设计就会涨（两个域落地就从 20 涨到 36）。于是这个数字变成移动靶：
    // 每来一个域就改一次上限，而「改一次上限」和「门控失效」在提交历史里长得一模一样。
    //
    // 本仓的纪律是**断言性质，不是断言数量**（`toHaveLength(N)` 会挡住一次正当的新增）。
    // 这里要守的性质是「债务不会在没人注意时长出来」——那就让**新增一个带债务的文件**
    // 成为一个必须显式声明的动作，而条数在申报过的文件里怎么涨都无所谓。
    //
    // 偿还路径确定：某个域的契约束一旦签核，它的 mock 就该改为从 packages/contracts 生成
    // （`packages/contracts/scripts/gen-mock.ts` 已有这条路），届时该文件应当从本清单里删掉。
    // ⚠ phase-01 十个束全签完之后若这份清单还没缩短，说明 UI 先行的产物没有回流成契约——
    // 那才是真正要报警的事，而条数上限永远发现不了它。
    const DECLARED_MOCK_DEBT = [
      "apps/web/lib/mock/admin.ts",        // phase-00 F15 原型遗留（最早的那笔）
      "apps/web/lib/mock/tasks.ts",        // phase-00 原型遗留
      "apps/web/lib/mock/chat.ts",         // phase-01 chat 域 UI 先行
      "apps/web/lib/mock/interview-studio.ts", // phase-01 itv 域 UI 先行
      "apps/web/lib/mock/rec.ts",          // phase-01 rec 域 UI 先行
      "apps/web/lib/mock/agent-runtime.ts",// phase-01 agent-runtime 域 UI 先行
      "apps/web/lib/mock/canvas.ts",       // phase-01 canvas 域 UI 先行
      "apps/web/lib/mock/skill.ts",        // phase-01 skill 域 UI 先行
    ];
    const r = runGate();
    const debtLines = r.out.split("\n").filter((l) => l.startsWith("· [debt]"));
    // 债务仍然只许待在原型 mock 目录下——这条没变，它挡的是「债务跑进产品代码」。
    for (const line of debtLines) {
      expect(line, "debt must stay confined to the prototype mock folder").toContain(
        "apps/web/lib/mock/",
      );
    }
    const files = [...new Set(debtLines.map((l) => l.split(" ")[2]!.split(":")[0]!))].sort();
    const undeclared = files.filter((f) => !DECLARED_MOCK_DEBT.includes(f));
    expect(
      undeclared,
      "新的原型 mock 文件带进了内建能力清单，但没有在 DECLARED_MOCK_DEBT 里申报。" +
        "这不是自动失败——把它加进上面的清单并写明属于哪个域、哪次 UI 先行，就通过了。" +
        "要拦的是「没人注意地长出来」，不是「长出来」。",
    ).toEqual([]);
    // 反向：清单里列了但实际已经没有债务的文件，说明它已经改成从契约生成了 —— 该删掉，
    // 否则清单会变成一份没人维护的白名单，那是本仓踩过的另一个坑。
    const stale = DECLARED_MOCK_DEBT.filter((f) => !files.includes(f));
    expect(stale, "这些文件已无债务，从 DECLARED_MOCK_DEBT 里删掉").toEqual([]);
    expect(
      debtLines.length,
      "if this hits zero the console was rewired -- delete the allowance",
    ).toBeGreaterThan(0);
  });

  it("no migration seeds capability_listings", () => {
    // Rule 3 of the gate, asserted here too because SQL is the one door a TypeScript scan
    // cannot see, and a seeded row is indistinguishable from configuration a human made.
    const inserts = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) =>
        readFileSync(join(MIGRATIONS, f), "utf8")
          .split("\n")
          .some((l) => !/^\s*--/.test(l) && /INSERT\s+INTO\s+capability_listings/i.test(l)),
      );
    expect(inserts).toEqual([]);
  });
});

/* ─────────────────────────── RUNTIME half ─────────────────────────── */

let BASE: string;
let app: NestExpressApplication;

const EMPTY_ORG = "org-v1-empty";
const CONFIGURED_ORG = "org-v1-configured";
const USER = "u-v1";

const authFor = (org: string) => ({ "x-kernel-test-principal": `${USER}:${org}` });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(EMPTY_ORG, CONFIGURED_ORG);
});

beforeEach(async () => {
  await resetOrgs(EMPTY_ORG, CONFIGURED_ORG);
  await seedOrg({ orgId: EMPTY_ORG, projectId: `${EMPTY_ORG}-p` });
  await seedOrg({ orgId: CONFIGURED_ORG, projectId: `${CONFIGURED_ORG}-p` });
  await addOrgMember(EMPTY_ORG, USER, "admin", null);
  await addOrgMember(CONFIGURED_ORG, USER, "admin", null);
});

const list = (org: string, kind: string): Promise<unknown> =>
  fetch(`${BASE}/capabilities?orgId=${org}&kind=${kind}`, { headers: authFor(org) }).then((r) =>
    r.json(),
  );

describe("V1 runtime, BOTH directions", () => {
  it("an organization with no configuration returns [] for every one of the six kinds", async () => {
    for (const kind of C.CapabilityKind.options) {
      const body = await list(EMPTY_ORG, kind);
      expect(body, `kind ${kind} must be empty, not a default set`).toEqual([]);
      // The empty array still has to be the contract's shape.
      const parsed = C.operations.listCapabilities.out.safeParse(body);
      expect(parsed.success ? null : parsed.error.issues).toBeNull();
    }
  });

  it("the empty answer comes from an empty TABLE, not from a branch in the code", async () => {
    // Otherwise "returns []" could be a hardcoded early return that never consults storage,
    // and the configured direction below would be the only thing keeping it honest.
    const n = await asApp(EMPTY_ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM capability_listings WHERE org_id = $1", [
        EMPTY_ORG,
      ]),
    );
    expect(n.rows[0]?.n).toBe("0");
  });

  it("a configured organization returns EXACTLY what was configured -- no extras", async () => {
    // The other direction. "Returns empty for an unconfigured org" is satisfied by returning
    // empty always; this is the assertion that rules that out.
    await addCapability({ orgId: CONFIGURED_ORG, id: "cap-a1", kind: "agent", name: "Bookkeeper" });
    await addCapability({ orgId: CONFIGURED_ORG, id: "cap-a2", kind: "agent", name: "Zoning" });
    await addCapability({ orgId: CONFIGURED_ORG, id: "cap-m1", kind: "model", name: "local-llm" });

    const agents = (await list(CONFIGURED_ORG, "agent")) as { id: string; name: string }[];
    expect(agents.map((a) => a.name).sort()).toEqual(["Bookkeeper", "Zoning"]);

    const models = (await list(CONFIGURED_ORG, "model")) as { name: string }[];
    expect(models.map((m) => m.name)).toEqual(["local-llm"]);

    // And the kinds nobody configured are still empty in the SAME organization -- so the
    // emptiness is per-kind data, not a global switch.
    for (const kind of ["skill", "mcp", "canvas-template", "blueprint"]) {
      expect(await list(CONFIGURED_ORG, kind), `kind ${kind}`).toEqual([]);
    }
  });

  it("switch-org into an unconfigured organization hands back [], and into a configured one hands back its own", async () => {
    await addCapability({ orgId: CONFIGURED_ORG, id: "cap-s1", kind: "skill", name: "cashflow" });

    const empty = await fetch(`${BASE}/identity/switch-org`, {
      method: "POST",
      headers: { ...authFor(EMPTY_ORG), "content-type": "application/json" },
      body: JSON.stringify({ toOrgId: EMPTY_ORG }),
    }).then((r) => r.json() as Promise<{ capabilities: unknown[] }>);
    expect(empty.capabilities).toEqual([]);

    const configured = await fetch(`${BASE}/identity/switch-org`, {
      method: "POST",
      headers: { ...authFor(CONFIGURED_ORG), "content-type": "application/json" },
      body: JSON.stringify({ toOrgId: CONFIGURED_ORG }),
    }).then((r) => r.json() as Promise<{ capabilities: { name: string }[] }>);
    expect(configured.capabilities.map((c) => c.name)).toEqual(["cashflow"]);
  });

  it("the six kinds are the contract's, and an undeclared kind is refused", () => {
    // E-4's lesson: assert CLOSEDNESS, not a member count. `toHaveLength(6)` would block a
    // reviewed, ADR-approved seventh kind with a failure that says nothing about why.
    expect(new Set(C.CapabilityKind.options)).toEqual(
      new Set(["agent", "skill", "model", "mcp", "canvas-template", "blueprint"]),
    );
    expect(C.CapabilityKind.safeParse("workflow").success).toBe(false);
  });

  it("an undeclared kind is refused at the ROUTE, not answered with an empty list", async () => {
    // An empty array here would be indistinguishable from an unconfigured organization, so a
    // typo in the console would read as "the admin has not set this up yet".
    const r = await fetch(`${BASE}/capabilities?orgId=${EMPTY_ORG}&kind=agnet`, {
      headers: authFor(EMPTY_ORG),
    });
    expect(r.status).toBe(400);
  });
});
