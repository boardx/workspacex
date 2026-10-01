import { describe, expect, it } from "vitest";
import { DEFAULT_PORTS } from "../src/config";
import { relocateInternalPorts } from "../src/internal-ports";

const busyOnly = (...ports: number[]) => async (p: number) => ports.includes(p);

describe("内部端口被占就换号（#3872 R23）", () => {
  it("默认的 PGlite 端口被别人占了 → 换到 20000–31999 里一个空的", async () => {
    const r = await relocateInternalPorts(DEFAULT_PORTS, busyOnly(55432));
    expect(r.moved).toHaveLength(1);
    expect(r.moved[0]).toMatchObject({ name: "postgres", from: 55432 });
    expect(r.ports.postgres).toBeGreaterThanOrEqual(20_000);
    expect(r.ports.postgres).toBeLessThan(32_000);
    expect(r.ports.api).toBe(DEFAULT_PORTS.api);
  });

  it("备选号也被占时跳过它", async () => {
    const first = (await relocateInternalPorts(DEFAULT_PORTS, busyOnly(55432))).ports.postgres;
    const r = await relocateInternalPorts(DEFAULT_PORTS, busyOnly(55432, first));
    expect(r.ports.postgres).not.toBe(first);
    expect(r.ports.postgres).not.toBe(55432);
  });

  it("api / web 被占不挪——它们的地址写死在 web 产物里", async () => {
    const r = await relocateInternalPorts(DEFAULT_PORTS, busyOnly(DEFAULT_PORTS.api, DEFAULT_PORTS.web));
    expect(r.moved).toEqual([]);
  });

  it("人显式指定的端口被占不挪，交给端口检查如实报", async () => {
    const ports = { ...DEFAULT_PORTS, postgres: 60000 };
    const r = await relocateInternalPorts(ports, busyOnly(60000));
    expect(r.moved).toEqual([]);
    expect(r.ports.postgres).toBe(60000);
  });

  it("几个一起挪时互不撞号，也不撞到别的在用端口", async () => {
    const r = await relocateInternalPorts(DEFAULT_PORTS, busyOnly(55432, 3310, 3320, 2024));
    const tos = r.moved.map((m) => m.to);
    expect(r.moved.map((m) => m.name).sort()).toEqual(["asr", "deepAgent", "postgres", "sandbox"]);
    expect(new Set(tos).size).toBe(4);
    for (const t of tos) expect(Object.values(DEFAULT_PORTS)).not.toContain(t);
  });

  it("都空闲时什么都不动", async () => {
    const r = await relocateInternalPorts(DEFAULT_PORTS, busyOnly());
    expect(r.moved).toEqual([]);
    expect(r.ports).toEqual(DEFAULT_PORTS);
  });
});
