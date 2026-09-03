/**
 * `lint-rewrite-coverage` 必须装在 **PR** 门控上（#2490）。
 *
 * 2026-08-31 起 main 上连续 30 次 `e2e-full` 在第 7 步 3 分钟内红，死因是三条不接线的
 * controller 路由——#539 那道门当场就抓到了，但它只挂在 `verify:harness:raw` 链里，
 * 而那条链只被 main 的 `e2e-full` 调用：PR 全绿 → 合入 → 红在一个本来就没人看的 job 里。
 *
 * 这里断的是**拓扑**，不是某段源码字符串：解析 workflow YAML，找到会在 `pull_request`
 * 上跑的 job，要求其中至少一个 step 真的执行 rewrite-coverage 门。把 step 删掉、
 * 或给 job 加上 `!= 'pull_request'` 的条件，都会让它红。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const WORKFLOW = join(__dirname, "..", "..", ".github", "workflows", "harness-verify.yml");

interface Step { name?: string; run?: string }
interface Job { if?: string; steps?: Step[] }

function prJobs(): Record<string, Job> {
  const doc = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> };
  return Object.fromEntries(
    Object.entries(doc.jobs).filter(([, job]) => {
      const cond = job.if ?? "";
      // 排除掉明确不在 PR 上跑的 job（`!= 'pull_request'`），以及只在别的事件上跑的
      return !/event_name\s*!=\s*'pull_request'/.test(cond) && !/event_name\s*==\s*'(schedule|workflow_dispatch|push)'/.test(cond);
    }),
  );
}

describe("rewrite-coverage 门在 PR 门控上（#2490）", () => {
  it("至少一个在 pull_request 上跑的 job 有 step 执行 lint-rewrite-coverage", () => {
    const jobs = prJobs();
    const hits = Object.entries(jobs).flatMap(([name, job]) =>
      (job.steps ?? [])
        .filter((s) => /lint[:-]rewrite-coverage/.test(s.run ?? ""))
        .map((s) => `${name} › ${s.name ?? s.run}`),
    );
    expect(hits, "PR 门控里没有任何 step 跑 lint-rewrite-coverage——门又回到了只在 main 的 e2e-full 里红的位置").not.toEqual([]);
  });

  it("反空转：workflow 里确实存在被本测试排除的非 PR job（否则过滤器是空转的）", () => {
    const doc = parse(readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> };
    expect(Object.keys(doc.jobs).length).toBeGreaterThan(Object.keys(prJobs()).length);
  });
});
