import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentKernelRunStatus } from "../../src/streaming-transport";
import { AgentRunStatus } from "../../src/wave2-runtime";

/**
 * Phase 14 F06（`plan-permissions` 契约束 R8）—— "`awaiting_tool_permission` 是本 phase
 * 唯一的'工具调用需人工表态'状态，取代现状代码中的 `awaiting_approval`（旧名废弃，
 * 语义统一，避免状态机出现两个含义重叠的分支）"。
 *
 * 三条断言，从"新名字都在"到"旧名字哪儿都不在"：
 * ① `AgentKernelRunStatus`（`streaming-transport.ts`，新状态机权威）含
 *    `awaiting_plan_confirmation`/`awaiting_tool_permission`。
 * ② `AgentRunStatus`（`wave2-runtime.ts`，DA-07b 起家的旧状态机，F06 迁到新名字）
 *    含 `awaiting_tool_permission`、且不再含 `awaiting_approval`。
 * ③ 静态扫描 `packages/contracts/src` 全部源文件（剥掉注释——历史沿革允许在讲述
 *    "这是什么改名而来"时提到旧名字，同 `execute-run-thin-gateway.test.ts` 的既有
 *    先例）：真代码里不再有 `awaiting_approval` 这个字面量，不留半个分支。
 */

describe("Phase 14 F06 -- awaiting_approval 旧名废弃，awaiting_tool_permission 统一取代", () => {
  it("①`AgentKernelRunStatus` 含 awaiting_plan_confirmation 与 awaiting_tool_permission", () => {
    expect(AgentKernelRunStatus.options).toContain("awaiting_plan_confirmation");
    expect(AgentKernelRunStatus.options).toContain("awaiting_tool_permission");
  });

  it("①`AgentKernelRunStatus` 不含旧名 awaiting_approval", () => {
    expect(AgentKernelRunStatus.options).not.toContain("awaiting_approval");
  });

  it("②`AgentRunStatus`（DA-07b 起家的旧状态机）已迁到 awaiting_tool_permission", () => {
    expect(AgentRunStatus.options).toContain("awaiting_tool_permission");
  });

  it("②`AgentRunStatus` 不再含旧名 awaiting_approval——二者不并存", () => {
    expect(AgentRunStatus.options).not.toContain("awaiting_approval");
  });

  it("③ 真代码里（剥注释后）不存在 awaiting_approval 这个字面量，一处都不留", () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const SRC_DIR = resolve(HERE, "../../src");
    const offenders: string[] = [];
    for (const file of readdirSync(SRC_DIR)) {
      if (!file.endsWith(".ts")) continue;
      const path = resolve(SRC_DIR, file);
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/awaiting_approval/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
