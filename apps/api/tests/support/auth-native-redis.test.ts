import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "PONG\n") }));
vi.mock("./db", () => ({ asOwner: vi.fn() }));
import { ensureRedis } from "./auth";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("probes the explicitly owned native Redis at the isolated address", () => {
  vi.stubEnv("WORKSPACEX_NATIVE_REDIS", "1");
  vi.stubEnv("REDIS_HOST", "127.0.0.1");
  vi.stubEnv("REDIS_PORT", "24444");
  ensureRedis();
  expect(execFileSync).toHaveBeenCalledOnce();
  expect(execFileSync).toHaveBeenCalledWith("redis-cli", ["-h", "127.0.0.1", "-p", "24444", "PING"],
    { stdio: "pipe", encoding: "utf8" });
});

it("fails closed for unavailable native Redis without starting Docker", () => {
  vi.stubEnv("WORKSPACEX_NATIVE_REDIS", "1");
  vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error("connection refused"); });
  expect(() => ensureRedis()).toThrow("redis-cli PING failed");
  expect(execFileSync).toHaveBeenCalledOnce();
  expect(vi.mocked(execFileSync).mock.calls[0][0]).toBe("redis-cli");
});

it("rejects a non-PONG response instead of treating any output as ready", () => {
  vi.stubEnv("WORKSPACEX_NATIVE_REDIS", "1");
  vi.mocked(execFileSync).mockReturnValueOnce("NOAUTH Authentication required" as never);
  expect(() => ensureRedis()).toThrow("redis-cli PING failed");
  expect(execFileSync).toHaveBeenCalledOnce();
});

it("keeps the existing Docker readiness path when opt-in is absent", () => {
  vi.stubEnv("WORKSPACEX_NATIVE_REDIS", "0");
  ensureRedis();
  const [command, args] = vi.mocked(execFileSync).mock.calls[0];
  expect(command).toBe("docker");
  expect(args).toContain("exec");
  expect(args?.slice(-5)).toEqual(["exec", "-T", "redis", "redis-cli", "PING"]);
});
