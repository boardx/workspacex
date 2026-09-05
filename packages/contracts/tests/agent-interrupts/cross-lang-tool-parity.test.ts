/**
 * F212/#2252（`agent-interrupts` 契约束）—— 跨语言边界门控 + 环境变量投影链条。
 *
 * ⚠ **#2252 之前 vs 之后，如实记录这条测试的演变**：三个具名虚拟工具
 * （`confirm_task_intent`/`fill_run_params`/`choose_execution_option`）曾经**没有**在
 * `apps/deep-agent-service` 落地，本文件当时只能断言"这三个名字此刻在 tools.py 里还
 * 不存在"这个反向锚点。#2252 把 Python 侧 `@tool` 实现补上之后，这条测试升级为
 * `deep-agent-hitl.test.ts` 同款的签名比对——但**不是逐字比对**，原因见下一段。
 *
 * ## 为什么不能像 `call_skill` 那样逐字比对参数名
 *
 * `call_skill` 的 Python 签名与契约 `DeepAgentHitlToolArgs` 逐字一致，是因为它只有
 * **一种**调用/恢复形状。这三个新工具不是——`HumanInTheLoopMiddleware`（0.7.6）
 * `edit` 分支恢复时，重新调用的是**同一个** Python 函数，但携带的是
 * `ConfirmIntentDecision`/`FillParamsDecision`/`ChooseOptionDecision` 各自
 * `editedArgs` 的**精简**形状（例如 `ChooseOptionDecision.editedArgs` 只有
 * `selectedOptionId`，没有 `requestId`/`options`），跟工具最初被模型调用时的完整
 * `*Args` 契约形状不同（`agent-interrupts.ts` 与
 * `apps/api/src/application/agent-interrupts/{fill-params,choose-option}-decision.ts`
 * 已经把这条差异写清楚）。所以 Python 侧函数签名必须是**契约 Args 字段 ∪ 各 Decision
 * editedArgs 字段**的并集，全部设为可选——本测试断言的是这条并集关系，不是逐字相等：
 *   ① 契约 `*Args` 的每个字段，必须原样出现在 Python 签名里（模型侧调用的字段一个都
 *      不能丢，丢了就是模型没法按契约传参）；
 *   ② Python 签名里除 `config` 外的每个参数，必须能在"契约 Args 字段 ∪ 该工具已知的
 *      Decision editedArgs 字段"这个并集里找到出处（多出来的参数如果没有出处，
 *      要么是笔误要么是没写文档，两者都不该无声通过）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  AGENT_INTERRUPTS_HITL_TOOLS_ENV_VALUE,
  AGENT_INTERRUPTS_TOOL_NAMES,
  ChooseOptionArgs,
  ConfirmIntentArgs,
  FillParamsArgs,
} from "../../src/agent-interrupts";
import { DEEP_AGENT_HITL_TOOLS_ENV_VALUE } from "../../src/deep-agent-hitl";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS_PY = resolve(HERE, "../../../../apps/deep-agent-service/src/deep_agent_service/tools.py");
const HARNESS_PY = resolve(HERE, "../../../../apps/deep-agent-service/src/deep_agent_service/harness.py");
const PROVISION_SH = resolve(HERE, "../../../../.harness/scripts/vm/provision.sh");
const DEPLOY_SH = resolve(HERE, "../../../../.harness/scripts/vm/deploy.sh");

function readSrc(path: string): string {
  const src = readFileSync(path, "utf8");
  expect(src.length, `${path} 读到空内容——路径漂了`).toBeGreaterThan(200);
  return src;
}

/** 剥掉 Python `#` 行注释与三引号 docstring、bash `#` 行注释，只留下真代码用来做
 * "这个符号已经不存在了"的扫描——移除掉的符号名字本身作为历史沿革仍然合法地出现
 * 在讲述"这是什么、为什么被移除"的注释/docstring 里，剥注释是为了不被这类合法的
 * 历史文档误伤。够用即可，不处理字符串字面量里恰好含注释起始符的边界情况。 */
function stripComments(source: string): string {
  return source
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/#[^\n]*/g, "");
}

function pyParamNames(src: string, name: string): string[] {
  const match = new RegExp(`def\\s+${name}\\s*\\(([\\s\\S]*?)\\)\\s*->`).exec(src);
  expect(match, `解析不出 ${name} 的签名`).not.toBeNull();
  return (match?.[1] ?? "")
    .split(",")
    .map((p) => p.trim().split(":")[0]?.trim() ?? "")
    .filter((p) => p !== "" && p !== "config");
}

// 工具名 → (契约 Args 字段, 该工具的 Decision editedArgs 已知会额外携带的字段)。
// editedArgs 字段来自各自的契约类型与 application 层消费点，逐字抄一遍名字，不是猜的：
// - confirm_task_intent：`ConfirmIntentDecision` 的 edit 分支 editedArgs = {assumptions}。
// - fill_run_params：`FillParamsResumePlan.editedArgs`（`fill-params-decision.ts`）与
//   `FillParamsDecision` 的 edit 分支都只用 `fields` 这个键（元素形状不同，但顶层字段名
//   一样，不额外引入新的顶层参数名）。
// - choose_execution_option：`ChooseOptionDecision` 的 edit 分支
//   editedArgs = {selectedOptionId}。
const TOOL_SPECS: { name: string; contractFields: string[]; editedArgsFields: string[] }[] = [
  { name: AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent, contractFields: Object.keys(ConfirmIntentArgs.shape), editedArgsFields: [] },
  { name: AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams, contractFields: Object.keys(FillParamsArgs.shape), editedArgsFields: [] },
  { name: AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption, contractFields: Object.keys(ChooseOptionArgs.shape), editedArgsFields: ["selectedOptionId"] },
];

describe("#2252 跨语言签名门控：Python @tool 参数 = 契约 Args 字段 ∪ 已知 editedArgs 字段", () => {
  for (const spec of TOOL_SPECS) {
    it(`${spec.name}：@tool 函数真实存在，且签名覆盖契约字段、不带无出处的多余参数`, () => {
      const src = readSrc(TOOLS_PY);
      const existsPattern = new RegExp(`@tool\\s*\\n\\s*def\\s+${spec.name}\\s*\\(`);
      expect(existsPattern.test(src), `tools.py 里找不到 @tool def ${spec.name}(`).toBe(true);

      const pyParams = pyParamNames(src, spec.name);
      const allowed = new Set([...spec.contractFields, ...spec.editedArgsFields]);

      for (const field of spec.contractFields) {
        expect(pyParams, `${spec.name} 的 Python 签名丢了契约字段 ${field}`).toContain(field);
      }
      for (const p of pyParams) {
        expect(allowed.has(p), `${spec.name} 的 Python 参数 ${p} 在契约 Args 与已知 editedArgs 字段里都找不到出处`).toBe(true);
      }
    });
  }
});

describe("固定 HITL 工具清单（Phase 14 F02，R6）——不再是环境变量投影，是 harness.py 的常量", () => {
  // Phase 14 F02（R6）：`DEEP_AGENT_HITL_TOOLS` 这个灰度开关已从 harness.py 移除，
  // 验证稳定后按 R6 要求默认开启且开关本身移除——原本"provision.sh 那一行 =
  // deep-agent-hitl 契约值 + 本束三个工具名的并集，逗号拼接"这条投影链条，现在改为
  // harness.py 的 `DEFAULT_HITL_TOOL_NAMES` 常量硬编码同一份并集，这里断言的是
  // 那个常量确实包含两侧契约各自贡献的工具名，不再依赖环境变量/部署脚本。
  it("harness.py 的真代码里不再读 DEEP_AGENT_HITL_TOOLS 这个环境变量", () => {
    expect(stripComments(readSrc(HARNESS_PY))).not.toContain("DEEP_AGENT_HITL_TOOLS");
  });

  it("harness.py 的 DEFAULT_HITL_TOOL_NAMES = deep-agent-hitl 契约值 + 本束三个工具名的并集", () => {
    const src = readSrc(HARNESS_PY);
    const match = /DEFAULT_HITL_TOOL_NAMES:\s*tuple\[str, \.\.\.\]\s*=\s*\(([\s\S]*?)\)/.exec(src);
    expect(match, "harness.py 里找不到 DEFAULT_HITL_TOOL_NAMES 的定义").not.toBeNull();
    const pyNames = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter((s) => s !== "");
    const expected = [DEEP_AGENT_HITL_TOOLS_ENV_VALUE, AGENT_INTERRUPTS_HITL_TOOLS_ENV_VALUE].join(",").split(",");
    expect(pyNames).toEqual(expected);
  });

  it("provision.sh / deploy.sh 的真代码里不再出现 DEEP_AGENT_HITL_TOOLS 这个已移除的开关符号", () => {
    expect(stripComments(readSrc(PROVISION_SH))).not.toContain("DEEP_AGENT_HITL_TOOLS");
    expect(stripComments(readSrc(DEPLOY_SH))).not.toContain("DEEP_AGENT_HITL_TOOLS");
  });
});
