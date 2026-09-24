/**
 * E3 —— 第一个价值时刻埋点：先写者胜、记录失败绝不冒泡、本地查看的形状。
 * （纯单元：存储用内存假件，语义与 `pg-first-value-facts.ts` 的 ON CONFLICT DO NOTHING 相同；
 *  真实表上的同一断言见 `first-value-facts-db.test.ts`，需要数据库。）
 */
import { describe, expect, it, vi } from "vitest";
import { firstValueEvents as FV } from "@repo/contracts";
import { FirstValueRecorder, recordFirstValue, type FirstValueFactStore, type FirstValueStep } from "../../src/application/first-value/first-value-recorder";
import type { LoggerPort } from "../../src/application/ports/logger.port";
import type { OrgId } from "../../src/domain/org-id";

function memoryStore(): FirstValueFactStore & { rows: Map<string, Date> } {
  const rows = new Map<string, Date>();
  return {
    rows,
    recordFirst: async (orgId, step, at) => {
      const k = `${orgId}|${step}`;
      if (!rows.has(k)) rows.set(k, at);
    },
    listForOrg: async (orgId) =>
      [...rows].filter(([k]) => k.startsWith(`${orgId}|`)).map(([k, at]) => ({ step: k.split("|")[1] as FirstValueStep, occurredAt: at })),
  };
}
const logger = (): LoggerPort => ({ info: vi.fn(), error: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("FirstValueRecorder", () => {
  it("幂等：同组织同步重复记录，只保留第一次的时刻（先写者胜）", async () => {
    const store = memoryStore();
    let t = Date.parse("2026-09-24T00:00:00.000Z");
    const rec = new FirstValueRecorder(store, logger(), () => new Date(t));
    rec.record("org-a", "first_sign_in");
    await flush();
    t += 60_000;
    rec.record("org-a", "first_sign_in");
    await flush();
    expect(store.rows.size).toBe(1);
    expect(store.rows.get("org-a|first_sign_in")!.toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("存储异步失败 / 同步抛错 ⇒ record() 不抛，只记日志", async () => {
    const log = logger();
    const rejecting = new FirstValueRecorder({ ...memoryStore(), recordFirst: async () => { throw new Error("db down"); } }, log);
    expect(() => rejecting.record("org-a", "workspace_opened")).not.toThrow();
    await flush();
    expect(log.error).toHaveBeenCalledTimes(1);

    const throwing = new FirstValueRecorder({ ...memoryStore(), recordFirst: () => { throw new Error("sync"); } }, log);
    expect(() => throwing.record("org-a", "workspace_opened")).not.toThrow();
    expect(log.error).toHaveBeenCalledTimes(2);

    const badLogger: LoggerPort = { info: vi.fn(), error: () => { throw new Error("logger down"); } };
    const worst = new FirstValueRecorder({ ...memoryStore(), recordFirst: () => { throw new Error("sync"); } }, badLogger);
    expect(() => worst.record("org-a", "workspace_opened")).not.toThrow();
  });

  it("无组织 / 未接线 ⇒ no-op", async () => {
    const store = memoryStore();
    const rec = new FirstValueRecorder(store, logger());
    rec.record(null, "first_sign_in");
    rec.record("", "first_sign_in");
    recordFirstValue(undefined, "org-a", "first_sign_in");
    await flush();
    expect(store.rows.size).toBe(0);
  });

  it("本地查看：各步齐全、未到达为 null、分钟数从首次登录算起", async () => {
    const store = memoryStore();
    let t = Date.parse("2026-09-24T00:00:00.000Z");
    const rec = new FirstValueRecorder(store, logger(), () => new Date(t));
    rec.record("org-a", "first_sign_in");
    await flush();
    t += 12 * 60_000;
    rec.record("org-a", FV.FIRST_VALUE_STEP);
    await flush();
    const rows = await store.listForOrg("org-a" as OrgId);
    const out = FV.orgFirstValueFunnel(rows.map((r) => ({ step: r.step, occurredAt: r.occurredAt.toISOString() })));
    expect(out.steps.map((s) => s.step)).toEqual(FV.FirstValueStep.options);
    expect(out.steps.find((s) => s.step === "workspace_opened")!.occurredAt).toBeNull();
    expect(out.minutesToFirstValue).toBe(12);
    expect(out.budgetMinutes).toBe(FV.FIRST_VALUE_BUDGET_MINUTES);
  });
});
