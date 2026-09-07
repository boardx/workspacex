/**
 * Phase 14 F02（R6 后置条件）—— `deep-agent-service` 六项能力开关默认开启并移除
 * 开关本身：subagents / async-subtasks / task-auto-classify / precompletion-checklist /
 * hitl-tools / checkpoint-db。
 *
 * 这是静态扫描 + 结构性断言，不是行为测试（行为覆盖在
 * `apps/deep-agent-service/tests/test_harness.py`/`test_tools.py`，那是 Python 侧的
 * pytest 套件，跨语言边界靠这份门控直接读 `.py`/`.sh` 源文件断言，不是 import——同
 * `packages/contracts/tests/deep-agent-hitl.test.ts` 的既有纪律）：
 *
 * ① 六个开关符号（`packages/contracts/src/kernel-gateway.ts` 的
 *    `DEEP_AGENT_REMOVED_FLAG_NAMES`，单一事实源，不在本文件重复写字面量）逐一在
 *    真代码（剥掉注释后）里断言消失或仍存在——**五个**（subagents/async-subtasks/
 *    task-auto-classify/precompletion-checklist/hitl-tools）必须真的消失；
 *    `DEEP_AGENT_CHECKPOINT_DB` 是唯一的例外，原因见下方"诚实的范围收窄"一节。
 * ② 曾经被这五个开关保护的代码路径，现在必须无条件可达（不是"进了函数但内部判断
 *    为 no-op"，是分支/条件本身消失）。
 *
 * ## 诚实的范围收窄：`DEEP_AGENT_CHECKPOINT_DB` 为什么不在本次移除范围内
 *
 * 另外五个开关都是纯粹的能力布尔开关（未设 = 完全等同接线前，语义上可以直接删掉
 * 条件分支、让能力恒定生效）。`DEEP_AGENT_CHECKPOINT_DB` 不是——它是 Postgres DSN，
 * 语义是"这个进程跑在哪种部署拓扑下"：
 * - 平台托管环境（本仓当前唯一真实部署的拓扑）：`Dockerfile` 的 CMD 固定是
 *   `langgraph dev`，由它自带 checkpointer；`build_checkpointer()` 返回 `None` 是
 *   **正确行为**，不是"能力被关掉了"。
 * - 自托管环境：需要一个真实、可连接的 Postgres DSN；`harness.py` 的
 *   `build_interrupt_on` 文档也说明 HITL 中断依赖这个 checkpointer。
 *
 * 把这一项也强改成"无条件生效"，唯一诚实的做法是让 `build_checkpointer()` 在缺少
 * DSN 时直接报错（不再允许 `None` 这个分支），但本仓当前唯一部署的拓扑（platform
 * -hosted，`provision.sh` 显式把这一项留空）依赖的正是"缺 DSN 时优雅返回 None、
 * 交给 `langgraph dev` 自己管"这条路径——在没有真实 Postgres 基础设施可供这个服务
 * 连接、且本会话没有可用于验证生产部署的 Docker/网络环境（与本 phase 其它 sprint
 * 会话撞到的同一类环境限制）之前，贸然让它 fail-closed 会在下一次部署时让平台托管
 * 环境的容器直接起不来——这是比"某个能力没有默认打开"严重得多的倒退，不符合
 * `user_visible_behavior` 明确写的"无用户可感知的行为倒退"。
 *
 * 因此本次改动对 `DEEP_AGENT_CHECKPOINT_DB` **不做代码改动**，保留原有的
 * "缺省即 None、fail-closed 只在 DSN 设了但连不上时触发"语义，下面用一条专门的
 * 测试机械看守这个范围决定本身保持诚实可见（而不是静默漏掉），并把它记在
 * `phases/phase-14-agent-kernel-unification/sprints/sprint-01/session-handoff.md`
 * 供后续会话（尤其是能拿到真实 Postgres 基础设施与部署验证环境的会话）接手评估：
 * 复用 `apps/api` 已有的 Postgres 实例、把 DSN 投影进 deep-agent 容器、并在真实部署
 * 环境里验证 `langgraph dev` 与显式 `PostgresSaver` 不冲突之后，再让这一项也无条件
 * 生效并把符号本身删掉。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kernelGateway } from "@repo/contracts";

const { DEEP_AGENT_REMOVED_FLAG_NAMES } = kernelGateway;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const HARNESS_PY = resolve(REPO_ROOT, "apps/deep-agent-service/src/deep_agent_service/harness.py");
const TOOLS_PY = resolve(REPO_ROOT, "apps/deep-agent-service/src/deep_agent_service/tools.py");
const PROVISION_SH = resolve(REPO_ROOT, ".harness/scripts/vm/provision.sh");
const DEPLOY_SH = resolve(REPO_ROOT, ".harness/scripts/vm/deploy.sh");

function readSrc(path: string): string {
  const src = readFileSync(path, "utf8");
  expect(src.length, `${path} 读到空内容——路径漂了`).toBeGreaterThan(200);
  return src;
}

/** 剥掉 Python `#` 行注释与 `"""..."""`/`'''...'''` 三引号文档字符串，只留下真代码
 * 用来做符号扫描——这五个符号名字本身作为历史沿革仍然合法地出现在"这是什么、
 * 为什么被移除"的注释/docstring 里（本文件自己头注也是这样处理的先例，见
 * `execute-run-thin-gateway.test.ts`），剥注释是为了不被这类合法的历史文档误伤。
 * 够用即可，不处理字符串字面量里恰好含 `#`/三引号的边界情况——这两个源文件里
 * 没有这种字面量出现在会话入我们扫描的符号名附近。 */
function stripPyComments(source: string): string {
  return source
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/#[^\n]*/g, "");
}

/** 剥掉 bash `#` 行注释（同上，够用即可）。 */
function stripShComments(source: string): string {
  return source.replace(/#[^\n]*/g, "");
}

const REMOVED_FLAG_NAMES = DEEP_AGENT_REMOVED_FLAG_NAMES.filter(
  (name) => name !== "DEEP_AGENT_CHECKPOINT_DB",
);

describe("Phase 14 F02（R6）—— deep-agent-service 五项能力开关已从真代码消失", () => {
  it("`DEEP_AGENT_REMOVED_FLAG_NAMES` 逐字等于 R6 点名的六个符号（单一事实源没有漂）", () => {
    expect([...DEEP_AGENT_REMOVED_FLAG_NAMES].sort()).toEqual(
      [
        "DEEP_AGENT_SUBAGENTS_ENABLED",
        "DEEP_AGENT_ASYNC_SUBTASKS_ENABLED",
        "DEEP_AGENT_TASK_AUTO_CLASSIFY",
        "DEEP_AGENT_PRECOMPLETION_CHECKLIST",
        "DEEP_AGENT_HITL_TOOLS",
        "DEEP_AGENT_CHECKPOINT_DB",
      ].sort(),
    );
  });

  it.each(REMOVED_FLAG_NAMES)("%s 不再以真代码（非注释）的形态出现在 harness.py / tools.py", (flagName) => {
    const harnessCode = stripPyComments(readSrc(HARNESS_PY));
    const toolsCode = stripPyComments(readSrc(TOOLS_PY));
    expect(harnessCode, `${flagName} 仍出现在 harness.py 的真代码里`).not.toContain(flagName);
    expect(toolsCode, `${flagName} 仍出现在 tools.py 的真代码里`).not.toContain(flagName);
  });

  it.each(REMOVED_FLAG_NAMES)("%s 不再出现在部署脚本 provision.sh / deploy.sh 的真代码里", (flagName) => {
    const provisionCode = stripShComments(readSrc(PROVISION_SH));
    const deployCode = stripShComments(readSrc(DEPLOY_SH));
    expect(provisionCode, `${flagName} 仍出现在 provision.sh 的真代码里`).not.toContain(flagName);
    expect(deployCode, `${flagName} 仍出现在 deploy.sh 的真代码里`).not.toContain(flagName);
  });

  it("subagents（DA-05）：`build_subagents` 无条件返回子代理清单，函数体里没有任何提前 return 分支", () => {
    const code = stripPyComments(readSrc(HARNESS_PY));
    const match = /def build_subagents\(model: BaseChatModel\) -> list\[dict\]:([\s\S]*?)\n\n\n/.exec(code);
    expect(match, "harness.py 里找不到 build_subagents 的函数体").not.toBeNull();
    const body = match?.[1] ?? "";
    expect(body).not.toMatch(/return None/);
    expect(body).not.toMatch(/if\s+.*:\s*\n\s*return/);
  });

  it("hitl-tools（DA-07）：`build_interrupt_on` 无条件返回固定四工具清单，返回类型不再是可选的 None", () => {
    const code = stripPyComments(readSrc(HARNESS_PY));
    // issue #2767 -- 返回类型从 `dict[str, bool]` 加宽到 `dict[str, bool | InterruptOnConfig]`：
    // `call_skill` 现在覆盖成带 `when` 谓词的 `InterruptOnConfig`（按目标 skill 的风险等级
    // 决定是否 interrupt），其余三个具名虚拟工具仍是裸 `True`。本条锁的是"无条件返回、
    // 不是 Optional"这件事，不是"值类型必须是纯 bool"——加宽值类型不违反这条锁的本意。
    expect(code).toMatch(/def build_interrupt_on\(\) -> dict\[str, bool \| InterruptOnConfig\]:/);
    expect(code).toMatch(/DEFAULT_HITL_TOOL_NAMES/);
    expect(code).toMatch(/"call_skill"/);
    expect(code).toMatch(/"confirm_task_intent"/);
    expect(code).toMatch(/"fill_run_params"/);
    expect(code).toMatch(/"choose_execution_option"/);
  });

  it("task-auto-classify（DA-13）：`TaskClassifierMiddleware()` 无条件出现在 `build_middleware()` 返回列表里，不再是条件展开的数组", () => {
    const code = stripPyComments(readSrc(HARNESS_PY));
    const buildMiddleware = /def build_middleware\(model: BaseChatModel(?:, \*, backend: BackendProtocol \| None = None)?\) -> list\[AgentMiddleware\]:([\s\S]*?)\ndef /.exec(code);
    expect(buildMiddleware, "harness.py 里找不到 build_middleware 的函数体").not.toBeNull();
    const body = buildMiddleware?.[1] ?? "";
    expect(body).toMatch(/\n\s*TaskClassifierMiddleware\(\),/);
    expect(body).not.toMatch(/\*\(\[TaskClassifierMiddleware/);
  });

  it("precompletion-checklist（D7）：`_DefaultCompletionChecklistMiddleware()` 无条件进入 `build_precompletion_middleware` 的种子列表", () => {
    const code = stripPyComments(readSrc(HARNESS_PY));
    const match = /def build_precompletion_middleware\(model: BaseChatModel\) -> list\[AgentMiddleware\]:([\s\S]*?)\n\n\n/.exec(code);
    expect(match, "harness.py 里找不到 build_precompletion_middleware 的函数体").not.toBeNull();
    const body = match?.[1] ?? "";
    expect(body).toMatch(/seed: list\[AgentMiddleware\] = \[_DefaultCompletionChecklistMiddleware\(\)\]/);
    expect(body).not.toMatch(/if\s+enabled/);
  });

  it("async-subtasks（#2664）：`spawn_async_task` 无条件出现在 `build_tools()` 返回的工具列表里", () => {
    const code = stripPyComments(readSrc(TOOLS_PY));
    const match = /return \[\s*list_org_skills,[\s\S]*?\]/.exec(code);
    expect(match, "tools.py 里找不到 build_tools 无条件返回的工具列表").not.toBeNull();
    expect(match?.[0] ?? "").toContain("spawn_async_task");
  });
});

describe("Phase 14 F02（R6）—— DEEP_AGENT_CHECKPOINT_DB 是记录在案的诚实范围收窄，不是遗漏", () => {
  it("`DEEP_AGENT_CHECKPOINT_DB` 仍然存在（部署拓扑参数，非能力开关——见本文件头注）", () => {
    const code = stripPyComments(readSrc(HARNESS_PY));
    expect(code).toContain("DEEP_AGENT_CHECKPOINT_DB");
  });

  it("这个范围决定写在 harness.py 自己的注释里，不是只存在于本测试文件（避免「同一事实两处声明」漂移）", () => {
    const src = readSrc(HARNESS_PY);
    const fnIdx = src.indexOf("def build_checkpointer");
    expect(fnIdx, "harness.py 里找不到 build_checkpointer").toBeGreaterThan(-1);
    const docBlock = src.slice(Math.max(0, fnIdx - 400), fnIdx + 600);
    expect(docBlock).toMatch(/自托管|平台托管/);
  });
});
