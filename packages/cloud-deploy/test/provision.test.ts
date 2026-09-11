import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { provision, provisionStages, type ProvisionActions } from "../src/provision";
const directories: string[] = [];
async function directory() { const p = await mkdtemp(join(tmpdir(), "provision-")); directories.push(p); return p; }
afterEach(async () => { await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
function actions(): ProvisionActions { return { preflight: vi.fn(async () => {}), secrets: vi.fn(async () => {}), dependencies: vi.fn(async () => {}), migrate: vi.fn(async () => {}), bootstrap: vi.fn(async () => {}), start: vi.fn(async () => {}), readiness: vi.fn(async () => {}), "business-probe": vi.fn(async () => {}) }; }

it("runs every stage in order and keeps independent attempt reports on retry", async () => {
  const stateDirectory = await directory();
  const calls: string[] = [];
  const steps = actions();
  for (const name of provisionStages) steps[name] = async ({ remainingMs }) => { expect(remainingMs()).toBeGreaterThan(0); calls.push(name); };
  const a = await provision({ stateDirectory, actions: steps });
  const b = await provision({ stateDirectory, actions: steps });
  expect(a.status).toBe("passed"); expect(b.status).toBe("passed");
  expect(calls).toEqual([...provisionStages, ...provisionStages]);
  expect(a.attemptId).not.toBe(b.attemptId);
  expect(await readdir(stateDirectory)).toHaveLength(2);
  expect(JSON.parse(await readFile(join(stateDirectory, `${a.attemptId}.json`), "utf8"))).toEqual(a);
});
it("stops at a failed migration, redacts raw errors and permits safe retry", async () => {
  const stateDirectory = await directory(); const steps = actions();
  steps.migrate = async () => { throw new Error("postgres://secret@host"); };
  const result = await provision({ stateDirectory, actions: steps });
  expect(result.status).toBe("failed"); expect(result.code).toBe("STAGE_FAILED");
  expect(steps.bootstrap).not.toHaveBeenCalled(); expect(steps.start).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("postgres://secret@host");
  expect((await provision({ stateDirectory, actions: actions() })).status).toBe("passed");
});
it("enforces a global deadline even for an action that ignores cancellation, retaining its lock", async () => {
  const stateDirectory = await directory(); const steps = actions();
  steps.preflight = async () => new Promise(() => {});
  const result = await provision({ stateDirectory, actions: steps, deadlineMs: 30 });
  expect(result.code).toBe("DEADLINE_EXCEEDED"); expect(result.lockRetained).toBe(true);
  expect(steps.secrets).not.toHaveBeenCalled();
  await expect(provision({ stateDirectory, actions: actions() })).rejects.toThrow("DEPLOYMENT_LOCK_UNAVAILABLE");
});
it("refuses concurrent deployments without disturbing the running attempt", async () => {
  const stateDirectory = await directory(); const steps = actions();
  let ready!: () => void; const started = new Promise<void>(r => { ready = r; });
  let resume!: () => void;
  steps.preflight = () => { ready(); return new Promise<void>(r => { resume = r; }); };
  const first = provision({ stateDirectory, actions: steps }); await started;
  await expect(provision({ stateDirectory, actions: actions() })).rejects.toThrow("DEPLOYMENT_LOCK_UNAVAILABLE");
  resume(); expect((await first).status).toBe("passed");
});
it("propagates cancellation without starting later stages", async () => {
  const stateDirectory = await directory(); const steps = actions(); const controller = new AbortController();
  steps.preflight = async ({ signal }) => { controller.abort(); expect(signal.aborted).toBe(true); };
  const result = await provision({ stateDirectory, actions: steps, signal: controller.signal });
  expect(result.code).toBe("CANCELLED"); expect(result.lockRetained).toBe(true);
  expect(steps.secrets).not.toHaveBeenCalled();
});
it("cannot declare success when the business probe fails", async () => {
  const steps = actions(); steps["business-probe"] = async () => { throw new Error("probe failed"); };
  expect((await provision({ stateDirectory: await directory(), actions: steps })).status).toBe("failed");
});
it("rejects enlarged budgets or missing stages before acquiring a lock", async () => {
  const stateDirectory = await directory();
  await expect(provision({ stateDirectory, actions: actions(), deadlineMs: 300001 })).rejects.toThrow("INVALID_DEADLINE");
  const steps = actions(); delete (steps as Partial<ProvisionActions>).bootstrap;
  await expect(provision({ stateDirectory, actions: steps })).rejects.toThrow("MISSING_STAGE");
  expect(await readdir(stateDirectory)).toEqual([]);
});
