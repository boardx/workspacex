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

type Scenario = {
  closedAt: string;
  /** required check `verify-control-plane` 的观测序列：[结论, 开始(相对合入分钟), 完成(相对合入分钟；缺省=开始+1；null=未完成)] */
  vcp: Array<[string, number, (number | null)?]>;
  merged?: boolean;
  /** 让假 gh 的 graphql 失败（exit 1），测 strict 下 fail-closed */
  graphqlFails?: boolean;
  strict?: boolean;
};

const MERGED_AT = "2026-09-03T10:00:00Z";
const T = (min: number) => new Date(Date.parse(MERGED_AT) + min * 60_000).toISOString();

function runDoctorWithFakeGh(sc: Scenario): string {
  dir = mkdtempSync(join(tmpdir(), "doctor-pr-green-"));
  const gh = join(dir, "gh");
  const merged = sc.merged ?? true;
  const issue = JSON.stringify([{ number: 1, state: "CLOSED", stateReason: "COMPLETED", closedAt: sc.closedAt, body: "<!-- harness-feature: 00/F14 -->" }]);
  const graphql = JSON.stringify({ data: { repository: { issue: { closedByPullRequestsReferences: { nodes: [{ number: 900, merged, mergedAt: merged ? MERGED_AT : null, headRefOid: "d".repeat(40) }] } } } } });
  const checks = [
    ...sc.vcp.map(([conclusion, start, done]) => {
      const completed = done === undefined ? start + 1 : done;
      return completed === null
        ? { name: "verify-control-plane", status: "in_progress", conclusion: null, started_at: T(start), completed_at: null }
        : { name: "verify-control-plane", status: "completed", conclusion, started_at: T(start), completed_at: T(completed) };
    }),
    { name: "verify-affected", status: "completed", conclusion: "success", started_at: T(-30), completed_at: T(-29) },
    { name: "verify-full-compile", status: "completed", conclusion: "success", started_at: T(-30), completed_at: T(-29) },
    { name: "e2e-full", status: "completed", conclusion: "skipped", started_at: T(-30), completed_at: T(-30) },
  ].map((c) => JSON.stringify(c)).join("\n");
  writeFileSync(gh, `#!/usr/bin/env bash
case "$*" in
  *"issue list"*) printf '%s' '${issue}' ;;
  *"api graphql"*) ${sc.graphqlFails ? "echo 'gh: HTTP 502' >&2; exit 1" : `printf '%s' '${graphql}'`} ;;
  *"check-runs"*) printf '%s\\n' '${checks.replace(/\n/g, "' '")}' ;;
  *) echo '[]' ;;
esac
`);
  chmodSync(gh, 0o755);
  const args = ["harness", "doctor", "--phase", "00", ...(sc.strict ? ["--strict"] : [])];
  try {
    return execFileSync("pnpm", args, {
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
  it("生效后关闭 + 合入时 required FAILURE → 报出来，理由带 PR 号与 check 名", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["failure", -5]] });
    expect(out).toContain("完成定义第 7 条");
    expect(out).toContain("PR #900");
    expect(out).toContain("verify-control-plane");
  });

  it("合入前失败、合入前 rerun 成功 → 不报（同名取最晚，不会永远违反）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["failure", -30], ["success", -10]] });
    expect(out).not.toContain("完成定义第 7 条");
  });

  it("合入时绿、合入后被 rerun 打红 → 不报（合入后的 run 无关）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10], ["failure", +20]] });
    expect(out).not.toContain("完成定义第 7 条");
  });

  it("合入前最后一次红、合入后才 rerun 绿 → 仍报（合入时就是红的）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["failure", -10], ["success", +5]] });
    expect(out).toContain("完成定义第 7 条");
  });

  it("合入前开始、合入后才 SUCCESS 完成 → 报（合入时 required 还没结论，不是绿）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -5, +10]] });
    expect(out).toContain("完成定义第 7 条");
    expect(out).toContain("还没有结论");
  });

  it("合入前完成的绿 + 合入前开始、合入后才完成的 rerun → 不报（不覆盖合入时刻的结论）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -30, -25], ["failure", -5, +10]] });
    expect(out).not.toContain("完成定义第 7 条");
  });

  it("生效后关闭 + 没有已合入的 PR → 报「没有任何已合入的 PR」", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], merged: false });
    expect(out).toContain("没有任何已合入的 PR");
  });

  it("生效前关闭的存量 → 不倒查（即使 PR 是红的）", () => {
    const out = runDoctorWithFakeGh({ closedAt: BEFORE, vcp: [["failure", -5]] });
    expect(out).not.toContain("完成定义第 7 条");
  });

  it("gh 问不到（graphql 失败）+ --strict → FAIL 级（问不到不等于绿，不 fail-open）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], graphqlFails: true, strict: true });
    const line = out.split("\n").find((l) => l.includes("查不到关闭 issue #1 的 PR"));
    expect(line, out).toBeDefined();
    expect(line!.startsWith("✗") || line!.includes("✗")).toBe(true); // FAIL 行以 ✗ 打印，WARN 行以 ⚠
  });

  it("gh 问不到 + 非 strict（pre-push）→ WARN 级", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], graphqlFails: true, strict: false });
    const line = out.split("\n").find((l) => l.includes("查不到关闭 issue #1 的 PR"));
    expect(line, out).toBeDefined();
    expect(line!.includes("⚠")).toBe(true);
  });
});
