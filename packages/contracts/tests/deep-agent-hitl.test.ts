/**
 * issue #2017 —— HITL 工具名/参数形状「单一事实源」的跨语言门控。
 *
 * 这份测试守的是一条 **import 守不住的边界**：工具本身由 Python 定义
 * （`deep_agent_service/tools.py` 的 `@tool def call_skill`），TypeScript 侧无法 import
 * 它，只能把名字与参数名再写一遍。凡"再写一遍"就是漂移的种子，所以这里直接读那个
 * `.py` 源文件做逐字比对——Python 侧改了名字或参数而 `deep-agent-hitl.ts` 没跟，本测试红。
 *
 * ⚠ 断言的是 `.py` 源文件而不是跑一个 Python 进程：本包是纯 TS 包，没有也不该有
 * Python 运行时依赖。读源文件已足够守住"名字漂移"这件事——这是本门控唯一的职责。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  DEEP_AGENT_HITL_TOOL_NAME,
  DEEP_AGENT_HITL_TOOLS_ENV_VALUE,
  DEEP_AGENT_HITL_ARGS_MAX_CHARS,
  DeepAgentHitlToolArgs,
} from "../src/deep-agent-hitl";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS_PY = resolve(HERE, "../../../apps/deep-agent-service/src/deep_agent_service/tools.py");
const HARNESS_PY = resolve(HERE, "../../../apps/deep-agent-service/src/deep_agent_service/harness.py");
const PROVISION_SH = resolve(HERE, "../../../.harness/scripts/vm/provision.sh");

function readPy(path: string): string {
  const src = readFileSync(path, "utf8");
  // 空文件/读错路径会让下面每条断言都以"没匹配到"的形式假绿地失败一次，
  // 但那样的红看不出根因，所以先在这里把"文件本身没读到"变成明确的红。
  expect(src.length, `${path} 读到空内容——路径漂了`).toBeGreaterThan(200);
  return src;
}

/** 剥掉 Python `#` 行注释与三引号 docstring、bash `#` 行注释，只留下真代码用来做
 * "这个符号已经不存在了"的扫描——移除掉的符号名字本身作为历史沿革仍然合法地出现
 * 在讲述"这是什么、为什么被移除"的注释/docstring 里（同
 * `execute-run-thin-gateway.test.ts` 的既有先例），剥注释是为了不被这类合法的
 * 历史文档误伤。够用即可，不处理字符串字面量里恰好含注释起始符的边界情况。 */
function stripComments(source: string): string {
  return source
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/#[^\n]*/g, "");
}

describe("issue #2017 HITL 工具名单一事实源", () => {
  it("契约里的工具名，在 tools.py 里真的是一个 @tool 函数", () => {
    const src = readPy(TOOLS_PY);
    // `@tool` 紧接着 `def <name>(` ——langchain 以函数名作工具名，所以这两行连在一起
    // 才构成"这个名字真的是一个可被模型调用的工具"。
    const pattern = new RegExp(`@tool\\s*\\n\\s*def\\s+${DEEP_AGENT_HITL_TOOL_NAME}\\s*\\(`);
    expect(
      pattern.test(src),
      `tools.py 里找不到 @tool def ${DEEP_AGENT_HITL_TOOL_NAME}(——契约里的工具名与引擎漂移了`,
    ).toBe(true);
  });

  it("契约里的参数名，逐字等于 tools.py 那个函数的签名（config 除外）", () => {
    const src = readPy(TOOLS_PY);
    const match = new RegExp(`def\\s+${DEEP_AGENT_HITL_TOOL_NAME}\\s*\\(([^)]*)\\)`).exec(src);
    expect(match, `解析不出 ${DEEP_AGENT_HITL_TOOL_NAME} 的签名`).not.toBeNull();

    const pyParams = (match?.[1] ?? "")
      .split(",")
      .map((p) => p.trim().split(":")[0]?.trim() ?? "")
      .filter((p) => p !== "" && p !== "config");

    const tsParams = Object.keys(DeepAgentHitlToolArgs.shape);
    expect([...pyParams].sort()).toEqual([...tsParams].sort());
  });

  it("被它取代的 send_email 已经不再是任何一侧的事实", () => {
    // 反向断言：这个名字曾经同时写死在前端与替身里，而引擎全树零命中。
    // 它若重新出现在 tools.py 里，说明有人真的加了这个工具，本契约需要重新评估。
    expect(readPy(TOOLS_PY)).not.toContain("send_email");
    expect(DEEP_AGENT_HITL_TOOL_NAME).not.toBe("send_email");
  });

  it("Phase 14 F02（R6）：契约里的工具名，逐字出现在 harness.py 固定的 DEFAULT_HITL_TOOL_NAMES 清单里", () => {
    // `DEEP_AGENT_HITL_TOOLS` 这个环境变量开关已移除（验证稳定后默认开启且开关本身
    // 移除）——`build_interrupt_on` 不再按逗号解析环境变量，而是无条件返回
    // `DEFAULT_HITL_TOOL_NAMES` 这份固定清单。这里断言契约里的工具名确实是其中之一，
    // 键名漂了/被移出清单这里都要红。
    const src = readPy(HARNESS_PY);
    expect(stripComments(src), "harness.py 的真代码里不应再读这个已移除的环境变量").not.toContain("DEEP_AGENT_HITL_TOOLS");
    const match = /DEFAULT_HITL_TOOL_NAMES:\s*tuple\[str, \.\.\.\]\s*=\s*\(([\s\S]*?)\)/.exec(src);
    expect(match, "harness.py 里找不到 DEFAULT_HITL_TOOL_NAMES 的定义").not.toBeNull();
    expect(match?.[1] ?? "").toContain(`"${DEEP_AGENT_HITL_TOOL_NAME}"`);
  });

  it("provision.sh / deploy.sh 的真代码里不再出现 DEEP_AGENT_HITL_TOOLS 这个已移除的开关符号", () => {
    // Phase 14 F02（R6）：这个开关本身已从代码库移除，不再作为部署投影项存在——
    // 固定工具清单改由 harness.py 的 DEFAULT_HITL_TOOL_NAMES 常量承担（见上一条）。
    // 剥注释再断言：符号名字作为历史沿革仍合法出现在解释"为什么移除"的注释里。
    expect(stripComments(readPy(PROVISION_SH))).not.toContain("DEEP_AGENT_HITL_TOOLS");
    const deploySh = readPy(resolve(HERE, "../../../.harness/scripts/vm/deploy.sh"));
    expect(stripComments(deploySh)).not.toContain("DEEP_AGENT_HITL_TOOLS");
  });

  it("args 上限足够容纳会被 JSON.parse 的真实长参数", () => {
    // 500 是普通工具的截断档（`PROGRESS_SUMMARY_MAX_CHARS`），对要被解析的待批 args
    // 不够用——这条锁住"别退回 500"。
    expect(DEEP_AGENT_HITL_ARGS_MAX_CHARS).toBeGreaterThan(500);
  });

  it("参数 schema 拒绝 send_email 的旧形状", () => {
    expect(DeepAgentHitlToolArgs.safeParse({ to: "a@b.c", subject: "s", body: "b" }).success).toBe(false);
    expect(DeepAgentHitlToolArgs.safeParse({ skill_stable_name: "s", task: "t" }).success).toBe(true);
  });
});
