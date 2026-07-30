// design-signoff.test.ts — 签核链门控的反证（ADR-023）。
//
// 本仓已九次出现「门控全绿但其实空转」。所以每条断言都成对写：
// **性质成立时不报警** + **把性质破坏掉必须报警**。只有前者的测试可以在
// 门控被注释掉之后依然全绿。
//
// ⚠ 断言的是**性质**不是**数量**：不写 `toHaveLength(6)` 这类——
// 它会把一次合法的新增（多一个契约束）判成失败，而那正是这套门控要支持的动作。
// 要断言的是「集合外的进不来」（新增的束没进复核范围 ⇒ 必须红）
// 与「集合内的没漏」（范围齐了 ⇒ 必须绿）。
//
// 用一次性 fixture phase 目录测真实文件系统行为（同 spec-ref.test.ts 的惯例）。
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PHASES_DIR, REPO_ROOT, findPhaseDir } from "./paths";
import {
  assertDesignSignedOff,
  auditSignoff,
  checkTimestamp,
  parseFrontmatter,
  readBundleSignoffs,
  readCoherence,
  requiredBundleFiles,
} from "./design-signoff";

const PHASE_ID = "zz-signoff-test";
const PHASE_DIR = join(PHASES_DIR, `phase-${PHASE_ID}-fixture`);
const CONTRACTS = join(PHASE_DIR, "contracts");

/** 建一个结构完整、已签核的束 */
function writeBundle(
  name: string,
  opts: {
    covers?: string[] | null;
    status?: string;
    confirmedAt?: string;
    confirmedBy?: string;
    skipFiles?: string[];
  } = {},
): void {
  const dir = join(CONTRACTS, name);
  mkdirSync(dir, { recursive: true });
  const skip = new Set(opts.skipFiles ?? []);
  for (const f of ["domain.md", "usecases.md", "coverage.md"]) {
    if (!skip.has(f)) writeFileSync(join(dir, f), `# ${name} ${f}\n`, "utf8");
  }
  if (skip.has("design-signoff.md")) return;
  const covers = opts.covers === null ? "" : `covers: [${(opts.covers ?? ["F01"]).join(", ")}]\n`;
  writeFileSync(
    join(dir, "design-signoff.md"),
    `---\nbundle: ${name}\nphase: "${PHASE_ID}"\n${covers}` +
      `status: ${opts.status ?? "confirmed"}          # pending | confirmed\n` +
      `confirmed_by: "${opts.confirmedBy ?? "yanbin shen"}"\n` +
      `confirmed_at: "${opts.confirmedAt ?? "2026-07-28"}"\n---\n\n# ${name}\n`,
    "utf8",
  );
}

function writeCoherence(
  opts: { coversBundles?: string[] | null; status?: string; confirmedAt?: string; confirmedBy?: string } = {},
): void {
  const covers =
    opts.coversBundles === null ? "" : `covers_bundles: [${(opts.coversBundles ?? []).join(", ")}]\n`;
  writeFileSync(
    join(PHASE_DIR, "design-coherence.md"),
    `---\nphase: "${PHASE_ID}"\n${covers}` +
      `status: ${opts.status ?? "confirmed"}\n` +
      `confirmed_by: "${opts.confirmedBy ?? "yanbin shen"}"\n` +
      `confirmed_at: "${opts.confirmedAt ?? "2026-07-28"}"\n---\n\n# 一致性复核\n`,
    "utf8",
  );
}

/** 门控判定的参考时刻：fixture 里的签核时间都早于它 */
const NOW = new Date("2026-07-29T00:00:00Z");

beforeEach(() => {
  mkdirSync(PHASE_DIR, { recursive: true });
  // ⓪ 2026-07-30 起 `auditSignoff` 先查 requirements 覆盖（原 `assertUiSignedOff` 的行为，
  //    随 phase 级 UI 门被撤而搬到束级门）。fixture 得有一份真实 story，
  //    否则所有束级断言都会被这条新的 FAIL 污染。它自己的反证在下方 describe 里。
  mkdirSync(join(PHASE_DIR, "requirements"), { recursive: true });
  writeFileSync(join(PHASE_DIR, "requirements", "story.md"), "# 真实 story\n\n## R1 用户能登录\n", "utf8");
});
afterEach(() => {
  if (existsSync(PHASE_DIR)) rmSync(PHASE_DIR, { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
  it("吃得下引号、行尾注释、内联数组、块状列表", () => {
    const p = join(PHASE_DIR, "fm.md");
    writeFileSync(
      p,
      `---\nbundle: auth\ncovers: [F19, F20]   # 注释里也有 F99，不许被吃进去\n` +
        `status: confirmed   # pending | confirmed\nconfirmed_by: "yanbin shen"\n` +
        `tags:\n  - a\n  - b\n---\n\nstatus: 正文里的这行不算数\n`,
      "utf8",
    );
    const fm = parseFrontmatter(p)!;
    expect(fm["covers"]).toEqual(["F19", "F20"]);
    expect(fm["status"]).toBe("confirmed");
    expect(fm["confirmed_by"]).toBe("yanbin shen");
    expect(fm["tags"]).toEqual(["a", "b"]);
  });

  // ⚠ 2026-07-30 phase-01 建九个束时抓到的真洞：模板里的
  //   `confirmed_by:            # 确认人（姓名/邮箱）` 会被解析成字符串
  //   `"# 确认人（姓名/邮箱）"`——**非空**。于是「confirmed 却没有 confirmed_by」
  //   那条检查（本文件下方那条测试）会被一个注释骗过去：
  //   人类只把 status 改成 confirmed、名字忘了填，门控照样放行，
  //   而**签核记名是这条链的信任根**。九个束的模板全是这个形状。
  it("值只有注释 → 视为空值（注释不许冒充签名）", () => {
    const p = join(PHASE_DIR, "fm-comment.md");
    writeFileSync(
      p,
      `---\nbundle: b\nstatus: pending          # pending | confirmed\n` +
        `confirmed_by:            # 确认人（姓名/邮箱）\nconfirmed_at:            # ISO 8601\n---\n`,
      "utf8",
    );
    const fm = parseFrontmatter(p)!;
    expect(fm["confirmed_by"]).toBe("");
    expect(fm["confirmed_at"]).toBe("");
    // 反向：真填了名字就必须原样读出来，不能被上面那条规则误伤
    writeFileSync(
      p,
      `---\nbundle: b\nconfirmed_by: yanbin shen   # 确认人\n---\n`,
      "utf8",
    );
    expect(parseFrontmatter(p)!["confirmed_by"]).toBe("yanbin shen");
  });

  it("confirmed + confirmed_by 只剩模板注释 → 拒绝（这正是上一条要防的后果）", () => {
    const dir = join(CONTRACTS, "comment-signed");
    mkdirSync(dir, { recursive: true });
    for (const f of ["domain.md", "usecases.md", "coverage.md"]) {
      writeFileSync(join(dir, f), "x\n", "utf8");
    }
    writeFileSync(
      join(dir, "design-signoff.md"),
      `---\nbundle: comment-signed\ncovers: [F01]\n` +
        `status: confirmed        # pending | confirmed\n` +
        `confirmed_by:            # 确认人（姓名/邮箱）\n` +
        `confirmed_at: "2026-07-28"\n---\n`,
      "utf8",
    );
    writeCoherence({ coversBundles: ["comment-signed"] });
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails.join("\n")).toMatch(/没有 confirmed_by/);
  });

  it("没有 frontmatter → null（与「有 frontmatter 但字段为空」区分开）", () => {
    const p = join(PHASE_DIR, "plain.md");
    writeFileSync(p, "# 没有 frontmatter\ncovers: [F01]\n", "utf8");
    expect(parseFrontmatter(p)).toBeNull();
  });
});

describe("checkTimestamp", () => {
  it("合法的 ISO 8601 且不在未来 → 通过", () => {
    expect(checkTimestamp("2026-07-28", NOW).ok).toBe(true);
    expect(checkTimestamp("2026-07-28T07:35:09+08:00", NOW).ok).toBe(true);
    expect(checkTimestamp("2026-07-28T07:35:09.123Z", NOW).ok).toBe(true);
  });

  // 反证：现存两处真实违例的形态，逐个必须红
  it("少补零的 2026-7-28 不是 ISO 8601 → 拒绝", () => {
    const r = checkTimestamp("2026-7-28", NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/ISO 8601/);
  });
  it("晚于当下的时间戳 → 拒绝（签核是已经发生的动作）", () => {
    const r = checkTimestamp("2026-07-30T10:22:44+08:00", NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/晚于当前时刻/);
  });
  it("缺失 → 拒绝", () => {
    expect(checkTimestamp(undefined, NOW).ok).toBe(false);
    expect(checkTimestamp("   ", NOW).ok).toBe(false);
  });
  it("形状对但不是真实时刻（2026-02-30）→ 拒绝", () => {
    expect(checkTimestamp("2026-02-30", NOW).ok).toBe(false);
  });
});

describe("束↔feature 映射的权威是 frontmatter 的 covers（ADR-023 决策三）", () => {
  it("从 covers 读，而不是从 coverage.md 正文", () => {
    writeBundle("identity", { covers: ["F01", "F02"] });
    // 正文写一个矛盾的映射：它必须不起作用
    writeFileSync(join(CONTRACTS, "identity", "coverage.md"), "> 覆盖 feature：F98 F99\n", "utf8");
    const [b] = readBundleSignoffs(PHASE_ID);
    expect(b!.features).toEqual(["F01", "F02"]);
    expect(b!.features).not.toContain("F99");
  });

  it("散文被改写（不写 F 编号）也不再影响映射 —— 这正是旧实现的爆点", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeFileSync(join(CONTRACTS, "identity", "coverage.md"), "> 覆盖 feature：本束覆盖全部 5 个\n", "utf8");
    writeCoherence({ coversBundles: ["identity"] });
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails).toEqual([]);
  });

  it("缺 covers 字段 → 报错并指到 design-signoff.md", () => {
    writeBundle("identity", { covers: null });
    writeCoherence({ coversBundles: ["identity"] });
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/缺 `covers/);
  });
});

describe("auditSignoff —— 开工门控", () => {
  it("没有 contracts/ 目录 → 不适用，全部放行（不追溯拦住 ADR-020 之前的阶段）", () => {
    const r = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(r.applicable).toBe(false);
    expect(r.fails).toEqual([]);
  });

  it("结构齐备、束已签、复核覆盖全部束 → 无 FAIL", () => {
    writeBundle("identity", { covers: ["F01", "F02"] });
    writeBundle("artifact", { covers: ["F03"] });
    writeCoherence({ coversBundles: ["identity", "artifact"] });
    expect(auditSignoff(PHASE_ID, ["F01", "F03"], NOW).fails).toEqual([]);
  });

  it("反证：feature 不属于任何束 → 拒绝", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity"] });
    const { fails } = auditSignoff(PHASE_ID, ["F09"], NOW);
    expect(fails.join("\n")).toMatch(/F09 不属于任何契约束/);
  });

  it("反证：所属束 status: pending → 拒绝", () => {
    writeBundle("identity", { covers: ["F01"], status: "pending" });
    writeCoherence({ coversBundles: ["identity"] });
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/尚未签核/);
  });

  it("反证：两个束都声明同一个 feature → 拒绝（归属必须唯一）", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeBundle("artifact", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity", "artifact"] });
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/同时被.*声明/);
  });

  it("反证：束缺必备支撑材料（coverage.md）→ 拒绝", () => {
    writeBundle("identity", { covers: ["F01"], skipFiles: ["coverage.md"] });
    writeCoherence({ coversBundles: ["identity"] });
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/缺必备材料：coverage\.md/);
  });

  it("反证：签核时间戳在未来 → 拒绝（即使一切其它条件都满足）", () => {
    writeBundle("identity", { covers: ["F01"], confirmedAt: "2026-07-30T10:22:44+08:00" });
    writeCoherence({ coversBundles: ["identity"] });
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/签核时间戳不合法/);
  });

  it("confirmed 却没有 confirmed_by → 拒绝（签核必须记名）", () => {
    writeBundle("identity", { covers: ["F01"], confirmedBy: "" });
    writeCoherence({ coversBundles: ["identity"] });
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails.join("\n")).toMatch(/没有 confirmed_by/);
  });

  it("confirmed_by 带前导空格 → WARN，不阻断", () => {
    writeBundle("identity", { covers: ["F01"], confirmedBy: " yanbin shen" });
    writeCoherence({ coversBundles: ["identity"] });
    const r = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(r.fails).toEqual([]);
    expect(r.warns.join("\n")).toMatch(/带首尾空格/);
  });
});

describe("一致性复核必须声明覆盖范围（ADR-023 决策四）", () => {
  it("缺 covers_bundles → 拒绝，并把磁盘上现有的束列出来", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: null });
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/缺 `covers_bundles/);
    expect(fails.join("\n")).toMatch(/identity/);
  });

  // ★ 这是 ADR-023 背景 1 的可执行形式，也是整套门控的核心性质：
  //   **集合外的进不来**。断言里没有任何数字——多一个束、少一个束都由性质本身覆盖。
  it("反证：磁盘上多出一个束而复核范围没跟上 → 拒绝，并点名是哪个束", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity"] });
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails).toEqual([]); // 破坏前：绿

    writeBundle("auth", { covers: ["F19"] }); // 新束出现，复核范围原封不动
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/一致性复核没覆盖这些束：auth/);
    // 已在范围内的束不该被点名
    expect(fails.join("\n")).not.toMatch(/没覆盖这些束：.*identity/);
  });

  it("范围补齐后恢复通过 —— 门控可以被正当地满足，不是死路", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeBundle("auth", { covers: ["F19"] });
    writeCoherence({ coversBundles: ["identity", "auth"] });
    expect(auditSignoff(PHASE_ID, ["F01", "F19"], NOW).fails).toEqual([]);
  });

  it("复核范围是超集（含已删除的束）→ WARN 而非 FAIL", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity", "已删掉的束"] });
    const r = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(r.fails).toEqual([]);
    expect(r.warns.join("\n")).toMatch(/不存在的束/);
  });

  it("反证：复核 status 仍是 pending → 拒绝", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity"], status: "pending" });
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails.join("\n")).toMatch(/一致性复核尚未通过/);
  });

  it("反证：复核时间戳非 ISO（2026-7-28）→ 拒绝", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity"], confirmedAt: "2026-7-28" });
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails.join("\n")).toMatch(/复核的时间戳不合法/);
  });

  it("readCoherence 把声明范围如实读出来", () => {
    writeCoherence({ coversBundles: ["identity", "artifact"] });
    const co = readCoherence(PHASE_ID);
    expect(co.coversBundlesDeclared).toBe(true);
    expect(co.coversBundles).toEqual(["identity", "artifact"]);
  });
});

describe("ui.md 的要求范围只覆盖 has_ui 阶段（ADR-023 决策一 ①）", () => {
  // 用真实 roadmap 里的阶段断言性质，而不是硬编码某个阶段该有几个文件：
  // phase-00 无 has_ui、phase-01 has_ui: true。
  it("has_ui 阶段要求 ui.md，非 UI 阶段不要求", () => {
    expect(requiredBundleFiles("01")).toContain("ui.md");
    expect(requiredBundleFiles("00")).not.toContain("ui.md");
  });

  it("两种阶段都要求四件基础材料", () => {
    for (const p of ["00", "01"]) {
      expect(requiredBundleFiles(p)).toEqual(
        expect.arrayContaining(["domain.md", "usecases.md", "coverage.md", "design-signoff.md"]),
      );
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 以下三个 describe 是 2026-07-30「两道签核门收敛为一道」的反证（ADR-023 决策一）。
 *
 * 收敛本身很小：`new-sprint` 少调一个 assert。**危险的是它的副作用**：
 * phase-02/03 标了 `has_ui`、还没建 `contracts/`，此前挡住它们的唯一一道门
 * 正是被撤掉的那道；而束级门有一个「零契约束 ⇒ 静默放行」的逃生口。
 * 只撤门不堵口 = 那两个阶段从「有门」变成「无门」。下面的测试就是钉这件事的。
 * ══════════════════════════════════════════════════════════════════════════ */

describe("has_ui 阶段的零契约束逃生口已堵上（ADR-023 决策一落地，2026-07-30）", () => {
  it("非 UI 阶段 + 零契约束 → 仍然不适用，放行（不追溯拦住 ADR-020 之前的阶段）", () => {
    // fixture phase 不在 roadmap 里 ⇒ has_ui 为假，走的正是这条旧路径
    const r = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(r.applicable).toBe(false);
    expect(r.fails).toEqual([]);
  });

  // ★ 本次改动最大的风险点：撤掉 phase 级 UI 门后，phase-02/03 是否**仍然**被挡住。
  //   用真实 roadmap + 真实磁盘断言，不是 fixture——因为要防的就是真实那两个阶段被放行。
  it("phase-02 / phase-03（has_ui: true，磁盘上没有 contracts/）→ 判失败，且点名 has_ui", () => {
    for (const phaseId of ["02", "03"]) {
      expect(existsSync(join(findPhaseDir(phaseId), "contracts"))).toBe(false); // 前提没变
      const r = auditSignoff(phaseId, [], NOW);
      expect(r.applicable).toBe(true);
      expect(r.fails.join("\n")).toMatch(/has_ui/);
      expect(r.fails.join("\n")).toMatch(/没有任何契约束/);
    }
  });

  it("assertDesignSignedOff 对 phase-02/03 抛错 —— new-sprint 与 claim 共用它，两个入口一起被挡", () => {
    for (const phaseId of ["02", "03"]) {
      expect(() => assertDesignSignedOff(phaseId, ["F01"])).toThrow(/has_ui/);
    }
  });

  it("phase-01（has_ui: true 且已建 contracts/）不被这条误伤 —— 它走正常的束级判定", () => {
    expect(existsSync(join(findPhaseDir("01"), "contracts"))).toBe(true);
    const r = auditSignoff("01", [], NOW);
    expect(r.applicable).toBe(true);
    expect(r.fails.join("\n")).not.toMatch(/没有任何契约束/);
  });
});

describe("requirements 覆盖这条行为已搬进束级门（人类拍板 2026-07-19，不许随旧门一起消失）", () => {
  it("束齐备但 requirements/ 是空的 → 拒绝，并说明「先有需求才谈设计签核」", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity"] });
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails).toEqual([]); // 破坏前：绿

    rmSync(join(PHASE_DIR, "requirements"), { recursive: true, force: true });
    const { fails } = auditSignoff(PHASE_ID, ["F01"], NOW);
    expect(fails.join("\n")).toMatch(/没有真实 story 覆盖/);
  });

  it("requirements/ 里只有空文件也不算数（裸模板/空壳不是需求）", () => {
    writeBundle("identity", { covers: ["F01"] });
    writeCoherence({ coversBundles: ["identity"] });
    writeFileSync(join(PHASE_DIR, "requirements", "story.md"), "   \n", "utf8");
    expect(auditSignoff(PHASE_ID, ["F01"], NOW).fails.join("\n")).toMatch(/没有真实 story 覆盖/);
  });
});

describe("phase 级 ui-signoff.md 已停用：改它的 status 不产生任何门控效果", () => {
  const ARCHIVED = [
    "phases/phase-01-run-a-project/ui-signoff.md",
    "phases/phase-02-visible-outcomes/ui-signoff.md",
    "phases/phase-03-reuse-and-governance/ui-signoff.md",
  ];

  /** 去掉块注释与行注释，只留可执行代码 */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  function harnessSources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) harnessSources(p, out);
      else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
    }
    return out;
  }

  // ★ 这条是「改它没用」的机械形式。没有它，将来有人把 status 改成 confirmed
  //   会以为自己签过了——而门控根本不看这个文件。
  it("harness 脚本的可执行代码里不存在任何对 ui-signoff.md 的引用", () => {
    const offenders = harnessSources(join(REPO_ROOT, ".harness", "scripts"))
      .filter((p) => /ui-signoff/.test(stripComments(readFileSync(p, "utf8"))));
    expect(offenders).toEqual([]);
  });

  it("lib/ui-signoff.ts 已删除（门控实现不存在 ⇒ 不可能有第二个读取点）", () => {
    expect(existsSync(join(REPO_ROOT, ".harness", "scripts", "lib", "ui-signoff.ts"))).toBe(false);
  });

  it("三份留痕文件仍在磁盘上，顶部有停用块，status 原值未被改动", () => {
    for (const rel of ARCHIVED) {
      const body = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(body).toMatch(/本文件已停用（2026-07-30，ADR-023 决策一）/);
      // 档案：agent 不许改签核字段。它们本来就是 pending，改动即违规。
      expect(parseFrontmatter(join(REPO_ROOT, rel))!["status"]).toBe("pending");
    }
  });
});
