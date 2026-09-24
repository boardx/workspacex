/**
 * backlog C8 —— 本地零出网「拔网 e2e」：代表性本地流程跑一遍，断言非回环连接 0 次。
 *
 * ## 「拔网」在这里是什么
 *
 * 一个**独立于被测代码**的观察者（`unplug()`），装在 `net.Socket.prototype.connect` 与
 * `dns.lookup` 上：任何非回环目的地都被记下并当场判「网络不可达」——和拔掉网线时进程看到的
 * 一样。它不读 guard 的计数，也不信应用层的自述：「我没有出网」正是被测的说法，不能同时当证据。
 *
 * ## 代表性流程（不需要数据库，跑在 `test:local-desktop-unit` 这条裸机车道上）
 *   ① 本地运行时健康检查（`getLocalRuntimeStatus`，真 HTTP 到回环上的假 Ollama）
 *   ② 一次本地模型调用（`invokeLocalModel` → `HttpLocalModelRuntime.complete`）
 *   ③ 读出网账本（`getEgressLedger`，E4 界面那一格的后端）
 * 用例层是真的；只有身份/能力两张表换成内存替身——它们在本地版里本来就走回环上的 PGlite。
 *
 * ## 这道门自己能红（反证，缺一不可）
 *   · 观察者**看到了**回环流量——否则「0 次出网」对一个没装上的观察者同样成立；
 *   · 同一流程里混进一次「厂商遥测」式的外连 ⇒ 观察者抓到、判定红，且 E4 账本记成 `unexpected`；
 *   · 在个人本地组织承诺内外连 ⇒ guard 拒绝，账本记成 `refused`；
 *   · 只做了 DNS 解析（还没连）⇒ 同样抓到：主机名离开这台电脑本身就是出网。
 */
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { egressLedgerState } from "@repo/contracts/deployment";
import { getLocalRuntimeStatus, invokeLocalModel, type LocalModelDeps } from "../../src/application/identity/invoke-local-model";
import { getEgressLedger } from "../../src/application/identity/egress-ledger";
import {
  ProcessEgressGuard, ProcessEgressLedger, isLoopbackTarget,
} from "../../src/infrastructure/egress/local-egress-guard";
import { HttpLocalModelRuntime } from "../../src/infrastructure/identity/http-local-model-runtime";
import type { OrgId } from "../../src/domain/org-id";

const ORG = "org-c8-unplugged" as OrgId;
const USER = "u-c8";
const MODEL = "cap-c8-local";
/** TEST-NET-3（文档保留段）：定义上就不在这台机器上，也不会路由到任何真实主机。 */
const OFF_MACHINE = "203.0.113.9";

/* ───────────────────────── 独立观察者：拔网 ───────────────────────── */

interface Observed { readonly loopback: string[]; readonly offMachine: string[]; readonly dnsNames: string[] }

function hostOf(args: unknown[]): { host: string | undefined; label: string } {
  const flat = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  const first = flat[0];
  if (typeof first === "object" && first !== null) {
    const o = first as { host?: string; port?: number; path?: string };
    if (typeof o.path === "string") return { host: "", label: `unix:${o.path}` };
    return { host: o.host ?? "localhost", label: `${o.host ?? "localhost"}:${o.port ?? "?"}` };
  }
  if (typeof first === "number") {
    const h = typeof flat[1] === "string" ? flat[1] : "localhost";
    return { host: h, label: `${h}:${first}` };
  }
  if (typeof first === "string") return { host: "", label: `unix:${first}` };
  return { host: "unknown", label: "unknown" };
}

/**
 * 装上拔网观察者，返回记录与卸载函数。装在 guard **外层**：先记，再交给里层（guard 照常
 * 判定、照常记账）；里层放行的非回环连接随即以 ENETUNREACH 销毁——拔了网线就是这样。
 */
function unplug(): { observed: Observed; restore: () => void } {
  const observed: Observed = { loopback: [], offMachine: [], dnsNames: [] };
  const inner = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const { host, label } = hostOf(args);
    if (isLoopbackTarget(host)) {
      observed.loopback.push(label);
      return (inner as (...a: unknown[]) => net.Socket).apply(this, args);
    }
    observed.offMachine.push(label);
    const sock = (inner as (...a: unknown[]) => net.Socket).apply(this, args); // guard may throw here
    const err = Object.assign(new Error(`network unplugged: ${label}`), { code: "ENETUNREACH" });
    sock.destroy(err);
    return sock;
  } as typeof net.Socket.prototype.connect;

  const innerLookup = dns.lookup;
  (dns as { lookup: unknown }).lookup = function (hostname: string, ...rest: unknown[]) {
    const cb = rest[rest.length - 1] as (e: NodeJS.ErrnoException | null, ...r: unknown[]) => void;
    if (isLoopbackTarget(hostname)) return (innerLookup as (...a: unknown[]) => unknown)(hostname, ...rest);
    observed.dnsNames.push(hostname);
    process.nextTick(() => cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" })));
    return undefined;
  };
  return {
    observed,
    restore: () => {
      net.Socket.prototype.connect = inner;
      (dns as { lookup: unknown }).lookup = innerLookup;
    },
  };
}

/** 门的判定：纯函数，所以反证可以直接喂一份「有出网」的记录给它。 */
function zeroEgressViolations(o: Observed): string[] {
  return [
    ...o.offMachine.map((t) => `非回环连接 ${t}`),
    ...o.dnsNames.map((n) => `外部域名解析 ${n}`),
  ];
}

/* ───────────────────────── 代表性本地流程 ───────────────────────── */

let ollama: http.Server;
let deps: LocalModelDeps;
let ledger: ProcessEgressLedger;

beforeAll(async () => {
  ollama = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => { body += c.toString("utf8"); });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(req.url === "/api/generate" ? JSON.stringify({ response: "本机模型的回答" }) : "Ollama is running");
    });
  });
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
  ledger = new ProcessEgressLedger("local");
  deps = {
    repo: {
      findOrgMembership: async () => ({ userId: USER, orgId: ORG, role: "admin" }),
      findOrganization: async () => ({ id: ORG, kind: "personal-local", name: "我的本地" }),
    } as unknown as LocalModelDeps["repo"],
    capabilities: {
      findById: async () => ({ id: MODEL, facts: { endpoint } }),
    } as unknown as LocalModelDeps["capabilities"],
    runtime: new HttpLocalModelRuntime(endpoint, "qwen-local"),
    egress: new ProcessEgressGuard(),
  };
});

afterAll(async () => {
  await new Promise<void>((r) => ollama.close(() => r()));
});

async function representativeFlow(): Promise<string> {
  const status = await getLocalRuntimeStatus(deps, { userId: USER, orgId: ORG });
  expect(status.available).toBe(true);
  const out = await invokeLocalModel(deps, { userId: USER, orgId: ORG, capabilityId: MODEL, prompt: "总结这份材料" });
  getEgressLedger(ledger);
  return out.output;
}

describe("C8 本地零出网：拔网跑代表性流程", () => {
  it("the whole local flow completes with the network unplugged, and opens zero off-machine connections", async () => {
    const before = ledger.snapshot().counts;
    const { observed, restore } = unplug();
    let output: string;
    try {
      output = await representativeFlow();
    } finally {
      restore();
    }
    expect(output).toBe("本机模型的回答");
    expect(zeroEgressViolations(observed)).toEqual([]);
    // 观察者自己的反证：它确实看到了流量（回环上的 Ollama），不是没装上。
    // （Node 的 http 全局 agent 默认 keep-alive：三次请求可能复用一条连接，所以是 ≥1。）
    expect(observed.loopback.length).toBeGreaterThanOrEqual(1);
    // E4 账本与独立观察者一致：这段流程没往任何桶里加一次。
    expect(ledger.snapshot().counts).toEqual(before);
  });

  it("counter-proof: a vendor-telemetry style call mixed into the flow is caught, and the ledger calls it unexpected", async () => {
    const before = ledger.snapshot().counts.unexpected;
    const { observed, restore } = unplug();
    try {
      await representativeFlow();
      // 一个不经过我们任何 helper 的外连——依赖里的遥测就长这样。
      await new Promise<void>((resolve) => {
        const s = net.connect({ host: OFF_MACHINE, port: 443 });
        s.on("error", () => resolve());
        s.on("close", () => resolve());
      });
    } finally {
      restore();
    }
    expect(zeroEgressViolations(observed)).toEqual([`非回环连接 ${OFF_MACHINE}:443`]);
    const after = ledger.snapshot();
    expect(after.counts.unexpected).toBe(before + 1);
    expect(egressLedgerState(after.counts)).toBe("unexpected");
  });

  it("counter-proof: an outbound call inside the personal-local promise is refused and counted as refused", async () => {
    const before = ledger.snapshot().counts.refused;
    const { observed, restore } = unplug();
    let thrown: unknown = null;
    try {
      await deps.egress.runLocalOnly(ORG, async () => {
        await representativeFlow();
        try { net.connect({ host: OFF_MACHINE, port: 80 }); } catch (e) { thrown = e; }
      });
    } finally {
      restore();
    }
    expect(thrown).not.toBeNull();
    expect(zeroEgressViolations(observed)).toHaveLength(1);
    expect(ledger.snapshot().counts.refused).toBe(before + 1);
  });

  it("counter-proof: resolving an external hostname is already egress and is caught", async () => {
    const { observed, restore } = unplug();
    try {
      await new Promise<void>((resolve) => dns.lookup("telemetry.example.com", () => resolve()));
    } finally {
      restore();
    }
    expect(zeroEgressViolations(observed)).toEqual(["外部域名解析 telemetry.example.com"]);
  });
});
