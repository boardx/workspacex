/**
 * F212（`agent-interrupts` 契约束）—— 跨语言边界门控 + 环境变量投影链条。
 *
 * ⚠ **与 `deep-agent-hitl.test.ts` 的关键差异，如实记录**：那份测试能逐字比对
 * `tools.py` 的 `@tool def call_skill(` 签名，是因为该工具**已经**在 Python 侧实现。
 * 本束三个虚拟工具（`confirm_task_intent`/`fill_run_params`/`choose_execution_option`）
 * **尚未**在 `apps/deep-agent-service` 落地——**实测确认**（`harness.py` 的
 * `build_interrupt_on` 只是「工具名 → 是否中断」的开关字典，`graph.py` 把它与
 * `build_tools()` 注册的工具列表一起传给 `create_deep_agent`；`HumanInTheLoopMiddleware`
 * 0.7.6 实测源码 `human_in_the_loop.py:429` 只在真实工具调用发生时按名字查这个字典，
 * 不会在初始化时校验键是否有对应工具存在——见 `agent-interrupts.ts` 文件头）。这意味着：
 *   - 这三个名字**不是**纯前端可以自己发明的约定——它们最终必须是 Python 侧真实的
 *     `@tool` 函数，模型才有东西可调用、中断才可能真的发生。
 *   - 但它们现在**还不是**——把「Python 侧工具是否存在」写成逐字签名断言现在只会是
 *     故意的红，不是真门控，而且会挡住「只出契约内核」这个 PR 的合并。
 * 所以本测试断言两类事情：① **现在确实为真、且必须为真**的部分（环境变量投影链条）；
 * ② **如实的反向锚点**——三个工具名此刻在 `tools.py` 里确实还不存在。锚点②一旦变红
 * （说明 Python 侧工具已经落地），就是提醒把这条测试换成 `deep-agent-hitl.test.ts`
 * 同款的逐字签名比对，不是本测试的失败。
 *
 * Python 侧 `@tool` 实现登记为**独立于本 issue 的后续 feature**
 * （`phases/phase-01-run-a-project/contracts/agent-interrupts/coverage.md` AI-4b），
 * 不在本次变更范围内。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { AGENT_INTERRUPTS_TOOL_NAME_LIST, AGENT_INTERRUPTS_HITL_TOOLS_ENV_VALUE } from "../../src/agent-interrupts";
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

describe("⚠ 反向锚点：Python 侧尚未实现（AI-4b，超出本轮范围）", () => {
  it("tools.py 现在确实还没有这三个 @tool 函数——一旦这条变红，说明 Python 侧已落地，该把这条测试换成逐字签名比对", () => {
    const src = readSrc(TOOLS_PY);
    for (const name of AGENT_INTERRUPTS_TOOL_NAME_LIST) {
      const pattern = new RegExp(`@tool\\s*\\n\\s*def\\s+${name}\\s*\\(`);
      expect(
        pattern.test(src),
        `tools.py 里出现了 @tool def ${name}(——Python 侧已实现，反向锚点应升级为逐字签名比对`,
      ).toBe(false);
    }
  });
});

describe("环境变量投影链条（AI-5）——惰性安全，不校验 Python 侧是否已注册", () => {
  it("harness.py 确实是读 DEEP_AGENT_HITL_TOOLS 这个键（按逗号分隔）", () => {
    expect(readSrc(HARNESS_PY)).toContain("DEEP_AGENT_HITL_TOOLS");
  });

  it("provision.sh 那一行 = deep-agent-hitl 契约值 + 本束三个工具名的并集，逗号拼接", () => {
    const sh = readSrc(PROVISION_SH);
    const line = sh.split("\n").find((l) => l.startsWith("DEEP_AGENT_HITL_TOOLS="));
    expect(line, "provision.sh 里没有生效的 DEEP_AGENT_HITL_TOOLS= 行").toBeDefined();
    const expected = [DEEP_AGENT_HITL_TOOLS_ENV_VALUE, AGENT_INTERRUPTS_HITL_TOOLS_ENV_VALUE].join(",");
    expect(line).toBe(`DEEP_AGENT_HITL_TOOLS=${expected}`);
  });

  it("deploy.sh 的容器 env 投影白名单里已经有 DEEP_AGENT_HITL_TOOLS 这个键（无需新增，只是值变化）", () => {
    const deploySh = readSrc(DEPLOY_SH);
    const call = /deep_agent_project_capability_env[^\n]*\n[^\n]*/.exec(deploySh)?.[0] ?? "";
    expect(call).toContain("DEEP_AGENT_HITL_TOOLS");
  });
});
