#!/usr/bin/env node
/**
 * lint-shipped-pack-version.mjs —— 标准 skill 包「发货版本」单一事实源门控
 *
 * 管的是什么：一个标准包的 packVersion 今天写在**两处**——
 *   ① 构建侧：`skills/<pack>/scripts/build.ts` 里的 `packVersion:'x.y.z'`
 *      （同一行还会再写一遍给 `verifySkillStarterPack` 做自校验）
 *   ② 发货侧：`apps/api/src/infrastructure/skill/ensure-standard-skill-packs.ts`
 *      的 `STANDARD_PLATFORM_PACKS`——这是**真正被 seed 进平台组织**的那份
 * 两处都是手写的，没有任何脚本比对过它们。实测漂移（2026-09-09）：
 *   standard-web 构建侧 1.1.2、发货侧 1.1.1，`starter-packs/standard-web/1.1.2.json`
 *   躺在仓库里从没被 seed 过，而两版内容确有差异（web-artifact 1.0.1 vs 1.0.2）。
 *   「构建了新版」和「发货了新版」在磁盘上长得一模一样——这正是它骗人的方式。
 *
 * ── 判定四条 ──────────────────────────────────────────────────────────
 *  ① 每个有 `scripts/build.ts` 的包都必须出现在 `STANDARD_PLATFORM_PACKS` 里。
 *  ② 每个 `STANDARD_PLATFORM_PACKS` 条目都必须有对应的 `scripts/build.ts`。
 *  ③ 两侧 packVersion 必须**逐字相等**（本门控的核心断言）。
 *  ④ 发货版本对应的 `skills/starter-packs/<pack>/<version>.json` 必须存在
 *     ——seeder 指向一个不存在的清单会在运行时才炸。
 *
 * ── 空集防线（本仓九次「全绿但空转」的教训）────────────────────────────
 *  · 一个 build.ts 都扫不到 ⇒ 红（不是「没对象所以全绿」）。
 *  · `STANDARD_PLATFORM_PACKS` 解析出 0 条 ⇒ 红（正则失配 ≠ 没有漂移）。
 *
 * ⚠ 本门控**不决定往哪边收**。构建侧新一点还是发货侧稳一点，是发货内容决策，
 *   归人类。脚本只负责让「两处不一致」这件事无法静默存在。
 *
 * 用法：node .harness/scripts/lint-shipped-pack-version.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = join(ROOT, "skills");
const SEEDER = join(ROOT, "apps/api/src/infrastructure/skill/ensure-standard-skill-packs.ts");

/** 从 build.ts 里取 `packId:'x'` 与 `packVersion:'y'`——只取 unsigned 定义里的第一处。 */
export function parseBuildScript(source) {
  const packId = /packId\s*:\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? null;
  const packVersion = /packVersion\s*:\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? null;
  return { packId, packVersion };
}

/** 从 seeder 源码里取 STANDARD_PLATFORM_PACKS 的 {packId, packVersion} 列表。 */
export function parseSeeder(source) {
  const block = /STANDARD_PLATFORM_PACKS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source)?.[1];
  if (block === undefined) return null; // 结构变了：拒绝下判断，不是判绿
  const entries = [];
  const re = /packId\s*:\s*['"]([^'"]+)['"]\s*,\s*packVersion\s*:\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(block)) !== null) entries.push({ packId: m[1], packVersion: m[2] });
  return entries;
}

/** 纯函数判定。build/seed 都是已解析好的数据，便于 fixture 反证。 */
export function checkPackVersions(builds, seeded, packManifestExists) {
  const failures = [];
  if (builds.length === 0) failures.push("空集防线：`skills/*/scripts/build.ts` 一个都没扫到——包目录结构可能变了，拒绝判绿");
  if (seeded === null) failures.push("空集防线：`STANDARD_PLATFORM_PACKS = [...] as const` 没解析出来——seeder 结构可能变了，拒绝判绿");
  const seedList = seeded ?? [];
  if (seeded !== null && seedList.length === 0) failures.push("空集防线：`STANDARD_PLATFORM_PACKS` 解析出 0 条——正则失配不等于没有漂移，拒绝判绿");

  const seedMap = new Map(seedList.map((s) => [s.packId, s.packVersion]));
  for (const b of builds) {
    if (b.packId === null || b.packVersion === null) {
      failures.push(`${b.sourceFile}: 解析不出 packId/packVersion`);
      continue;
    }
    if (!seedMap.has(b.packId)) {
      failures.push(`${b.packId}: 构建侧有 ${b.sourceFile}，但 STANDARD_PLATFORM_PACKS 里没有它——构建出来的包从没发货`);
      continue;
    }
    const shipped = seedMap.get(b.packId);
    if (shipped !== b.packVersion) {
      failures.push(
        `${b.packId}: 发货版本 ${shipped}（ensure-standard-skill-packs.ts）≠ 构建版本 ${b.packVersion}（${b.sourceFile}）` +
          " —— 同一事实两处手写且已漂移；往哪边收是发货内容决策，归人类",
      );
    }
  }
  const buildIds = new Set(builds.map((b) => b.packId));
  for (const s of seedList) {
    if (!buildIds.has(s.packId)) failures.push(`${s.packId}: STANDARD_PLATFORM_PACKS 里有它，但 skills/${s.packId}/scripts/build.ts 不存在`);
    const manifest = `skills/starter-packs/${s.packId}/${s.packVersion}.json`;
    if (!packManifestExists(manifest)) failures.push(`${s.packId}: 发货版本清单 ${manifest} 不存在——seeder 指向一个磁盘上没有的清单`);
  }
  return { ok: failures.length === 0, failures, checked: builds.length };
}

export function loadBuilds() {
  if (!existsSync(SKILLS_DIR)) return [];
  const out = [];
  for (const entry of readdirSync(SKILLS_DIR).sort()) {
    if (entry === "starter-packs") continue;
    const buildPath = join(SKILLS_DIR, entry, "scripts", "build.ts");
    if (!existsSync(buildPath)) continue;
    out.push({ ...parseBuildScript(readFileSync(buildPath, "utf8")), sourceFile: `skills/${entry}/scripts/build.ts` });
  }
  return out;
}

export function run() {
  const builds = loadBuilds();
  const seeded = existsSync(SEEDER) ? parseSeeder(readFileSync(SEEDER, "utf8")) : null;
  return checkPackVersions(builds, seeded, (rel) => existsSync(join(ROOT, rel)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run();
  if (result.ok) {
    console.log(`✅ [shipped-pack-version] ${result.checked} 个标准包的发货版本与构建版本逐字一致`);
    process.exit(0);
  }
  console.error("❌ [shipped-pack-version] 发货版本与构建版本不一致：");
  for (const f of result.failures) console.error(`   · ${f}`);
  console.error("");
  console.error("修法（二选一，是发货内容决策，不要顺手改）：");
  console.error("   A. 把 STANDARD_PLATFORM_PACKS 升到构建版本 —— 等于决定发这一版内容");
  console.error("   B. 把 build.ts 降回发货版本 —— 等于决定不发，并删掉多余的 starter-packs 清单");
  process.exit(1);
}
