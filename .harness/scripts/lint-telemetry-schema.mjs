#!/usr/bin/env node
/**
 * lint-telemetry-schema.mjs —— 实例上报 schema 的白名单与个人信息门控（backlog C5 + C6）。
 *
 * ## 为什么要有这一道
 *
 * 超级实例设计里客户实例向我们上报运行信号，判据只有一句话：
 * **能不能从上报里重建出客户的一句话？能就不许传。**
 *
 * 这句话要是只写在文档里，下一个加字段的人加一个 `note: z.string()`，客户内容就有了一条缝。
 * 本仓规矩：没有脚本的规范视为未落地。本脚本把那句话变成四条可机械检查的规则，
 * 直接遍历 zod schema 本身——检查的是**真正会被执行的那份定义**，不是它的文档。
 *
 * ## 四条规则
 *
 *   ① 字符串必须受约束：只接受带正则、枚举、字面量或 datetime 的字符串。
 *      一个不受约束的 `z.string()` 就是客户内容唯一能挤进来的缝。
 *   ② 字段名不许长成个人信息的样子（name / email / phone / address / content / message …）。
 *      名字对了不代表内容对，但名字长成这样，几乎一定是要装那类东西。
 *   ③ 每个对象都必须 `.strict()`：多一个字段就拒，而不是悄悄丢掉——
 *      悄悄丢掉会让上报方以为传上来了，也让新字段绕过本门控的审查。
 *   ④ 每个数组都必须有长度上限：无上限的数组是另一种形态的「任意大小载荷」。
 *
 * 遍历到 0 个叶子字段判失败：空集不是全绿。
 *
 * 用法（经 tsx 跑，因为要 import TypeScript 写的契约）：
 *   pnpm run lint:telemetry-schema
 *   pnpm exec tsx .harness/scripts/lint-telemetry-schema.mjs --module <文件> --export <导出名[,导出名…]>   # 运营平面各 schema 用
 *
 * 不带参数时检查 {@link TARGETS} 里的每一份 schema（任何一份红即整体红）。新增一份会离开实例、
 * 或与上报同源的 schema，就往 TARGETS 里加一行——门控不认识的 schema 等于没被门控。
 */
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
/** 默认检查目标——上报相关 schema 的清单，只在这里声明。 */
const TARGETS = [
  { module: "packages/contracts/src/instance-telemetry.ts", exportName: "InstanceTelemetryReport" },
  // backlog E1：第一个价值时刻的本地事实与计数上报（后者经 usage 同意离开实例）
  { module: "packages/contracts/src/first-value-events.ts", exportName: "FirstValueLocalFact" },
  { module: "packages/contracts/src/first-value-events.ts", exportName: "FirstValueFunnelReport" },
];
const targets = process.argv.includes("--module")
  ? arg("--export", "InstanceTelemetryReport").split(",").map((exportName) => ({ module: arg("--module"), exportName }))
  : TARGETS.map((t) => ({ ...t, module: join(ROOT, t.module) }));

/** 长成个人信息样子的字段名。按词边界匹配驼峰拆开后的片段，避免 `username` 这类漏网。 */
const PII_WORDS = ["name", "email", "mail", "phone", "mobile", "address", "content", "text", "message",
  "prompt", "body", "title", "comment", "note", "contact", "person", "user", "ip", "location", "description"];
const words = (key) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/);

let failed = false;
for (const { module: modPath, exportName } of targets) {
  const mod = await import(pathToFileURL(resolve(modPath)).href);
  const root = mod[exportName];
  if (!root || !root._def) {
    console.error(`上报 schema 检查：${modPath} 没有导出 ${exportName}，无法判定——不许判绿。`);
    failed = true;
    continue;
  }
  const { findings, leaves } = inspect(root, exportName);
  console.log(`上报 schema 检查：${exportName}，叶子字段 ${leaves} 个，违规 ${findings.length} 处`);
  if (leaves === 0) {
    console.error("遍历到 0 个叶子字段——空集不是全绿，判失败。");
    failed = true;
  }
  for (const f of findings) console.error(`  ${f.path}\n    ${f.rule}：${f.detail}`);
  if (findings.length) failed = true;
}
if (failed) {
  console.error("\n判据：能不能从上报里重建出客户的一句话？能就不许传。");
  process.exit(1);
}
console.log(`✅ ${targets.length} 份上报 schema 里没有能装下客户内容的字段`);

function inspect(root, rootPath) {
  const findings = [];
  let leaves = 0;
  function walk(schema, path) {
    const def = schema._def;
    switch (def.typeName) {
      case "ZodEffects": return walk(def.schema, path);
      case "ZodOptional": case "ZodNullable": case "ZodDefault": case "ZodReadonly":
        return walk(def.innerType, path);
      case "ZodObject": {
        if (def.unknownKeys !== "strict") findings.push({ path, rule: "③ 对象未 .strict()", detail: "多出的字段会被悄悄丢掉，而不是拒绝" });
        for (const [key, child] of Object.entries(def.shape())) {
          const hit = words(key).find((w) => PII_WORDS.includes(w));
          if (hit) findings.push({ path: `${path}.${key}`, rule: "② 字段名像个人信息", detail: `含「${hit}」` });
          walk(child, `${path}.${key}`);
        }
        return;
      }
      case "ZodArray":
        if (!def.maxLength) findings.push({ path, rule: "④ 数组无上限", detail: "加 .max(n)" });
        return walk(def.type, `${path}[]`);
      case "ZodString": {
        leaves++;
        const constrained = def.checks.some((c) => ["regex", "datetime", "uuid", "cuid", "ulid", "ip"].includes(c.kind));
        if (!constrained) findings.push({ path, rule: "① 字符串不受约束", detail: "自由文本能装下客户的一句话；改用枚举、字面量或带正则的标识符" });
        return;
      }
      case "ZodEnum": case "ZodNativeEnum": case "ZodLiteral": case "ZodNumber": case "ZodBoolean":
        leaves++;
        return;
      case "ZodUnion": case "ZodDiscriminatedUnion":
        return def.options.forEach((o, i) => walk(o, `${path}|${i}`));
      case "ZodRecord": case "ZodMap":
        findings.push({ path, rule: "③ 开放键集合", detail: "Record / Map 的键可以是任意字符串，等于没有白名单" });
        return walk(def.valueType, `${path}{}`);
      default:
        leaves++;
        findings.push({ path, rule: "未知类型", detail: `${def.typeName} 不在本门控认识的范围里——先扩展门控，再用它` });
    }
  }
  walk(root, rootPath);
  return { findings, leaves };
}
