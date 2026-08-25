/**
 * **前端请求体不许漏契约里的字段**（R2，2026-08-26）。
 *
 * ## 这道门抓到过一次真事故，不是假想的
 *
 * `live-canvas.ts` 里每个写操作都**逐字段**拼 body（`{ key: input.key, displayName:
 * input.displayName, … }`，不是 `...input`）。R0 给契约加了 `tags` 之后，
 * `createCanvasTemplate` / `updateCanvasTemplateDraft` / `mintCanvasTemplateVersion`
 * 三个函数都没跟着加这一栏——后果是**静默丢失**：
 *
 * · 请求合法（`tags` 是 `.optional()`，服务端不会报错）
 * · 服务端落一个空数组
 * · 界面上使用者填过的标签胶囊好好地显示着（那是本地 state）
 *
 * 三者看起来全对，只有真栈 e2e 在"刷新后标签没了"那一刻才炸。这道门把那次事故
 * 变成一个**编译期就能发现**的东西：契约 `in` 里有的键，函数源码里必须提到。
 *
 * ## 为什么是读源码文本，不是调函数看请求体
 *
 * 调函数要 mock `apiRequest`、要造一份合法入参、每加一个操作要写一遍——而真正要
 * 防的事情只有一件：「契约加了一栏，拼 body 的地方忘了加」。读源码文本直接对上
 * 这件事，且新增操作时**不需要改这个测试**（下面的清单是从契约本身派生的）。
 *
 * 已知边界：它只检查"提到了这个键名"，不检查"赋的值对不对"。赋错值是另一类错误
 * （类型系统与 e2e 各挡一半），不在这道门的射程里——一道门管一件事。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canvas } from "@repo/contracts";
import { ROOT } from "./import-closure";

const SOURCE = readFileSync(resolve(ROOT, "lib/live-canvas.ts"), "utf8");

/**
 * 契约操作 → 对应的前端函数名。**只列写操作**：GET 走 query 参数不走 body，
 * 形状约束不同，不适用这条规则。
 */
const WRITE_OPERATIONS: readonly (readonly [keyof typeof canvas.operations, string])[] = [
  ["createTemplate", "createCanvasTemplate"],
  ["updateTemplateDraft", "updateCanvasTemplateDraft"],
  ["updateTemplateMetadata", "updateCanvasTemplateMetadata"],
  ["mintTemplateVersion", "mintCanvasTemplateVersion"],
];

/** 截出一个函数的源码——从 `export async function <name>` 到下一个顶层 `export`。 */
function bodyOf(fnName: string): string {
  const start = SOURCE.indexOf(`export async function ${fnName}`);
  expect(start, `找不到函数 ${fnName}——它被改名或删掉了，这道门要跟着更新`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const nextExport = rest.indexOf("\nexport ");
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

describe("前端写操作的请求体覆盖契约 in 的每一个键（防静默丢字段）", () => {
  it.each(WRITE_OPERATIONS)("%s → %s 提到了契约里的每一栏", (opName, fnName) => {
    const op = canvas.operations[opName] as { in: { shape: Record<string, unknown> } };
    const contractKeys = Object.keys(op.in.shape);
    const source = bodyOf(fnName);

    const missing = contractKeys.filter((k) => !new RegExp(`\\b${k}\\b`).test(source));
    expect(
      missing,
      `${fnName} 的请求体漏了契约 ${opName}.in 里的字段：${missing.join("、")}——`
      + "逐字段拼 body 的写法下，漏掉的那一栏会静默丢失（请求合法、落库为空、界面照常显示）。",
    ).toEqual([]);
  });

  it("⚠ 反证：这道门真的会红——给它一个不存在于源码里的假字段名", () => {
    const source = bodyOf("createCanvasTemplate");
    // 契约里没有 `nonexistentField`，源码里当然也没有——正是"漏了一栏"的形状。
    expect(new RegExp("\\bnonexistentField\\b").test(source)).toBe(false);
  });
});
