/**
 * 从 `.github/workflows/*.yml` 里抽出**每个 job 的命令**，并回答一个问题：
 *
 *     这个 job 是「每次 push/PR 都跑」，还是「只在某些条件下才跑」？
 *
 * ## 它要挡的失效（#523）
 *
 * `lint-spec-gate-coverage.mjs`（#512 / PR #515）把 devportal 的 6 条 spec 判为
 * `covered`，唯一来源是 `deploy-devportal.yml` 的 `pnpm --filter @repo/devportal run e2e`。
 * 而那个 workflow 带 **`paths: apps/devportal/**` 触发过滤** —— 共享包
 * （`packages/contracts` 等）的改动打红 devportal 的 spec 时，它**根本不会被触发**。
 *
 * 这比 #512 更隐蔽：#512 是「写了但没人跑」（门控会红），#523 是「写了、名义上有人跑、
 * 但那个人只在某些改动下才来」——门控**报绿**。
 *
 * ## 判据：拿两个「必经事件」去探
 *
 * 一个 job 算**无条件**（真覆盖）⟺ 它在下面两个探针事件里**至少有一个**会跑：
 *
 *   · `pull_request`（base=main，任意路径）—— 每个 PR 必经
 *   · `push` 到 `refs/heads/main`（任意路径）—— 每次合入必经
 *
 * 这正是 issue #523 那张表的口径：`harness-verify`/`backend-gates` 每次 push/PR 都跑
 * ⇒ 真覆盖；`deploy-devportal`（`paths:` 过滤）、只有 `workflow_dispatch` 的取证
 * workflow、只有 `schedule` 的定时 job ⇒ 条件覆盖。
 *
 * 三道闸依次判，任何一道拦下就不是「本探针可达」：
 *   ① workflow 的 `on:` 是否接纳该事件（`paths`/`paths-ignore` 过滤 ⇒ 不接纳；
 *      `branches` 不含 main ⇒ 不接纳）；
 *   ② job 的 `needs` 是否全部可达（父被跳过，子就不会跑）；
 *   ③ job / step 的 `if:` 在该事件下是否成立。
 *
 * ## 失败方向必须偏「吵」
 *
 * 表达式解析不出来、函数不认识、上下文取不到 ⇒ 一律 **UNKNOWN**，而 UNKNOWN
 * **不算可达** ⇒ 该 job 被判为条件覆盖 ⇒ 门控吵。反过来（猜成无条件）就是
 * 本文件要挡的那种哑火，一次都不能有。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** 求值结果里的「不知道」。它不是 false —— 它只是不能被当成 true 用。 */
export const UNKNOWN = Symbol("unknown");

/**
 * 两个必经事件。改这里等于改「什么叫无条件覆盖」，改之前先想清楚：
 * 一条 spec 只在这两个事件之外才跑，它就挡不住「共享包改动打红它」那类回归。
 */
export const PROBE_EVENTS = [
  {
    id: "pull_request",
    eventName: "pull_request",
    ref: "refs/pull/1/merge",
    baseBranch: "main",
    label: "每个 PR",
  },
  {
    id: "push-main",
    eventName: "push",
    ref: "refs/heads/main",
    baseBranch: "main",
    label: "每次合入 main",
  },
];

const DEFAULT_BRANCH = "main";

// ---------------------------------------------------------------------------
// GitHub 表达式：一个够用的子集求值器
// ---------------------------------------------------------------------------

/**
 * 词法：标识符里允许 `-`（`needs.gates-fast.result` 是真实写法），字符串是单引号、
 * 内部 `''` 转义（GitHub 的写法）。
 */
function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'") {
      let value = "";
      i += 1;
      while (i < source.length) {
        if (source[i] === "'") {
          if (source[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += source[i];
        i += 1;
      }
      tokens.push({ type: "string", value });
      continue;
    }
    const two = source.slice(i, i + 2);
    if (["==", "!=", "&&", "||", "<=", ">="].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("()!,<>".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    const rest = source.slice(i);
    const number = /^\d+(\.\d+)?/.exec(rest);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.*-]*/.exec(rest);
    if (word) {
      tokens.push({ type: "word", value: word[0] });
      i += word[0].length;
      continue;
    }
    // 认不出的字符：整条表达式作废（见文件头「失败方向必须偏吵」）。
    throw new Error(`无法解析的字符 ${JSON.stringify(ch)}`);
  }
  return tokens;
}

/** `''`/0/null/false ⇒ 假；UNKNOWN 不参与（调用方先判）。 */
function truthy(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value !== "";
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

/** GitHub 的宽松相等只需覆盖到「null 与 false 同真值」这一档。 */
function looseEqual(a, b) {
  const normalize = (v) => (v === null || v === undefined ? false : v);
  return normalize(a) === normalize(b);
}

/**
 * 已知函数。其余（`startsWith`、`contains`、`fromJSON`……）一律 UNKNOWN：
 * 猜它们的值就是在猜「这个 job 会不会跑」，而猜错的方向恰好是哑火。
 *
 * `always()` / `success()` 取 true、`cancelled()` / `failure()` 取 false：
 * 我们探的是**顺利那一趟**——问的是「这个 job 在正常流程里会不会被执行」。
 */
const FUNCTIONS = {
  always: () => true,
  success: () => true,
  cancelled: () => false,
  failure: () => false,
};

function parseExpression(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (value) => {
    if (peek() && peek().type === "op" && peek().value === value) {
      pos += 1;
      return true;
    }
    return false;
  };

  function parsePrimary() {
    const token = peek();
    if (!token) throw new Error("表达式提前结束");
    if (eat("(")) {
      const inner = parseOr();
      if (!eat(")")) throw new Error("括号未闭合");
      return inner;
    }
    if (eat("!")) {
      const operand = parsePrimary();
      return { kind: "not", operand };
    }
    if (token.type === "string" || token.type === "number") {
      pos += 1;
      return { kind: "literal", value: token.value };
    }
    if (token.type === "word") {
      pos += 1;
      if (peek() && peek().type === "op" && peek().value === "(") {
        pos += 1;
        const args = [];
        if (!eat(")")) {
          for (;;) {
            args.push(parseOr());
            if (eat(")")) break;
            if (!eat(",")) throw new Error("函数参数表未闭合");
          }
        }
        return { kind: "call", name: token.value, args };
      }
      if (token.value === "true") return { kind: "literal", value: true };
      if (token.value === "false") return { kind: "literal", value: false };
      if (token.value === "null") return { kind: "literal", value: null };
      return { kind: "path", path: token.value };
    }
    throw new Error(`无法解析的 token ${JSON.stringify(token.value)}`);
  }

  function parseComparison() {
    const left = parsePrimary();
    const token = peek();
    if (token && token.type === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(token.value)) {
      pos += 1;
      const right = parsePrimary();
      return { kind: "compare", op: token.value, left, right };
    }
    return left;
  }

  function parseAnd() {
    let node = parseComparison();
    while (eat("&&")) node = { kind: "and", left: node, right: parseComparison() };
    return node;
  }

  function parseOr() {
    let node = parseAnd();
    while (eat("||")) node = { kind: "or", left: node, right: parseAnd() };
    return node;
  }

  const ast = parseOr();
  if (pos !== tokens.length) throw new Error("表达式有尾巴没吃掉");
  return ast;
}

function evaluateNode(node, context) {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "path":
      return context.lookup(node.path);
    case "call": {
      const fn = FUNCTIONS[node.name];
      return fn ? fn() : UNKNOWN;
    }
    case "not": {
      const value = evaluateNode(node.operand, context);
      return value === UNKNOWN ? UNKNOWN : !truthy(value);
    }
    case "compare": {
      const left = evaluateNode(node.left, context);
      const right = evaluateNode(node.right, context);
      if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
      if (node.op === "==") return looseEqual(left, right);
      if (node.op === "!=") return !looseEqual(left, right);
      if (typeof left !== "number" || typeof right !== "number") return UNKNOWN;
      if (node.op === "<") return left < right;
      if (node.op === "<=") return left <= right;
      if (node.op === ">") return left > right;
      return left >= right;
    }
    case "and": {
      const left = evaluateNode(node.left, context);
      if (left !== UNKNOWN && !truthy(left)) return false;
      const right = evaluateNode(node.right, context);
      if (right !== UNKNOWN && !truthy(right)) return false;
      if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
      return true;
    }
    case "or": {
      const left = evaluateNode(node.left, context);
      if (left !== UNKNOWN && truthy(left)) return true;
      const right = evaluateNode(node.right, context);
      if (right !== UNKNOWN && truthy(right)) return true;
      if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
      return false;
    }
    default:
      return UNKNOWN;
  }
}

/** 探针事件下的上下文。取不到的路径一律 UNKNOWN —— 别替 GitHub 编值。 */
function probeContext(probe, { needsResults }) {
  const REPO = "boardx/workspacex";
  const table = new Map([
    ["github.event_name", probe.eventName],
    ["github.ref", probe.ref],
    ["github.ref_name", probe.ref.replace(/^refs\/heads\//, "")],
    ["github.repository", REPO],
    // 探针只探**同仓** PR：fork PR 上被跳过的 job（本仓多处的 fork 守卫）不该因此
    // 被判成条件覆盖——同仓 PR 才是「每个 PR 必经」那条线。
    ["github.event.pull_request.head.repo.full_name", REPO],
    ["github.event.pull_request.base.ref", probe.baseBranch],
    // 非 schedule / 非 workflow_dispatch 事件下，这两个上下文就是空的。
    ["github.event.schedule", null],
    ["github.event.workflow_run.conclusion", null],
    ["github.event.workflow_run.head_branch", null],
  ]);
  return {
    lookup(pathExpr) {
      if (table.has(pathExpr)) return table.get(pathExpr);
      // `inputs.x` / `github.event.inputs.x`：只有 workflow_dispatch / workflow_call
      // 才有值，两个探针事件下都是空。
      if (/^(github\.event\.)?inputs\./.test(pathExpr)) return null;
      const needs = /^needs\.([A-Za-z0-9_-]+)\.result$/.exec(pathExpr);
      // 顺利那一趟：可达的父 job 记 success，不可达的父 job 记 skipped。
      if (needs) return needsResults.get(needs[1]) ?? UNKNOWN;
      return UNKNOWN;
    },
  };
}

/**
 * 在某个探针事件下求 `if:` 的值。
 * 返回 true / false / UNKNOWN —— **UNKNOWN 由调用方当作「不可达」**。
 */
export function evaluateIf(expression, probe, { needsResults = new Map() } = {}) {
  if (expression === undefined || expression === null) return true;
  const source = String(expression).trim();
  if (source === "") return true;
  // `${{ ... }}` 包裹是合法写法，剥掉外壳后仍是同一条表达式。
  const unwrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(source);
  const body = unwrapped ? unwrapped[1] : source;
  try {
    return evaluateNode(parseExpression(tokenize(body)), probeContext(probe, { needsResults }));
  } catch {
    return UNKNOWN;
  }
}

// ---------------------------------------------------------------------------
// workflow 的 `on:`：这个事件进不进得来
// ---------------------------------------------------------------------------

function asTriggerMap(on) {
  if (on === null || on === undefined) return {};
  if (typeof on === "string") return { [on]: {} };
  if (Array.isArray(on)) return Object.fromEntries(on.map((name) => [name, {}]));
  return on;
}

function branchesAdmit(branches, branch) {
  if (branches === undefined || branches === null) return true;
  const list = Array.isArray(branches) ? branches : [branches];
  return list.some((pattern) => {
    if (pattern === branch) return true;
    if (pattern === "*" || pattern === "**") return true;
    // 只认前缀通配（`main*` / `release/**`）；更花的 glob 认不了就当不接纳（偏吵）。
    const star = pattern.indexOf("*");
    return star > 0 && branch.startsWith(pattern.slice(0, star));
  });
}

/**
 * workflow 级：`on:` 在该探针事件下是否**无条件**接纳。
 *
 * ⚠ `paths` / `paths-ignore` 一出现就判不接纳 —— 这正是 #523 的病根：
 * 「只在某些路径改动时才触发」= 共享包改动打红它时，它不来。
 */
export function triggerAdmits(on, probe) {
  const triggers = asTriggerMap(on);
  const filter = triggers[probe.eventName];
  if (filter === undefined) return { admits: false, why: `on: 没有 ${probe.eventName}` };
  const spec = filter ?? {};
  if (typeof spec !== "object" || Array.isArray(spec)) {
    return { admits: true, why: "" };
  }
  if (spec.paths || spec["paths-ignore"]) {
    const list = spec.paths ?? spec["paths-ignore"];
    const shown = (Array.isArray(list) ? list : [list]).slice(0, 3).join(", ");
    return {
      admits: false,
      why: `on.${probe.eventName} 带路径过滤（${shown}${Array.isArray(list) && list.length > 3 ? ", …" : ""}）`,
    };
  }
  // `push` 看被推的分支，`pull_request` 看 PR 的 base 分支——两者都归到 main 这条线上。
  const branch = probe.eventName === "push" ? DEFAULT_BRANCH : probe.baseBranch;
  if (!branchesAdmit(spec.branches, branch)) {
    return { admits: false, why: `on.${probe.eventName}.branches 不含 ${branch}` };
  }
  if (spec["branches-ignore"] && branchesAdmit(spec["branches-ignore"], branch)) {
    return { admits: false, why: `on.${probe.eventName}.branches-ignore 排除了 ${branch}` };
  }
  return { admits: true, why: "" };
}

// ---------------------------------------------------------------------------
// 合起来：每个 job 的命令 + 它到底是不是无条件
// ---------------------------------------------------------------------------

/**
 * 某个 job 在给定探针事件下会执行的 `run:` 文本。
 *
 * ⚠ step 级的 UNKNOWN 与 job 级**方向相反**，这不是笔误：
 *   · job 级问的是「这个 job 算不算无条件覆盖」——判不出来就当条件覆盖（吵）；
 *   · step 级只是**降噪**，判不出来就**保留**这条命令。
 * 反过来会把真覆盖判丢：本仓几乎每个 e2e job 的正文步骤都挂着
 * `if: steps.dedup.outputs.run == 'true'`（`ci-lane-dedup.mjs` 的同 SHA 去重），
 * 那是运行期 step output，静态判不出来——按「判不出就丢」会把 chat-read /
 * self-service-profile / trace-geometry 三条整条 lane 从覆盖里抹掉，
 * 逼出一堆根本不该存在的豁免。
 *
 * 所以这里只丢**能证明为假**的 step（`if: failure()`、
 * `if: github.event_name == 'schedule'` 之类）。
 */
function stepCommands(job, probe) {
  const commands = [];
  for (const step of job.steps ?? []) {
    if (!step || typeof step.run !== "string") continue;
    if (evaluateIf(step.if, probe) === false) continue;
    commands.push(step.run);
  }
  return commands;
}

/**
 * 判一个 workflow 里每个 job 在某探针事件下是否可达。
 * `needs` 按拓扑推：父不可达 ⇒ 子记 skipped ⇒ 子的 `needs.X.result == 'success'` 为假。
 */
function reachableJobs(workflow, probe) {
  const jobs = Object.entries(workflow.jobs ?? {});
  const verdicts = new Map();
  const needsResults = new Map();
  const admitted = triggerAdmits(workflow.on ?? workflow.true, probe);

  // 简单不动点：`needs` 是 DAG，最多 N 轮就稳定。
  for (let round = 0; round < jobs.length + 1; round += 1) {
    let changed = false;
    for (const [name, job] of jobs) {
      if (verdicts.has(name)) continue;
      const needs = job?.needs ? (Array.isArray(job.needs) ? job.needs : [job.needs]) : [];
      if (needs.some((parent) => !verdicts.has(parent))) continue;
      let reachable = admitted.admits;
      let why = admitted.why;
      if (reachable && needs.some((parent) => verdicts.get(parent).reachable === false)) {
        reachable = false;
        why = `needs 的父 job 在该事件下不跑（${needs.join(", ")}）`;
      }
      if (reachable) {
        const value = evaluateIf(job?.if, probe, { needsResults });
        if (value !== true) {
          reachable = false;
          why = value === UNKNOWN ? `job if: 判不出来（保守当作不跑）` : `job if: 在该事件下为假`;
        }
      }
      verdicts.set(name, { reachable, why });
      needsResults.set(name, reachable ? "success" : "skipped");
      changed = true;
    }
    if (!changed) break;
  }
  // 环（GitHub 本身不允许）或漏判的 job：当作不可达，偏吵那一边。
  for (const [name] of jobs) {
    if (!verdicts.has(name)) verdicts.set(name, { reachable: false, why: "needs 成环，判不出来" });
  }
  return { verdicts, admitted };
}

/** 读 `.github/workflows/*.yml`；解析失败就抛——静默跳过一个 workflow = 静默丢覆盖。 */
export function readWorkflows(root = REPO_ROOT) {
  const dir = path.join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => {
      const raw = readFileSync(path.join(dir, file), "utf8");
      let document;
      try {
        document = parseYaml(raw);
      } catch (error) {
        throw new Error(`${file} 解析失败：${error.message}`);
      }
      return { file, document: document ?? {} };
    });
}

/**
 * 全仓 CI 的命令清单，每条都带上「它所在的 job 是不是无条件跑」。
 *
 * 返回 `[{ label, workflow, job, unconditional, why, commands }]`，
 * `commands` 是该 job 里、在探针事件下没有被 `if:` 证伪的 `run:` 文本
 * （见 `stepCommands` 里 step 级与 job 级方向相反的那段注释）。
 */
export function ciJobCommands(root = REPO_ROOT) {
  const out = [];
  for (const { file, document } of readWorkflows(root)) {
    const perProbe = PROBE_EVENTS.map((probe) => ({ probe, ...reachableJobs(document, probe) }));
    for (const [job, definition] of Object.entries(document.jobs ?? {})) {
      const hits = perProbe.filter(({ verdicts }) => verdicts.get(job)?.reachable);
      const unconditional = hits.length > 0;
      const why = unconditional
        ? hits.map(({ probe }) => probe.label).join(" / ")
        : perProbe
            .map(({ probe, verdicts }) => `${probe.id}: ${verdicts.get(job)?.why ?? "不可达"}`)
            .join("；");
      const probe = hits[0]?.probe ?? PROBE_EVENTS[0];
      const commands = stepCommands(definition ?? {}, probe);
      if (commands.length === 0) continue;
      out.push({ label: `${file}#${job}`, workflow: file, job, unconditional, why, commands });
    }
  }
  return out;
}
