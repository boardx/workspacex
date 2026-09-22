/**
 * #1142 owner 命名空间门的反证。
 *
 * 每一条断言都对应一处判据：把那处判据拆掉，这里必须红。写完门控立刻造反证——
 * 否则它只是一份看起来安全的装饰（同 #1136 的写法）。
 */
import { describe, it, expect } from "vitest";
import {
  isUnowned, judgeFeatureOwners, staleOwnerAllowlistEntries, ownerAllowlistKey,
  type PhaseFeatureOwners,
} from "./feature-owner";

/** 身份命名空间：registry.yaml ∪ .harness/agents/*.yaml 的实际形态（取真实 id 做样本）。 */
const KNOWN = new Set(["coord-main", "dev-chat-e2e", "rev-uiux"]);

const phases = (features: PhaseFeatureOwners["features"]): PhaseFeatureOwners[] =>
  [{ phaseId: "01", features }];

describe("isUnowned —— 什么算「没有归属」", () => {
  it("null / undefined 是未认领", () => {
    expect(isUnowned(null)).toBe(true);
    expect(isUnowned(undefined)).toBe(true);
  });

  // 反证：拆掉 trim() 判据 ⇒ 本条红。空白串是「留空」的另一种写法，
  // 不去掉它，一个空格就能让 feature 装成「有主」并绕过整道门。
  it("反证：纯空白字符串也是未认领，不是一个身份", () => {
    expect(isUnowned("")).toBe(true);
    expect(isUnowned("   ")).toBe(true);
  });

  it("真实 id 不是未认领", () => {
    expect(isUnowned("coord-main")).toBe(false);
  });
});

describe("judgeFeatureOwners —— 主判定", () => {
  // 这是 #1142 的洞本身：sprint 期一次性把手不在任何身份命名空间里，
  // 门控落地前 doctor 对它一声不吭。拆掉 `knownIds.has(owner)` 之后的
  // newGaps 分支 ⇒ 本条红。
  it("反证：sprint 期临时把手（w2-chat4）不在命名空间里且未豁免 ⇒ 判红", () => {
    const v = judgeFeatureOwners(
      phases([{ id: "F123", owner: "w2-chat4", status: "passing" }]),
      KNOWN,
      [],
    );
    expect(v.newGaps.map((g) => g.key)).toEqual(["01/F123=w2-chat4"]);
    expect(v.grandfathered).toEqual([]);
  });

  it("反证：裸 Directory ULID 同样不是身份（#1142 实测到 3 条）", () => {
    const v = judgeFeatureOwners(
      phases([{ id: "F9", owner: "agt_01KZRABCZ99M2NGN20C7YWEASG", status: "passing" }]),
      KNOWN,
      [],
    );
    expect(v.newGaps).toHaveLength(1);
  });

  it("真实 registry 角色 id 放行", () => {
    const v = judgeFeatureOwners(
      phases([
        { id: "F1", owner: "coord-main", status: "passing" },
        { id: "F2", owner: "rev-uiux", status: "in_progress" },
      ]),
      KNOWN,
      [],
    );
    expect(v.newGaps).toEqual([]);
    expect(v.grandfathered).toEqual([]);
  });

  // 拆掉 `.trim()` 归一 ⇒ 本条红：前后空格不该把一个真实身份判成非法。
  it("owner 两侧空白不影响命名空间判定", () => {
    const v = judgeFeatureOwners(
      phases([{ id: "F1", owner: "  coord-main  ", status: "passing" }]),
      KNOWN,
      [],
    );
    expect(v.newGaps).toEqual([]);
  });

  // 拆掉 allowlist 命中分支 ⇒ 本条红（存量会被误杀，"上线即全红"）。
  it("反证：存量把手在 allowlist 里 ⇒ 豁免通过，不判红", () => {
    const v = judgeFeatureOwners(
      phases([{ id: "F123", owner: "w2-chat4", status: "passing" }]),
      KNOWN,
      ["01/F123=w2-chat4"],
    );
    expect(v.newGaps).toEqual([]);
    expect(v.grandfathered.map((g) => g.key)).toEqual(["01/F123=w2-chat4"]);
  });

  // ★ 这一条是「key 为什么要带 owner 取值」的反证。
  // 把 key 退化成 `<phase>/<feature>`（不带取值）⇒ 本条红：那道门会变成
  // 「这条 feature 的 owner 字段从此免检」，正是本 issue 要堵的洞的永久版。
  it("反证：豁免只对被登记的那个取值有效，换成另一个编的把手仍判红", () => {
    const v = judgeFeatureOwners(
      phases([{ id: "F123", owner: "w9-something-else", status: "passing" }]),
      KNOWN,
      ["01/F123=w2-chat4"],
    );
    expect(v.newGaps.map((g) => g.key)).toEqual(["01/F123=w9-something-else"]);
    expect(v.grandfathered).toEqual([]);
  });

  it("owner 为空不进命名空间判定（未认领不是非法）", () => {
    const v = judgeFeatureOwners(
      phases([{ id: "F1", owner: null, status: "not_started" }]),
      KNOWN,
      [],
    );
    expect(v.newGaps).toEqual([]);
    expect(v.grandfathered).toEqual([]);
  });
});

describe("unowned 的两档 —— 混成一个数字就是用噪音埋信号", () => {
  // 拆掉 `f.status === "not_started" ? …` 的分档 ⇒ 本条红。
  // 实测分布（2026-09-21）：166 个 not_started（正常待领）vs 9 个 passing（真欠债）。
  it("反证：not_started 无主是正常待领，不与「已开工却无主」混在一起", () => {
    const v = judgeFeatureOwners(
      phases([
        { id: "F1", owner: null, status: "not_started" },
        { id: "F2", owner: null, status: "passing" },
        { id: "F3", owner: "   ", status: "in_progress" },
      ]),
      KNOWN,
      [],
    );
    expect(v.unownedNotStarted).toEqual(["01/F1"]);
    expect(v.unownedActive).toEqual(["01/F2", "01/F3"]);
  });
});

describe("staleOwnerAllowlistEntries —— 棘轮只许收缩", () => {
  // 拆掉陈旧判定 ⇒ 本条红：归一化之后豁免条目还留着，
  // 那个取值被再写回来时会静悄悄命中一条没人看守的豁免。
  it("反证：owner 已归一化到真实身份 ⇒ 对应豁免条目陈旧，必须删", () => {
    const stale = staleOwnerAllowlistEntries(
      phases([{ id: "F123", owner: "coord-main", status: "passing" }]),
      KNOWN,
      ["01/F123=w2-chat4"],
    );
    expect(stale).toEqual(["01/F123=w2-chat4"]);
  });

  it("反证：feature 已不存在 ⇒ 对应豁免条目同样陈旧", () => {
    expect(staleOwnerAllowlistEntries(phases([]), KNOWN, ["01/F404=w2-chat4"]))
      .toEqual(["01/F404=w2-chat4"]);
  });

  it("仍然需要豁免的条目不算陈旧", () => {
    const stale = staleOwnerAllowlistEntries(
      phases([{ id: "F123", owner: "w2-chat4", status: "passing" }]),
      KNOWN,
      ["01/F123=w2-chat4"],
    );
    expect(stale).toEqual([]);
  });
});

describe("ownerAllowlistKey", () => {
  it("条目形如 <phaseId>/<featureId>=<owner>", () => {
    expect(ownerAllowlistKey("01", "F123", "w2-chat4")).toBe("01/F123=w2-chat4");
  });
});

describe("空命名空间 —— 这道门自己最危险的失效形态", () => {
  // ★ 这是「为什么 doctor 在 known.size === 0 时拒绝下判断」的反证。
  //
  // registry.yaml 结构变了 / 读不到 ⇒ 命名空间是空集 ⇒ 每个 owner 都落在外面。
  // 存量把手被 allowlist 接住，于是唯一炸红的恰好是那些**真实正确**的 owner。
  // 仓库实测：32 条 FAIL，每条都点名一个真角色（dev-chat-e2e / coord-voice …）说它不存在。
  //
  // 判定函数这里**不**兜底——它是纯函数，只回答「给定这个命名空间，谁在外面」。
  // 兜底在调用方（doctor.ts 把空集登记成权威缺口，走 #394 的 UNREACHABLE）。
  // 本条把这个危险行为钉死成规格：它必须是可预期的，而不是某天悄悄变了。
  it("反证：命名空间为空集时，连真实身份也会被判进 newGaps —— 所以调用方必须先拦住空集", () => {
    const v = judgeFeatureOwners(
      phases([
        { id: "F1", owner: "coord-main", status: "passing" },
        { id: "F2", owner: "dev-chat-e2e", status: "passing" },
      ]),
      new Set<string>(),
      [],
    );
    expect(v.newGaps.map((g) => g.owner)).toEqual(["coord-main", "dev-chat-e2e"]);
  });
});
