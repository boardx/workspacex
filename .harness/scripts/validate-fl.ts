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
  sprint?: string | null;
  owner?: unknown;
  verification?: string[];
  evidence?: unknown;
  notes?: string;
}

/**
 * 不可信的 verification 形态清单 —— **不在这里重列一遍**。
 *
 * 这里曾硬编码五条（echo / test -ef / ls / true / cat）。2026-07-30 查出第六种：
 * `pnpm --filter web vitest run <任意路径>` 恒 exit 0（缺 `exec`，pnpm 在无匹配脚本时退 0），
 * 当时 21 个 feature / 84 点靠它验收。这份清单显然会继续长，
 * 而「同一事实声明在两处」在本仓已五次真的漂移 ⇒ 清单唯一事实源是
 * `lint-verification-can-fail.mjs` 的 `UNTRUSTWORTHY_SHAPES`（每条带「怎么发现的」），
 * 本文件只 import 它。那道门控还会做本文件做不到的事：**实测命令会不会红**。
 */
// @ts-expect-error —— .mjs 无类型声明，故意直接引（照 lint-ui-material.test.ts 的成例）
import { UNTRUSTWORTHY_SHAPES } from "./lint-verification-can-fail.mjs";

const SHAPES = UNTRUSTWORTHY_SHAPES as Array<{ name: string; kind: string; re: RegExp; why: string }>;

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
  let feats = fl.features ?? [];
  // 已 passing 的 feature 可能被 `harness archive-passing` 挪进同目录的
  // feature_list.archive.json（只是搬家，不是第二份事实源）——本文件下面的估点对账、
  // id 唯一性等检查都要按阶段全量算，漏并回来会把归档记录的估点/id 从总数里丢掉。
  const archivePath = join(dir, "feature_list.archive.json");
  if (existsSync(archivePath)) {
    const archive = JSON.parse(readFileSync(archivePath, "utf8")) as { features: Feature[] };
    feats = [...(archive.features ?? []), ...feats];
  }
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

    // ⚠ 本校验器最初假设「清单永远在生成态」，一旦有 feature 真的开工就会误报。
    //   它该验的是**状态合法且与其它字段自洽**，不是「必须是 not_started」。
    const LEGAL = ["not_started", "in_progress", "blocked", "passing"];
    if (!LEGAL.includes(f.status ?? "")) {
      say(`${f.id} status=${f.status} 不是合法状态（${LEGAL.join(" / ")}）`);
    }
    // passing 的归属由 verify 门控写入，此处只查自洽性（证据见下方 evidence 检查）
    if (f.status === "passing" && !f.sprint) {
      say(`${f.id} 是 passing 却没有 sprint 归属 —— passing 必须能追回是哪一轮验的`);
    }
    if (f.status === "not_started" && f.owner != null) {
      say(`${f.id} 尚未开工却已有 owner=${String(f.owner)}`);
    }
    // ⚠ harness 的 `Feature.evidence` 是 **string**（见 lib/types.ts），模板 scaffold 成 ""。
    //   我曾在 requirement-author 规格里写成 `[]`，导致 225 个 feature 全带错类型——
    //   verify 写入时是字符串，被当数组读就变成 50 个单字符。
    //   **写规格前没查 harness 自己的类型**，这是根因。
    if (typeof f.evidence !== "string") {
      say(`${f.id} evidence 类型应为 string（harness lib/types.ts），实为 ${typeof f.evidence}`);
    } else if (f.status === "not_started" && f.evidence !== "") {
      say(`${f.id} 尚未开工却已有 evidence："${f.evidence.slice(0, 40)}"`);
    } else if (f.status === "passing" && !f.evidence.trim()) {
      say(`${f.id} 是 passing 却没有 evidence —— 没有证据 = 没有完成（AGENTS.md 完成定义）`);
    }
    if (typeof f.points !== "number" || f.points <= 0) say(`${f.id} points 缺失或非正数`);
    if (!f.user_visible_behavior?.trim()) say(`${f.id} 缺 user_visible_behavior`);

    if (!Array.isArray(f.verification) || f.verification.length === 0) {
      say(`${f.id} 没有 verification`);
    } else {
      for (const v of f.verification) {
        const hit = SHAPES.find((s) => s.re.test(v.trim()));
        if (hit) {
          say(
            `${f.id} verification 不可信（${hit.kind === "always-zero" ? "恒 0" : "结果不确定"}:${hit.name}）："${v}"\n` +
              `      ${hit.why}`,
          );
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

  // ── 估点漂移检查（2026-07-28 新增）────────────────────────────────
  // 估点被声明在**两处**：UC 头部的 `估点 **n**`，与 feature_list 里逐 feature 的 points。
  // 两处必然漂移——本次就查出三处：uc-0-5（13 vs 20，我加 F17 时没回头改头部）、
  // uc-11-1（3 vs 5，O-27 已裁但头部漏改）、uc-13-4（5 vs 8，O-30 同理）。
  // 与 token / 字号 / 丢弃原因 / 撤回链是同一种失效模式，故同样上机械门控。
  //
  // ⚠ `contracts/<bundle>#confirmed` 锚点（2026-08-26，方案 3）没有「UC 头部估点」
  //   这个概念可对账——契约束是签核材料，不是带估点头部的 requirements 文档。
  //   这条检查的 key 是 spec_ref 的 `#` 前半段：requirements 锚点是 `<file>.md`，
  //   会落在 `requirements/<file>.md`；契约锚点是 `contracts/<bundle>`，
  //   在 `requirements/` 目录下永远不存在，天然被下面的 existsSync 挡掉——
  //   但为了不依赖「恰好不存在」这种隐式行为，这里显式跳过，语义更清楚，
  //   也不会因为将来有人手滑建了同名文件而悄悄误判。
  {
    const byUc = new Map<string, number>();
    for (const f of feats) {
      const ref = (f.spec_ref ?? "").trim();
      if (ref.startsWith("contracts/")) continue; // 契约束锚点：没有头部估点可对账
      const file = ref.split("#")[0];
      if (file) byUc.set(file, (byUc.get(file) ?? 0) + (f.points ?? 0));
    }
    for (const [rel, sum] of byUc) {
      const ucPath = join(dir, "requirements", rel);
      if (!existsSync(ucPath)) continue;
      const m = /估点\s*\*\*(\d+)\*\*/.exec(readFileSync(ucPath, "utf8"));
      if (!m) {
        say(`${rel} 头部没有 \`估点 **n**\`，无法与 feature_list 对账`);
        continue;
      }
      const declared = Number(m[1]);
      if (declared !== sum) {
        say(
          `估点漂移：${rel} 头部声明 ${declared}，feature_list 合计 ${sum}` +
            `（估点声明在两处必然漂移——改了一处就要改另一处，或说明差异原因）`,
        );
      }
    }
  }

  // ⚠ 这里曾打印 `needs_ui_signoff: n 个`。该字段全仓 87 个 feature 带着它，
  //   **只有本文件读、只用来打印这个计数，没有任何门控**。ADR-023 删掉了它：
  //   「留着一个只被打印的布尔比没有更糟——它让人以为有关卡。」
  //   UI 签核现在落在束级 `contracts/<bundle>/ui.md` + design-signoff.md 上。
  const pts = feats.reduce((s, f) => s + (f.points ?? 0), 0);
  for (const f of feats) {
    if ("needs_ui_signoff" in f) {
      say(`${f.id} 仍带已废弃字段 needs_ui_signoff —— ADR-023 已删除它（UI 签核移到束级 ui.md）`);
    }
  }
  console.log(`  ${feats.length} 个 feature / ${pts} 点`);
  if (bad === 0) console.log("  ✅ 全部通过");
  totalBad += bad;
}

console.log(totalBad === 0 ? "\n✅ 全部阶段通过" : `\n❌ 共 ${totalBad} 项不合格`);
process.exit(totalBad === 0 ? 0 : 1);
