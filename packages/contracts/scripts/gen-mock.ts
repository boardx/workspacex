/**
 * gen-mock.ts — 从契约生成前端 mock（ADR-020 第四条）
 *
 * 为什么必须生成而不是手写：本项目已**五次**因「同一事实声明在两处」而漂移——
 * 设计 token、字号档位、丢弃原因枚举、撤回链 SLA、估点。手写 mock 是第六次。
 *
 * 生成之后，**前端自动成为契约的第一个消费者：契约错了，界面当场就崩**，
 * 而不是等到联调才发现。这是把「契约正确性」从人的自觉转成机器可验证的关键一步。
 *
 * 产物带 `@generated` 头，`lint-contract-source` 据此判定它没被手改。
 * 每个契约束一个 `<file>.mock.ts`；新增契约束时在 MODULES 加一行即可。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as auth from "../src/auth";
import * as identity from "../src/identity";
import * as artifact from "../src/artifact";
import * as contextPack from "../src/context-pack";
import * as provenance from "../src/provenance";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(ROOT, "apps/web/lib/generated");

type Op = { out: z.ZodTypeAny; err: readonly string[] };
/**
 * `file` = 生成物文件名 / 契约包子路径（可含连字符，如 `context-pack`）；
 * `varName` = 生成物里 `import * as <varName>` 的 JS 标识符（不能含连字符）。
 * 省略 `varName` 时默认取 `file`（适用于 identity / artifact 这类本身就是合法标识符的束）。
 */
type Bundle = { file: string; varName?: string; operations: Record<string, unknown> };

/** 契约束清单——新增束在此加一行，生成器自动产出 `<file>.mock.ts` */
const MODULES: Bundle[] = [
  { file: "auth", operations: auth.operations },
  { file: "identity", operations: identity.operations },
  { file: "auth", operations: auth.operations },
  { file: "artifact", operations: artifact.operations },
  { file: "context-pack", varName: "contextPack", operations: contextPack.operations },
  { file: "provenance", operations: provenance.operations },
];

/**
 * 从 zod schema 造一个**确定性**样例。
 * 刻意不用随机值：mock 必须可复现，否则截图对比与快照测试都不稳。
 */
function sample(schema: z.ZodTypeAny, key = "", depth = 0): unknown {
  if (depth > 8) return null;
  const def = (schema as unknown as { _def: { typeName: string; [k: string]: unknown } })._def;
  switch (def.typeName) {
    case "ZodString":
      return key ? `${key}-1` : "sample";
    case "ZodNumber":
      return 1;
    case "ZodBoolean":
      return false;
    case "ZodEnum":
      // 取第一个取值——确定性，且第一个通常是最典型的那个
      return (def.values as string[])[0];
    case "ZodLiteral":
      return def.value;
    case "ZodNullable":
      // ⚠ 取 null 而不是内层样例：让前端**必须**处理空值分支。
      //   projectRole 为 null 正是「不在项目上下文」这个正常状态（domain I-11）。
      return null;
    case "ZodOptional":
      return sample(def.innerType as z.ZodTypeAny, key, depth + 1);
    case "ZodArray":
      return [sample(def.type as z.ZodTypeAny, key, depth + 1)];
    case "ZodRecord":
      return {};
    case "ZodUnknown":
      return null;
    case "ZodObject": {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(shape)) out[k] = sample(v as z.ZodTypeAny, k, depth + 1);
      return out;
    }
    default:
      return null;
  }
}

const HEADER = `/**
 * @generated 由 packages/contracts 生成，**请勿手改**。
 *
 * 改这里的值不会改变契约，只会让 mock 与契约漂移——
 * 而「同一事实声明在两处必然漂移」是本项目已经踩过五次的坑（ADR-020）。
 * 要改请改 packages/contracts/src/*.ts，然后跑 pnpm --filter @repo/contracts gen:mock。
 *
 * 门控：node .harness/scripts/lint-contract-source.mjs
 */
`;

mkdirSync(OUT, { recursive: true });

for (const bundle of MODULES) {
  const varName = bundle.varName ?? bundle.file;
  const lines: string[] = [HEADER];
  lines.push(`import type { z } from "zod";`);
  lines.push(`import * as ${varName} from "@repo/contracts/${bundle.file}";\n`);

  for (const [name, op] of Object.entries(bundle.operations)) {
    const o = op as Op;
    const value = JSON.stringify(sample(o.out, name), null, 2);
    lines.push(`/** ${name} 的成功响应样例（由契约生成） */`);
    lines.push(
      `export const ${name}Mock: z.infer<typeof ${varName}.operations.${name}.out> = ${value};\n`,
    );
    if (o.err.length) {
      lines.push(`/** ${name} 的失败模式全集——界面的异常态必须逐个覆盖 */`);
      lines.push(
        `export const ${name}Errors = ${JSON.stringify(o.err)} as const;\n`,
      );
    }
  }

  const target = join(OUT, `${bundle.file}.mock.ts`);
  writeFileSync(target, lines.join("\n"), "utf8");
  console.log(`✓ 已生成 ${target}（${Object.keys(bundle.operations).length} 个操作）`);
}
