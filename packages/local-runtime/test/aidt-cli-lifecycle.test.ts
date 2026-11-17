/** CLI state machine with native up/doctor/IPC mocked. Does not affect a real local stack. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  up: vi.fn(), stop: vi.fn(), close: vi.fn(), acquire: vi.fn(), serve: vi.fn(), doctor: vi.fn(), config: vi.fn(), fetch: vi.fn(),
  outputAcquire: vi.fn(), outputClose: vi.fn(), buildCheck: vi.fn(), invalidate: vi.fn(), record: vi.fn(), childStart: vi.fn(), childStop: vi.fn(),
  handler: undefined as ((command: "status" | "stop") => Promise<unknown>) | undefined,
}));
vi.mock("../src/up", () => ({ up: mocks.up }));
vi.mock("../src/doctor", () => ({ runDoctor: mocks.doctor }));
vi.mock("../src/aidt-control", () => ({ acquireControl: mocks.acquire, serveControl: mocks.serve, inspectControl: vi.fn(), requestControl: vi.fn() }));
vi.mock("../src/config", async (original) => ({ ...await original<typeof import("../src/config")>(), resolveLocalConfig: mocks.config }));
vi.mock("../src/aidt-web-build", () => ({ acquireWebOutputLease: mocks.outputAcquire, checkAidtWebBuild: mocks.buildCheck, fingerprintAidtWebBuild: () => ({ sourceInputHash: "before-build-source" }), invalidateAidtWebBuild: mocks.invalidate, recordAidtWebBuild: mocks.record }));
vi.mock("../src/node-launch", () => ({ nextLaunch: () => ({ command: process.execPath, args: ["next-build-test"], env: {} }) }));
vi.mock("../src/processes", () => ({ startManaged: mocks.childStart }));
const stack = () => ({
  stop: mocks.stop, health: () => [], capabilities: [], warnings: [],
  urls: { api: "http://127.0.0.1:3200", web: "http://127.0.0.1:3100", ollama: null, deepAgent: null, asr: null },
  login: { email: "me@local.workspacex", password: "DUMMY_PRIVATE_PASSWORD_SENTINEL" },
});
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
let originalArgv: string[], originalExit: typeof process.exitCode;
let baselineInt = new Set(process.listeners("SIGINT")), baselineTerm = new Set(process.listeners("SIGTERM"));
let logged = "";
function ownSignal(): () => void { const signal = process.listeners("SIGINT").find((listener) => !baselineInt.has(listener)); if (!signal) throw new Error("CLI signal handler was not installed"); return () => signal("SIGINT"); }
async function control(command: "status" | "stop"): Promise<unknown> { if (!mocks.handler) throw new Error("CLI control handler missing"); return mocks.handler(command); }
async function startCli() { await import("../src/aidt-cli"); await vi.waitFor(() => expect(mocks.up).toHaveBeenCalledTimes(1)); }
beforeEach(() => {
  vi.resetModules(); originalArgv = process.argv; originalExit = process.exitCode;
  baselineInt = new Set(process.listeners("SIGINT")); baselineTerm = new Set(process.listeners("SIGTERM"));
  process.argv = [process.execPath, "aidt-cli.ts", "start", "--data-dir", "/test-only-aidt-data"];
  logged = ""; vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { logged += `${args.map(String).join(" ")}\n`; });
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const method of [mocks.up, mocks.stop, mocks.close, mocks.acquire, mocks.serve, mocks.doctor, mocks.config, mocks.fetch, mocks.outputAcquire, mocks.outputClose, mocks.buildCheck, mocks.invalidate, mocks.record, mocks.childStart, mocks.childStop]) method.mockReset();
  mocks.handler = undefined; mocks.doctor.mockReturnValue({ ok: true, findings: [] }); mocks.config.mockReturnValue({ profile: "aidt", repoRoot: "/repo", dataDir: "/test-only-aidt-data", ports: { web: 3100, api: 3200 } });
  mocks.outputAcquire.mockResolvedValue({ close: mocks.outputClose }); mocks.outputClose.mockResolvedValue(undefined);
  mocks.buildCheck.mockReturnValue({ usable: true, reason: null }); mocks.record.mockResolvedValue(undefined);
  mocks.childStop.mockResolvedValue(undefined);
  mocks.childStart.mockReturnValue({ child: { exitCode: 0, signalCode: null }, exited: Promise.resolve(0), recentOutput: () => "", stop: mocks.childStop });
  mocks.acquire.mockResolvedValue({ dataDir: "/test-only-aidt-data", state: { token: "PRIVATE_CONTROL_TOKEN" }, close: mocks.close });
  mocks.serve.mockImplementation(async (_lease, handler: (command: "status" | "stop") => Promise<unknown>) => { mocks.handler = handler; });
  mocks.up.mockResolvedValue(stack()); mocks.stop.mockResolvedValue(undefined); mocks.close.mockResolvedValue(undefined);
  mocks.fetch.mockImplementation(async () => ({ status: 200, body: { cancel: async () => {} } })); vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => {
  for (const listener of process.listeners("SIGINT")) if (!baselineInt.has(listener)) process.removeListener("SIGINT", listener);
  for (const listener of process.listeners("SIGTERM")) if (!baselineTerm.has(listener)) process.removeListener("SIGTERM", listener);
  process.argv = originalArgv; process.exitCode = originalExit; vi.restoreAllMocks(); vi.unstubAllGlobals();
});
describe("AIDT CLI lifecycle boundaries", () => {
  it("retains ownership and reports stop-failed when native shutdown rejects, without a false stopped message", async () => {
    mocks.stop.mockRejectedValue(new Error("Native shutdown not confirmed"));
    await startCli(); const signal = ownSignal(); signal();
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(await control("status")).toMatchObject({ phase: "stop-failed", healthy: false, reason: "Native shutdown not confirmed" });
    expect(mocks.close).not.toHaveBeenCalled(); expect(logged).not.toContain("AIDT stopped.");
    expect(mocks.outputClose).not.toHaveBeenCalled();
    signal(); await Promise.resolve();
    expect(mocks.stop).toHaveBeenCalledTimes(1); expect(mocks.close).not.toHaveBeenCalled();
  });

  it("does not confirm a startup stop until up returns and the original stack actually stops", async () => {
    const boot = deferred<ReturnType<typeof stack>>(), shutdown = deferred<void>();
    mocks.up.mockReturnValue(boot.promise); mocks.stop.mockReturnValue(shutdown.promise);
    await startCli(); const signal = ownSignal(); signal(); signal();
    expect(await control("status")).toMatchObject({ phase: "stopping", healthy: false });
    expect(mocks.stop).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
    expect(logged).toContain("this can take several minutes"); expect(logged).not.toContain("AIDT stopped.");
    boot.resolve(stack()); await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledTimes(1));
    signal(); expect(mocks.close).not.toHaveBeenCalled(); expect(logged).not.toContain("AIDT stopped.");
    shutdown.resolve(); await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.stop).toHaveBeenCalledTimes(1); expect(logged).toContain("AIDT stopped.");
    expect(mocks.outputClose).toHaveBeenCalledTimes(1);
    expect(logged).not.toContain("AIDT ready:");
  });

  it("refuses a missing or stale prebuilt artifact before booting native services, with no dev fallback", async () => {
    process.argv.push("--web", "start"); mocks.buildCheck.mockReturnValue({ usable: false, reason: "Artifact does not match this API port" });
    await import("../src/aidt-cli");
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.buildCheck).toHaveBeenCalledTimes(1); expect(mocks.up).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1); expect(mocks.outputClose).toHaveBeenCalledTimes(1);
  });

  it("boots a verified build explicitly with next start and reports the actual mode", async () => {
    process.argv.push("--web", "start"); await startCli();
    expect(mocks.up).toHaveBeenCalledWith(expect.objectContaining({ webMode: "start" }));
    expect(await control("status")).toMatchObject({ webMode: "start", healthy: true });
    ownSignal()(); await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
  });

  it("builds with the native AIDT browser flags and records proof only after a successful child exit", async () => {
    process.argv[2] = "build";
    await import("../src/aidt-cli"); await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    expect(mocks.up).not.toHaveBeenCalled(); expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), { sourceInputHash: "before-build-source" });
    expect(mocks.childStart).toHaveBeenCalledWith(expect.objectContaining({ env: expect.objectContaining({ NEXT_PUBLIC_ENABLE_AIDT: "1", NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT: "1", NODE_ENV: "production", WORKSPACEX_RELEASE_BUILD: "1" }) }));
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(logged).toContain("AIDT build verified"); expect(logged).not.toContain("AIDT ready:");
  });

  it("does not record successful proof or start services after a failed build", async () => {
    process.argv[2] = "build";
    mocks.childStart.mockReturnValue({ child: { exitCode: 1, signalCode: null }, exited: Promise.resolve(1), recentOutput: () => "compile failed", stop: mocks.childStop });
    await import("../src/aidt-cli"); await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.invalidate).toHaveBeenCalledTimes(1); expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.up).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledTimes(1); expect(logged).not.toContain("build verified");
  });

  it("waits for its build child to stop before releasing output ownership and never records a cancelled build", async () => {
    process.argv[2] = "build";
    const compiling = deferred<number | null>(), shutdown = deferred<void>();
    const child: { exitCode: number | null; signalCode: string | null } = { exitCode: null, signalCode: null };
    mocks.childStop.mockImplementation(async () => { child.signalCode = "SIGTERM"; compiling.resolve(null); await shutdown.promise; });
    mocks.childStart.mockReturnValue({ child, exited: compiling.promise, recentOutput: () => "", stop: mocks.childStop });
    await import("../src/aidt-cli"); await vi.waitFor(() => expect(mocks.childStart).toHaveBeenCalledTimes(1));
    expect(await control("status")).toMatchObject({ phase: "building", webMode: "build", healthy: false });
    ownSignal()(); await vi.waitFor(() => expect(mocks.childStop).toHaveBeenCalledTimes(1));
    expect(mocks.close).not.toHaveBeenCalled(); expect(mocks.outputClose).not.toHaveBeenCalled();
    shutdown.resolve(); await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
    expect(mocks.record).not.toHaveBeenCalled(); expect(logged).not.toContain("build verified");
  });

  it("fails closed if artifact recording detects changed source after compilation", async () => {
    process.argv[2] = "build"; mocks.record.mockRejectedValue(new Error("Source changed during build"));
    await import("../src/aidt-cli"); await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.up).not.toHaveBeenCalled(); expect(logged).not.toContain("build verified");
    expect(mocks.close).toHaveBeenCalledTimes(1); expect(mocks.outputClose).toHaveBeenCalledTimes(1);
  });

  it("releases only its data owner when another instance holds this checkout's output", async () => {
    mocks.outputAcquire.mockRejectedValue(new Error("Web output already owned"));
    await import("../src/aidt-cli"); await vi.waitFor(() => expect(process.exitCode).toBe(1));
    expect(mocks.config).not.toHaveBeenCalled(); expect(mocks.up).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(mocks.outputClose).not.toHaveBeenCalled();
  });

  it("probes API and Web afresh for each status and never includes login or control credentials", async () => {
    await startCli();
    const first = await control("status"); expect(first).toMatchObject({ phase: "running", healthy: true });
    mocks.fetch.mockResolvedValueOnce({ status: 503, body: { cancel: async () => {} } });
    const second = await control("status"); expect(second).toMatchObject({ phase: "running", healthy: false });
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    const output = JSON.stringify([first, second]); expect(output).not.toContain("DUMMY_PRIVATE_PASSWORD_SENTINEL"); expect(output).not.toContain("PRIVATE_CONTROL_TOKEN");
    expect(logged).not.toContain("DUMMY_PRIVATE_PASSWORD_SENTINEL");
    expect(mocks.up).toHaveBeenCalledWith(expect.objectContaining({ webMode: "dev", pullModel: false, allowAlternateOllamaRestart: false }));
    ownSignal()(); await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledTimes(1));
  });
});
