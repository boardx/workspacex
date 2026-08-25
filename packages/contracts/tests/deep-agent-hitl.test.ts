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

  it("deploy.env 该写的逐字值，正是 harness.py 逗号分隔解析得回来的东西", () => {
    // `build_interrupt_on` 读 DEEP_AGENT_HITL_TOOLS，按逗号切、每项 strip。
    // 这里模拟它的解析，断言我们给运维的那个值解析回来就是契约里的工具名集合。
    const parsed = DEEP_AGENT_HITL_TOOLS_ENV_VALUE.split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");
    expect(parsed).toEqual([DEEP_AGENT_HITL_TOOL_NAME]);

    // 并且 harness.py 确实是读这个 env 键——键名漂了这里也要红。
    expect(readPy(HARNESS_PY)).toContain("DEEP_AGENT_HITL_TOOLS");
  });

  it("deploy.env 模板（provision.sh）里那一行，逐字等于契约给的值", () => {
    // bash 没法 import TS，所以 provision.sh 里那一行是契约在部署侧的**投影**。
    // 凡投影就会漂，所以这条门控直接读那个 .sh 断言逐字一致。
    const sh = readPy(PROVISION_SH);
    const line = sh
      .split("\n")
      .find((l) => l.startsWith("DEEP_AGENT_HITL_TOOLS="));
    expect(line, "provision.sh 里没有生效的 DEEP_AGENT_HITL_TOOLS= 行（被注释掉了？）").toBeDefined();
    expect(line).toBe(`DEEP_AGENT_HITL_TOOLS=${DEEP_AGENT_HITL_TOOLS_ENV_VALUE}`);
  });

  it("该键在 deploy.sh 的容器 env 投影白名单里——否则写了也到不了引擎", () => {
    // issue #2076/#2077 实测：deep-agent 容器读的是 deploy.sh 当场重写的
    // deep-agent.env，白名单外的键无论 deploy.env 里怎么写都到不了容器进程。
    // 「配置文件里有这一行 ≠ 进程真的读到了它」——这条门控守的就是那个断层。
    const deploySh = readPy(resolve(HERE, "../../../.harness/scripts/vm/deploy.sh"));
    const call = /deep_agent_project_capability_env[^\n]*\n[^\n]*/.exec(deploySh)?.[0] ?? "";
    expect(call).toContain("DEEP_AGENT_HITL_TOOLS");
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
