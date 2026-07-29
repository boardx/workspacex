/**
 * merge-fl-parts.ts — 把 `_fl-parts/*.json` 分片合并成一份 feature_list.json
 *
 * 为什么要分片：一个阶段 50 份 UC 塞给单个 agent 会超上下文，切成 3 片并行写更稳。
 * 但分片各自编号会撞号，所以约定：**分片内用临时 id `T01…`，跨分片依赖写
 * `depends_on_note`（自然语言）**，由本脚本统一重排为 `F01…Fnn` 并解析依赖。
 *
 * 本脚本刻意**不自动解析** `depends_on_note`——那是自然语言，猜错比不猜更糟。
 * 它把所有 note 原样保留到 `notes` 里并单独列出，由人（或主 agent）确认后再落成真实依赖。
 *
 * 用法：pnpm exec tsx .harness/scripts/merge-fl-parts.ts <phase-dir> <phase-id>
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Feature {
  id: string;
  depends_on?: string[];
  depends_on_note?: string[];
  points: number;
  status: string;
  spec_ref: string;
  notes?: string;
  priority?: number;
  [k: string]: unknown;
}

const [phaseDir, phaseId] = process.argv.slice(2);
if (!phaseDir || !phaseId) {
  console.error("用法：merge-fl-parts.ts <phase-dir> <phase-id>");
  process.exit(1);
}

const partsDir = join(phaseDir, "_fl-parts");
if (!existsSync(partsDir)) {
  console.error(`✗ 找不到分片目录 ${partsDir}`);
  process.exit(1);
}

const partFiles = readdirSync(partsDir).filter((f) => f.endsWith(".json")).sort();
if (partFiles.length === 0) {
  console.error(`✗ ${partsDir} 下没有分片`);
  process.exit(1);
}

/** 分片内 id → 合并后 id */
const remap = new Map<string, string>();
const merged: Feature[] = [];
let seq = 0;
const crossNotes: { id: string; notes: string[] }[] = [];

for (const pf of partFiles) {
  const part = JSON.parse(readFileSync(join(partsDir, pf), "utf8")) as {
    part?: string;
    features: Feature[];
  };
  console.log(`  读入 ${pf}：${part.features.length} 个 feature`);
  for (const f of part.features) {
    seq += 1;
    const newId = `F${String(seq).padStart(2, "0")}`;
    remap.set(`${pf}::${f.id}`, newId);
    merged.push({ ...f, __part: pf, __oldId: f.id, id: newId } as Feature);
  }
}

// 第二遍：重写分片内依赖
for (const f of merged) {
  const pf = f.__part as string;
  f.depends_on = (f.depends_on ?? []).map((d) => {
    if (d.includes(":")) return d; // 跨阶段引用（如 "p0:F01"）原样保留
    const hit = remap.get(`${pf}::${d}`);
    if (!hit) {
      console.warn(`  ⚠ ${f.id}（原 ${f.__oldId} @ ${pf}）的依赖 ${d} 在本分片内找不到，已保留原值待人工处理`);
      return d;
    }
    return hit;
  });
  if (f.depends_on_note?.length) {
    crossNotes.push({ id: f.id, notes: f.depends_on_note });
    f.notes = `${f.notes ?? ""}\n【跨分片依赖待确认】${f.depends_on_note.join("；")}`.trim();
  }
  delete f.__part;
  delete f.__oldId;
  delete f.depends_on_note;
}

const out = { phase: phaseId, features: merged };
const target = join(phaseDir, "feature_list.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n", "utf8");

const points = merged.reduce((s, f) => s + (f.points ?? 0), 0);
console.log(`\n✓ 已合并 → ${target}`);
console.log(`  ${merged.length} 个 feature / ${points} 点`);
if (crossNotes.length) {
  console.log(`\n⚠ ${crossNotes.length} 个 feature 带跨分片依赖描述，需人工落成真实 id：`);
  for (const c of crossNotes) console.log(`  ${c.id}: ${c.notes.join(" ｜ ")}`);
}
