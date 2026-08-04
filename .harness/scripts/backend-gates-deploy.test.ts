// backend-gates-deploy.test.ts — #482：每个 PR 都部署到 devops 之后，`deploy` job 的
// `if:` 表达式变成了**唯一**挡住 fork PR 的东西（self-hosted runner + sudo 部署：
// 接受 fork 等于任何人提个 PR 就能在那台机器上以 root 跑代码）。
//
// 「断言 yml 文本里含某个子串」是本仓栽过很多次的空转门控——改个写法就绕过去了。
// 所以这里**把表达式真的求值**：从 workflow 里抠出 `if:`，喂三份合成事件负载
// （同仓 PR / fork PR / push main），断言 fork 那份求值为 false。
// 求值器只覆盖本表达式用到的子集（`||` `&&` `==` 括号 字符串字面量 `github.*` 路径），
// 覆盖不到的写法一律抛错而不是当成 true——不认识就不放行。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";

const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "backend-gates.yml");
const raw = readFileSync(WORKFLOW_PATH, "utf8");
const workflow = parse(raw) as {
  on: Record<string, unknown>;
  jobs: Record<string, { if?: string; concurrency?: { group?: string; "cancel-in-progress"?: boolean }; steps?: Array<{ run?: string }> }>;
};

type Ctx = Record<string, unknown>;

function readPath(ctx: Ctx, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, ctx);
}

/** GitHub 表达式子集求值器。不认识的 token 抛错——静默当真是这类门控失效的常见方式。 */
function evaluate(expression: string, ctx: Ctx): boolean {
  const tokens = expression.match(/\(|\)|\|\||&&|==|'[^']*'|[A-Za-z_][\w.]*/g);
  if (!tokens) throw new Error(`无法解析表达式：${expression}`);
  let pos = 0;
  const peek = (): string | undefined => tokens[pos];

  const primary = (): unknown => {
    const token = tokens[pos++];
    if (token === undefined) throw new Error("表达式意外结束");
    if (token === "(") {
      const value = orExpr();
      if (tokens[pos++] !== ")") throw new Error("括号不匹配");
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1);
    if (/^[A-Za-z_][\w.]*$/.test(token)) return readPath(ctx, token);
    throw new Error(`不认识的 token：${token}`);
  };
  const eqExpr = (): unknown => {
    let left = primary();
    while (peek() === "==") {
      pos++;
      left = left === primary();
    }
    return left;
  };
  const andExpr = (): unknown => {
    let left = eqExpr();
    while (peek() === "&&") {
      pos++;
      const right = eqExpr();
      left = left ? right : left;
    }
    return left;
  };
  const orExpr = (): unknown => {
    let left = eqExpr2();
    while (peek() === "||") {
      pos++;
      const right = eqExpr2();
      left = left ? left : right;
    }
    return left;
  };
  const eqExpr2 = (): unknown => andExpr();

  const result = orExpr();
  if (pos !== tokens.length) throw new Error(`表达式有未消费的 token：${tokens.slice(pos).join(" ")}`);
  return Boolean(result);
}

const REPO = "boardx/workspacex";
const samePrEvent: Ctx = {
  github: { event_name: "pull_request", ref: "refs/pull/9/merge", repository: REPO, event: { pull_request: { head: { repo: { full_name: REPO } } } } },
};
const forkPrEvent: Ctx = {
  github: { event_name: "pull_request", ref: "refs/pull/9/merge", repository: REPO, event: { pull_request: { head: { repo: { full_name: "attacker/workspacex" } } } } },
};
const pushMainEvent: Ctx = {
  github: { event_name: "push", ref: "refs/heads/main", repository: REPO, event: {} },
};
const pushBranchEvent: Ctx = {
  github: { event_name: "push", ref: "refs/heads/worker/whatever", repository: REPO, event: {} },
};
const tagEvent: Ctx = {
  github: { event_name: "push", ref: "refs/tags/v1.2.3", repository: REPO, event: {} },
};

describe("#482 backend-gates 每个 PR 部署到 devops", () => {
  const deploy = workflow.jobs["deploy"]!;

  it("PR 触发已开启，tag 触发入口已删除", () => {
    expect(Object.keys(workflow.on)).toContain("pull_request");
    // push 下不得再有 tags——同一件事两条触发路径，其中一条没人再用
    expect((workflow.on["push"] as Record<string, unknown>)["tags"]).toBeUndefined();
  });

  it("求值 deploy 的 if：同仓 PR 与 push main 部署，fork PR 一律不部署", () => {
    const condition = deploy.if!;
    expect(evaluate(condition, samePrEvent), "同仓 PR 应当部署").toBe(true);
    expect(evaluate(condition, pushMainEvent), "push main 应当部署").toBe(true);
    expect(evaluate(condition, forkPrEvent), "fork PR 绝不能部署到自建 runner").toBe(false);
    expect(evaluate(condition, pushBranchEvent), "非 main 分支的 push 不部署").toBe(false);
    expect(evaluate(condition, tagEvent), "tag 不再是部署入口").toBe(false);
  });

  it("求值器本身不是摆设：认得出被削弱的条件", () => {
    // 反证：去掉同仓判断 → fork PR 会被放行。这条保证上面那些 expect 不是空转。
    const weakened = "github.event_name == 'pull_request'";
    expect(evaluate(weakened, forkPrEvent)).toBe(true);
    // 反证：不认识的写法必须抛错，不能静默当真
    expect(() => evaluate("github.event_name != 'push'", pushMainEvent)).toThrow();
  });

  it("部署独占一条全局泳道，且排队不取消", () => {
    // devops 是一台机器，deploy.sh 会 git reset --hard：两个 PR 同时部署会撕裂；
    // 取消进行到一半的部署，机器会停在半部署状态。
    expect(deploy.concurrency?.group).toBe("backend-gates-deploy-devops");
    expect(deploy.concurrency?.group).not.toContain("github.ref"); // 按 ref 分组＝不同 PR 仍并发
    expect(deploy.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("部署的是被门控过的那个 commit，不是会漂移的分支名", () => {
    const run = (deploy.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(run).toContain("github.event.pull_request.head.sha");
    expect(run).not.toContain("github.ref_name");
    // 仍走 /usr/local/bin 的副本（sudoers 只许这一条路径），不是仓库里那份
    expect(run).toContain(".harness/scripts/vm/deploy-gate.sh");
  });
});
