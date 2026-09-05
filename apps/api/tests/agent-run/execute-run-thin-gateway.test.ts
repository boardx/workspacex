/**
 * Phase 14 F01 (R4 E3 / domain.md I-1) -- `execute-run.ts` 静态断言：本 feature 完成后,
 * `executeToolLoop`（#725，已被 #741 物理删除）、`useLazySkillLoading`
 * 伪循环（design-delta `skill-lazy-loading`）、以及原先与它们并列的"纯 completeStream/
 * complete() 单次调用"分支，三条历史执行分支都必须从这个文件的**源码本身**消失——
 * 不是"默认关闭"或"死代码但还在"，是物理不存在。
 *
 * 这是静态扫描，不是行为测试（行为覆盖见同目录 `gateway-forwarding.test.ts`）：直接读
 * `execute-run.ts` 的源文本，先剥掉注释（这三个符号名字本身作为历史沿革仍然合法地出现
 * 在讲述"这是什么、为什么被删"的注释里——见本文件顶部这段注释和 `execute-run.ts` 自己
 * 的头注，剥注释是为了不被这类合法的历史文档误伤），再断言剩下的真代码里没有这三个
 * 符号的声明/调用形态，且模型调用收敛成唯一一处 `invokeKernel(...)`。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXECUTE_RUN_PATH = resolve(HERE, "../../src/application/agent-run/execute-run.ts");
const SOURCE = readFileSync(EXECUTE_RUN_PATH, "utf8");

/**
 * 剥掉 `/* ... *\/` 块注释与 `// ...` 行注释，只留下真代码用来做符号扫描。够用即可——
 * 不需要处理字符串字面量里恰好长得像注释起始符的边界情况，这个文件里没有这种字面量。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const CODE = stripComments(SOURCE);

describe("Phase 14 F01 -- execute-run.ts 退化为薄网关（静态断言）", () => {
  it("`executeToolLoop`（#725/#741）不再以函数声明或调用的形态存在于真代码里", () => {
    expect(CODE).not.toMatch(/\bfunction\s+executeToolLoop\b/);
    expect(CODE).not.toMatch(/\bexecuteToolLoop\s*\(/);
  });

  it("`useLazySkillLoading` 伪循环不再以变量声明的形态存在于真代码里", () => {
    expect(CODE).not.toMatch(/\b(?:const|let)\s+useLazySkillLoading\b/);
  });

  it("渐进式披露专属符号（MAX_READ_SKILL_ROUNDS / tryExtractReadSkillRequest / " +
    "appendSkillFullContent / appendSkillNotMountedNotice / \"catalog\" 模式）随分支一并消失", () => {
    expect(CODE).not.toMatch(/\bMAX_READ_SKILL_ROUNDS\b/);
    expect(CODE).not.toMatch(/\btryExtractReadSkillRequest\b/);
    expect(CODE).not.toMatch(/\bappendSkillFullContent\b/);
    expect(CODE).not.toMatch(/\bappendSkillNotMountedNotice\b/);
    expect(CODE).not.toMatch(/"catalog"/);
  });

  it("再没有直接分支调用 deps.model.completeStream(...) 或对 deps.model.complete(...) 做" +
    "\"是否走这条最终答案路径\"的判断——模型调用收敛成唯一一处 invokeKernel(...)", () => {
    expect(CODE).not.toMatch(/deps\.model\.completeStream\(/);
    expect(CODE).not.toMatch(/deps\.model\.completeWithProgress\(/);
    const invokeKernelCallSites = CODE.match(/\binvokeKernel\(/g) ?? [];
    expect(invokeKernelCallSites).toHaveLength(1);
  });

  it("`invokeKernel` 确实从独立文件导入，不是本文件内联定义的第四条分支", () => {
    expect(CODE).toMatch(/import\s*\{\s*invokeKernel\s*\}\s*from\s*"\.\/invoke-kernel"/);
  });

  it("R7：execute-run.ts 完成本需求后代码行数应显著下降（作为退化为\"薄网关\"的可验证信号）", () => {
    // 改造前（#742 三分支并存时）的行数快照，作为对照基线——不是本次改动引入的新事实,
    // 是本 feature 开工前 `git show` 那次的行数（见 F01 issue 的实现指引）。
    const LINE_COUNT_BEFORE_F01 = 1493;
    const lineCount = SOURCE.split("\n").length;
    expect(lineCount).toBeLessThan(LINE_COUNT_BEFORE_F01);
    // 不只是"少了几行"：三条分支加起来两百多行，显著下降意味着掉了两位数以上的比例。
    expect(lineCount).toBeLessThanOrEqual(LINE_COUNT_BEFORE_F01 - 100);
  });
});
