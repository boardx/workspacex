/**
 * verify-uc-coverage.ts — UC 覆盖矩阵门控（ADR-020 第三道）
 *
 * 回答的问题：**契约定的接口，真的够跑通业务吗？**
 * 领域模型再漂亮、API 再整齐，只要有一条 UC 的验收线索找不到对应接口，业务就是跑不通的。
 *
 * 检查四件事：
 *   ① 每个签核束的必备材料齐全、签核本身合法（判定在 lib/design-signoff，不在这里重写）
 *   ② UC 的 R12 验收线索**逐条**在 coverage 表里出现（不许漏行）
 *   ③ 每条都有「API 操作」与「前端消费点」两列，**不许空着**
 *      —— 空着意味着没人想过它怎么被调用、怎么被人看见
 *   ④ 每个束覆盖的 feature 合起来 = 该阶段全部 feature（无遗漏、无重叠）
 *
 * ⚠ 本脚本**不判断映射得对不对**——那是人在签核时做的事。
 *   它只保证「每条都被想过」，把「漏了一整条」这种最容易发生的失误挡住。
 *
 * ⚠ 束↔feature 的映射**只从 design-signoff.md 的 frontmatter `covers:` 读**
 *   （ADR-023 决策三）。此前这里和 lib/design-signoff.ts 各有一份中文正则去抓
 *   coverage.md 正文——同一个映射两份实现，正是本项目最高发的失效模式。
 *
 * 用法：pnpm exec tsx .harness/scripts/verify-uc-coverage.ts <phase-id> […]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { findPhaseDir } from "./lib/paths";
import { auditSignoff, readBundleSignoffs, readCoherence } from "./lib/design-signoff";

interface Feature { id: string; spec_ref?: string; points?: number }

let totalBad = 0;

for (const phaseId of process.argv.slice(2)) {
  console.log(`\n── phase ${phaseId} ──`);
  let bad = 0;
  const say = (m: string) => { console.log(`  ✗ ${m}`); bad++; };

  const dir = findPhaseDir(phaseId);
  const contractsDir = join(dir, "contracts");
  if (!existsSync(contractsDir)) {
    say("没有 contracts/ 目录 —— 该阶段尚未做契约束设计（ADR-020）");
    totalBad += bad;
    continue;
  }

  const signoffs = readBundleSignoffs(phaseId);
  const bundles = signoffs.map((s) => s.bundle);
  if (bundles.length === 0) say("contracts/ 下没有任何契约束");

  const fl = JSON.parse(
    readFileSync(join(dir, "feature_list.json"), "utf8"),
  ) as { features: Feature[] };

  /* ── ① 材料齐全 + 签核合法性：复用签核链的唯一判定实现 ────────── */
  // featureIds 传 []：这里只做结构性检查，「谁能开工」是 new-sprint/claim/doctor 的事。
  const audit = auditSignoff(phaseId, []);
  for (const m of audit.fails) say(m);
  for (const m of audit.warns) console.log(`  ⚠ ${m}`);

  const covered = new Set<string>();
  const bundleOfFeature = new Map<string, string>();
  for (const s of signoffs) {
    for (const id of s.features) {
      covered.add(id);
      if (!bundleOfFeature.has(id)) bundleOfFeature.set(id, s.bundle);
    }
  }

  for (const b of bundles) {
    const covPath = join(contractsDir, b, "coverage.md");
    if (!existsSync(covPath)) continue;
    const cov = readFileSync(covPath, "utf8");

    /* ── ②③ R12 逐条覆盖 + 两列不许空 ──────────────────────── */
    // 从 coverage 表里抓已映射的 V 编号（表格首列形如 | V3 | …）
    const mappedV = new Set<string>();
    const emptyCells: string[] = [];
    for (const line of cov.split("\n")) {
      // ⚠ 容忍加粗写法 `| **V1** |` —— 各束的表格风格不完全一致，
      //   门控不该因为排版差异误报「漏了一整条」（本脚本第二版就因此误报 web-kernel 漏 10 条）
      const m = /^\|\s*\*{0,2}(V\d+)\*{0,2}\s*\|(.*)$/.exec(line.trim());
      if (!m) continue;
      mappedV.add(m[1]!);
      const cells = m[2]!.split("|").map((c) => c.trim());
      // 列序：一句话 | API 操作 | 前端消费点 | 状态
      const api = cells[1] ?? "";
      const fe = cells[2] ?? "";
      if (!api) emptyCells.push(`${m[1]} 的「API 操作」列空着`);
      if (!fe) emptyCells.push(`${m[1]} 的「前端消费点」列空着（填不出来请写「—（API 层验收）」，不许留白）`);
    }
    for (const e of emptyCells) say(`${b}/coverage.md：${e}`);

    // 该束依据的 UC 有哪些 R12 条目
    const ucRefs = new Set(
      fl.features
        .filter((f) => bundleOfFeature.get(f.id) === b)
        .map((f) => (f.spec_ref ?? "").split("#")[0])
        .filter(Boolean),
    );
    for (const rel of ucRefs) {
      const ucPath = join(dir, "requirements", rel!);
      if (!existsSync(ucPath)) continue;
      const body = readFileSync(ucPath, "utf8");
      const r12 = body.slice(body.indexOf("## R12"));
      const declared = [...r12.matchAll(/^-\s*(V\d+)/gm)].map((m) => m[1]!);
      const missing = declared.filter((v) => !mappedV.has(v));
      if (missing.length) {
        say(
          `${b}/coverage.md 漏了 ${rel} 的验收线索：${missing.join(" ")}` +
            `（R12 共 ${declared.length} 条，覆盖 ${declared.length - missing.length} 条）`,
        );
      }
    }
  }

  /* ── ④ 束覆盖 = 阶段全部 feature ──────────────────────────── */
  const all = new Set(fl.features.map((f) => f.id));
  const uncovered = [...all].filter((id) => !covered.has(id));
  if (uncovered.length) {
    say(`这些 feature 不属于任何契约束，无法开工：${uncovered.join(" ")}`);
  }
  const ghost = [...covered].filter((id) => !all.has(id));
  if (ghost.length) say(`契约束声称覆盖了不存在的 feature：${ghost.join(" ")}`);

  /* ── 签核状态汇总（不判失败，只报告）────────────────────────── */
  const signed = signoffs.filter((s) => s.status === "confirmed").map((s) => s.bundle);
  const pending = signoffs.filter((s) => s.status !== "confirmed").map((s) => s.bundle);
  const co = readCoherence(phaseId);
  const outOfScope = bundles.filter((b) => !co.coversBundles.includes(b));

  console.log(`  ${bundles.length} 个契约束｜已签 ${signed.length}｜待签 ${pending.length}`);
  if (pending.length) console.log(`    待签：${pending.join(" ")}`);
  console.log(`  阶段一致性复核：${co.status === "confirmed" ? "✅ 已通过" : "⏳ 未通过"}`);
  if (outOfScope.length) console.log(`    ⚠ 未进入复核范围的束：${outOfScope.join(" ")}`);
  if (bad === 0) console.log("  ✅ 覆盖矩阵完整");
  totalBad += bad;
}

console.log(totalBad === 0 ? "\n✅ 全部阶段通过" : `\n❌ 共 ${totalBad} 项不合格`);
process.exit(totalBad === 0 ? 0 : 1);
