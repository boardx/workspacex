// github-issues.ts — 「一次拉全仓 issue 清单」的单一实现（doctor 与 sync 共用，#2483）。
//
// 背景：doctor 在 2026-08-05 把 `gh issue list --limit 300` 改成「请求远高于现实规模的上限 +
// 断言没触顶，触顶就拒绝做否定性判断」（#1382 同族，见 doctor-issue-truncation.test.ts）。
// sync-github.ts 的 `allIssues` 当时没有一起改，一直停在 `--limit 500`——而 `gh issue list`
// 按编号从新到旧返回，仓库过了 #2400 之后，phase-00/01 早期 feature 的投影 issue 已经在
// 窗口之外。sync 在残缺清单上做的判断比 doctor 更危险：doctor 最多误报「没有 issue」，
// sync 会**真的再创建一个**（标题搜索对中文长标题匹配不上，2026-07-29 已因此建出 #30/#31）。
//
// 同一件事两处各写一套、其中一处忘了修，正是 AGENTS.md 点名的漂移形态；收敛到这里。
//
// 不变量：**清单可能不完整时，宁可不判，也不要拿它做否定性判断**（「没有对应 issue」→
// 创建 / 报断裂）。所以返回值是三态而不是「数组或空数组」——空数组会被调用方当成
// 「确实没有」，那正是要防的误读。
import { sh as defaultSh, type ShResult } from "./sh";

export interface GhIssueRow {
  number: number;
  title: string;
  body: string;
  /** gh 给的是大写：OPEN / CLOSED */
  state: string;
  /** COMPLETED / NOT_PLANNED / REOPENED；老版本 gh 可能不带 */
  stateReason?: string | null;
  /** ISO 时刻；未关闭为 null。完成定义第 7 条（#2540）只判生效时刻之后关闭的 issue */
  closedAt?: string | null;
  labels?: { name: string }[];
}

/** 远高于现实规模的上限；返回条数触到它 ⇒ 无法排除被截断。 */
export const ISSUE_PAGE_LIMIT = 5000;

export type IssueListResult =
  | { kind: "ok"; issues: GhIssueRow[] }
  /** gh 没装 / 没登录 / 离线 / 输出不是 JSON */
  | { kind: "unavailable"; reason: string }
  /** 返回条数 ≥ 上限，清单可能残缺 */
  | { kind: "truncated"; count: number; limit: number };

export interface ListAllIssuesOptions {
  /** owner/name；不传则用当前目录的仓库（gh 自己解析） */
  repo?: string;
  cwd?: string;
  /** 可注入，供单测喂假 gh 输出 */
  exec?: (cmd: string, cwd?: string) => ShResult;
  limit?: number;
}

export function listAllIssues(opts: ListAllIssuesOptions = {}): IssueListResult {
  const exec = opts.exec ?? defaultSh;
  const limit = opts.limit ?? ISSUE_PAGE_LIMIT;
  const repoArg = opts.repo ? ` --repo ${JSON.stringify(opts.repo)}` : "";
  const r = exec(
    `gh issue list${repoArg} --state all --limit ${limit} --json number,title,body,state,stateReason,closedAt,labels`,
    opts.cwd,
  );
  if (r.code !== 0) {
    return { kind: "unavailable", reason: `gh issue list 退出码 ${r.code}：${(r.stderr || r.stdout).trim().slice(0, 200)}` };
  }
  let rows: unknown;
  try {
    rows = JSON.parse(r.stdout || "[]");
  } catch (e) {
    return { kind: "unavailable", reason: `gh issue list 输出不是 JSON：${(e as Error).message}` };
  }
  if (!Array.isArray(rows)) return { kind: "unavailable", reason: "gh issue list 输出不是数组" };
  if (rows.length >= limit) return { kind: "truncated", count: rows.length, limit };
  return { kind: "ok", issues: rows as GhIssueRow[] };
}

/** 给人看的一句话：为什么这份清单不能拿来做否定性判断。 */
export function describeIssueListFailure(r: Exclude<IssueListResult, { kind: "ok" }>): string {
  return r.kind === "truncated"
    ? `issue 清单可能被截断（返回 ${r.count} 条，上限 ${r.limit}）`
    : `读不到 GitHub issue（${r.reason}）`;
}
