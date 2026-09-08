#!/usr/bin/env node
/**
 * 门控：**Chat 路径覆盖矩阵不许烂掉**。
 *
 * ## 它要挡的失效
 *
 * 一张手写的覆盖表天生会腐烂：新增路径没人补表、spec 改名后表里那格还指着旧文件、
 * 新写的 `chat-path-*.spec.ts` 忘了加进 config 的 testMatch（#512 那个「写了但没人跑」
 * 的形状，本仓已经犯过一次）。这与根 `AGENTS.md` 自己那条
 * **「没有脚本的规范条目视为未落地」** 是同一件事——所以这张表配一支脚本，不然它就只是
 * 一篇会过期的散文。
 *
 * ## 判定的四条（与矩阵文档「机械门控」一节逐条对应，那里是给人读的，这里是给机器跑的）
 *
 * 1. 表里每一行编号唯一、形如 `A1`/`F7`。
 * 2. 每个 `chat-path-*.spec.ts` 的 `test()` 标题带 `@path:<编号>`，且编号在表里存在。
 * 3. 表里「现有 spec」列点名了某个 `chat-path-*` spec 的行，仓库里真有带对应标签的用例。
 * 4. 每个 `chat-path-*.spec.ts` 都被 `playwright.chat-read.config.ts` 的
 *    `chat-path-coverage` 项目 testMatch 捞得到。
 * 5.（表里点名的其余 spec 文件）文件存在性——改名/删除后表里那格会指空。
 *
 * ## 它**挡不到**什么
 *
 * 存量 spec 没有 `@path:` 标签（理由见矩阵文档同名一节：给 25 个既有文件改测试标题
 * 的风险不抵收益）。所以第 2/3 条只在本车道内成立，第 5 条对全表成立。
 * 把这条边界写在这里，是为了下一个读它的人不会以为这道门比实际更强。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MATRIX = path.join(REPO_ROOT, ".harness/instructions/chat-path-coverage-matrix.md");
const E2E_DIR = path.join(REPO_ROOT, "apps/web/e2e");
const CONFIG = path.join(REPO_ROOT, "apps/web/playwright.chat-read.config.ts");
const LANE_PROJECT = "chat-path-coverage";

const failures = [];
const fail = (message) => failures.push(message);

/* ── 表：抓「路径全集与覆盖矩阵」那张表的数据行 ── */
const matrixText = readFileSync(MATRIX, "utf8");
const rows = [];
for (const line of matrixText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) continue;
  const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined).split("|").map((cell) => cell.trim());
  if (cells.length < 5) continue;
  const id = /^([A-F]\d+)\b/.exec(cells[0]);
  if (!id) continue;
  rows.push({ id: id[1], title: cells[0], specCell: cells[2], coverage: cells[3], lane: cells[4] });
}

if (rows.length === 0) fail(`矩阵表一行都没解析出来：${path.relative(REPO_ROOT, MATRIX)} 的表格结构变了？`);

/* ① 编号唯一 */
const seen = new Set();
for (const row of rows) {
  if (seen.has(row.id)) fail(`路径编号重复：${row.id}——编号是这张表的主键，重复等于两条路径共用一个身份`);
  seen.add(row.id);
}

/* 表里点名的 spec 文件（只认反引号里像 spec 基名的 token，跳过 `apps/api 侧有…` 这类散文） */
const namedSpecs = new Map();
for (const row of rows) {
  for (const match of row.specCell.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(token)) continue;
    if (!namedSpecs.has(token)) namedSpecs.set(token, []);
    namedSpecs.get(token).push(row.id);
  }
}

/* ⑤ 文件存在性 */
for (const [spec, ids] of namedSpecs) {
  if (!existsSync(path.join(E2E_DIR, `${spec}.spec.ts`))) {
    fail(`矩阵第 ${ids.join("/")} 行点名的 spec 不存在：apps/web/e2e/${spec}.spec.ts（改名或删除后没人回来补表）`);
  }
}

/* ── 本车道的 spec 文件 ── */
const laneSpecs = readdirSync(E2E_DIR).filter((name) => name.startsWith("chat-path-") && name.endsWith(".spec.ts"));
if (laneSpecs.length === 0) fail("一个 chat-path-*.spec.ts 都没有——这道门本身失去了对象，是不是被整体删了？");

const configText = readFileSync(CONFIG, "utf8");
const laneBlock = configText.slice(configText.indexOf(`name: "${LANE_PROJECT}"`));
const laneMatch = /testMatch:\s*\/(.+?)\/,/s.exec(laneBlock);
if (!laneMatch) {
  fail(`没在 ${path.relative(REPO_ROOT, CONFIG)} 里找到 ${LANE_PROJECT} 项目的 testMatch——车道没了，这批 spec 就没人跑`);
}
const laneRegex = laneMatch ? new RegExp(laneMatch[1]) : null;

const taggedIds = new Set();
for (const spec of laneSpecs) {
  const source = readFileSync(path.join(E2E_DIR, spec), "utf8");
  /*
   * `test(` 与 `test.fixme(` 都算——后者是本仓人类裁决（issue #2997 方案 B）对
   * 「断言是对的、产品还没做到」的既有处置：不删断言、不改宽、等缺口补上就改回 `test`。
   * `test.skip(` **刻意不认**：skip 掉的差距等于不存在，那正是这套门控要挡的。
   */
  const tags = [...source.matchAll(/test(?:\.fixme)?\(\s*"@path:([A-F]\d+)/g)].map((match) => match[1]);
  /* ② 标签存在且指向表里真有的编号 */
  if (tags.length === 0) {
    fail(`${spec} 的 test() 标题里没有 @path:<编号> 标签——没有标签，它与矩阵之间就没有任何机械联系`);
  }
  for (const tag of tags) {
    if (!seen.has(tag)) fail(`${spec} 标了 @path:${tag}，但矩阵里没有这一行——标签指向了一条不存在的路径`);
    taggedIds.add(tag);
  }
  /* ④ 真的被本车道捞得到 */
  if (laneRegex && !laneRegex.test(spec)) {
    fail(`${spec} 不在 ${LANE_PROJECT} 的 testMatch 里——「写了但没人跑」（#512 同一个失效模式）`);
  }
}

/* ③ 表里说由本车道覆盖的行，真有对应标签 */
for (const row of rows) {
  const claimsLaneSpec = [...row.specCell.matchAll(/`(chat-path-[a-z0-9-]+)`/g)].length > 0;
  if (claimsLaneSpec && !taggedIds.has(row.id)) {
    fail(`矩阵第 ${row.id} 行声称由 chat-path-* 用例覆盖，但没有任何用例标了 @path:${row.id}`);
  }
}

if (failures.length > 0) {
  console.error("chat 路径覆盖矩阵门控失败：\n");
  for (const message of failures) console.error(`  · ${message}`);
  console.error(`\n判据与边界见 ${path.relative(REPO_ROOT, MATRIX)}`);
  process.exit(1);
}

console.log(`chat 路径覆盖矩阵 OK：${rows.length} 条路径，${laneSpecs.length} 个 chat-path-* 用例，标签全部对得上。`);
