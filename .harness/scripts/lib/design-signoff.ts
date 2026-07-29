// design-signoff —— 签核链的可执行形式（ADR-020 → ADR-023）。
//
// ADR-003 定了「UI 未确认不得进入代码开发」。ADR-020 把签核对象从「UI 一件」
// 扩成「契约束四件套」，并写明 `new-sprint` 的拒绝条件相应扩展：
//   **一个 feature 可以开工，当且仅当：它所属的契约束已签 ∧ 阶段一致性复核已通过。**
//
// ADR-023 在此之上补了三件，全部因为「规范在、脚本没有」而失效过：
//   ③ 束↔feature 的映射从 coverage.md 的**散文**移到 design-signoff.md 的
//      frontmatter `covers: [F01, …]`。散文当权威的后果是双向的：
//      把那行改成「本束覆盖 Artifact 全部 5 个」→ 匹配 0 个编号，该束下全部
//      feature 变成「不属于任何束」；正文里随手写个 F99 → 被吃进映射。
//   ④ `design-coherence.md` 必须用 `covers_bundles: [...]` 声明它复核了哪些束，
//      门控要求「声明的束集合 ⊇ 本阶段全部束」。此前它只是一个布尔——
//      phase-00 那份只看过 4 个束，却给 6 个束的 feature 一起放了行。
//   ⑤ 签核时间戳必须是 ISO 8601 且不得晚于当下（现存一处 `2026-07-30`）。
//
// ⚠ 这个文件是上面那几句话的可执行形式。在它存在之前它们是**只写没做**的——
//   本项目的纪律是「没有脚本的规范条目视为未落地」，那就包括我自己写的 ADR。
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { findPhaseDir, REPO_ROOT } from "./paths";
import { phaseHasUi } from "./ui-signoff";

export type SignoffStatus = "pending" | "confirmed" | "missing";

/* ── frontmatter 解析 ────────────────────────────────────────────────────
 * 这些文件是人手写的，格式必然带毛边：值可能加引号、行尾常挂 `# 注释`、
 * 列表可能写成 `[A, B]` 也可能写成多行 `- A`。解析器要能吃下这些，
 * 但**不能**去猜语义——猜错的代价是门控静默放行。
 * ────────────────────────────────────────────────────────────────────── */

export type FrontmatterValue = string | string[];

/** 只解析首个 `---` 块。文件不存在或没有 frontmatter → null（与「空 frontmatter」区分开） */
export function parseFrontmatter(path: string): Record<string, FrontmatterValue> | null {
  if (!existsSync(path)) return null;
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8"))?.[1];
  if (block === undefined) return null;

  const out: Record<string, FrontmatterValue> = {};
  let lastKey: string | null = null;
  for (const raw of block.split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && lastKey) {
      // 块状列表：`covers:` 下面挂 `- F01`
      const prev = out[lastKey];
      const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
      list.push(scalar(item[1]!));
      out[lastKey] = list;
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = kv[1]!;
    const rest = kv[2]!;
    lastKey = key;
    if (rest.trim() === "") {
      out[key] = []; // 等下面的块状列表来填；填不上就是空列表 = 声明了但没内容
      continue;
    }
    const inline = /^\[(.*)\]/.exec(rest.trim());
    out[key] = inline
      ? inline[1]!.split(",").map(scalar).filter((s) => s !== "")
      : scalar(rest);
  }
  return out;
}

/** 去行尾注释 → 去引号 → trim。⚠ 引号内的 `#` 不算注释 */
function scalar(raw: string): string {
  const s = raw.trim();
  const quoted = /^(["'])([\s\S]*?)\1/.exec(s);
  if (quoted) return quoted[2]!.trim();
  // ⚠ 整行只有注释 ⇒ 空值。`confirmed_by:            # 确认人（姓名/邮箱）` 这种模板占位
  //   此前会被解析成字符串 `"# 确认人（姓名/邮箱）"`——**非空**，于是
  //   「status 是 confirmed 但没有 confirmed_by ⇒ 签核必须记名」那条检查
  //   会被一个注释骗过去。下面那行 `\s+#` 要求 `#` 前有空白，而这里的 s 已 trim，
  //   `#` 落在行首就匹配不上。2026-07-30 phase-01 建九个束时抓到（九份模板全长这样）。
  if (s.startsWith("#")) return "";
  return s.replace(/\s+#.*$/, "").trim();
}

function fmString(fm: Record<string, FrontmatterValue> | null, key: string): string {
  const v = fm?.[key];
  return typeof v === "string" ? v : "";
}

/** 原样取值（不 trim），用来检出 `confirmed_by: " yanbin shen"` 这类前导空格 */
function fmRawString(path: string, key: string): string | null {
  if (!existsSync(path)) return null;
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
  const m = new RegExp(`^${key}\\s*:\\s*(.*)$`, "m").exec(block);
  if (!m) return null;
  const s = m[1]!.trim();
  const quoted = /^(["'])([\s\S]*?)\1/.exec(s);
  return quoted ? quoted[2]! : s.replace(/\s+#.*$/, "");
}

function fmList(fm: Record<string, FrontmatterValue> | null, key: string): string[] | null {
  const v = fm?.[key];
  if (v === undefined) return null; // 没声明 ≠ 声明了空集
  return Array.isArray(v) ? v : [v];
}

function statusOf(fm: Record<string, FrontmatterValue> | null): SignoffStatus {
  if (fm === null) return "missing";
  return fmString(fm, "status") === "confirmed" ? "confirmed" : "pending";
}

/* ── 时间戳（ADR-023 决策五）────────────────────────────────────────── */

/** ISO 8601：`YYYY-MM-DD` 或 `YYYY-MM-DDThh:mm:ss[.sss][Z|±hh:mm]` */
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export interface TimestampCheck {
  ok: boolean;
  reason?: string;
}

/**
 * 签核时间戳必须是 ISO 8601，且不得晚于当下。
 *
 * ⚠ 为什么「未来时间戳」是要挡的：签核是**已经发生的人的动作**。
 *   一个晚于当下的时刻要么是手滑，要么是有人在为将来的放行预埋——
 *   两种都让「这个设计被人看过了」这句话不成立。
 *   现存实例：auth 束签在 `2026-07-30`，而它覆盖的 F19/F20/F21 已经 passing。
 */
export function checkTimestamp(value: string | undefined, now: Date = new Date()): TimestampCheck {
  const v = (value ?? "").trim();
  if (!v) return { ok: false, reason: "缺 confirmed_at" };
  if (!ISO_RE.test(v)) {
    return {
      ok: false,
      reason: `confirmed_at "${v}" 不是 ISO 8601（要 2026-07-29 或 2026-07-29T07:35:09+08:00 这种；` +
        `"2026-7-28" 这类少补零的写法不算，机器排不了序）`,
    };
  }
  // ⚠ 形状对不等于日期存在：V8 对 "2026-02-30" 不返回 NaN，而是**悄悄滚到 3 月 2 日**。
  //   只查 isNaN 会让一个不存在的日子通过，于是「签核发生在哪天」这句话是假的。
  //   故对日期部分做一次回环校验。
  const [yy, mm, dd] = v.slice(0, 10).split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(yy, mm - 1, dd));
  if (probe.getUTCFullYear() !== yy || probe.getUTCMonth() !== mm - 1 || probe.getUTCDate() !== dd) {
    return { ok: false, reason: `confirmed_at "${v}" 不是一个真实存在的日期` };
  }
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return { ok: false, reason: `confirmed_at "${v}" 不是一个真实存在的时刻` };
  if (t > now.getTime()) {
    return {
      ok: false,
      reason: `confirmed_at "${v}" 晚于当前时刻（${now.toISOString()}）——签核是已经发生的动作，不能签在未来`,
    };
  }
  return { ok: true };
}

/* ── 读取 ───────────────────────────────────────────────────────────── */

export interface BundleSignoff {
  bundle: string;
  /** 相对仓库根的 design-signoff.md 路径，报错里直接给人贴 */
  signoffPath: string;
  dir: string;
  status: SignoffStatus;
  /** 该束覆盖的 feature id —— 权威来源是 frontmatter 的 `covers:`（ADR-023 决策三） */
  features: string[];
  /** `covers:` 是否被声明过。未声明 ≠ 覆盖 0 个，前者是格式缺陷 */
  coversDeclared: boolean;
  confirmedBy: string;
  confirmedByRaw: string | null;
  confirmedAt: string;
  /** 束目录里缺的必备支撑材料（ADR-023 决策二：降级为支撑材料，但仍强制存在） */
  missingFiles: string[];
}

/** has_ui 阶段的束必须有 `ui.md`（ADR-023 决策一 ①）；非 UI 阶段不要求 */
export function requiredBundleFiles(phaseId: string): string[] {
  const base = ["domain.md", "usecases.md", "coverage.md", "design-signoff.md"];
  return phaseHasUi(phaseId) ? [...base, "ui.md"] : base;
}

/** 读某阶段全部契约束的签核状态。没有 contracts/ 目录 → 空数组（该阶段还没做契约设计） */
export function readBundleSignoffs(phaseId: string): BundleSignoff[] {
  const contractsDir = join(findPhaseDir(phaseId), "contracts");
  if (!existsSync(contractsDir)) return [];
  const required = requiredBundleFiles(phaseId);
  return readdirSync(contractsDir)
    .filter((n) => statSync(join(contractsDir, n)).isDirectory())
    .sort()
    .map((bundle) => {
      const dir = join(contractsDir, bundle);
      const signoffPath = join(dir, "design-signoff.md");
      const fm = parseFrontmatter(signoffPath);
      const covers = fmList(fm, "covers");
      return {
        bundle,
        dir,
        signoffPath: relative(REPO_ROOT, signoffPath),
        status: statusOf(fm),
        features: (covers ?? []).map((s) => s.trim()).filter(Boolean),
        coversDeclared: covers !== null,
        confirmedBy: fmString(fm, "confirmed_by"),
        confirmedByRaw: fmRawString(signoffPath, "confirmed_by"),
        confirmedAt: fmString(fm, "confirmed_at"),
        missingFiles: required.filter((f) => !existsSync(join(dir, f))),
      };
    });
}

export interface Coherence {
  path: string;
  status: SignoffStatus;
  /** 这次一致性复核声明它看过哪些束（ADR-023 决策四） */
  coversBundles: string[];
  coversBundlesDeclared: boolean;
  confirmedBy: string;
  confirmedByRaw: string | null;
  confirmedAt: string;
}

export function readCoherence(phaseId: string): Coherence {
  const path = join(findPhaseDir(phaseId), "design-coherence.md");
  const fm = parseFrontmatter(path);
  const covers = fmList(fm, "covers_bundles");
  return {
    path: relative(REPO_ROOT, path),
    status: statusOf(fm),
    coversBundles: (covers ?? []).map((s) => s.trim()).filter(Boolean),
    coversBundlesDeclared: covers !== null,
    confirmedBy: fmString(fm, "confirmed_by"),
    confirmedByRaw: fmRawString(path, "confirmed_by"),
    confirmedAt: fmString(fm, "confirmed_at"),
  };
}

/** 兼容旧调用点：只要状态 */
export function readCoherenceStatus(phaseId: string): SignoffStatus {
  return readCoherence(phaseId).status;
}

/* ── 审计（new-sprint / claim / doctor 共用同一份判定）──────────────── */

export interface SignoffAudit {
  fails: string[];
  warns: string[];
  /** 该阶段是否采用契约束流程（没有 contracts/ 目录 → false，全部检查跳过） */
  applicable: boolean;
}

/**
 * 签核链体检。**这是 new-sprint / claim / doctor 唯一的判定实现**——
 * 三个入口读同一份结论，否则「同一事实声明在多处」会第 N+1 次发生。
 *
 * @param featureIds 本次要放行的 feature；传 `[]` 表示只做结构性检查（不查归属）。
 *
 * ⚠ 不做契约设计的阶段（没有 contracts/ 目录）**直接放行**——
 *   ADR-020 是 2026-07-28 引入的，此前的阶段不该被追溯拦住。
 *   一旦某阶段建了 contracts/，就说明它选择了这套流程，门控随之生效。
 */
export function auditSignoff(
  phaseId: string,
  featureIds: string[],
  now: Date = new Date(),
): SignoffAudit {
  const bundles = readBundleSignoffs(phaseId);
  if (bundles.length === 0) return { fails: [], warns: [], applicable: false };

  const fails: string[] = [];
  const warns: string[] = [];

  /* ① 每个束的结构性完整性 */
  const seen = new Map<string, string>(); // feature id → 已声明它的束
  for (const b of bundles) {
    if (b.status === "missing") {
      fails.push(`契约束「${b.bundle}」没有 design-signoff.md —— 束目录存在就说明它进了这套流程`);
    }
    if (b.missingFiles.length) {
      fails.push(
        `契约束「${b.bundle}」缺必备材料：${b.missingFiles.join(" ")}` +
          `（ADR-023 决策二：domain/coverage 降级为支撑材料但不得删除；ui.md 只对 has_ui 阶段要求）`,
      );
    }
    if (!b.coversDeclared) {
      fails.push(
        `契约束「${b.bundle}」的 design-signoff.md frontmatter 缺 \`covers: [F01, F02, …]\` —— ` +
          `束↔feature 的映射权威在这里，不在 coverage.md 正文（ADR-023 决策三）。文件：${b.signoffPath}`,
      );
    } else if (b.features.length === 0) {
      fails.push(`契约束「${b.bundle}」声明了 \`covers:\` 但为空 —— 一个不覆盖任何 feature 的束不成立`);
    }
    for (const fid of b.features) {
      const owner = seen.get(fid);
      if (owner) {
        fails.push(
          `${fid} 同时被「${owner}」和「${b.bundle}」的 covers 声明 —— 束之间必须无重叠，` +
            `否则「它所属的束签了没有」没有唯一答案`,
        );
      } else {
        seen.set(fid, b.bundle);
      }
    }
    if (b.status === "confirmed") {
      const t = checkTimestamp(b.confirmedAt, now);
      if (!t.ok) fails.push(`契约束「${b.bundle}」的签核时间戳不合法：${t.reason}（${b.signoffPath}）`);
      if (!b.confirmedBy) {
        fails.push(`契约束「${b.bundle}」status 是 confirmed 但没有 confirmed_by —— 签核必须记名`);
      } else if (b.confirmedByRaw !== null && b.confirmedByRaw !== b.confirmedByRaw.trim()) {
        warns.push(
          `契约束「${b.bundle}」的 confirmed_by "${b.confirmedByRaw}" 带首尾空格 —— ` +
            `签名会被当成另一个人，去掉空格（${b.signoffPath}）`,
        );
      }
    }
  }

  /* ② 要放行的 feature 必须属于某个已签的束 */
  for (const fid of featureIds) {
    const owner = bundles.find((b) => b.features.includes(fid));
    if (!owner) {
      fails.push(
        `${fid} 不属于任何契约束 —— 无法确认它的设计被评审过。` +
          `请把它写进某个束 design-signoff.md 的 frontmatter \`covers:\`（ADR-023 决策三）`,
      );
      continue;
    }
    if (owner.status !== "confirmed") {
      fails.push(
        `${fid} 所属的契约束「${owner.bundle}」尚未签核（status: ${owner.status}）→ ${owner.signoffPath}`,
      );
    }
  }

  /* ③ 阶段一致性复核：必须已过 **且声明的范围覆盖全部束**（ADR-023 决策四） */
  const co = readCoherence(phaseId);
  if (co.status !== "confirmed") {
    fails.push(
      `阶段一致性复核尚未通过（status: ${co.status}）→ ${co.path}\n` +
        `    它查的是**跨束的**交叉约束——单束都签了不代表它们之间不打架。`,
    );
  } else {
    const t = checkTimestamp(co.confirmedAt, now);
    if (!t.ok) fails.push(`阶段一致性复核的时间戳不合法：${t.reason}（${co.path}）`);
    if (co.confirmedByRaw !== null && co.confirmedByRaw !== co.confirmedByRaw.trim()) {
      warns.push(`阶段一致性复核的 confirmed_by "${co.confirmedByRaw}" 带首尾空格 —— 去掉（${co.path}）`);
    }
  }

  if (!co.coversBundlesDeclared) {
    fails.push(
      `${co.path} 的 frontmatter 缺 \`covers_bundles: [...]\` —— ` +
        `一致性复核必须声明它复核了哪些束（ADR-023 决策四）。\n` +
        `    磁盘上现有的束：${bundles.map((b) => b.bundle).join(" ")}`,
    );
  } else {
    const declared = new Set(co.coversBundles);
    const uncovered = bundles.map((b) => b.bundle).filter((b) => !declared.has(b));
    const ghost = co.coversBundles.filter((b) => !bundles.some((x) => x.bundle === b));
    if (uncovered.length) {
      fails.push(
        `一致性复核没覆盖这些束：${uncovered.join(" ")} —— ` +
          `它们的 feature 靠一份**从没看过它们**的复核解锁了开工（ADR-023 背景 1）。\n` +
          `    修法：人类重做 ${co.path} 的交叉约束复核，把这些束纳入范围表，` +
          `再把 covers_bundles 补成 [${bundles.map((b) => b.bundle).join(", ")}]。\n` +
          `    ⚠ **不要只改 covers_bundles**：那是把「没复核」谎报成「复核过」，` +
          `比现在这条红更糟。`,
      );
    }
    if (ghost.length) {
      warns.push(
        `一致性复核声明覆盖了不存在的束：${ghost.join(" ")}（${co.path}）—— 束被改名或删了？`,
      );
    }
  }

  return { fails, warns, applicable: true };
}

/**
 * 开工门控（ADR-020 + ADR-023）。要开的 feature 里只要有一个所属束未签、
 * 或阶段一致性复核未过/未覆盖到它、或签核本身不合法，就拒绝。
 *
 * new-sprint 与 claim 共用它——ADR-023 决策六：真正的开工动作是 claim，
 * 而在此之前 claim 根本不问签核，`new-sprint` 那道门可以被绕过去。
 */
export function assertDesignSignedOff(phaseId: string, featureIds: string[]): void {
  const { fails, applicable } = auditSignoff(phaseId, featureIds);
  if (!applicable || fails.length === 0) return;

  throw new Error(
    `设计签核未完成，拒绝开工（ADR-020 / ADR-023）：\n${fails.map((f) => `  · ${f}`).join("\n")}\n\n` +
      `⚠ 签核是**人的动作**：由人类把 design-signoff.md / design-coherence.md 的 status 改为 confirmed，\n` +
      `  填 confirmed_by / confirmed_at。agent 不得代劳，也不得为了让门控变绿而改这些字段。\n` +
      `  为什么设这道门：后端契约会在画界面时被顺手创造出来却无人评审——\n` +
      `  mock 是手写的，它对自己永远自洽，界面跑得通不等于契约成立。`,
  );
}
