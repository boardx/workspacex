/**
 * doctor 第 ⑤ 条「关闭 issue 的 PR 合入时是否绿」（完成定义第 7 条，#2539 / #2540）的**行为**反证。
 *
 * 同 doctor-issue-truncation.test.ts 的纪律：不断源码字符串，用假 `gh` 喂三种命令
 * （`issue list` / `api graphql` / `api repos/…/check-runs`），断 doctor 的输出。
 * phase-00 的 F14 是 passing、有 sprint，假 issue 用它的 marker；其余 feature 会报
 * 「没有对应 issue」，与本测试无关，不断言。
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");

let dir: string | null = null;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

type Scenario = { closedAt: string; requiredConclusion: "success" | "failure"; merged?: boolean };

function runDoctorWithFakeGh(sc: Scenario): string {
  dir = mkdtempSync(join(tmpdir(), "doctor-pr-green-"));
  const gh = join(dir, "gh");
  const merged = sc.merged ?? true;
  const issue = JSON.stringify([{ number: 1, state: "CLOSED", stateReason: "COMPLETED", closedAt: sc.closedAt, body: "<!-- harness-feature: 00/F14 -->" }]);
  const graphql = JSON.stringify({ data: { repository: { issue: { closedByPullRequestsReferences: { nodes: [{ number: 900, merged, headRefOid: "d".repeat(40) }] } } } } });
  const checks = [
    { name: "verify-control-plane", status: "completed", conclusion: sc.requiredConclusion },
    { name: "verify-affected", status: "completed", conclusion: "success" },
    { name: "verify-full-compile", status: "completed", conclusion: "success" },
    { name: "e2e-full", status: "completed", conclusion: "skipped" },
  ].map((c) => JSON.stringify(c)).join("\n");
  writeFileSync(gh, `#!/usr/bin/env bash
case "$*" in
  *"issue list"*) printf '%s' '${issue}' ;;
  *"api graphql"*) printf '%s' '${graphql}' ;;
  *"check-runs"*) printf '%s\\n' '${checks.replace(/\n/g, "' '")}' ;;
  *) echo '[]' ;;
esac
`);
  chmodSync(gh, 0o755);
  try {
    return execFileSync("pnpm", ["harness", "doctor", "--phase", "00"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
}

const AFTER = "2026-09-03T00:00:00Z";
const BEFORE = "2026-08-01T00:00:00Z";

describe("doctor ⑤：关闭 issue 的 PR 合入时不绿 → 报完成定义第 7 条", () => {
  it("生效后关闭 + required check FAILURE → 报出来，理由带 PR 号与 check 名", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, requiredConclusion: "failure" });
    expect(out).toContain("完成定义第 7 条");
    expect(out).toContain("PR #900");
    expect(out).toContain("verify-control-plane");
  });

  it("生效后关闭 + 没有已合入的 PR → 报「没有任何已合入的 PR」", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, requiredConclusion: "success", merged: false });
    expect(out).toContain("没有任何已合入的 PR");
  });

  it("反空转正样本：生效后关闭 + 全绿 → 不报", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, requiredConclusion: "success" });
    expect(out).not.toContain("完成定义第 7 条");
  });

  it("生效前关闭的存量 → 不倒查（即使 PR 是红的）", () => {
    const out = runDoctorWithFakeGh({ closedAt: BEFORE, requiredConclusion: "failure" });
    expect(out).not.toContain("完成定义第 7 条");
  });
});
