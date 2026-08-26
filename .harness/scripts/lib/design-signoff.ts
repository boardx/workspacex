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
import { phaseHasUi } from "./roadmap";
import { hasRequirementsCoverage } from "./spec-ref";

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
  /**
   * 「已签核，但 feature 尚未生成」的**显式理由**（frontmatter `covers_pending:`）。
   *
   * 空字符串 = 没声明。见 `covers: []` 那条判定里的长注释——它是把这种状态从
   * 「一个空壳束冒充签核」里分出来的**唯一**依据，所以必须是人写的一句理由，
   * 不是一个 `true`。
   */
  coversPending: string;
  confirmedBy: string;
  confirmedByRaw: string | null;
  confirmedAt: string;
  /** 束目录里缺的必备支撑材料（ADR-023 决策二：降级为支撑材料，但仍强制存在） */
  missingFiles: string[];
}

/**
 * has_ui 阶段的束必须有 `ui.md`（ADR-023 决策一 ①）；非 UI 阶段不要求。
 * 2026-07-30 起 `ui.md` 是 UI 签核的**唯一**材料位置——phase 级 `ui-signoff.md` 已停用。
 */
export function requiredBundleFiles(phaseId: string): string[] {
  const base = ["domain.md", "usecases.md", "coverage.md", "design-signoff.md"];
  return phaseHasUi(phaseId) ? [...base, "ui.md"] : base;
}

/* ── 正文自称不可签核（ADR-023 背景 2 的直接后果，2026-07-31 补）──────────
 *
 * `assertDesignSignedOff` 此前只读 frontmatter 的 `status`，正文写什么都不看。
 * 后果：三份文件（`project` / `asset-governance` / `research`）的正文逐字写着
 * 「🔴 本束现在不可签核。请不要把 `status` 改成 `confirmed`」，而它们的 `status`
 * 恰恰都是 `confirmed`——每一道机械门都是绿的，只有人读正文才发现矛盾。
 *
 * 这条检查不判断阻塞是否已经解除（那需要理解语义，机械做不到），只做一件事：
 * **status: confirmed 的束，如果正文含自称不可签核的短语，就必须同时含一句明确的
 * 重新确认**（本仓的写法是「签核继续有效」，签核时若阻塞已解除、人类照这个格式
 * 补一个更正块）。没有那句重新确认 ⇒ FAIL，把自称的那一行原样贴出来。
 *
 * ⚠ 不判断「阻塞是否真的解除了」——那仍然是人的判断，机械只保证「矛盾不会被沉默略过」。
 */
const SELF_DECLARED_BLOCKED_RE = /不可签核|不具备签核条件|请不要把 `status` 改成/;
const REAFFIRMED_RE = /签核继续有效/;

/** 读 design-signoff.md 正文（frontmatter 之后的部分）。文件不存在 → 空字符串 */
function readSignoffBody(path: string): string {
  if (!existsSync(path)) return "";
  const raw = readFileSync(path, "utf8");
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  return m ? m[1]! : raw;
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
        coversPending: fmString(fm, "covers_pending"),
        confirmedBy: fmString(fm, "confirmed_by"),
        confirmedByRaw: fmRawString(signoffPath, "confirmed_by"),
        confirmedAt: fmString(fm, "confirmed_at"),
        missingFiles: required.filter((f) => !existsSync(join(dir, f))),
      };
    });
}

/** design-delta 的签核投影（PROP-HARNESS-SIGNOFF-002，2026-08-12 人类 Accept） */
export interface DeltaSignoff {
  delta: string;
  signoffPath: string;
  status: SignoffStatus;
  /** delta 挂靠的既有束——必须真实存在且已 confirmed，否则「新建 delta 目录 +
   *  自己写 confirmed」就是一条绕过全流程的路（门不依赖「没人会作弊」）。 */
  baseBundle: string;
  features: string[];
}

/** 读某阶段全部 design-delta 的签核状态。没有 design-deltas/ → 空数组 */
export function readDeltaSignoffs(phaseId: string): DeltaSignoff[] {
  const deltasDir = join(findPhaseDir(phaseId), "design-deltas");
  if (!existsSync(deltasDir)) return [];
  return readdirSync(deltasDir)
    .filter((n) => statSync(join(deltasDir, n)).isDirectory())
    .sort()
    .map((delta) => {
      const signoffPath = join(deltasDir, delta, "design-signoff.md");
      const fm = parseFrontmatter(signoffPath);
      return {
        delta,
        signoffPath: relative(REPO_ROOT, signoffPath),
        status: statusOf(fm),
        baseBundle: fmString(fm, "base_bundle"),
        features: (fmList(fm, "covers") ?? []).map((s) => s.trim()).filter(Boolean),
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
  /**
   * 该阶段是否受签核门约束。
   * 没有契约束 **且** 非 has_ui 阶段 → false，全部检查跳过；
   * has_ui 阶段即便零契约束也是 true（此时 fails 里就一条：它无法被签核）。
   */
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
 *
 * ⚠⚠ **但 `has_ui: true` 的阶段没有这个逃生口**（2026-07-30，ADR-023 决策一落地）。
 *   在此之前，有界面的阶段被两道门挡着：phase 级 `ui-signoff.md`（ADR-003）
 *   和这道束级门。ADR-023 决策一把两道收敛成一道之后，phase-02/03 那种
 *   「标了 has_ui、还没建 contracts/」的阶段会从「有门」直接变成「无门」——
 *   实测过：撤门之前 `claim --phase 02 --feature F01` 就已经一路放行了
 *   （`claim` 从来只问束级门，不问 phase 级 UI 门）。
 *   所以收敛的同时必须把这个口堵上：has_ui ∧ 零契约束 ⇒ **失败**，不是放行。
 *
 * @param mode `"gate"`（默认，new-sprint / claim / verify-uc-coverage）
 *   与 `"audit"`（doctor）。**唯一的区别只有一处**，见 `UNSTARTED_PHASE_IS_WARN` 注释。
 */
export function auditSignoff(
  phaseId: string,
  featureIds: string[],
  now: Date = new Date(),
  mode: "gate" | "audit" = "gate",
): SignoffAudit {
  const bundles = readBundleSignoffs(phaseId);
  if (bundles.length === 0) {
    if (!phaseHasUi(phaseId)) return { fails: [], warns: [], applicable: false };
    const msg =
      `Phase ${phaseId} 在 roadmap.yaml 里标了 \`has_ui: true\`，却没有任何契约束` +
      `（phases/phase-${phaseId}-*/contracts/<束>/）——按 ADR-023 决策一，UI 签核是束级` +
      `\`design-signoff.md\` 的第 ① 件，**没有束就没有地方签，这个阶段无法被签核**。\n` +
      `    ⚠ 这条红是 2026-07-30 补的：在此之前有界面的阶段靠 phase 级 UI 签核关卡（ADR-003，已停用）挡着，` +
      `ADR-023 把两道门收敛成一道，若不同时堵这里，该阶段会从「有门」变成「无门」。\n` +
      `    修法二选一：⑴ 按能力域切契约束，建 contracts/<束>/{ui,domain,usecases,coverage,design-signoff}.md，` +
      `人类逐束签核；⑵ 该阶段确实没有界面 → 把 roadmap.yaml 里的 has_ui 撤掉。\n` +
      `    **不要为了消红而建一个空壳束**——空 covers 的束会在下一条红里被抓住。`;

    /* ── UNSTARTED_PHASE_IS_WARN（2026-07-31）────────────────────────────
     *
     * doctor 是**审计链**体检：它问「已经做出来的东西，证据链断没断」。
     * 一个**一条 feature 都还没开工**的阶段没有审计链可断——
     * 它欠的是「开工资格」，而那由 `claim` / `new-sprint` 各自独立地挡着
     * （两者用的就是本函数的 `"gate"` 模式）。
     *
     * 为什么必须区分：CI 的 `pnpm harness doctor`（无 --phase）体检**全部**阶段。
     * phase-02/03「标了 has_ui、还没切束」这条红因此让**每一个 PR** 都失败，
     * 包括与 phase-02/03 毫无关系的 phase-01 feature PR。
     * 一道会让所有 PR 变红的门，实际效果是「大家一律 --no-verify」——
     * 那才是真正把门拆了。
     *
     * ⚠ 这**不是**放行，是降级为 WARN：
     *   - doctor 仍然逐条打印它，`.harness/state/DEBT-phase-02-03-signoff-chain.md` 登记着它
     *   - 一旦该阶段有任何 feature 进入 in_progress / passing（`featureIds` 非空），
     *     立刻回到 FAIL —— 那时它就真的是一条断掉的审计链了
     *   - `"gate"` 模式（claim / new-sprint / verify-uc-coverage）**行为一字未变**，
     *     仍然是 FAIL。已实测：`claim --phase 02` 与 `new-sprint --phase 02` 都被拒
     *
     * 反证在 `design-signoff.test.ts`：零束 + 已开工 feature ⇒ audit 模式也必须 FAIL。
     * 那条测试红了，就说明这个降级被误写成了无条件放行。 */
    const unstartedPhaseIsWarn = mode === "audit" && featureIds.length === 0;
    if (unstartedPhaseIsWarn) {
      return {
        applicable: true,
        fails: [],
        warns: [
          msg +
            `\n    ⚠ 本条在 doctor 里降级为 WARN，因为该阶段**一条 feature 都还没开工**` +
            `（没有 in_progress / passing），没有审计链可断。开工资格仍由 claim / new-sprint 独立挡着。` +
            `一旦有 feature 开工，它立刻变回 FAIL。登记：.harness/state/DEBT-phase-02-03-signoff-chain.md`,
        ],
      };
    }
    return { applicable: true, warns: [], fails: [msg] };
  }

  const fails: string[] = [];
  const warns: string[] = [];

  /* ⓪ requirements 覆盖 —— 人类拍板 2026-07-19，2026-07-30 从 `assertUiSignedOff` 搬到这里。
   *
   * 原文只作用于 phase 级 UI 门：「即便 status: confirmed，若该阶段 requirements/ 全是裸模板
   * 就仍然拒绝」。那道门随 ADR-023 决策一撤掉了，但**这条行为不能跟着一起消失**——
   * 它管的不是「界面对不对」而是「这块设计背后有没有一个真实需求」，
   * 两个把关（人 + 这条检查）本来就是分工的。搬到束级门之后它的适用面反而更正确：
   * 不再限于 has_ui 阶段，**任何采用契约束流程的阶段**都得先有真实 story。 */
  const coverage = hasRequirementsCoverage(phaseId);
  if (!coverage.ok) {
    fails.push(
      `Phase ${phaseId} 的 requirements/ 没有真实 story 覆盖，因此它的契约束不可签核：${coverage.reason}\n` +
        `    契约束签的是「这块设计对不对」，前提是先有「这块设计要解决谁的什么问题」。\n` +
        `    修法：在 phases/phase-${phaseId}-*/requirements/ 下用 .harness/templates/requirements.template.md ` +
        `写清楚需求（R1-Rn），再回到束级 design-signoff.md。（人类拍板 2026-07-19）`,
    );
  }

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
    } else if (b.features.length === 0 && b.status === "confirmed" && b.coversPending !== "") {
      /*
        「人类已签核、feature 尚未生成」——这是 `contract-design.md` 自己写的流程
        （「签核通过后由 requirement-author 生成 feature 再追加」），不是缺陷。

        ## 为什么原先无条件红，而现在分出这一支

        原判定的理由（保留在下面那支里）是：空 covers 会让「本束覆盖的 feature 全部
        已评审」因集合为空而**平凡为真**。那条担心成立，但它针对的是**空壳束冒充
        签核**，不是这一种：人类真的签了（`status: confirmed` + `confirmed_by` +
        `confirmed_at`），只是流程规定 feature 在签核之后才生成。

        两者在磁盘上曾经完全同形，所以原先只能一律判红。现在用 `covers_pending:`
        这句**人写的理由**把它们分开。

        ## 这条放行**没有**打开开工闸门

        束↔feature 的链接只有 `covers:` 一条：feature 的 `spec_ref` 指向 requirements
        文档而不是束目录（本阶段 218 条 feature 逐条查过，指向 `contracts/` 的为 0）。
        所以空 covers **解锁不了任何 feature**，不存在"靠一份没看过它的复核开工"。
        风险只剩一种：束长期空着没人管。用 WARN 每次都打印那句理由压住它，
        而不是默默放行。

        ⚠ 判据三条缺一不可：声明了 `covers`、人类已签核、写了待生成的理由。
          只写 `covers_pending` 而 `status: pending` 仍然判红——那正是"空壳束"本身。

        起因：2026-08-26 `agent-interrupts` 与 `plan-control` 两个**已签核**束卡住
        `gates-fast`，而 `deploy` 的 `needs` 里有它 ⇒ **CD 从 `b97ecda5` 起停摆**，
        main 上所有已合并的改动都到不了 devapp。人类当日裁决按本方案放行。
      */
      warns.push(
        `契约束「${b.bundle}」已签核但 \`covers: []\`（feature 尚未生成）：${b.coversPending}\n` +
          `    ⚠ 这不是绿灯：本束目前**不覆盖任何 feature**，「它覆盖的 feature 都已评审」` +
          `是平凡为真。等 requirement-author 生成 feature 后按「covers 追加规则」填进去，` +
          `本条才会消失。文件：${b.signoffPath}`,
      );
    } else if (b.features.length === 0) {
      fails.push(
        `契约束「${b.bundle}」声明了 \`covers: []\`（空）—— 一个不覆盖任何 feature 的束不成立，` +
          `**因此它不可签核**。\n` +
          `    最常见的原因：**该能力域的 feature 还没生成**——束目录先建好了，` +
          `而 feature_list.json 里还没有属于它的条目（例如它依赖一批尚未裁决的问题，` +
          `requirement-author 还不能生成 feature）。\n` +
          `    这条红是**故意的**：空 covers 若被放行，「这个束覆盖的 feature 全部已评审」` +
          `会因为集合为空而**平凡为真**，读起来像绿灯，实际什么都没评审` +
          `（本仓九次「全绿但空转」的形状）。\n` +
          `    修法只有两条：⑴ 裁决完成 → requirement-author 生成 feature → 填进 \`covers:\`；` +
          `⑵ 该域确实不该有束 → 删掉束目录。**不要为了消红而随手填一个 feature 编号。**\n` +
          `    ⚠ 若人类**确实已签核**、只是 feature 还没生成：加 frontmatter ` +
          `\`covers_pending: "<理由>"\` 降为 WARN（2026-08-26 人类裁决）。` +
          `它同时要求 \`status: confirmed\`，所以补不了一个没人签过的空壳束。\n` +
          `    文件：${b.signoffPath}`,
      );
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
      /* 正文自称不可签核，且没有明确的「签核继续有效」重新确认 ⇒ FAIL */
      const body = readSignoffBody(join(REPO_ROOT, b.signoffPath));
      const selfDeclaredLine = body
        .split(/\r?\n/)
        .find((line) => SELF_DECLARED_BLOCKED_RE.test(line));
      if (selfDeclaredLine && !REAFFIRMED_RE.test(body)) {
        fails.push(
          `契约束「${b.bundle}」的 status 是 confirmed，但正文自称不可签核且没有重新确认：\n` +
            `    「${selfDeclaredLine.trim()}」\n` +
            `    修法：人类逐条对账后，在正文加一段包含「签核继续有效」的更正块（留痕原文，不删），` +
            `或把 status 退回 pending。文件：${b.signoffPath}`,
        );
      }
    }
  }

  /* ② 要放行的 feature 必须属于某个已签的束**或已签的 design-delta**
   *   （PROP-HARNESS-SIGNOFF-002，2026-08-12 人类 Accept：#953 只立了评审侧，
   *    claim 侧漏了——delta 覆盖的 feature 此前永远 claim 不了）。
   *   三条不可放宽约束逐条落在下面，反证见 design-signoff.test.ts。 */
  const deltas = readDeltaSignoffs(phaseId);
  for (const fid of featureIds) {
    const bundleOwners = bundles.filter((b) => b.features.includes(fid));
    const deltaOwners = deltas.filter((d) => d.features.includes(fid));
    const total = bundleOwners.length + deltaOwners.length;

    /* 约束③：同一 feature 被两处 covers ⇒ 判失败，不是取第一个——
     * 两份声明会漂移，漂移的那份读起来照样像权威。 */
    if (total > 1) {
      const places = [
        ...bundleOwners.map((b) => `束「${b.bundle}」`),
        ...deltaOwners.map((d) => `delta「${d.delta}」`),
      ].join("、");
      fails.push(
        `${fid} 被多处 covers 同时声明（${places}）—— 同一 feature 的签核归属必须唯一，` +
          `留一处、删其余（同一事实不得声明在两处）。`,
      );
      continue;
    }
    if (total === 0) {
      fails.push(
        `${fid} 不属于任何契约束或已签 design-delta —— 无法确认它的设计被评审过。` +
          `请把它写进某个束 design-signoff.md 的 frontmatter \`covers:\`（ADR-023 决策三），` +
          `或为增量面走 design-delta（#953 先例）。`,
      );
      continue;
    }
    const bOwner = bundleOwners[0];
    if (bOwner) {
      if (bOwner.status !== "confirmed") {
        fails.push(
          `${fid} 所属的契约束「${bOwner.bundle}」尚未签核（status: ${bOwner.status}）→ ${bOwner.signoffPath}`,
        );
      }
      continue;
    }
    const dOwner = deltaOwners[0]!;
    /* 约束①：delta 必须 confirmed 才放行，pending 照拦——「签核是人的动作」的脚本层落点 */
    if (dOwner.status !== "confirmed") {
      fails.push(
        `${fid} 所属的 design-delta「${dOwner.delta}」尚未签核（status: ${dOwner.status}）→ ${dOwner.signoffPath}`,
      );
      continue;
    }
    /* 约束②：delta 必须挂在真实存在且已 confirmed 的 base_bundle 上 */
    const base = bundles.find((b) => b.bundle === dOwner.baseBundle);
    if (!base) {
      fails.push(
        `${fid} 所属 delta「${dOwner.delta}」的 base_bundle「${dOwner.baseBundle || "（未声明）"}」` +
          `在本阶段 contracts/ 里不存在 —— delta 只能挂靠既有已签束，不能凭空立户 → ${dOwner.signoffPath}`,
      );
    } else if (base.status !== "confirmed") {
      fails.push(
        `${fid} 所属 delta「${dOwner.delta}」挂靠的束「${base.bundle}」尚未签核（status: ${base.status}）` +
          `—— 基座未签，增量无从谈起 → ${dOwner.signoffPath}`,
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
