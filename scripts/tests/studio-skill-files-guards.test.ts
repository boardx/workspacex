import { describe, expect, it, vi } from "vitest";
import { assertStudioReport, withStudioIsolation } from "../studio-skill-files-guards";
import { deriveTestIsolation } from "../../.harness/scripts/lib/test-isolation";
const root = "/fixture/studio-worktree";
const isolated = () => deriveTestIsolation({ worktreePath: root, isolationId: "studio-guard-fixture" });
const config = (env: ReturnType<typeof isolated>) => ({ database: env.PGDATABASE, host: env.PGHOST, port: Number(env.PGPORT), user: "owner", password: "fixture" });
describe("STUDIO isolation rejects before commands", () => {
  it.each([
    ["missing declaration", { WORKSPACEX_DB: undefined }],
    ["shared database", { PGDATABASE: "workspacex", WORKSPACEX_DB: "workspacex" }],
    ["shared compose project", { COMPOSE_PROJECT_NAME: "workspacex" }],
    ["different declaration", { WORKSPACEX_DB: "wsx_elsewhere" }],
    ["different actual PGDATABASE", { PGDATABASE: "workspacex" }],
    ["missing seed", { WORKSPACEX_ISOLATION_SEED: undefined }],
    ["foreign host", { PGHOST: "example.com" }],
  ])("%s never starts commands", async (_name, changes) => {
    const env = { ...isolated(), ...changes };
    const command = vi.fn(async () => {});
    await expect(withStudioIsolation(command, env, { ...config(isolated()), database: env.PGDATABASE! }, root)).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
  it("checks the actual resolved connection, not only environment claims", async () => {
    const env = isolated(), command = vi.fn(async () => {});
    for (const changed of [{ database: "workspacex" }, { host: "example.com" }, { port: 5432 }]) {
      await expect(withStudioIsolation(command, env, { ...config(env), ...changed }, root)).rejects.toThrow();
    }
    expect(command).not.toHaveBeenCalled();
  });
  it("accepts a standard identity with independently reserved ports", async () => {
    const env = { ...isolated(), PGPORT: "21900" }, command = vi.fn(async () => "executed");
    expect(await withStudioIsolation(command, env, config(env), root)).toBe("executed");
    expect(command).toHaveBeenCalledTimes(1);
  });
});
const passing = () => ({ stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, errors: [], suites: [{ specs: [{ tests: [
  { expectedStatus: "passed", status: "expected", results: [{ status: "passed" }] },
] }], suites: [] }] });
describe("STUDIO exact structured report", () => {
  it("accepts one actual pass", () => expect(() => assertStudioReport(passing())).not.toThrow());
  it.each(["expected", "unexpected", "skipped", "flaky"])("rejects wrong %s counts", key => {
    const value = passing(); value.stats[key as keyof typeof value.stats] = key === "expected" ? 0 : 1;
    expect(() => assertStudioReport(value)).toThrow();
  });
  it("rejects copied summary, retry, hidden failure, skip and malformed report", () => {
    const duplicate = passing(); duplicate.suites[0]!.specs[0]!.tests.push(duplicate.suites[0]!.specs[0]!.tests[0]!);
    expect(() => assertStudioReport(duplicate)).toThrow();
    for (const status of ["failed", "skipped", "timedOut", "interrupted"]) {
      const value = passing(); value.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = status;
      expect(() => assertStudioReport(value)).toThrow();
    }
    const retried = passing(); retried.suites[0]!.specs[0]!.tests[0]!.results.push({ status: "passed" });
    expect(() => assertStudioReport(retried)).toThrow();
    for (const value of [null, "1 passed", {}, { ...passing(), errors: [{ message: "worker failed" }] }]) expect(() => assertStudioReport(value)).toThrow();
  });
});
