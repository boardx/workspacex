import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
const script = fileURLToPath(new URL("../src/cn-migration-rehearsal-cli.ts", import.meta.url));
function failure(args: string[], profile?: string) {
  try {
    execFileSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8", stdio: "pipe", env: { ...process.env, WORKSPACEX_DEPLOY_PROFILE: profile ?? "" } });
    return "unexpected_success";
  } catch (error) { return String((error as { stderr?: unknown }).stderr); }
}
it("refuses any cloud profile before reading input or contacting Docker", () => {
  expect(failure(["nonexistent-checkout", "a".repeat(40), "b".repeat(40), "nonexistent-ledger", "nonexistent-report"], "production")).toContain("synthetic rehearsal refuses cloud profile");
});
it("refuses ledger input without read-only format before contacting Docker", () => {
  const dir = mkdtempSync(join(tmpdir(), "rehearsal-refusal-"));
  try {
    const ledger = join(dir, "ledger.json");
    writeFileSync(ledger, JSON.stringify({ readOnly: false, ledger: [] }));
    expect(failure([dir, "a".repeat(40), "b".repeat(40), ledger, join(dir, "report.json")])).toContain("read-only ledger required");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
