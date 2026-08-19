// gate-mutation-spec.ts —— 门禁变异反证的**登记表**（纯数据 + 纯函数，可单测）。
//
// 背景（issue #1573，方案见 .harness/state/harness-slim-backlog.md）：
// 本仓已九次出现「门全绿但什么都没在测」。2026-08-18 一天内四次实证：
//   · merge-gate 的 native APPROVE 检查——实测 100 个已合并 PR，0 个命中
//   · review:*-ok 标签检查——实测 300 个 PR，0 个命中
//   · verify-risk 高风险标记——实测 304 个 feature，4/7 标记零命中
//   · H3A 治理机器——7,872 行守着 0 task / 0 review / 2 event / 1 domain
// 共同的失效方式不是「规则写错了」，而是「规则在判一个不存在的信号」，
// 而这件事**读代码看不出来**——代码越诚实具体，读起来越像它真的在守着什么。
//
// 本模块把「这道门真能抓东西吗」变成机械可判定的：对每道门登记若干
// **变异**（往仓库里注入一个该门本应拦住的缺陷），断言注入后该门必须非 0 退出。
//
// 分层刻意如此：
//   lib/gate-mutation-spec.ts  登记表 + 纯判定（本文件，可单测，不碰 IO）
//   gate-mutation-probe.ts     执行器：建临时 worktree → 施加变异 → 跑门 → 收结果
// 变异**永远只在临时 detached worktree 里发生**，执行器不在工作树上写一个字节。

/** 一条变异：往干净树里注入一个缺陷。 */
export interface Mutation {
  /** 人类可读的变异名，出现在报告里。 */
  name: string;
  /**
   * 在 worktree 根目录下施加变异。返回 false 表示"这次没改动任何东西"——
   * 执行器据此判 INEFFECTIVE 而不是判"门漏过了"。这个区分是本模块最关键的
   * 一处设计：2026-08-18 手工跑变异时，有 5 条 sed 表达式因为不匹配而静默
   * 没生效，如果不区分，会得出"门漏过"的错误结论，正好是本文件要防的那类错误。
   */
  apply: (root: string, io: MutationIo) => boolean;
}

/** 变异需要的最小 IO 面，注入进来以便单测用假的。 */
export interface MutationIo {
  read: (rel: string) => string;
  write: (rel: string, content: string) => void;
  exists: (rel: string) => boolean;
  /** 让文件被 git 追踪（部分门就是在查"投影是否被追踪"）。 */
  gitAdd: (rel: string) => void;
  /** 删文件（"引用集 == 实存集"类的门就是在查这个）。 */
  remove: (rel: string) => void;
}

/** 一道门 + 它的全部变异。 */
export interface GateSpec {
  /** 门名，出现在报告里。 */
  gate: string;
  /** 跑这道门的 argv（相对仓库根，交给 tsx/node 执行）。 */
  run: readonly string[];
  /**
   * 这道门守的数据是否存在。不存在时执行器判 NO_DATA 并跳过——
   * 「守着空数据」本身就是 #1567 要量化的结论，不该伪装成"通过"。
   */
  guards: (root: string, io: MutationIo) => boolean;
  mutations: readonly Mutation[];
}

export type Verdict =
  | "CAUGHT" // 变异生效且门红了——这道门在这条上是活的
  | "MISSED" // 变异生效但门仍绿——发现
  | "INEFFECTIVE" // 变异没改动任何东西——探针自身的问题，不是门的问题
  | "NO_DATA"; // 这道门守的数据不存在——门守着空气

export interface MutationOutcome {
  gate: string;
  mutation: string;
  verdict: Verdict;
  exitCode: number | null;
}

export interface ProbeReport {
  /** 干净树上跑，每道门都必须 exit 0；这里记录不满足的。 */
  baselineFailures: { gate: string; exitCode: number }[];
  outcomes: MutationOutcome[];
}

/**
 * 探针整体是否通过。刻意**不**把 NO_DATA 判失败——「门守着空数据」是要被
 * 报出来供人决策的事实（#1567 H-01 就靠它），不是要当场拦住 CI 的错误。
 * MISSED 与 INEFFECTIVE 都判失败：前者是门漏了，后者是探针坏了，
 * 两种都会让"变异反证"这层保护静默失效——正是本文件存在的理由。
 */
export function probePassed(r: ProbeReport): boolean {
  if (r.baselineFailures.length > 0) return false;
  return !r.outcomes.some((o) => o.verdict === "MISSED" || o.verdict === "INEFFECTIVE");
}

export function summarize(r: ProbeReport): Record<Verdict, number> {
  const out: Record<Verdict, number> = { CAUGHT: 0, MISSED: 0, INEFFECTIVE: 0, NO_DATA: 0 };
  for (const o of r.outcomes) out[o.verdict]++;
  return out;
}

// ─────────────────────────── 变异原语 ───────────────────────────
// 每个原语都返回 false（而不是抛错）当它没能改动任何东西——见 Mutation.apply 注释。

/** 把 YAML 顶层某字段的值清空（`key: value` → `key:`）。 */
export function blankField(rel: string, key: string): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    const before = io.read(rel);
    const after = before.replace(new RegExp(`^${key}:.*$`, "m"), `${key}:`);
    if (after === before) return false;
    io.write(rel, after);
    return true;
  };
}

/** 把 YAML 顶层某字段的值换成给定值。 */
export function setField(rel: string, key: string, value: string): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    const before = io.read(rel);
    const after = before.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
    if (after === before) return false;
    io.write(rel, after);
    return true;
  };
}

/** 删掉 YAML 顶层某个字段行。 */
export function dropField(rel: string, key: string): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    const before = io.read(rel);
    const after = before
      .split("\n")
      .filter((l) => !new RegExp(`^${key}:`).test(l))
      .join("\n");
    if (after === before) return false;
    io.write(rel, after);
    return true;
  };
}

/** 删掉缩进 YAML 里第一次出现的某个字段行（用于 list-of-mappings）。 */
export function dropFirstIndentedField(rel: string, key: string): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    const lines = io.read(rel).split("\n");
    const i = lines.findIndex((l) => new RegExp(`^\\s+${key}:`).test(l));
    if (i < 0) return false;
    lines.splice(i, 1);
    io.write(rel, lines.join("\n"));
    return true;
  };
}

/**
 * 复制某个 `- <idKey>: X` 条目并把它的 id 改成另一个已存在的 id，制造重复。
 * 用于所有"唯一性"类检查。
 */
export function duplicateEntryId(
  rel: string,
  idKey: string,
  fromId: string,
  collideWith: string,
): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    const lines = io.read(rel).split("\n");
    const start = lines.findIndex((l) => l.trim().startsWith(`- ${idKey}: ${fromId}`));
    if (start < 0) return false;
    const indent = lines[start]!.match(/^\s*/)![0];
    let end = start + 1;
    while (end < lines.length && !lines[end]!.trim().startsWith(`- ${idKey}:`) && !(lines[end]!.trim() !== "" && !lines[end]!.startsWith(indent + " "))) end++;
    const block = lines.slice(start, end).slice();
    block[0] = block[0]!.replace(`${idKey}: ${fromId}`, `${idKey}: ${collideWith}`);
    if (block.length === 0) return false;
    io.write(rel, [...lines.slice(0, end), ...block, ...lines.slice(end)].join("\n"));
    return true;
  };
}

/** 往文件末尾追加一行（用于"引用了不存在的路径"这类检查）。 */
export function appendLine(rel: string, line: string): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    io.write(rel, io.read(rel) + "\n" + line + "\n");
    return true;
  };
}

/** 删掉一个文件（用于"引用集 == 实存集"「死链」类检查）。 */
export function removeFile(rel: string): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    io.remove(rel);
    return true;
  };
}

/** 把文件里第一处出现的字面量替换掉（用于改配置/导航项/契约声明）。 */
export function replaceOnce(rel: string, from: string, to: string): Mutation["apply"] {
  return (_root, io) => {
    if (!io.exists(rel)) return false;
    const before = io.read(rel);
    if (!before.includes(from)) return false;
    io.write(rel, before.replace(from, to));
    return true;
  };
}

/** 新建一个文件并强制加进 git 索引（用于"投影路径不得被追踪"这类检查）。 */
export function trackNewFile(rel: string, content: string): Mutation["apply"] {
  return (_root, io) => {
    io.write(rel, content);
    io.gitAdd(rel);
    return true;
  };
}

// ─────────────────────────── 登记表 ───────────────────────────
// 这批变异全部在 2026-08-18 手工实测过（见 #1573 正文的表格），本表是把它们固化。
// 新增门禁时**必须**在这里补登记：一道没有变异反证的门，等于没有证据说它在工作。

const UI_SHOT = "phases/phase-01-run-a-project/ui-preview/chat-v2/uc-8-3-landing-default.png";
const NAV = "apps/web/lib/navigation.ts";
const REWRITE_ALLOWLIST = ".harness/state/rewrite-coverage-allowlist.json";
const CONTRACT_TS = "packages/contracts/src/skills.ts";
const FL_01 = "phases/phase-01-run-a-project/feature_list.json";

const cli = (...rest: string[]) => ["tsx", ".harness/scripts/cli.ts", ...rest] as const;
const node = (script: string) => ["node", script] as const;
const tsx = (script: string) => ["tsx", script] as const;

export const GATE_SPECS: readonly GateSpec[] = [
  {
    gate: "graph-authority",
    run: cli("graph-authority", "doctor"),
    guards: () => true, // 它守的是"路径不得被追踪"，空目录本身就是被守的状态
    mutations: [
      {
        name: "把投影文件 git add -f 进索引",
        apply: trackNewFile(".harness/templates/instances/PROBE-BOGUS.yaml", "x: 1\n"),
      },
    ],
  },
  // ── 以下是 H-01（删 H3A）之后**存活**的门 ──────────────────────────────
  // H-00 初版只登记了 workflow-event / terminology / domains / graph-authority，
  // 而这四道里有三道正是 H-01 要删的——那样的基线保护不了删除动作，因为它证明的
  // 恰好是即将消失的东西。真正需要网的是删完之后还在跑的门，补登记如下。
  {
    gate: "ui-material",
    run: node(".harness/scripts/lint-ui-material.mjs"),
    guards: (_r, io) => io.exists(UI_SHOT),
    mutations: [
      { name: "删掉一张 ui.md 引用的截图（造死链）", apply: removeFile(UI_SHOT) },
    ],
  },
  {
    gate: "nav-reachability",
    run: node(".harness/scripts/lint-nav-reachability.mjs"),
    guards: (_r, io) => io.exists(NAV),
    mutations: [
      {
        name: "把导航项 href 改成不存在的屏",
        apply: replaceOnce(NAV, 'href: "/chat"', 'href: "/no-such-screen-zzz"'),
      },
    ],
  },
  {
    gate: "rewrite-coverage",
    run: tsx(".harness/scripts/lint-rewrite-coverage.mjs"),
    guards: (_r, io) => io.exists(REWRITE_ALLOWLIST),
    mutations: [
      {
        name: "往棘轮 allowlist 里加一条不该有的豁免",
        // 棘轮「只能变短」：加一条今天并不缺的前缀，必须当场红。
        apply: replaceOnce(REWRITE_ALLOWLIST, '"downloads",', '"downloads",\n    "probe-bogus-prefix",'),
      },
    ],
  },
  {
    gate: "third-artifact",
    run: node(".harness/scripts/lint-third-artifact.mjs"),
    guards: (_r, io) => io.exists(CONTRACT_TS),
    mutations: [
      { name: "删掉某束的第 ③ 件契约文件", apply: removeFile(CONTRACT_TS) },
    ],
  },
  {
    gate: "verification-can-fail",
    // 全仓最有价值的一道门：它对每种 verification 形态**真跑一遍"指向物不存在"
    // 的变体**，确认会非 0 退出——即"这条 verification 有可能失败吗"。
    // 单次约 22s（9 个动态探针），是本探针最慢的一条，但正因为它守的是
    // "验证本身会不会空转"，删掉它等于把整个证据链的地基抽掉，必须有网。
    run: node(".harness/scripts/lint-verification-can-fail.mjs"),
    guards: (_r, io) => io.exists(FL_01),
    mutations: [
      {
        name: "把一条 verification 改成未登记形态",
        apply: replaceOnce(
          FL_01,
          "pnpm --filter api exec vitest run tests/auth/device-session-30d.test.ts",
          "echo probe-bogus-verification",
        ),
      },
    ],
  },
  {
    gate: "skills",
    run: cli("skills", "doctor"),
    guards: (_r, io) => io.exists(".agents/skills/mod-chat/SKILL.md"),
    mutations: [
      {
        name: "SKILL.md 引用不存在的路径",
        // 必须带反引号：skill-doctor-model 只提取反引号包住的路径候选。
        // 2026-08-18 手工首次变异忘了反引号，得到"漏过"的假结论——这正是
        // INEFFECTIVE 与 MISSED 必须区分开的实例。
        apply: appendLine(".agents/skills/mod-chat/SKILL.md", "参见 `.harness/probe-does-not-exist.md`"),
      },
    ],
  },
];
