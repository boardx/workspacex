/**
 * 反向门控（#3302）：**每一件真实派发的工具都必须被显式分级**，落进
 * `classifyToolRisk` 末尾的兜底 `L2` 即判失败。
 *
 * ## 为什么单独加这一条
 *
 * 已有的 `tool-risk-tier-names-are-real.test.ts` 只断言**一个方向**：白名单里的名字必须
 * 真实存在（死名字 ⇒ 红）。它对**漏登记**完全无感——一件新工具不进任何一档，兜底
 * 静默把它判成 L2，测试照绿，用户在 devapp 上每调一次弹一次审批框。同一形状已经出过
 * 三次：#3160（`fetch_url`）、#3186（`write_todos`），以及 #3301 的盘点——45 件原生工具里
 * **22 件从未登记**，28/45 每次调用都打断。
 *
 * 兜底不是"判断结果是 L2"，是"没人判断过"。两者在行为上偶尔同向（`sql_db_query` 确实
 * 该 L2），但在**只读工具**上就是纯粹的伤害（`sql_db_list_tables` / `web_search`）。所以
 * 本门控要的不是"最终等级对不对"，而是"有没有人显式写下这一档"。
 *
 * ## 门控的边界（说清楚，不假装覆盖）
 *
 * 覆盖：`NATIVE_PROFILE_TOOLS`（原生执行档准入表本表，`interrupt_on` 就是逐个喂给
 * `classifyToolRisk` 算出来的）+ `deep_agent_service/tools.py` 里 `@tool` 注册的远端图工具
 * （远端路径经 `tool-permission-gate.ts` → `classifyToolCallRisk` → `classifyToolRisk`）。
 * 两者都可以在**编译期静态枚举**，所以可以做全称断言。
 *
 * **不覆盖：组织自己接的 MCP 工具。** 它们的名字来自运行时快照（`McpExecutionSnapshot`），
 * 按组织配置而变，静态枚举不出来。但它们也**不经过** `classifyToolRisk`：
 * `pg-native-session-owner.ts` 的 `provision` 把快照里每一件工具**无条件**并成
 * `interrupt_on = true`。也就是说 MCP 侧的策略是"一律打断"，与本分级表解耦——这就是
 * 边界这样切的理由。下面第三条断言把这个前提**机械钉住**：哪天有人把 MCP 改成走
 * `classifyToolRisk`，这条会红，边界必须重新论证，而不是悄悄失守。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NATIVE_PROFILE_TOOLS } from "../../src/application/agent-run/native-invocation";
import { RISK_TIER_WHITELISTS } from "../../src/domain/agent-run/tool-risk-tier";

const PY_TOOLS = fileURLToPath(new URL("../../../deep-agent-service/src/deep_agent_service/tools.py", import.meta.url));
const OWNER_SOURCE = fileURLToPath(new URL("../../src/infrastructure/agent-run/pg-native-session-owner.ts", import.meta.url));

function remoteGraphToolNames(): string[] {
  const src = readFileSync(PY_TOOLS, "utf8");
  const names = [...src.matchAll(/@tool\s*(?:\([^)]*\)\s*)?\n\s*def\s+([a-z_][a-z0-9_]*)\s*\(/g)].map(m => m[1]!);
  // 空集防线：解析不出来就是正则失配，全称断言会平凡为真——宁可红。
  expect(names.length).toBeGreaterThan(3);
  return names;
}

/** 显式登记的名字全集 = 三档白名单的并。刻意**不**用 `classifyToolRisk`：它有兜底，
 * 用它来判"有没有登记"就是拿被测对象给自己作证。 */
function explicitlyClassified(): Set<string> {
  const tiers = Object.values(RISK_TIER_WHITELISTS);
  expect(tiers.length).toBe(3);
  return new Set(tiers.flatMap(names => [...names]));
}

describe("每一件真实派发的工具都必须被显式分级（兜底 L2 = 没人判断过，判红）", () => {
  it("A：原生执行档 NATIVE_PROFILE_TOOLS 的每个名字都显式登记在某一档", () => {
    expect(NATIVE_PROFILE_TOOLS.length).toBeGreaterThan(30); // 空集防线
    const explicit = explicitlyClassified();
    const unclassified = NATIVE_PROFILE_TOOLS.filter(name => !explicit.has(name));
    expect(unclassified, `这些工具没有被显式分级，会静默落进兜底 L2（每次调用弹审批框）：${unclassified.join(", ")}`).toEqual([]);
  });

  it("B：远端 deep-agent 图注册的 @tool 也必须显式分级（远端路径同样走 classifyToolRisk）", () => {
    const explicit = explicitlyClassified();
    const unclassified = remoteGraphToolNames().filter(name => !explicit.has(name));
    expect(unclassified, `远端图工具未显式分级：${unclassified.join(", ")}`).toEqual([]);
  });

  it("C：边界前提——MCP 工具不走分级表，而是在 provision 里被无条件设为打断", () => {
    const src = readFileSync(OWNER_SOURCE, "utf8");
    // 就是 provision 里那句 `...Object.fromEntries((snapshot?.tools??[]).map(tool=>[tool.name,true]))`。
    expect(src, "pg-native-session-owner 不再无条件把 MCP 快照工具设为 true——本门控声明的边界失效了，必须重新论证覆盖范围")
      .toMatch(/snapshot\?\.tools\s*\?\?\s*\[\]\)\.map\(tool\s*=>\s*\[tool\.name\s*,\s*true\]\)/);
    expect(src).not.toMatch(/classifyToolRisk/);
  });

  /** 落点：修完之后只剩下真正该打断的那些工具会打断，只读的几件不再弹框。
   *
   * ⚠ 这条断言最初还点名了三件 SQL 面（`sql_db_list_tables` / `sql_db_schema` /
   * `sql_db_query_checker`）为 L0——那是**只按工具语义**推的，撞上了仓里既有的一条
   * 具名生产授权链断言：`standard-sql-source-real-db.test.ts` 要求未授权的
   * `sql_db_list_tables` 必须 503。三件 SQL 面共用 `/sql/source/check` 这一道
   * **数据源准入**，风险单位是"接上一个外部数据库"而不是读/写，所以它们整体留在 L2
   * （显式登记，行为与本 PR 之前逐字相同）。同理 `wx_memory_write` 被
   * `standard-memory-real-db.test.ts` 钉在 L2。 */
  it("落点：只读工具不再触发审批打断，危险工具照旧触发", () => {
    const { L0, L2 } = RISK_TIER_WHITELISTS;
    for (const name of ["wx_schedule_list", "web_search", "wx_audio_transcribe", "task"]) {
      expect(L0.has(name), `${name} 按性质只读，不该打断`).toBe(true);
    }
    // 外部数据源准入与记忆写：由既有的具名授权链断言判定，不按工具语义放宽。
    for (const name of ["sql_db_list_tables", "sql_db_schema", "sql_db_query_checker", "wx_memory_write"]) {
      expect(L2.has(name), `${name} 由既有生产授权链断言钉在 L2`).toBe(true);
    }
    // 反证：放宽的只是只读面，写面/执行面没被顺手放行。
    for (const name of ["sql_db_query", "execute", "delete", "wx_memory_delete", "wx_schedule_create", "wx_schedule_cancel",
      "confirm_task_intent", "fill_run_params", "choose_execution_option"]) {
      expect(L2.has(name), `${name} 必须留在 L2`).toBe(true);
    }
  });
});
