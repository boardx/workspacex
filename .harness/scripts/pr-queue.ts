// pr-queue.ts — CLI：`pnpm harness pr-queue`（只读 PR 队列体检，#451）。
//
// 只做三件事：用 gh 取客观事实 → 交给 lib/pr-queue.ts 的纯函数判定 → 打印。
// **不合并、不改 label、不评论**——所有写动作留给人（见 mergeAuthorization 注释与
// loop-design-principles「破坏性动作永远在 loop 之外」）。
//
//   pnpm harness pr-queue                 # 全部 open PR 的状态
//   pnpm harness pr-queue --pr 451        # 单个 PR
//   pnpm harness pr-queue --json          # 机器可解析
//   pnpm harness pr-queue --pr 451 --attended   # 顺带回答"人类在场时能不能合"
//   pnpm harness pr-queue --post-merge 451      # 合并后收尾核验
//
// 退出码：有任何 PR 处于 MERGE_BLOCKED，或 --post-merge 有缺口 → 非 0（CI/loop 可消费）。
import type { Args } from "./lib/args";
import { req } from "./lib/args";
import { log, die } from "./lib/log";
import { sh } from "./lib/sh";
import {
  classifyPr,
  mergeAuthorization,
  parseClosesIssues,
  parseRefsIssues,
  postMergeGaps,
  resolveCoordMode,
  type FormalReview,
  type PostMergeFacts,
  type PrClassification,
  type PrFacts,
  type RequiredCheck,
} from "./lib/pr-queue";

/** gh pr view/list 的 JSON 形状（只声明用得上的字段）。 */
interface GhPr {
  number: number;
  author?: { login?: string } | null;
  isDraft: boolean;
  body?: string | null;
  headRefOid?: string | null;
  mergeStateStatus?: string | null;
  labels?: Array<{ name: string }> | null;
  statusCheckRollup?: Array<{ name?: string; context?: string; status?: string; conclusion?: string | null; state?: string | null }> | null;
  reviews?: Array<{ author?: { login?: string } | null; state?: string; commit?: { oid?: string } | null }> | null;
}

const PR_FIELDS = "number,author,isDraft,body,headRefOid,mergeStateStatus,labels,statusCheckRollup,reviews";

function ghJson<T>(cmd: string): T {
  const r = sh(cmd);
  if (r.code !== 0) die(`gh 命令失败（${r.code}）：${cmd}\n${r.stderr.trim()}`);
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return die(`gh 输出不是合法 JSON：${cmd}`);
  }
}

/** statusCheckRollup 混着 CheckRun 与 StatusContext 两种形状，统一成 RequiredCheck。 */
function toRequiredChecks(rollup: GhPr["statusCheckRollup"]): RequiredCheck[] {
  if (!rollup) return [];
  return rollup.map((c) => ({
    name: c.name ?? c.context ?? "(unnamed)",
    // CheckRun 有 status/conclusion；StatusContext 只有 state（SUCCESS/PENDING/FAILURE…）
    status: c.status ?? (c.state ? "COMPLETED" : "UNKNOWN"),
    conclusion: c.conclusion ?? c.state ?? null,
  }));
}

function toFormalReviews(reviews: GhPr["reviews"]): FormalReview[] {
  if (!reviews) return [];
  return reviews.map((r) => ({
    author: r.author?.login ?? "(unknown)",
    state: r.state ?? "COMMENTED",
    commit: r.commit?.oid ?? "",
  }));
}

function toFacts(pr: GhPr): PrFacts {
  return {
    number: pr.number,
    author: pr.author?.login ?? "(unknown)",
    isDraft: pr.isDraft,
    headSha: pr.headRefOid ?? "",
    closesIssues: parseClosesIssues(pr.body ?? ""),
    refsIssues: parseRefsIssues(pr.body ?? ""),
    // 拿不到合并状态按 UNKNOWN 处理（fail-closed），不按"大概能合"
    mergeStateStatus: pr.mergeStateStatus ?? "UNKNOWN",
    checks: toRequiredChecks(pr.statusCheckRollup),
    verdictLabels: (pr.labels ?? []).map((l) => l.name).filter((n) => n.startsWith("review:")),
    formalReviews: toFormalReviews(pr.reviews),
  };
}

function render(results: Array<{ facts: PrFacts; result: PrClassification }>, args: Args): void {
  const mode = resolveCoordMode(args.flags);
  if (args.flags["json"] === true) {
    console.log(
      JSON.stringify(
        {
          mode,
          prs: results.map(({ facts, result }) => ({
            ...result,
            head_sha: facts.headSha,
            author: facts.author,
            closes: facts.closesIssues,
            merge_authorization: mergeAuthorization(result.state, mode),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  for (const { facts, result } of results) {
    log.step(`PR #${result.number} → ${result.state}（head ${facts.headSha.slice(0, 12)}，作者 ${facts.author}）`);
    for (const reason of result.reasons) log.info(`   · ${reason}`);
    for (const advisory of result.advisories) log.info(`   · ${advisory}`);
    const auth = mergeAuthorization(result.state, mode);
    log.info(`   合并授权：${auth.allowed ? "允许" : "拒绝"} — ${auth.reason}`);
    if (auth.allowed) log.info(`   人类执行：gh pr merge ${result.number} --squash --delete-branch`);
  }
  const blockedCount = results.filter((r) => r.result.state === "MERGE_BLOCKED").length;
  const readyCount = results.filter((r) => r.result.state === "READY_TO_MERGE").length;
  log.info(`\n共 ${results.length} 个 open PR：READY_TO_MERGE ${readyCount}，MERGE_BLOCKED ${blockedCount}（模式 ${mode}）`);
}

function runPostMerge(args: Args): void {
  const num = Number(req(args, "post-merge"));
  // gh 没有 `merged` 字段（只有 state/mergedAt）——用 state 判定，别猜字段名
  const pr = ghJson<{ number: number; state: string; mergeCommit?: { oid?: string } | null; body?: string | null }>(
    `gh pr view ${num} --json number,state,mergeCommit,body`,
  );
  const mergeCommit = pr.mergeCommit?.oid ?? null;
  // API 说 merged 不等于 commit 真的在 main——用 git 实测（铁律 4：证据实测）
  const onMain = mergeCommit
    ? sh(`git merge-base --is-ancestor ${mergeCommit} origin/main`).code === 0
    : false;
  const closes = parseClosesIssues(pr.body ?? "");
  const issueClosed: Record<number, boolean> = {};
  for (const issue of closes) {
    const got = ghJson<{ state: string }>(`gh issue view ${issue} --json state`);
    issueClosed[issue] = got.state === "CLOSED";
  }
  // CD 是否进入监控无法从 PR 元数据推断——查不到就是 null（fail-closed 成"未确认"）
  const facts: PostMergeFacts = {
    number: num,
    merged: pr.state === "MERGED",
    mergeCommit,
    mergeCommitOnMain: onMain,
    closesIssues: closes,
    issueClosed,
    deploymentTracked: args.flags["deployment-tracked"] === true ? true : null,
  };
  const gaps = postMergeGaps(facts);
  if (args.flags["json"] === true) {
    console.log(JSON.stringify({ ...facts, gaps }, null, 2));
  } else if (gaps.length === 0) {
    log.ok(`PR #${num} 合并后收尾干净：merged + commit 在 main + 关联 issue 已关闭 + CD 已进入监控`);
  } else {
    log.err(`PR #${num} 合并后收尾有 ${gaps.length} 处缺口：`);
    for (const gap of gaps) log.info(`   · ${gap}`);
  }
  if (gaps.length > 0) process.exitCode = 1;
}

export function prQueue(args: Args): void {
  if (args.opts["post-merge"] !== undefined) {
    runPostMerge(args);
    return;
  }
  const single = args.opts["pr"];
  const prs = single
    ? [ghJson<GhPr>(`gh pr view ${Number(single)} --json ${PR_FIELDS}`)]
    : ghJson<GhPr[]>(`gh pr list --state open --limit 100 --json ${PR_FIELDS}`);

  const results = prs.map((pr) => {
    const facts = toFacts(pr);
    return { facts, result: classifyPr(facts) };
  });
  render(results, args);
  if (results.some((r) => r.result.state === "MERGE_BLOCKED")) process.exitCode = 1;
}
