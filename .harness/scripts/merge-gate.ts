// merge-gate.ts — CLI：`pnpm harness merge-gate --pr <N>`（#956 机械合并门禁）。
//
// 只做三件事：用 gh 取当前 HEAD SHA 上的客观事实 → 交给 lib/merge-gate.ts 的纯
// 函数判定 → 打印，失败退出非零。**不合并、不改 label、不评论**——判定失败只是
// "这个 CI job 报红"，接成 required status check 之后能挡住"状态转绿"，但挡不住
// 管理员 bypass（GitHub 的 required check 默认对 repo admin 不生效，需要
// branch protection 里勾 "Include administrators"）——那一步必须人类在
// GitHub 仓库 Settings 手动做，见 PR 描述。
//
//   pnpm harness merge-gate --pr 956          # 判定单个 PR
//   pnpm harness merge-gate --pr 956 --json   # 机器可解析
//
// 退出码：不满足任一前置条件 → 非 0（供 CI 消费，作为 required status check）。
import type { Args } from "./lib/args";
import { req } from "./lib/args";
import { log, die } from "./lib/log";
import { sh } from "./lib/sh";
import { evaluateMergeGate, type FormalReview, type MergeGateFacts } from "./lib/merge-gate";

/** gh pr view 的 JSON 形状（只声明用得上的字段）。 */
interface GhPr {
  number: number;
  author?: { login?: string } | null;
  body?: string | null;
  headRefOid?: string | null;
  labels?: Array<{ name: string }> | null;
  reviews?: Array<{ author?: { login?: string } | null; state?: string; commit?: { oid?: string } | null }> | null;
}

const PR_FIELDS = "number,author,body,headRefOid,labels,reviews";

function ghJson<T>(cmd: string): T {
  const r = sh(cmd);
  if (r.code !== 0) die(`gh 命令失败（${r.code}）：${cmd}\n${r.stderr.trim()}`);
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return die(`gh 输出不是合法 JSON：${cmd}`);
  }
}

function toFacts(pr: GhPr): MergeGateFacts {
  const reviews: FormalReview[] = (pr.reviews ?? []).map((r) => ({
    author: r.author?.login ?? "(unknown)",
    state: r.state ?? "COMMENTED",
    commit: r.commit?.oid ?? "",
  }));
  return {
    number: pr.number,
    author: pr.author?.login ?? "(unknown)",
    headSha: pr.headRefOid ?? "",
    body: pr.body ?? "",
    labels: (pr.labels ?? []).map((l) => l.name),
    reviews,
  };
}

export function mergeGate(args: Args): void {
  const num = Number(req(args, "pr"));
  const pr = ghJson<GhPr>(`gh pr view ${num} --json ${PR_FIELDS}`);
  const facts = toFacts(pr);
  const result = evaluateMergeGate(facts);

  if (args.flags["json"] === true) {
    console.log(JSON.stringify({ number: facts.number, head_sha: facts.headSha, ...result }, null, 2));
  } else {
    if (result.passed) {
      log.ok(`PR #${num}（head ${facts.headSha.slice(0, 12)}）满足机械合并门禁：唯一 verdict label + Closes 关联`);
    } else {
      log.err(`PR #${num}（head ${facts.headSha.slice(0, 12)}）不满足机械合并门禁：`);
      for (const reason of result.reasons) log.info(`   · ${reason}`);
      log.warn(
        "本 job 只能挡住 CI 状态与自动化流程——它不能阻止 repo admin 在 GitHub 网页端直接点合并（bypass）。" +
          "把它变成真正拦人的门，需要人类在 Settings → Branches 把这个 check 加进 required status checks 并勾选 Include administrators。",
      );
    }
    if (result.advisories.length > 0) {
      log.warn("以下检查已暂停（不影响本次判定，仅记录，见 lib/merge-gate.ts 头部 2026-08-16 说明）：");
      for (const advisory of result.advisories) log.info(`   · ${advisory}`);
    }
  }
  if (!result.passed) process.exitCode = 1;
}
