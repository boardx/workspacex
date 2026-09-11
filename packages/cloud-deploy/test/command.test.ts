import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runProvisionCommand, captureProvisionCommand } from "../src/command";
const context = (signal = new AbortController().signal) => ({ signal, remainingMs: () => 1000 });
it("passes literal arguments without shell expansion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "provision-command-"));
  try {
    const path = join(dir, "args.json");
    const arg = '$(echo secret);`echo injected`';
    await runProvisionCommand({ executable: process.execPath,
      args: ["-e", "require('fs').writeFileSync(process.argv[1],JSON.stringify(process.argv.slice(2)))", path, arg], cwd: dir, env: {} }, context());
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([arg]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it("redacts stderr and treats nonzero exits as failure", async () => {
  await expect(runProvisionCommand({ executable: process.execPath, args: ["-e", "console.error('SECRET');process.exit(7)"], cwd: tmpdir(), env: {} }, context())).rejects.toThrow(/^COMMAND_FAILED$/);
});
it("kills a running command on abort", async () => {
  const controller = new AbortController();
  const promise = runProvisionCommand({ executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: tmpdir(), env: {} }, context(controller.signal));
  const timer = setTimeout(() => controller.abort(), 40);
  try { await expect(promise).rejects.toThrow("COMMAND_CANCELLED"); }
  finally { clearTimeout(timer); }
});
it("fails before spawning if already cancelled", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(runProvisionCommand({ executable: "does-not-exist", args: [], cwd: tmpdir(), env: {} }, context(controller.signal))).rejects.toThrow("COMMAND_CANCELLED");
});
it("redacts spawn failures", async () => {
  await expect(runProvisionCommand({ executable: "/nonexistent-secret-command", args: [], cwd: tmpdir(), env: {} }, context())).rejects.toThrow(/^COMMAND_START_FAILED$/);
});

it("captures bounded structured stdout and rejects excessive output", async () => {
  const base = { executable: process.execPath, cwd: tmpdir(), env: {} };
  expect(await captureProvisionCommand({ ...base, args: ["-e", "process.stdout.write(JSON.stringify({ok:true}))"] }, context())).toBe('{"ok":true}');
  await expect(captureProvisionCommand({ ...base, args: ["-e", "process.stdout.write('x'.repeat(70000))"] }, context())).rejects.toThrow("COMMAND_OUTPUT_LIMIT");
});
