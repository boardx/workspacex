// pr-queue.test.ts — #451 的反证测试。
//
// 结构刻意分两段：
//   ① 八条**必需反证**：issue #451 逐条列出的"绝不能得到 READY_TO_MERGE"的场景。
//      每条都先证明 baseline 真的是 READY_TO_MERGE，再只改动一个事实——否则
//      "测试全绿"可能只是因为 baseline 本来就红（本仓已九次栽在空转门控上）。
//   ② 文档↔代码单一事实源：coordinator-sop.md 的状态表必须与 PR_QUEUE_STATES 完全一致。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";
import {
  PR_QUEUE_STATES,
  REQUIRED_CHECKS,
  classifyPr,
  mergeAuthorization,
  parseClosesIssues,
  postMergeGaps,
  resolveCoordMode,
  type PrFacts,
} from "./pr-queue";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

/** 全绿基线：唯一一个应当得到 READY_TO_MERGE 的事实组合。 */
function greenFacts(): PrFacts {
  return {
    number: 451,
    author: "worker-agent",
    isDraft: false,
    headSha: HEAD,
    closesIssues: [451],
    mergeStateStatus: "CLEAN",
    checks: REQUIRED_CHECKS.map((name) => ({ name, status: "COMPLETED", conclusion: "SUCCESS" })),
    verdictLabels: ["review:feature-ok"],
    formalReviews: [{ author: "rev-feature", state: "APPROVED", commit: HEAD }],
  };
}

describe("#451 PR 队列状态机", () => {
  it("基线必须真的是 READY_TO_MERGE（否则下面八条反证全是空转）", () => {
    const got = classifyPr(greenFacts());
    expect(got.state).toBe("READY_TO_MERGE");
    expect(got.reasons).toEqual([]);
    expect(got.blockers).toEqual([]);
  });

  // ── 八条必需反证（issue #451「Required fail-closed regressions」）──────────
  //
  // 2026-08-16（APPROVE_CHECK_SUSPENDED=true，见该常量定义处）："verdict label
  // 必须锚定当前 head 的 approve 背书"这条判断暂停，只进 advisories 不进
  // blockers。反证 1/7 因此分成两半断言：state 不再是 MERGE_BLOCKED，但
  // advisories 里必须仍然出现对应理由——判断逻辑还在算，只是结论不拦人。
  it("反证 1：review 锚在旧 SHA——暂停期不再 MERGE_BLOCKED，但 advisories 仍报出旧 SHA", () => {
    const got = classifyPr({
      ...greenFacts(),
      formalReviews: [{ author: "rev-feature", state: "APPROVED", commit: OLD }],
    });
    expect(got.state).toBe("READY_TO_MERGE"); // 其余条件都满足，条件 5 这一半暂停不拦
    expect(got.advisories.join("\n")).toContain(OLD);
  });

  it("反证 2：同时存在 review:changes 与 review:feature-ok", () => {
    const got = classifyPr({ ...greenFacts(), verdictLabels: ["review:changes", "review:feature-ok"] });
    expect(got.state).toBe("MERGE_BLOCKED");
    expect(got.reasons.join("\n")).toContain("自相矛盾");
  });

  it.each(["PENDING", "CANCELLED", "SKIPPED", "NEUTRAL"])(
    "反证 3：required check 结论为 %s 一律不算绿",
    (conclusion) => {
      const pending = conclusion === "PENDING";
      const got = classifyPr({
        ...greenFacts(),
        checks: greenFacts().checks.map((check) =>
          check.name === REQUIRED_CHECKS[0]
            ? { name: REQUIRED_CHECKS[0], status: pending ? "IN_PROGRESS" : "COMPLETED", conclusion: pending ? null : conclusion }
            : check,
        ),
      });
      expect(got.state).not.toBe("READY_TO_MERGE");
      // pending 是"等"，skipped/neutral/cancelled 是"门空转"——严重度不同，不能混为一谈
      expect(got.state).toBe(pending ? "WAITING_CI" : "MERGE_BLOCKED");
    },
  );

  it("反证 4：PR 是 Draft", () => {
    const got = classifyPr({ ...greenFacts(), isDraft: true });
    expect(got.state).toBe("WAITING_WORKER");
    expect(got.blockers.join("\n")).toContain("Draft");
  });

  it.each(["DIRTY", "BLOCKED", "UNKNOWN"])("反证 5：mergeStateStatus=%s", (mergeStateStatus) => {
    const got = classifyPr({ ...greenFacts(), mergeStateStatus });
    expect(got.state).toBe("MERGE_BLOCKED");
  });

  it("反证 6：PR 正文缺少 Closes #N", () => {
    const got = classifyPr({ ...greenFacts(), closesIssues: [] });
    expect(got.state).toBe("MERGE_BLOCKED");
    expect(got.reasons.join("\n")).toContain("Closes");
  });

  it("反证 7：作者自审——approve 者与 PR 作者是同一人", () => {
    // 自审检查（条件 5 前半：selfApprovals.length > 0 → blocked）没有被暂停——
    // 只有"verdict label 缺独立 approve 背书"那半条（条件 5 后半）暂停了，两者
    // 是不同的判断，别混为一谈。
    const got = classifyPr({
      ...greenFacts(),
      formalReviews: [{ author: "worker-agent", state: "APPROVED", commit: HEAD }],
    });
    expect(got.state).toBe("MERGE_BLOCKED");
    expect(got.reasons.join("\n")).toContain("自审");
    // 自审不得顺带把"有人 approve 过"这件事洗白：条件 5 后半虽然暂停不拦，
    // 但判断逻辑还在算，advisories 里必须仍然报出"没有锚定当前 head"。
    expect(got.advisories.join("\n")).toContain("没有锚定当前 head");
  });

  // ── 2026-08-16 新行为：实测本仓最近 100 个已合并 PR 里 0 个有原生 APPROVE ──
  it("实测驱动：只有 review:feature-ok 标签、完全没有 formalReviews 也能到 READY_TO_MERGE", () => {
    // 直接对应实测证据：如果这条不通过，pr-queue 就会像暂停前一样，对本仓
    // 实际发生过的每一个 PR 都判非 READY_TO_MERGE，不管它有没有真的走过 review。
    const got = classifyPr({ ...greenFacts(), formalReviews: [] });
    expect(got.state).toBe("READY_TO_MERGE");
    // 判断逻辑仍然算出"标签缺 approve 背书"，只是挪进 advisories 不拦人。
    expect(got.advisories.join("\n")).toContain("没有锚定当前 head");
  });

  it("反证 8：无人值守 heartbeat 即便面对 READY_TO_MERGE 也一律拒绝合并", () => {
    const ready = classifyPr(greenFacts());
    expect(ready.state).toBe("READY_TO_MERGE");
    expect(mergeAuthorization(ready.state, "unattended").allowed).toBe(false);
    expect(mergeAuthorization(ready.state, "attended").allowed).toBe(true);
  });

  it("模式解析 fail-closed：只有显式 --attended 才算人类在场", () => {
    expect(resolveCoordMode({})).toBe("unattended");
    expect(resolveCoordMode({ json: true })).toBe("unattended");
    expect(resolveCoordMode({ attended: true })).toBe("attended");
    // 反证：任何非显式路径都不得被解释成 attended
    expect(mergeAuthorization("READY_TO_MERGE", resolveCoordMode({ json: true })).allowed).toBe(false);
  });

  // ── 其它 fail-closed 面 ────────────────────────────────────────────────────
  it("一条 check 都拿不到时按 WAITING_CI 处理——没跑不等于绿", () => {
    const got = classifyPr({ ...greenFacts(), checks: [] });
    expect(got.state).toBe("WAITING_CI");
    expect(got.reasons.length).toBe(REQUIRED_CHECKS.length);
  });

  it("少了任何一条声明过的 required check 都要等——不能因为其余全绿就放行", () => {
    for (const missing of REQUIRED_CHECKS) {
      const got = classifyPr({ ...greenFacts(), checks: greenFacts().checks.filter((c) => c.name !== missing) });
      expect(got.state, missing).toBe("WAITING_CI");
      expect(got.reasons.join("\n"), missing).toContain(missing);
    }
  });

  it("未声明的 check：SKIPPED/NEUTRAL 是条件未命中不拦路，FAILURE 仍然拦", () => {
    const base = greenFacts();
    for (const conclusion of ["SKIPPED", "NEUTRAL"]) {
      const got = classifyPr({
        ...base,
        checks: [...base.checks, { name: "check-new-merges", status: "COMPLETED", conclusion }],
      });
      expect(got.state, conclusion).toBe("READY_TO_MERGE");
    }
    const red = classifyPr({
      ...base,
      checks: [...base.checks, { name: "coord/lease", status: "COMPLETED", conclusion: "FAILURE" }],
    });
    expect(red.state).toBe("CHANGES_REQUIRED");
  });

  it("未知的 check 结论不放行", () => {
    const got = classifyPr({
      ...greenFacts(),
      checks: [{ name: REQUIRED_CHECKS[0], status: "COMPLETED", conclusion: "SOMETHING_NEW" }],
    });
    expect(got.state).toBe("MERGE_BLOCKED");
  });

  it("没有 verdict label 时是 WAITING_REVIEW，不是 MERGE_BLOCKED", () => {
    const got = classifyPr({ ...greenFacts(), verdictLabels: [], formalReviews: [] });
    expect(got.state).toBe("WAITING_REVIEW");
  });

  it("CI 失败退回 worker（CHANGES_REQUIRED），不与门禁完整性问题混为一谈", () => {
    const got = classifyPr({
      ...greenFacts(),
      checks: greenFacts().checks.map((c) => (c.name === REQUIRED_CHECKS[0] ? { ...c, conclusion: "FAILURE" } : c)),
    });
    expect(got.state).toBe("CHANGES_REQUIRED");
  });

  it("BEHIND 是 worker 该 rebase，不是 MERGE_BLOCKED", () => {
    const got = classifyPr({ ...greenFacts(), mergeStateStatus: "BEHIND" });
    expect(got.state).toBe("WAITING_WORKER");
  });

  it("reasons 收集全部命中项，不只报最严重那条", () => {
    const got = classifyPr({ ...greenFacts(), isDraft: true, closesIssues: [], mergeStateStatus: "DIRTY" });
    expect(got.state).toBe("MERGE_BLOCKED");
    expect(got.reasons.length).toBeGreaterThanOrEqual(3);
    expect(got.reasons.join("\n")).toContain("Draft");
  });

  it("解析 Closes 关键字，且不把无关的 #号当成闭合", () => {
    expect(parseClosesIssues("Closes #451\nrefs #999")).toEqual([451]);
    expect(parseClosesIssues("fixes #12 and resolves #7")).toEqual([7, 12]);
    expect(parseClosesIssues("见 #451 的讨论")).toEqual([]);
  });
});

describe("#451 合并后收尾核验", () => {
  const merged = {
    number: 451,
    merged: true,
    mergeCommit: "c".repeat(40),
    mergeCommitOnMain: true,
    closesIssues: [451],
    issueClosed: { 451: true },
    deploymentTracked: true,
  };

  it("全部到位时没有缺口", () => {
    expect(postMergeGaps(merged)).toEqual([]);
  });

  it("标了 merged 但 commit 不在 main —— 假完成必须报出来", () => {
    expect(postMergeGaps({ ...merged, mergeCommitOnMain: false }).join("\n")).toContain("不在 main");
  });

  it("关联 issue 未关闭 / CD 未确认都算缺口（null 按未进入处理）", () => {
    expect(postMergeGaps({ ...merged, issueClosed: { 451: false } }).join("\n")).toContain("#451 仍未关闭");
    expect(postMergeGaps({ ...merged, deploymentTracked: null }).join("\n")).toContain("未确认");
  });
});

describe("#451 文档与代码共用同一份状态枚举", () => {
  const sop = readFileSync(join(REPO_ROOT, ".harness", "instructions", "coordinator-sop.md"), "utf8");

  it("coordinator-sop.md 的状态表与 PR_QUEUE_STATES 完全一致（不多不少、顺序相同）", () => {
    // 状态表以 `| \`STATE\` |` 开头的表格行声明；这里按出现顺序抽取
    const declared = [...sop.matchAll(/^\|\s*`([A-Z_]+)`\s*\|/gm)].map((m) => m[1]);
    expect(declared).toEqual([...PR_QUEUE_STATES]);
  });

  it("REQUIRED_CHECKS 里的每个名字都是 harness-verify.yml 里真实存在的 job——防改名后门禁静默失效", () => {
    const wf = readFileSync(join(REPO_ROOT, ".github", "workflows", "harness-verify.yml"), "utf8");
    // 该 workflow 由 `on: pull_request` 触发（改掉就等于所有 required check 不再跑）
    expect(wf).toMatch(/^on:\n(?:.*\n)*?\s{2}pull_request:/m);
    const jobsBlock = wf.slice(wf.indexOf("\njobs:"));
    const jobIds = [...jobsBlock.matchAll(/^ {2}([a-z0-9][a-z0-9-]*):$/gm)].map((m) => m[1]);
    for (const name of REQUIRED_CHECKS) expect(jobIds, name).toContain(name);
  });

  it("#848 反证：REQUIRED_CHECKS 里的 job 不得被 `if` 排除在 pull_request 之外——存在 ≠ 会跑", () => {
    // 上一条只验「job id 存在」。`e2e-full` 就是**存在但永不在 PR 上跑**（它带
    // `if: github.event_name != 'pull_request'`），于是它被声明为必需之后，
    // 每个 PR 都恒判 MERGE_BLOCKED 长达五天，所有人转而绕过 pr-queue 直接合。
    // 静态存在是痕迹，「这次 PR 上会不会真的跑」才是事实——见
    // `.harness/instructions/static-trace-vs-live-fact.md`。
    const wf = readFileSync(join(REPO_ROOT, ".github", "workflows", "harness-verify.yml"), "utf8");
    const jobsBlock = wf.slice(wf.indexOf("\njobs:"));
    for (const name of REQUIRED_CHECKS) {
      const start = jobsBlock.indexOf(`\n  ${name}:`);
      expect(start, `job ${name} 应存在`).toBeGreaterThan(-1);
      const rest = jobsBlock.slice(start + 1);
      const next = rest.search(/\n {2}[a-z0-9][a-z0-9-]*:\n/);
      const body = next === -1 ? rest : rest.slice(0, next);
      // 必需门禁不得把 pull_request 排除掉——那等于声明了一个在 PR 上永不产出结论的门
      expect(body, `${name} 的 if 条件把 pull_request 排除了，它不可能在 PR 上变绿`)
        .not.toMatch(/github\.event_name\s*!=\s*'pull_request'/);
    }
  });

  it("SOP 明确写出无人值守不得合并，且指向本模块而不是另起一套判定", () => {
    expect(sop).toContain("pnpm harness pr-queue");
    expect(sop).toContain(".harness/scripts/lib/pr-queue.ts");
  });
});
