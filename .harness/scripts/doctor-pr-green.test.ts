/**
 * doctor 第 ⑤ 条「关闭 issue 的 PR 合入时是否绿」（完成定义第 7 条，#2539 / #2540）的**行为**反证。
 *
 * 同 doctor-issue-truncation.test.ts 的纪律：不断源码字符串，用假 `gh` 喂四种命令
 * （`issue list` / `api graphql`（分页）/ `api repos/…/check-runs` / `api repos/…/statuses`），断 doctor 的输出。
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
  /** 关掉 issue 的 PR 落在第二页：第一页塞 100 个已关闭未合入的 PR + hasNextPage，PR #900 在第二页 */
  prOnPageTwo?: boolean;
  /** 第二页请求失败（exit 1） */
  pageTwoFails?: boolean;
  /** graphql 回包不带 pageInfo（老查询形状）——不知道有没有下一页 */
  noPageInfo?: boolean;
  /** head 上的 commit status 历史：[context, state, 打上的时刻(相对合入分钟)] */
  statuses?: Array<[string, string, number]>;
  /** statuses 端点失败（exit 1） */
  statusesFail?: boolean;
  strict?: boolean;
};

const MERGED_AT = "2026-09-03T10:00:00Z";
const T = (min: number) => new Date(Date.parse(MERGED_AT) + min * 60_000).toISOString();

function runDoctorWithFakeGh(sc: Scenario): string {
  dir = mkdtempSync(join(tmpdir(), "doctor-pr-green-"));
  const gh = join(dir, "gh");
  const merged = sc.merged ?? true;
  const issue = JSON.stringify([{ number: 1, state: "CLOSED", stateReason: "COMPLETED", closedAt: sc.closedAt, body: "<!-- harness-feature: 00/F14 -->" }]);
  const pr900 = { number: 900, merged, mergedAt: merged ? MERGED_AT : null, headRefOid: "d".repeat(40) };
  const page = (nodes: object[], hasNextPage: boolean) =>
    JSON.stringify({ data: { repository: { issue: { closedByPullRequestsReferences: {
      nodes,
      ...(sc.noPageInfo ? {} : { pageInfo: { hasNextPage, endCursor: hasNextPage ? "PAGE2" : null } }),
    } } } } });
  const filler = Array.from({ length: 100 }, (_, i) => ({ number: 1000 + i, merged: false, mergedAt: null, headRefOid: "e".repeat(40) }));
  const pageOne = sc.prOnPageTwo ? page(filler, true) : page([pr900], false);
  const pageTwo = page([pr900], false);
  const checks = [
    ...sc.vcp.map(([conclusion, start, done], i) => {
      const completed = done === undefined ? start + 1 : done;
      return completed === null
        ? { id: 100 + i, name: "verify-control-plane", status: "in_progress", conclusion: null, started_at: T(start), completed_at: null }
        : { id: 100 + i, name: "verify-control-plane", status: "completed", conclusion, started_at: T(start), completed_at: T(completed) };
    }),
    { id: 1, name: "verify-affected", status: "completed", conclusion: "success", started_at: T(-30), completed_at: T(-29) },
    { id: 2, name: "verify-full-compile", status: "completed", conclusion: "success", started_at: T(-30), completed_at: T(-29) },
    { id: 3, name: "e2e-full", status: "completed", conclusion: "skipped", started_at: T(-30), completed_at: T(-30) },
  ].map((c) => JSON.stringify(c)).join("\n");
  const statuses = (sc.statuses ?? []).map(([context, state, at], i) => JSON.stringify({ id: 500 + i, context, state, created_at: T(at) })).join("\n");
  const lines = (s: string) => (s ? `printf '%s\\n' '${s.replace(/\n/g, "' '")}'` : ":");
  writeFileSync(gh, `#!/usr/bin/env bash
case "$*" in
  *"issue list"*) printf '%s' '${issue}' ;;
  *"api graphql"*"c=\"PAGE2\""*) ${sc.pageTwoFails ? "echo 'gh: HTTP 502' >&2; exit 1" : `printf '%s' '${pageTwo}'`} ;;
  *"api graphql"*) ${sc.graphqlFails ? "echo 'gh: HTTP 502' >&2; exit 1" : `printf '%s' '${pageOne}'`} ;;
  *"check-runs"*) ${lines(checks)} ;;
  *"/statuses"*) ${sc.statusesFail ? "echo 'gh: HTTP 502' >&2; exit 1" : lines(statuses)} ;;
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

  it("旧 attempt 合入前绿 + 更新的 rerun 合入时仍在跑 → 报（合入时 GitHub 显示的是 pending，不退回旧的绿）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -30, -25], ["success", -5, +10]] });
    expect(out).toContain("完成定义第 7 条");
    expect(out).toContain("还没有结论");
  });

  it("旧 attempt 合入前红 + 更新的 rerun 合入前完成绿 → 不报（最新 attempt 胜出）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["failure", -30, -25], ["success", -15, -10]] });
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

  it("关掉 issue 的 PR 在第二页（>100 个引用）→ 翻页到底后照样报出 PR #900 的红", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["failure", -5]], prOnPageTwo: true });
    expect(out).toContain("完成定义第 7 条");
    expect(out).toContain("PR #900");
    expect(out).not.toContain("没有任何已合入的 PR"); // 只看第一页会把它当成「没有 PR」
  });

  it("第二页拿不到 + --strict → FAIL「查不到」（半份清单不放行）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], prOnPageTwo: true, pageTwoFails: true, strict: true });
    const line = out.split("\n").find((l) => l.includes("查不到关闭 issue #1 的 PR"));
    expect(line, out).toBeDefined();
    expect(line!.includes("✗")).toBe(true);
  });

  it("graphql 回包不带 pageInfo → 不知道有没有下一页，按「查不到」处理（strict FAIL）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], noPageInfo: true, strict: true });
    expect(out).toContain("查不到关闭 issue #1 的 PR");
  });

  it("check run 全绿、但合入前打上的 commit status `coord/andon` 是 failure → 报（rollup 不只有 CheckRun）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], statuses: [["coord/andon", "failure", -3]] });
    expect(out).toContain("完成定义第 7 条");
    expect(out).toContain("coord/andon");
  });

  it("commit status 合入前 failure、合入前又打成 success → 不报（合入前最后一次 state 说了算）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], statuses: [["coord/andon", "failure", -8], ["coord/andon", "success", -2]] });
    expect(out).not.toContain("完成定义第 7 条");
  });

  it("commit status 合入后才打成 failure → 不报（合入后的观测无关）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], statuses: [["coord/andon", "failure", +7]] });
    expect(out).not.toContain("完成定义第 7 条");
  });

  it("statuses 端点拿不到 + --strict → FAIL「查不到」（只有 check run 那一半不放行）", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], statusesFail: true, strict: true });
    const line = out.split("\n").find((l) => l.includes("查不到关闭 issue #1 的 PR"));
    expect(line, out).toBeDefined();
    expect(line!.includes("✗")).toBe(true);
  });

  it("gh 问不到 + 非 strict（pre-push）→ WARN 级", () => {
    const out = runDoctorWithFakeGh({ closedAt: AFTER, vcp: [["success", -10]], graphqlFails: true, strict: false });
    const line = out.split("\n").find((l) => l.includes("查不到关闭 issue #1 的 PR"));
    expect(line, out).toBeDefined();
    expect(line!.includes("⚠")).toBe(true);
  });
});
