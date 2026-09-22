import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { startManaged, waitForManaged } from "../src/processes";

const quiet = (): void => {};

describe("startManaged", () => {
  it("waitForManaged rejects when the child exits before the probe succeeds (no false ready from a stale listener)", async () => {
    const m = startManaged({ name: "dies", command: process.execPath, args: ["-e", "process.exit(3)"], cwd: process.cwd(), env: {} }, quiet);
    await expect(waitForManaged(m, "http://127.0.0.1:1/never", { timeoutMs: 10_000 })).rejects.toThrow(/dies exited with code 3/);
  });

  it("stop() takes the whole process group down, not just the direct child", async () => {
    // sh forks `sleep`; killing only sh would leave sleep running (the uvicorn --workers shape)
    const m = startManaged({ name: "tree", command: "sh", args: ["-c", "sleep 300 & wait"], cwd: process.cwd(), env: {} }, quiet);
    await new Promise((r) => setTimeout(r, 300));
    const pgid = m.child.pid!;
    const before = execSync(`ps -o pid= -g ${pgid} | wc -l`).toString().trim();
    expect(Number(before)).toBeGreaterThanOrEqual(2);
    await m.stop();
    await new Promise((r) => setTimeout(r, 300));
    const after = execSync(`ps -o pid= -g ${pgid} | wc -l`).toString().trim();
    expect(Number(after)).toBe(0);
  });
});
