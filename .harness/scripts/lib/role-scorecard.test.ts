/**
 * role-scorecard 的门控反证。
 *
 * 本仓的规矩（AGENTS.md / 记忆纪律）：**写完门控立刻造反证**——
 * 每一道门都必须实测过「把它拆掉，这里会红」。已九次栽在「全绿但空转」上，
 * 一道不会红的门比没有门更糟，因为它提供虚假的安全感。
 *
 * 下面每个 `it` 都对着**一道具体的门**，注释里写明拆哪一行会让它变红。
 */
import { describe, it, expect } from "vitest";
import {
  validateCharter,
  buildScorecard,
  classifyBlockers,
  nextActionFor,
  FORBIDDEN_CHARTER_FIELDS,
  type CharterFile,
  type TrackVerdictLike,
} from "./role-scorecard";

const ROLES = new Set(["rev-e2e", "coord-main", "dev-chat-e2e"]);
const ITEMS = new Map([["R", 10], ["B", 10], ["V-D", 10], ["V-P", 10]]);
const THRESHOLD = 9;  // = PASS_THRESHOLD（人类 #831 裁决），S6 把两处钉死

function charter(roles: CharterFile["roles"]): CharterFile {
  return { version: 1, roles };
}

describe("charter 的四道门", () => {
  it("健康的 charter 零违规（正样本——没有它，下面每条都可能因为别的原因红）", () => {
    const v = validateCharter(
      charter({ "rev-e2e": { mission: "可达性与行为体验", owns: [{ kind: "clr_track", id: "R", target: 9, target_source: "人类裁决 #831" }] } }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toEqual([]);
  });

  // 拆掉 `if (!knownRoleIds.has(role))` 那一行 ⇒ 本条红。
  it("S2 反证：charter 里的角色不在 registry.yaml ⇒ UNKNOWN_ROLE", () => {
    const v = validateCharter(
      charter({ "ghost-role": { mission: "不存在的人", owns: [{ kind: "clr_track", id: "R", target: 9, target_source: "人类裁决 #831" }] } }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({ code: "UNKNOWN_ROLE", role: "ghost-role" });
  });

  // 拆掉 `NO_OWNED_ITEMS` 那一段 ⇒ 本条红。
  // ⚠ 这条挡的是「声明了一个角色但不给它任何可评项」——那样它会永远 met=true，
  //   看起来达标其实从未被测量。空着不等于达标。
  it("S1 反证：owns 为空 ⇒ NO_OWNED_ITEMS（不是默认达标）", () => {
    const v = validateCharter(
      charter({ "rev-e2e": { mission: "空壳", owns: [] } }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({ code: "NO_OWNED_ITEMS", role: "rev-e2e" });
  });

  // 拆掉 FORBIDDEN_CHARTER_FIELDS 那两个循环 ⇒ 本条红。
  // ⚠ 这是本文件**最重要**的一道门：charter 一旦能写现状分，就出现了第二个事实源，
  //   而漂移永远往「看起来达标」的方向走。
  it.each(FORBIDDEN_CHARTER_FIELDS)("S3 反证：charter 角色层出现现状字段 %s ⇒ 判红", (field) => {
    const v = validateCharter(
      charter({
        "rev-e2e": {
          mission: "偷偷写现状分", owns: [{ kind: "clr_track", id: "R", target: 9, target_source: "人类裁决 #831" }],
          [field]: 10,
        } as never,
      }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({ code: "CURRENT_SCORE_IN_CHARTER", role: "rev-e2e", field });
  });

  it("S3 反证（item 层）：owns 的条目里也不许出现现状字段", () => {
    const v = validateCharter(
      charter({
        "rev-e2e": {
          mission: "偷偷写现状分",
          owns: [{ kind: "clr_track", id: "R", target: 9, target_source: "人类裁决 #831", score: 10 } as never],
        },
      }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({ code: "CURRENT_SCORE_IN_CHARTER", role: "rev-e2e", field: "score" });
  });

  // 拆掉 `if (max === undefined)` ⇒ 本条红。
  it("S4 反证：owns 指向一个不存在的 item ⇒ UNKNOWN_ITEM（防指向虚空）", () => {
    const v = validateCharter(
      charter({ "rev-e2e": { mission: "指向虚空", owns: [{ kind: "clr_track", id: "NOPE", target: 9, target_source: "人类裁决 #831" }] } }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({ code: "UNKNOWN_ITEM", role: "rev-e2e", item: "NOPE" });
  });

  // 拆掉 S7 那段 ⇒ 本条红。
  it("S7 反证：目标分没写出处 ⇒ TARGET_SOURCE_MISSING（决策必须可追溯到做决定的人）", () => {
    const v = validateCharter(
      charter({ "rev-e2e": { mission: "来路不明的目标", owns: [{ kind: "clr_track", id: "R", target: 9 } as never] } }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({ code: "TARGET_SOURCE_MISSING", role: "rev-e2e", item: "R" });
  });

  // 拆掉 S6 那段 ⇒ 本条红。
  it("S6 反证：charter 的 target 与 CLR 的 PASS_THRESHOLD 漂移 ⇒ 判红（允许重复，机械钉死）", () => {
    const v = validateCharter(
      charter({ "rev-e2e": { mission: "偷偷调低目标", owns: [{ kind: "clr_track", id: "R", target: 6, target_source: "人类裁决 #831" }] } }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({
      code: "TARGET_DRIFTS_FROM_AUTHORITY", role: "rev-e2e", item: "R", charter: 6, authority: 9,
    });
  });

  // 拆掉 target 范围检查 ⇒ 本条红。
  it("S5 反证：target 超出 [0,max] ⇒ TARGET_OUT_OF_RANGE（不可达的目标 = 门废掉）", () => {
    const v = validateCharter(
      charter({ "rev-e2e": { mission: "永远达不到", owns: [{ kind: "clr_track", id: "R", target: 11, target_source: "人类裁决 #831" }] } }),
      ROLES, ITEMS, THRESHOLD,
    );
    expect(v).toContainEqual({ code: "TARGET_OUT_OF_RANGE", role: "rev-e2e", item: "R" });
  });
});

describe("现状分只能派生", () => {
  const identity = { kind: "quality-reviewer", reportsTo: "coord-main" };
  const verdicts = new Map<string, TrackVerdictLike>([
    ["R", { id: "R", name: "可达性", effectiveScore: 7, discounts: [], blockingIssues: [877] }],
    ["B", { id: "B", name: "行为体验", effectiveScore: 0, discounts: ["STALE"], blockingIssues: [884] }],
  ]);

  it("current 取的是 effectiveScore —— 于是 CLR 的 G1-G6 自动继承，不重复实现", () => {
    const sc = buildScorecard(
      "rev-e2e",
      { mission: "m", owns: [{ kind: "clr_track", id: "B", target: 9, target_source: "人类裁决 #831" }] },
      identity, verdicts,
    );
    // B 记录分是 6，但被 STALE 扣成 0 ⇒ 这里必须是 0，不是 6。
    expect(sc.items[0]?.current).toBe(0);
    expect(sc.items[0]?.gap).toBe(9);
    expect(sc.items[0]?.discounts).toContain("STALE");
  });

  // 拆掉 `?? 0` 改成 `continue/skip` ⇒ 本条红。
  it("查不到判定的 item ⇒ current 记 0，而不是跳过（空着不等于满分）", () => {
    const sc = buildScorecard(
      "rev-e2e",
      { mission: "m", owns: [{ kind: "clr_track", id: "V-P", target: 9, target_source: "人类裁决 #831" }] },
      identity, verdicts,
    );
    expect(sc.items[0]?.current).toBe(0);
    expect(sc.items[0]?.discounts).toContain("NO_SUCH_ITEM");
    expect(sc.met).toBe(false);
  });

  it("gap 不为负：超额完成不能用来抵别的项的欠账", () => {
    const sc = buildScorecard(
      "rev-e2e",
      { mission: "m", owns: [
        { kind: "clr_track", id: "R", target: 5, target_source: "人类裁决 #831" },   // 7 ≥ 5，超额 2
        { kind: "clr_track", id: "B", target: 9, target_source: "人类裁决 #831" },   // 0，欠 9
      ] },
      identity, verdicts,
    );
    expect(sc.items[0]?.gap).toBe(0);   // 不是 -2
    expect(sc.totalGap).toBe(9);        // 不是 7
    expect(sc.met).toBe(false);
  });

  it("全部达标才 met=true", () => {
    const sc = buildScorecard(
      "rev-e2e",
      { mission: "m", owns: [{ kind: "clr_track", id: "R", target: 7, target_source: "人类裁决 #831" }] },
      identity, verdicts,
    );
    expect(sc.met).toBe(true);
    expect(sc.totalGap).toBe(0);
  });
});

describe("我在等谁", () => {
  const meta = new Map([
    [877, { state: "OPEN", title: "🔒 需人类签核：agent-instructions delta", labels: [] }],
    [852, { state: "OPEN", title: "组织里没有任何产品路径能任命审核人职能", labels: ["owner:coord-agent-auth"] }],
    [853, { state: "OPEN", title: "createAgendaSegment 零 web 调用方", labels: [] }],
    [660, { state: "CLOSED", title: "已修好的那条", labels: [] }],
  ]);

  it("按显式信号分四类：human / role / unowned / closed", () => {
    expect(classifyBlockers([877, 852, 853, 660], meta)).toEqual([
      { issue: 877, on: "human", title: "🔒 需人类签核：agent-instructions delta" },
      { issue: 852, on: "role", who: "coord-agent-auth", title: "组织里没有任何产品路径能任命审核人职能" },
      { issue: 853, on: "unowned", title: "createAgendaSegment 零 web 调用方" },
      { issue: 660, on: "closed", title: "已修好的那条" },
    ]);
  });

  // 拆掉 `if (meta === null)` ⇒ 本条红。
  // ⚠ 离线时必须说「不知道」，不能默认成 unowned —— 那会让一屋子活凭空变成"没人管"，
  //   进而诱导 agent 去抢一个其实有人在做的活。
  it("离线反证：查不到 issue 状态 ⇒ unknown，不猜成 unowned", () => {
    const out = classifyBlockers([877], null);
    expect(out[0]?.on).toBe("unknown");
  });

  it("issue 不存在 ⇒ 也是 unknown，不是 unowned", () => {
    const out = classifyBlockers([99999], meta);
    expect(out[0]?.on).toBe("unknown");
  });
});

describe("我的下一个动作", () => {
  it("取统一队列里属于我的第一条（沿用队列既有优先级，不另排一次序）", () => {
    expect(nextActionFor([877, 624, 728, 750], new Set([728, 624]))).toBe(624);
  });

  it("队列里没有我的活 ⇒ null（照实说没有，不硬塞一条）", () => {
    expect(nextActionFor([877, 624], new Set([999]))).toBeNull();
  });
});
