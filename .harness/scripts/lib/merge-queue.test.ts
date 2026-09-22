// merge-queue.test.ts — #3238 的正反例。
//
// 纪律同 pr-queue.test.ts：每一条规则都配一条**反证**（规则不生效时会红的那个用例），
// 外加对真实 workflow YAML 的机械核对——纯函数判得再对，YAML 里没接上就是空转的门。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_EXECUTED_LANES,
  QUEUE_DEFERRABLE_LANES,
  ZERO_SHA,
  assertPlanIsHonest,
  classifyChangeScope,
  directMergeRefusal,
  parseMergeGroupPrNumbers,
  planVerification,
  queueEvidenceFailure,
  resolveMergeRoute,
  resolveScmBase,
  resolveVerifiedCommit,
  type VerificationPlan,
} from "./merge-queue";
import { REQUIRED_CHECKS } from "./pr-queue";
import { judgeClosingPrGreen } from "./pr-green";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const CANDIDATE = "a".repeat(40);
const GROUP_BASE = "b".repeat(40);
const PR_HEAD = "c".repeat(40);

describe("① merge_group 的 head_sha / base_sha", () => {
  it("merge_group 读 merge_group.head_sha/base_sha —— PR 字段与 base_ref 在这个事件上本来就是空的", () => {
    const facts = {
      eventName: "merge_group",
      sha: CANDIDATE,
      pullRequestHeadSha: "",
      baseRef: "",
      mergeGroupHeadSha: CANDIDATE,
      mergeGroupBaseSha: GROUP_BASE,
    };
    expect(resolveVerifiedCommit(facts)).toEqual({ trigger: "merge_group", headSha: CANDIDATE, provesMergeCandidate: true });
    expect(resolveScmBase(facts)).toBe(GROUP_BASE);
  });

  it("反证：merge_group 缺 head_sha 时抛错，**不**退回 github.sha —— 兜底会让「我验证了正确的东西」不可证伪", () => {
    expect(() => resolveVerifiedCommit({ eventName: "merge_group", sha: CANDIDATE, mergeGroupHeadSha: null })).toThrow(/merge_group\.head_sha/);
  });

  it("反证：merge_group 缺 base_sha 时抛错，不返回空基线（空 TURBO_SCM_BASE 不会报错，只会静悄悄比错东西）", () => {
    expect(() => resolveScmBase({ eventName: "merge_group", mergeGroupHeadSha: CANDIDATE, mergeGroupBaseSha: "" })).toThrow(/base_sha/);
  });

  it("pull_request 走 head.sha + origin/<base_ref>，且**不**证明候选组合", () => {
    const facts = { eventName: "pull_request", pullRequestHeadSha: PR_HEAD, baseRef: "main" };
    expect(resolveVerifiedCommit(facts).provesMergeCandidate).toBe(false);
    expect(resolveScmBase(facts)).toBe("origin/main");
  });

  it("push 走 github.sha + before；分支首推（空 SHA）时没有可证明的基线", () => {
    expect(resolveVerifiedCommit({ eventName: "push", sha: CANDIDATE }).headSha).toBe(CANDIDATE);
    expect(resolveScmBase({ eventName: "push", sha: CANDIDATE, before: GROUP_BASE })).toBe(GROUP_BASE);
    expect(() => resolveScmBase({ eventName: "push", sha: CANDIDATE, before: ZERO_SHA })).toThrow(/空 SHA/);
  });

  it("未知事件没有 diff 基线——不编一个出来", () => {
    expect(() => resolveScmBase({ eventName: "schedule", sha: CANDIDATE })).toThrow(/没有可证明的 diff 基线/);
  });
});

describe("② 影响范围判定（保守失败关闭）", () => {
  it("只改 app/components/public 下的界面文件 ⇒ 已证明的纯前端", () => {
    const verdict = classifyChangeScope(["apps/web/app/chat/page.tsx", "apps/web/components/Button.tsx", "apps/web/public/logo.svg"]);
    expect(verdict).toEqual({ scope: "frontend-only", reasons: [] });
  });

  it.each([
    ["apps/web/app/api/rooms/route.ts", /route handler/],
    ["apps/web/middleware.ts", /权限/],
    ["apps/web/package.json", /依赖\/构建编排/],
    ["apps/web/app/some.config.ts", /构建\/工具链配置/],
    ["apps/api/src/rooms.ts", /允许清单/],
    ["packages/coord-protocol/src/index.ts", /允许清单/],
    ["apps/api/migrations/0001_init.sql", /迁移/],
    ["pnpm-lock.yaml", /依赖\/构建编排/],
    ["turbo.json", /依赖\/构建编排/],
    [".github/workflows/harness-verify.yml", /允许清单/],
    [".harness/scripts/lib/pr-queue.ts", /允许清单/],
    ["some-brand-new-top-level-dir/x.ts", /允许清单/],
  ])("反证：%s 必须判 full（否则快检会把它当纯前端放过）", (path, why) => {
    const verdict = classifyChangeScope([path]);
    expect(verdict.scope).toBe("full");
    expect(verdict.reasons.join("\n")).toMatch(why);
  });

  it("反证：拿不到改动清单时判 full——「查不到」不等于「没改」", () => {
    expect(classifyChangeScope([]).scope).toBe("full");
    expect(classifyChangeScope(["  "]).scope).toBe("full");
  });

  it("一个前端路径 + 一个后端路径 ⇒ full，且理由只点名后端那一个", () => {
    const verdict = classifyChangeScope(["apps/web/app/page.tsx", "apps/api/src/x.ts"]);
    expect(verdict.scope).toBe("full");
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toContain("apps/api/src/x.ts");
  });
});

describe("③ 执行计划：队列启用前不得减验证", () => {
  it("反证（第 4 条）：队列没启用时，纯前端 PR 也不减——减了就是纯减", () => {
    const plan = planVerification({ trigger: "pull_request", scope: "frontend-only", queueEnabled: false });
    expect(plan.fastChecksEnabled).toBe(false);
    expect(plan.deferredLanes).toEqual([]);
    expect(plan.executedLanes).toEqual(expect.arrayContaining([...QUEUE_DEFERRABLE_LANES]));
    expect(plan.reasons.join("\n")).toContain("队列启用前");
  });

  it("队列启用 + 已证明纯前端 ⇒ 快检生效，推迟的全是可推迟车道，且写明了理由", () => {
    const plan = planVerification({ trigger: "pull_request", scope: "frontend-only", queueEnabled: true });
    expect(plan.fastChecksEnabled).toBe(true);
    expect(plan.deferredLanes).toEqual(QUEUE_DEFERRABLE_LANES);
    expect(plan.justification).toBeTruthy();
    expect(() => assertPlanIsHonest(plan)).not.toThrow();
  });

  it("第 3 条：快检生效时五项 required check 一条不少，必要的前端验证车道仍然真实执行", () => {
    const plan = planVerification({ trigger: "pull_request", scope: "frontend-only", queueEnabled: true });
    expect([...plan.requiredChecks]).toEqual([...REQUIRED_CHECKS]);
    for (const lane of ["verify-control-plane", "verify-affected", "verify-full-compile", "merge-gate", "prototype-audit"]) {
      expect(plan.executedLanes, lane).toContain(lane);
    }
  });

  it("第 1 条：merge_group 候选组永远跑完整验证，哪怕范围是纯前端、队列已启用", () => {
    const plan = planVerification({ trigger: "merge_group", scope: "frontend-only", queueEnabled: true });
    expect(plan.fastChecksEnabled).toBe(false);
    expect(plan.deferredLanes).toEqual([]);
    expect(plan.executedLanes).toEqual([...ALWAYS_EXECUTED_LANES, ...QUEUE_DEFERRABLE_LANES]);
  });

  it("范围没被证明是纯前端 ⇒ 不减，哪怕队列已启用", () => {
    expect(planVerification({ trigger: "pull_request", scope: "full", queueEnabled: true }).fastChecksEnabled).toBe(false);
  });

  it("反证：篡改过的计划必须抛——「少一道门」「没理由的推迟」「候选组也推迟」都是空转的门", () => {
    const honest = planVerification({ trigger: "pull_request", scope: "frontend-only", queueEnabled: true });
    const missingGate: VerificationPlan = { ...honest, requiredChecks: REQUIRED_CHECKS.slice(1) };
    expect(() => assertPlanIsHonest(missingGate)).toThrow(/不可以少一道门/);
    expect(() => assertPlanIsHonest({ ...honest, justification: null })).toThrow(/必须写明理由/);
    expect(() => assertPlanIsHonest({ ...honest, fastChecksEnabled: false })).toThrow(/纯粹把验证删掉/);
    expect(() => assertPlanIsHonest({ ...honest, trigger: "merge_group" })).toThrow(/候选组/);
    expect(() => assertPlanIsHonest({ ...honest, deferredLanes: ["verify-affected"] })).toThrow(/不在可推迟清单/);
  });
});

describe("④ 入队与直接合并必须分得清", () => {
  it("队列启用 + 人在场 + 机械门禁全绿 ⇒ 授权**入队**，不是直接合并", () => {
    const decision = resolveMergeRoute({ state: "READY_TO_MERGE", mode: "attended", queueEnabled: true });
    expect(decision).toMatchObject({ route: "enqueue", allowed: true });
    expect(decision.reason).toContain("加入合并队列");
  });

  it("队列没启用时路线就是直接合并，授权理由原样来自 mergeAuthorization（不另起一份判据）", () => {
    expect(resolveMergeRoute({ state: "READY_TO_MERGE", mode: "attended", queueEnabled: false })).toMatchObject({ route: "direct", allowed: true });
  });

  it("反证：无人值守一律不授权——入队也是破坏性动作，不因为多了一层队列就放宽", () => {
    expect(resolveMergeRoute({ state: "READY_TO_MERGE", mode: "unattended", queueEnabled: true }).allowed).toBe(false);
    expect(resolveMergeRoute({ state: "WAITING_CI", mode: "attended", queueEnabled: true }).allowed).toBe(false);
  });

  it("反证：队列启用后仍要直接合并 ⇒ 明确拒绝（那会跳过候选组验证）", () => {
    expect(directMergeRefusal(true)).toContain("跳过候选组");
    expect(directMergeRefusal(false)).toBeNull();
  });
});

describe("⑤ 历史判定必须锚定实际验证的候选组（第 5 条）", () => {
  const base = { mergedViaQueue: true, candidateSha: CANDIDATE, prHeadSha: PR_HEAD, checksObservedOn: CANDIDATE };

  it("证据读自候选组 commit ⇒ 成立", () => {
    expect(queueEvidenceFailure(base)).toBeNull();
  });

  it("反证：拿旧 PR head 的绿冒充候选组通过 ⇒ 必须失败并点名", () => {
    const failure = queueEvidenceFailure({ ...base, checksObservedOn: PR_HEAD });
    expect(failure).toContain("旧 PR head 的绿不能冒充新组合通过");
  });

  it("反证：查不到候选组 commit ⇒ 失败，不按绿处理", () => {
    expect(queueEvidenceFailure({ ...base, candidateSha: null })).toContain("查不到候选组 commit");
    expect(queueEvidenceFailure({ ...base, checksObservedOn: null })).toContain("无法证明验证的是实际合入的组合");
  });

  it("直接合并（没走队列）时 PR head 就是被验证的那个 commit ⇒ 不受本条影响（兼容存量）", () => {
    expect(queueEvidenceFailure({ mergedViaQueue: false, candidateSha: null, prHeadSha: PR_HEAD, checksObservedOn: PR_HEAD })).toBeNull();
  });
});

describe("⑤ 接进 pr-green：证据不成立时判 unknown，绝不判 ok", () => {
  const policy = { version: 2, requiredChecks: [...REQUIRED_CHECKS] };
  const greenRuns = REQUIRED_CHECKS.map((name) => ({
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    startedAt: "2026-09-10T00:00:00Z",
    completedAt: "2026-09-10T00:05:00Z",
  }));
  const closingPr = {
    number: 3238,
    merged: true,
    mergedAt: "2026-09-10T01:00:00Z",
    headSha: PR_HEAD,
    runs: greenRuns,
    policy,
  };

  it("反证：队列合并、但这批绿读自 PR head ⇒ unknown（strict 下 FAIL），不是 ok", () => {
    const verdict = judgeClosingPrGreen({
      issueNumber: 3238,
      issueClosedAt: "2026-09-10T01:00:00Z",
      closingPrs: [
        { ...closingPr, queueEvidence: { mergedViaQueue: true, candidateSha: CANDIDATE, prHeadSha: PR_HEAD, checksObservedOn: PR_HEAD } },
      ],
    });
    expect(verdict.kind).toBe("unknown");
    expect(JSON.stringify(verdict)).toContain("旧 PR head");
  });

  it("队列合并且证据锚在候选组 ⇒ 照常按 classifyChecks 判绿", () => {
    const verdict = judgeClosingPrGreen({
      issueNumber: 3238,
      issueClosedAt: "2026-09-10T01:00:00Z",
      closingPrs: [
        { ...closingPr, headSha: CANDIDATE, queueEvidence: { mergedViaQueue: true, candidateSha: CANDIDATE, prHeadSha: PR_HEAD, checksObservedOn: CANDIDATE } },
      ],
    });
    expect(verdict.kind).toBe("ok");
  });

  it("兼容：没有 queueEvidence 的存量 PR 判定行为一字不变", () => {
    expect(judgeClosingPrGreen({ issueNumber: 3238, issueClosedAt: "2026-09-10T01:00:00Z", closingPrs: [closingPr] }).kind).toBe("ok");
  });
});

describe("⑥ 候选组里有哪些 PR（merge-gate 要在候选组上继续出结论）", () => {
  it("队列 ref 与候选组 commit 标题两个来源都要——一个组可以批量含多个 PR，ref 只写得下最后一个", () => {
    expect(
      parseMergeGroupPrNumbers(`refs/heads/gh-readonly-queue/main/pr-3238-${GROUP_BASE}`, ["feat: x (#3230)", "fix: y (#3238)"]),
    ).toEqual([3230, 3238]);
  });

  it("反证：两个来源都解析不出 ⇒ 空数组，调用方必须据此失败，不得当成「这个组没有要检查的 PR」", () => {
    expect(parseMergeGroupPrNumbers("refs/heads/main", ["no pr reference here"])).toEqual([]);
  });
});

// ── workflow 机械核对：纯函数判得再对，YAML 里没接上就是空转的门 ────────────

const WORKFLOW_FILES = ["harness-verify.yml", "backend-gates.yml"] as const;
const workflow = (file: string) => readFileSync(join(REPO_ROOT, ".github", "workflows", file), "utf8");

/** 取某个 job 的整段 body（同 pr-queue.test.ts 的切法）。 */
function jobBody(text: string, name: string): string {
  const jobs = text.slice(text.indexOf("\njobs:"));
  const start = jobs.indexOf(`\n  ${name}:`);
  if (start === -1) return "";
  const rest = jobs.slice(start + 1);
  const next = rest.search(/\n {2}[a-z0-9][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("#3238 workflow 接线：候选组必须真的跑，部署必须真的不跑", () => {
  it.each(WORKFLOW_FILES)("%s 声明 merge_group 触发——没有它，候选组上一个 job 都不会起", (file) => {
    const text = workflow(file);
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\njobs:"));
    expect(on).toMatch(/^ {2}merge_group:/m);
  });

  it("每一项 required check 都会在候选组上出结论——被 `if` 排除掉就是队列永久卡住（#848 的同款失效）", () => {
    const text = WORKFLOW_FILES.map(workflow).join("\n");
    for (const name of REQUIRED_CHECKS) {
      const body = jobBody(text, name);
      expect(body, `job ${name} 应存在`).not.toBe("");
      const ifLine = /\n\s{4}if:([\s\S]*?)\n\s{4}[a-z-]+:/.exec(body)?.[1] ?? "";
      expect(ifLine, `${name} 显式把 merge_group 排除了`).not.toMatch(/event_name\s*!=\s*'merge_group'/);
      if (/github\.event_name\s*==\s*'/.test(ifLine)) {
        expect(ifLine, `${name} 的 if 用 event_name 白名单，却没有列入 merge_group`).toContain("'merge_group'");
      }
    }
  });

  it("verify-affected 的 diff 基线覆盖 merge_group——否则 TURBO_SCM_BASE 在候选组上是空串", () => {
    const body = jobBody(workflow("harness-verify.yml"), "verify-affected");
    for (const line of body.split("\n").filter((l) => l.includes("TURBO_SCM_BASE:"))) {
      expect(line, "TURBO_SCM_BASE 没有 merge_group 分支").toContain("merge_group.base_sha");
    }
  });

  it("第 1/6 条：候选组不得触发部署，main 发布仍钉死在 refs/heads/main 与 tag 上", () => {
    const body = jobBody(workflow("backend-gates.yml"), "deploy");
    expect(body).toMatch(/event_name\s*!=\s*'merge_group'/);
    expect(body).toContain("refs/heads/main");
    expect(body).toContain("refs/tags/v");
  });

  it("候选组的 run 不得被 cancel-in-progress 掐掉——掐掉等于这个组合从没被验证过", () => {
    for (const file of WORKFLOW_FILES) {
      const text = workflow(file);
      const concurrency = text.slice(text.indexOf("\nconcurrency:"), text.indexOf("\njobs:"));
      expect(concurrency, file).toMatch(/cancel-in-progress:.*github\.event_name == 'pull_request'/);
    }
  });
});
