#!/usr/bin/env node
/**
 * lint-skill-context-api-only.mjs —— I-25 的**结构**半边（F61）。
 *
 * `contracts/skills/domain.md` I-25 逐字：
 *   「skill 运行时**不存在直连业务库 / 对象存储 / 向量库的代码路径**（只经 Context API）」，
 *   断言方式：「架构依赖规则测试（`lint-arch-deps` 同类）断言 skill 运行时模块的
 *   import 图中无 DB/向量库客户端」。
 *
 * ## 为什么 `lint-arch-deps` 不够
 *
 * 那个门控管的是**层间方向**：application 不许 import infrastructure。它完全允许
 * `apps/api/src/application/skill/foo.ts` 写 `import { Pool } from "pg"` ——
 * pg 是第三方包，不属于任何层，`layerOf()` 对它返回 null，直接 `continue`。
 * 也就是说：今天把 skill 的取数写成直连数据库，八道已有门控**没有一道会红**。
 * 这个脚本就是那一道。
 *
 * ## 规则（三条，都只看 import 语句，不看运行时）
 *
 *   ① **禁止的第三方客户端**：pg / ioredis / 任何向量库客户端 / 对象存储 SDK。
 *      skill 模块拿到它们中的任何一个，「只经 Context API」就已经不成立了。
 *   ② **禁止直连 `infrastructure/`**：`lint-arch-deps` 已覆盖 application→infrastructure，
 *      这里重申是为了让 skill 模块**即使被搬到别的层**也依然受限（例如将来出现
 *      `interface/controllers/skill.controller.ts`，那一层同样不许直连）。
 *   ③ **禁止绕开 Context API 的兄弟端口**：直接 import `application/retrieval/**`
 *      或 `application/context-pack/**` 的内部装配用例，等于自己拼一个 pack ——
 *      I-24 要求的是「向 Context API 请求」，不是「自己装一个形状一样的东西」。
 *
 * ## 这个门控对自己的两条断言
 *
 * 1. 它打印 `scanned=N`。对着不存在的目录它会 exit 0 —— 本仓已九次栽在
 *    「门控全绿但一个文件都没扫」上（`lint-arch-deps` 头部记着同一条）。
 *    所以 `runtime-context-api-only` 一节断言的是**扫了几个文件、抓到了什么**，
 *    不是退出码。
 * 2. 它带一套**必然失败**的反证 fixture（`__fixtures__/skill-runtime-bad/`）：
 *    一个从未在真实违规上红过的门控，与没有这个门控无法区分。
 *
 * ⚠ 注释行豁免：本文件头部与 domain 注释里会出现 `pg`、`向量库` 这些词，
 *   把它们算成违规会让「解释规则」本身点红门控（同 lint-no-builtin-capabilities 的豁免）。
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(API, "..", "..");

/** 默认扫描根：skill 的 domain 与 application 模块。 */
const DEFAULT_ROOTS = ["apps/api/src/domain/skill", "apps/api/src/application/skill"];

/** ① 直连数据平面的第三方客户端。裸包名或其子路径。 */
const FORBIDDEN_PACKAGES = [
  ["pg", "PostgreSQL 客户端：skill 运行时直连业务库，Context Pack 的丢弃清单与重放记录就绕过去了"],
  ["pg-pool", "同 pg"],
  ["postgres", "PostgreSQL 客户端（porsager/postgres）"],
  ["ioredis", "Redis 客户端：会话/缓存也是业务数据平面"],
  ["redis", "Redis 客户端"],
  ["pgvector", "向量库客户端：I-25 点名的三类之一"],
  ["@pinecone-database/pinecone", "向量库客户端"],
  ["chromadb", "向量库客户端"],
  ["weaviate-ts-client", "向量库客户端"],
  ["@qdrant/js-client-rest", "向量库客户端"],
  ["@aws-sdk/client-s3", "对象存储 SDK：I-25 点名的三类之一"],
  ["minio", "对象存储 SDK"],
];

/** ③ 绕开 Context API 的兄弟通路。 */
const FORBIDDEN_PATH_FRAGMENTS = [
  ["/infrastructure/", "直连 infrastructure：取数实现应由 DI 注入 ContextApiPort 提供"],
  ["application/retrieval/", "直接调检索层等于自己拼一个 pack；I-24 要求的是向 Context API 请求"],
  [
    "application/context-pack/",
    "Context Pack 的装配用例属 context-pack 束；skill 侧只应持有 ContextApiPort 这个端口",
  ],
];

/**
 * 把注释替换成等长空白（保留换行，行号才不漂）。
 *
 * 不做「跳过以 // 开头的行」那种近似：本文件与 domain 注释里就有
 * `import("…")` 形态的说明文字，而块注释的中间行并不以 `//` 开头。
 */
function stripComments(src) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;

let scanned = 0;
let fail = 0;
let anyRoot = false;

for (const root of roots) {
  const abs = root.startsWith("/") ? root : join(ROOT, root);
  if (!existsSync(abs)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  anyRoot = true;
  for (const file of walk(abs)) {
    scanned++;
    const rel = relative(ROOT, file);
    const body = stripComments(readFileSync(file, "utf8"));

    // `import … from "x"` 与 `import("x")` 两种形态都要认：只认前者时，
    // 动态 import 就是一条现成的绕行路线。
    const specs = [];
    // ⚠ 行首空白写成 `[^\S\n]*` 而不是 `\s*`：`\s` 吃换行，配上 `m` 标志会让匹配
    //   从被抹白的注释区起头，报出来的行号恒为 1。（实测过，改前三条里两条报 :1。）
    for (const m of body.matchAll(/^[^\S\n]*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
      specs.push([m[1], body.slice(0, m.index).split("\n").length]);
    }
    for (const m of body.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      specs.push([m[1], body.slice(0, m.index).split("\n").length]);
    }
    for (const m of body.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      specs.push([m[1], body.slice(0, m.index).split("\n").length]);
    }

    for (const [spec, line] of specs) {
      const pkg = FORBIDDEN_PACKAGES.find(
        ([name]) => spec === name || spec.startsWith(`${name}/`),
      );
      if (pkg) {
        console.error(`✗ ${rel}:${line}`);
        console.error(`    skill 模块 import 了 \`${spec}\`：${pkg[1]}`);
        console.error(
          `    I-25：skill 运行时读上下文只能向 Context API 请求 Context Pack。声明一个端口，由 DI 注入实现。`,
        );
        fail++;
        continue;
      }
      const frag = FORBIDDEN_PATH_FRAGMENTS.find(([f]) => spec.includes(f));
      if (frag) {
        console.error(`✗ ${rel}:${line}`);
        console.error(`    skill 模块 import 了 \`${spec}\`：${frag[1]}`);
        fail++;
      }
    }
  }
}

if (!anyRoot) {
  console.log("✅ lint-skill-context-api-only: skill 模块尚未创建，无可检查（束签核后开工即生效）");
  console.log("scanned=0 violations=0");
  process.exit(0);
}

console.log(
  fail === 0
    ? `✅ lint-skill-context-api-only: ${scanned} 个文件，skill 取数只经 Context API（I-25）`
    : `\n❌ ${fail} 处直连数据平面。I-25：skill 运行时不存在直连业务库/对象存储/向量库的代码路径。`,
);
// 机器可读行：测试断言 scanned>0 与 violations 数，**不断言退出码**——
// 对着空目录这个门控会 exit 0 而什么都没检查。
console.log(`scanned=${scanned} violations=${fail}`);
process.exit(fail === 0 ? 0 : 1);
