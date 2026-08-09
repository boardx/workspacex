/**
 * core-loop-readiness.test.ts —— issue #814。
 *
 * ## 这份测试的第一职责是反证，不是覆盖率
 *
 * 本仓已九次出现"门写好了、全绿、但它其实什么都拦不住"。所以四道门每一道都配一对
 * 用例：**一条证明它在该红的时候红，一条证明它在不该红的时候不红**。只写后者的门
 * 等于没有门（恒绿）；只写前者的门会把所有人拦死（恒红），两种都空转。
 *
 * 聚合公式 `CLR = min(R, mean(B, V-D, V-P))` 单独测：它是本 issue 引入的设计决定，
 * 不是从既有文档推出来的，因此更需要把行为钉死——尤其是"R 封顶"这条，它是整套
 * 标准的激励设计核心（走不到的地方做得再好也等于 0）。
 */
import { describe, expect, it } from "vitest";
import {
  CEILING_TRACK,
  judgeReadiness,
  judgeTrack,
  matchesAny,
  validateState,
  type ReadinessState,
  type TrackRecord,
} from "./core-loop-readiness";

const SHA = "a".repeat(40);

/** 一条**完全健康**的记录。每个反证都从它出发，只破坏一个字段——这样"红"一定 */
/** 归因到被破坏的那一处，而不是记录本来就不合格。 */
function healthy(over: Partial<TrackRecord> = {}): TrackRecord {
  return {
    name: "测试 track",
    authority: ".harness/rubrics/whatever.md#x",
    allowed_scorers: ["rev-e2e"],
    max: 10,
    score: 8,
    scored_sha: SHA,
    scored_by: "rev-e2e",
    implemented_by: "dev-chat-e2e",
    evidence: ["evidence/shot.png"],
    watch: ["apps/web/**"],
    blocking_issues: [111],
    ...over,
  };
}

describe("judgeTrack：四道门，每道一对（该红的红 / 不该红的不红）", () => {
  it("健康记录如实计分——门不能恒红", () => {
    const v = judgeTrack("B", healthy(), []);
    expect(v.discounts).toEqual([]);
    expect(v.effectiveScore).toBe(8);
  });

  // ── G1 未评分记 0，不记「未知」 ─────────────────────────────────────────
  it("G1 反证：未评分记 0（空着不等于满分）", () => {
    const v = judgeTrack("B", healthy({ score: null, scored_sha: null, scored_by: null }), []);
    expect(v.discounts).toContain("NEVER_SCORED");
    expect(v.effectiveScore).toBe(0);
    expect(v.rawScore).toBeNull(); // 原始分仍如实保留为 null，不伪装成 0 分的实测
  });

  // ── G2 过期分数记 0 ────────────────────────────────────────────────────
  it("G2 反证：watch 命中的文件在评分后改过 ⇒ 过期 ⇒ 记 0", () => {
    const v = judgeTrack("B", healthy(), ["apps/web/components/chat/chat-read-screen.tsx"]);
    expect(v.discounts).toContain("STALE");
    expect(v.effectiveScore).toBe(0);
  });

  it("G2 不误伤：改的文件不在 watch 里 ⇒ 分数仍然有效", () => {
    const v = judgeTrack("B", healthy(), ["docs/README.md", ".harness/state/x.json"]);
    expect(v.discounts).toEqual([]);
    expect(v.effectiveScore).toBe(8);
  });

  it("G2 的 null 与空数组含义不同：null=没查（不触发），[]=查了没改（不触发但语义不同）", () => {
    expect(judgeTrack("B", healthy(), null).discounts).toEqual([]);
    expect(judgeTrack("B", healthy(), []).discounts).toEqual([]);
  });

  // ── G3 自评不算分 ──────────────────────────────────────────────────────
  it("G3 反证：scored_by === implemented_by ⇒ 自评 ⇒ 记 0", () => {
    const v = judgeTrack("B", healthy({ scored_by: "rev-e2e", implemented_by: "rev-e2e" }), []);
    expect(v.discounts).toContain("SELF_SCORED");
    expect(v.effectiveScore).toBe(0);
  });

  it("G3 反证：评分人不在 allowed_scorers 里 ⇒ 记 0（rev-uiux 不能替 rev-e2e 打行为分）", () => {
    const v = judgeTrack("B", healthy({ scored_by: "rev-uiux" }), []);
    expect(v.discounts).toContain("SCORER_NOT_ALLOWED");
    expect(v.effectiveScore).toBe(0);
  });

  // ── G4 无证据不算分 ────────────────────────────────────────────────────
  it("G4 反证：evidence 为空 ⇒ 记 0（没有证据 = 没有完成）", () => {
    const v = judgeTrack("B", healthy({ evidence: [] }), []);
    expect(v.discounts).toContain("NO_EVIDENCE");
    expect(v.effectiveScore).toBe(0);
  });

  it("越界分数记 0，不裁剪到 10——裁剪会把一个填错的记录伪装成满分", () => {
    expect(judgeTrack("B", healthy({ score: 11 }), []).effectiveScore).toBe(0);
    expect(judgeTrack("B", healthy({ score: -1 }), []).effectiveScore).toBe(0);
  });

  it("多道门同时命中时全部列出，不是只报第一条", () => {
    const v = judgeTrack("B", healthy({ evidence: [], scored_by: "rev-uiux" }), ["apps/web/x.ts"]);
    expect(v.discounts).toEqual(
      expect.arrayContaining(["NO_EVIDENCE", "SCORER_NOT_ALLOWED", "STALE"]),
    );
  });
});

describe("judgeReadiness：R 是天花板，不是加数", () => {
  const state = (r: number | null, b: number, vd: number, vp: number): ReadinessState => ({
    version: 1,
    tracks: {
      R: healthy({ name: "可达性", score: r, ...(r === null ? { scored_sha: null, scored_by: null } : {}), blocking_issues: [660, 619] }),
      B: healthy({ name: "行为", score: b, blocking_issues: [714] }),
      "V-D": healthy({ name: "项目对话保真", score: vd, allowed_scorers: ["rev-uiux"], scored_by: "rev-uiux", blocking_issues: [728] }),
      "V-P": healthy({ name: "个人对话", score: vp, allowed_scorers: ["rev-uiux"], scored_by: "rev-uiux", blocking_issues: [728, 750] }),
    },
  });

  it("可达性低时封顶——体验与视觉满分也抬不动总分", () => {
    const v = judgeReadiness(state(3, 10, 10, 10), {});
    expect(v.reachability).toBe(3);
    expect(v.experienceMean).toBe(10);
    expect(v.clr).toBe(3); // ← 这条是整套标准的激励设计核心
  });

  it("可达性满分时，总分由其余三条的均值决定", () => {
    const v = judgeReadiness(state(10, 4, 1, 7), {});
    expect(v.experienceMean).toBe(4); // (4+1+7)/3
    expect(v.clr).toBe(4);
  });

  it("R 未评分 ⇒ 天花板为 0 ⇒ CLR 为 0（不知道可达性时不许声称就绪）", () => {
    const v = judgeReadiness(state(null, 10, 10, 10), {});
    expect(v.clr).toBe(0);
  });

  it("缺 R 这条 track 直接抛——公式没有 R 就不成立，不许静默降级成四项平均", () => {
    const noR: ReadinessState = { version: 1, tracks: { B: healthy() } };
    expect(() => judgeReadiness(noR, {})).toThrow(/缺天花板 track/);
  });

  it("统一队列：R 的阻塞项在最前，其后按 track 得分升序，且去重", () => {
    const v = judgeReadiness(state(3, 9, 1, 5), {});
    // R(660,619) 先；其余按分升序 V-D(1)→V-P(5)→B(9)；728 在 V-D 已出现，V-P 里去重
    expect(v.queue).toEqual([660, 619, 728, 750, 714]);
  });

  it("每条 track 的扣分原因随判决一起返回，看板能直接渲染「为什么这条是 0」", () => {
    const s = state(5, 8, 8, 8);
    const v = judgeReadiness(s, { B: ["apps/web/components/chat/x.tsx"] });
    expect(v.tracks.find((t) => t.id === "B")?.discounts).toContain("STALE");
    expect(v.tracks.find((t) => t.id === "V-D")?.discounts).toEqual([]);
  });

  it(`天花板 track 的 id 是导出的常量，改名只有一处（当前：${CEILING_TRACK}）`, () => {
    expect(CEILING_TRACK).toBe("R");
  });
});

describe("matchesAny：glob 的两个真实坑", () => {
  it("`**` 跨目录，`*` 不跨——顺序处理错了 apps/** 就匹配不到深层文件", () => {
    expect(matchesAny(["apps/web/lib/chat/x.ts"], ["apps/**"])).toBe(true);
    expect(matchesAny(["apps/web/lib/chat/x.ts"], ["apps/*"])).toBe(false);
    expect(matchesAny(["apps/web"], ["apps/*"])).toBe(true);
  });

  it("`a/**/b.ts` 能匹配零层中间目录", () => {
    expect(matchesAny(["apps/b.ts"], ["apps/**/b.ts"])).toBe(true);
    expect(matchesAny(["apps/x/y/b.ts"], ["apps/**/b.ts"])).toBe(true);
  });

  it("点号不当通配符——`x.ts` 的 glob 不该匹配 `xats`", () => {
    expect(matchesAny(["xats"], ["x.ts"])).toBe(false);
  });
});

describe("validateState：手写记录的形状必须被机械检查", () => {
  const good: ReadinessState = {
    version: 1,
    tracks: { R: healthy(), B: healthy() },
  };

  it("健康 state 无问题", () => {
    expect(validateState(good)).toEqual([]);
  });

  it("反证：漏 watch ⇒ 报错（没有 watch，G2 过期门恒不触发，是最危险的静默失效）", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ watch: [] }) } };
    expect(validateState(bad).join()).toMatch(/缺 watch/);
  });

  it("反证：scored_sha 不是 40 位 SHA ⇒ 报错（实测必须声明 SHA）", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ scored_sha: "abc123" }) } };
    expect(validateState(bad).join()).toMatch(/40 位小写 SHA/);
  });

  it("反证：半截记录（有分数却把 SHA 清成 null）⇒ 报错", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ scored_sha: null }) } };
    expect(validateState(bad).length).toBeGreaterThan(0);
  });

  it("反证：未评分却留着 scored_by ⇒ 报错（改分数忘了改人的半截记录）", () => {
    const bad = {
      ...good,
      tracks: { ...good.tracks, B: healthy({ score: null, scored_sha: null, scored_by: "rev-e2e" }) },
    };
    expect(validateState(bad).join()).toMatch(/scored_by 也必须为 null/);
  });

  it("反证：max 不是 10 ⇒ 报错（四条 track 不同量纲时取均值没有意义）", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ max: 5 }) } };
    expect(validateState(bad).join()).toMatch(/max 必须是 10/);
  });

  it("反证：缺天花板 track R ⇒ 报错", () => {
    expect(validateState({ version: 1, tracks: { B: healthy() } }).join()).toMatch(/缺天花板/);
  });
});
