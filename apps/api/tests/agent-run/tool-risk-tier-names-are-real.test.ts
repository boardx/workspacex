/**
 * 风险分级白名单里的**名字本身**必须是真的——两条纯机械断言。
 *
 * ## 为什么这个文件存在（两次真实事故，都是"名字看着像真的"）
 *
 * ① **死名字进了白名单** —— L0 里写的是 `web_fetch`，而执行内核真正注册的工具叫
 *    `fetch_url`（`NATIVE_PROFILE_TOOLS`）。`web_fetch` 谁也匹配不上，`fetch_url` 落进
 *    `classifyToolRisk` 末尾的默认 L2 ⇒ **每次取网页都要人工批准**。分级表看上去有这一
 *    档，实际这一档对任何真实调用都不生效。见 #3160。
 *
 * ② **注释点名了，集合里却没有** —— `tool-risk-tier.ts` 的 L0 注释逐字写着
 *    「`write_todos`（deepagents `TodoListMiddleware` 的规划记账工具）都在这一档」，
 *    但 `L0_READ_ONLY_TOOLS` 里**从来没有过** `write_todos`（`git log -S write_todos`
 *    只有引入这条注释的 5571b867f 一次提交）⇒ 规划记账每调一次弹一次审批框。
 *    这条注释已经连续误导了两个 agent 的排查（#3132 的根因叙述、#3186 的第一手排查）：
 *    **写得越具体的痕迹，读起来越像权威**——这正是它骗人的方式。见 #3186。
 *
 * 两条断言都不看行为、不看意图，只做名字层面的机械核对：
 * · A：显式登记在任一档白名单里的工具名，必须存在于真实工具名全集。
 * · B：某一档的注释里点名的工具，必须真的在那一档的集合里。
 *
 * ## 真实工具名全集怎么来
 *
 * · 原生执行档 `NATIVE_PROFILE_TOOLS`（`application/agent-run/native-invocation.ts`）——
 *   `interrupt_on` 就是逐个 name 喂给 `classifyToolRisk` 算出来的，它是准入表本表。
 * · 远端 deep-agent 图自己的工具（`deep_agent_service/tools.py` 里的 `@tool` 函数）——
 *   从 Python 源码**解析**出来，不在 TS 里再手抄一份名字（手抄的副本正是 ① 的成因）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NATIVE_PROFILE_TOOLS } from "../../src/application/agent-run/native-invocation";
import { classifyToolRisk, RISK_TIER_WHITELISTS } from "../../src/domain/agent-run/tool-risk-tier";

const TIER_SOURCE = fileURLToPath(new URL("../../src/domain/agent-run/tool-risk-tier.ts", import.meta.url));
const PY_TOOLS = fileURLToPath(new URL("../../../deep-agent-service/src/deep_agent_service/tools.py", import.meta.url));

/** `tools.py` 里被 `@tool` 装饰的函数名 = 远端图注册的工具名。 */
function remoteGraphToolNames(): string[] {
  const src = readFileSync(PY_TOOLS, "utf8");
  const names = [...src.matchAll(/@tool\s*(?:\([^)]*\)\s*)?\n\s*def\s+([a-z_][a-z0-9_]*)\s*\(/g)].map(m => m[1]!);
  // 空集防线：解析不出来就是正则失配，全称断言会平凡为真——宁可红。
  expect(names.length).toBeGreaterThan(3);
  return names;
}

function knownToolNames(): Set<string> {
  const universe = new Set<string>([...NATIVE_PROFILE_TOOLS, ...remoteGraphToolNames()]);
  expect(universe.size).toBeGreaterThan(20);
  return universe;
}

describe("工具风险分级白名单里的名字必须是真的", () => {
  it("A：显式登记在任一档的工具名，必须存在于真实工具名全集（死名字 = 这一档对真实调用不生效）", () => {
    const known = knownToolNames();
    const entries = Object.entries(RISK_TIER_WHITELISTS);
    expect(entries.length).toBe(3);
    const dead = entries.flatMap(([tier, names]) =>
      [...names].filter(name => !known.has(name)).map(name => `${tier}:${name}`));
    expect(dead).toEqual([]);
  });

  it("B：某一档注释里点名的工具，必须真的在那一档的集合里（注释与集合是同一个事实的两处声明）", () => {
    const known = knownToolNames();
    const src = readFileSync(TIER_SOURCE, "utf8");
    const mismatches: string[] = [];
    let checkedBlocks = 0;
    for (const tier of Object.keys(RISK_TIER_WHITELISTS)) {
      // 该档常量声明之前、紧邻的那个注释块。
      const declIndex = src.indexOf(`const ${tier}_`);
      expect(declIndex, `找不到 ${tier} 的常量声明——文件结构变了，拒绝判绿`).toBeGreaterThan(-1);
      const commentStart = src.lastIndexOf("/*", declIndex);
      expect(commentStart, `${tier} 前面没有注释块——拒绝判绿`).toBeGreaterThan(-1);
      const block = src.slice(commentStart, declIndex);
      checkedBlocks += 1;
      // 只挑注释里那些**确实是真实工具名**的反引号 token；`TodoListMiddleware`、
      // 文件路径之类不是工具名，本条不管它们（它们由 A 之外的常识负责）。
      for (const match of block.matchAll(/`([^`]+)`/g)) {
        const token = match[1]!;
        if (!known.has(token)) continue;
        if (!(RISK_TIER_WHITELISTS as Record<string, ReadonlySet<string>>)[tier]!.has(token)) {
          mismatches.push(`${tier} 的注释点名了 ${token}，但 ${tier} 的集合里没有它`);
        }
      }
    }
    expect(checkedBlocks).toBe(3);
    expect(mismatches).toEqual([]);
  });

  /**
   * A/B 只管名字。这一条管**后果**：修完之后，两个工具在真实原生执行档里必须不再触发
   * 审批打断。`interrupt_on` 就是 `native-invocation.ts` 第 56 行那句
   * `classifyToolRisk(name) === "L2"`——所以这里直接照它复算一遍。
   */
  it("落点：fetch_url / write_todos 在原生执行档里不再触发审批打断，execute / call_skill 照旧触发", () => {
    const interruptOn = Object.fromEntries(NATIVE_PROFILE_TOOLS.map(name => [name, classifyToolRisk(name) === "L2"]));
    expect(interruptOn["fetch_url"]).toBe(false);
    expect(interruptOn["write_todos"]).toBe(false);
    expect(classifyToolRisk("fetch_url")).toBe("L0");
    expect(classifyToolRisk("write_todos")).toBe("L0");
    // 反证：放宽的只是这两个，命令执行与技能调用没被顺手放行。
    expect(interruptOn["execute"]).toBe(true);
    expect(classifyToolRisk("execute")).toBe("L2");
    expect(classifyToolRisk("call_skill")).toBe("L2");
    // 未登记的工具仍然最保守（I-1 没有例外）。
    expect(classifyToolRisk("totally_unknown_tool")).toBe("L2");
  });
});
