/**
 * `domain/canvas/template-recommendation.ts` —— chat 建议行里那排画布模板推荐的
 * **全部判定规则**（issue #2825）。纯函数，不起库。
 *
 * 这里钉的是"这次改动到底做对了什么"，每条都对应一种具体的退化形态：
 *   ① 推荐来自**后台配的** `recommendAfter`，不是代码里写死的一张表——把某个模板的
 *      推荐关系改掉，推荐结果必须跟着变（上一版的病根：前端一条常量 chip，后台改
 *      模板对它毫无影响）。
 *   ② 已经画过的模板不再被推荐（重画一遍除了多花一次模型调用什么也不会变）。
 *   ③ 线程里一个画布都没有 ⇒ 推荐**起点模板**（推荐图入度为 0 者），不是空，也不是
 *      写死的"就推 persona"。
 *   ④ `recommendAfter` 指向不存在/未发布/不可见的 key ⇒ 安静跳过，不报错、不渲染成
 *      一条点了必失败的假 chip（契约明写写入时不校验存在性，消费端必须容忍）。
 *   ⑤ 排序稳定：被推荐次数多的在前，并列按模板库顺序——同一条线程刷新两次，chip
 *      不该换位置。
 */
import { describe, expect, it } from "vitest";
import {
  buildRecommendationPrompt,
  detectCanvasTemplateKeys,
  entryTemplates,
  recommendTemplates,
  type RecommendableTemplate,
} from "../../src/domain/canvas/template-recommendation";

const LIB: readonly RecommendableTemplate[] = [
  { key: "persona", displayName: "用户画像", recommendAfter: ["journey-map", "empathy"] },
  { key: "journey-map", displayName: "用户旅程图", recommendAfter: ["hmw"] },
  { key: "empathy", displayName: "同理心地图", recommendAfter: ["hmw"] },
  { key: "hmw", displayName: "HMW 问题陈述", recommendAfter: [] },
];

const fence = (key: string): string =>
  ["```canvas", `模板: ${key}`, "## 分区", "- 一条要点", "```"].join("\n");

describe("detectCanvasTemplateKeys · 线程里画过哪些模板", () => {
  it("读 canvas 围栏的 `模板: <key>` 行；```persona 围栏的语言本身就是 key", () => {
    const text = [
      "先聊聊你的用户。",
      fence("journey-map"),
      "```persona",
      "姓名: 陈静",
      "## 目标和需求",
      "- 准时交付",
      "```",
    ].join("\n\n");
    expect(detectCanvasTemplateKeys(text)).toEqual(["journey-map", "persona"]);
  });

  it("不是 canvas/persona 的围栏一概不算——mermaid 图表不是工作坊画布", () => {
    const text = ["```mermaid", "flowchart LR", "A-->B", "```"].join("\n");
    expect(detectCanvasTemplateKeys(text)).toEqual([]);
  });

  it("没有 `模板:` 行的 canvas 围栏跳过（流式途中被截断的半截围栏就是这种）", () => {
    expect(detectCanvasTemplateKeys(["```canvas", "## 分区", "- 要点", "```"].join("\n"))).toEqual([]);
  });
});

describe("recommendTemplates · 推荐哪几个", () => {
  it("①推荐来自后台配的 recommendAfter：改掉那一栏，推荐结果跟着变", () => {
    const before = recommendTemplates({ drawnKeys: ["persona"], published: LIB, limit: 3 });
    expect(before.map((t) => t.key)).toEqual(["journey-map", "empathy"]);

    // 同一份线程事实，只把 persona 那一行的推荐关系改成 hmw——这正是后台管理员在
    // template-admin 里做的那一个动作。
    const relinked = LIB.map((t) =>
      t.key === "persona" ? { ...t, recommendAfter: ["hmw"] } : t);
    const after = recommendTemplates({ drawnKeys: ["persona"], published: relinked, limit: 3 });
    expect(after.map((t) => t.key)).toEqual(["hmw"]);
  });

  it("②已经画过的不再推荐", () => {
    const out = recommendTemplates({ drawnKeys: ["persona", "journey-map"], published: LIB, limit: 3 });
    expect(out.map((t) => t.key)).not.toContain("journey-map");
  });

  it("③线程里一个画布都没有 ⇒ 推起点模板（入度为 0），不是空", () => {
    const out = recommendTemplates({ drawnKeys: [], published: LIB, limit: 3 });
    expect(out.map((t) => t.key)).toEqual(["persona"]);
    expect(entryTemplates(LIB).map((t) => t.key)).toEqual(["persona"]);
  });

  /**
   * ③b 起点之间按**出度**排，不是按模板库的 key 字典序。
   *
   * 真实退化形态（本次实现的第一版就是这样）：默认配置下入度为 0 的模板有十个左右，
   * 按 `ORDER BY key` 取前三选出来的是「ai-strategy / burger / freytag」——一个与
   * "适不适合开场"完全无关的字典序。这条用例用同样的形状钉住它：`zzz-opener` 在
   * 字典序上排最后，但它能带出两个后续，必须排在只能带出零个的 `aaa-dead-end` 前面。
   */
  it("③b 起点之间：能带出更多后续的排在前面（不是按 key 的字典序）", () => {
    const lib: readonly RecommendableTemplate[] = [
      { key: "aaa-dead-end", displayName: "死胡同", recommendAfter: [] },
      { key: "mid", displayName: "中间", recommendAfter: [] },
      { key: "zzz-opener", displayName: "开场", recommendAfter: ["mid", "aaa-dead-end"] },
    ];
    // `zzz-opener` 指向另外两个 ⇒ 它是唯一入度为 0 的；换个只有两个孤立模板的库
    // 才看得出排序，所以这里再补一个同为起点、但出度更低的。
    const withSecondEntry = [...lib, { key: "bbb-lonely", displayName: "孤立", recommendAfter: [] }];
    expect(entryTemplates(withSecondEntry).map((t) => t.key)).toEqual(["zzz-opener", "bbb-lonely"]);
  });

  it("④指向不存在/未发布的 key ⇒ 跳过，不产出一条点了必失败的假 chip", () => {
    const withDangling = LIB.map((t) =>
      t.key === "persona" ? { ...t, recommendAfter: ["ghost-template", "empathy"] } : t);
    const out = recommendTemplates({ drawnKeys: ["persona"], published: withDangling, limit: 3 });
    expect(out.map((t) => t.key)).toEqual(["empathy"]);
  });

  it("⑤被推荐次数多的在前；并列按模板库顺序（刷新两次不换位置）", () => {
    // 画过 journey-map 与 empathy ⇒ 两者都推 hmw（2 票）；再补一个只被推 1 次的。
    const lib = [
      ...LIB,
      { key: "storyboard", displayName: "故事板", recommendAfter: [] },
    ].map((t) => (t.key === "journey-map" ? { ...t, recommendAfter: ["hmw", "storyboard"] } : t));
    const out = recommendTemplates({ drawnKeys: ["journey-map", "empathy"], published: lib, limit: 3 });
    expect(out.map((t) => t.key)).toEqual(["hmw", "storyboard"]);
  });

  it("limit 由调用方给，超出部分截断", () => {
    const out = recommendTemplates({ drawnKeys: ["persona"], published: LIB, limit: 1 });
    expect(out).toHaveLength(1);
  });
});

describe("buildRecommendationPrompt", () => {
  it("带上显示名与 key，并明说不要编造——围栏格式说明不在这里重复（它在 system prompt 里）", () => {
    const prompt = buildRecommendationPrompt({ key: "journey-map", displayName: "用户旅程图" });
    expect(prompt).toContain("用户旅程图");
    expect(prompt).toContain("journey-map");
    expect(prompt).toContain("不要编造");
    // ⚠ 反证：格式说明只能有一份（`buildCanvasTemplateGuidance`）。在用户消息里再写
    //   一遍围栏语法，两份措辞早晚漂移，而漂移的那天没有任何东西会报警。
    expect(prompt).not.toContain("```");
  });
});
