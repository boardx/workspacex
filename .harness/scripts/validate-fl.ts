/**
 * validate-fl.ts — feature_list 的独立校验器
 *
 * 用 harness 自己的 `resolveSpecRef` 校验 spec_ref（不另写一份解析逻辑），
 * 再加几条 feature_list 特有的完整性检查。
 *
 * 为什么不直接用 `pnpm harness verify`：那条命令是**状态转移门控**（把 feature 标 passing），
 * 需要 sprint 上下文。这里要的是「清单本身写得对不对」，是不同的事。
 *
 * 用法：pnpm exec tsx .harness/scripts/validate-fl.ts <phase-id> [更多 phase-id…]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveSpecRef, hasRequirementsCoverage } from "./lib/spec-ref";
import { findPhaseDir } from "./lib/paths";

interface Feature {
  id: string;
  title?: string;
  user_visible_behavior?: string;
  spec_ref?: string;
  depends_on?: string[];
  points?: number;
  status?: string;
  owner?: unknown;
  verification?: string[];
  evidence?: unknown[];
  needs_ui_signoff?: boolean;
  notes?: string;
}

/** 不验证行为的占位式 verification —— 这类等于没有验证 */
const PLACEHOLDER = [
  /^echo\s/i,
  /^test\s+-[ef]\s/i,
  /^ls\s/i,
  /^true$/i,
  /^cat\s/i,
];

let totalBad = 0;

for (const phaseId of process.argv.slice(2)) {
  let dir: string;
  try {
    dir = findPhaseDir(phaseId);
  } catch (e) {
    console.error(`✗ phase ${phaseId}: ${(e as Error).message}`);
    totalBad++;
    continue;
  }
  const flPath = join(dir, "feature_list.json");
  if (!existsSync(flPath)) {
    console.error(`✗ phase ${phaseId}: 没有 feature_list.json`);
    totalBad++;
    continue;
  }

  const fl = JSON.parse(readFileSync(flPath, "utf8")) as { phase?: string; features: Feature[] };
  const feats = fl.features ?? [];
  const ids = new Set(feats.map((f) => f.id));
  let bad = 0;
  const say = (msg: string) => {
    console.log(`  ✗ ${msg}`);
    bad++;
  };

  console.log(`\n── phase ${phaseId} ──`);

  const cov = hasRequirementsCoverage(phaseId);
  if (!cov.ok) say(`requirements 覆盖：${cov.reason}`);

  // 脚手架占位没被覆盖，是最容易漏的一种「看起来生成了」
  for (const f of feats) {
    if (/示例|example|健康检查端点/i.test(f.title ?? "")) {
      say(`${f.id} 仍是脚手架占位（"${f.title}"）—— 该阶段的清单没有真正生成`);
    }
  }

  for (const f of feats) {
    const r = resolveSpecRef(phaseId, f.spec_ref);
    if (!r.ok) say(`${f.id} spec_ref "${f.spec_ref}" — ${r.reason}`);

    if (f.status !== "not_started") say(`${f.id} status=${f.status}（生成阶段只能是 not_started）`);
    if (f.owner != null) say(`${f.id} owner 应为 null`);
    if (!Array.isArray(f.evidence) || f.evidence.length > 0) say(`${f.id} evidence 应为空数组`);
    if (typeof f.points !== "number" || f.points <= 0) say(`${f.id} points 缺失或非正数`);
    if (!f.user_visible_behavior?.trim()) say(`${f.id} 缺 user_visible_behavior`);

    if (!Array.isArray(f.verification) || f.verification.length === 0) {
      say(`${f.id} 没有 verification`);
    } else {
      for (const v of f.verification) {
        if (PLACEHOLDER.some((re) => re.test(v.trim()))) {
          say(`${f.id} verification 是占位式、不验证行为："${v}"`);
        }
      }
    }

    for (const d of f.depends_on ?? []) {
      if (d.includes(":")) continue; // 跨阶段引用
      if (!ids.has(d)) say(`${f.id} 依赖不存在的 ${d}`);
    }
  }

  // 依赖成环
  const state = new Map<string, 0 | 1 | 2>();
  const byId = new Map(feats.map((f) => [f.id, f]));
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      say(`依赖成环：${[...path, id].join(" → ")}`);
      return;
    }
    state.set(id, 1);
    for (const d of (byId.get(id)?.depends_on ?? []).filter((x) => !x.includes(":"))) {
      if (byId.has(d)) visit(d, [...path, id]);
    }
    state.set(id, 2);
  };
  for (const f of feats) visit(f.id, []);

  const pts = feats.reduce((s, f) => s + (f.points ?? 0), 0);
  const signoff = feats.filter((f) => f.needs_ui_signoff);
  console.log(`  ${feats.length} 个 feature / ${pts} 点｜needs_ui_signoff: ${signoff.length} 个`);
  if (bad === 0) console.log("  ✅ 全部通过");
  totalBad += bad;
}

console.log(totalBad === 0 ? "\n✅ 全部阶段通过" : `\n❌ 共 ${totalBad} 项不合格`);
process.exit(totalBad === 0 ? 0 : 1);
