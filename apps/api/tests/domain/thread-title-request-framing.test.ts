/**
 * 2026-09-22 —— 截断式标题先剥掉请求式开场白。
 *
 * ## 取证起点（人类实测截图）
 *
 * 线程标题是「做一个深度研究，关于 AI 原型转型在中国的高…」：24 个码点用完了，而
 * **信息量最大的那一半被截掉了**。真正的主题「AI 原型转型在中国的高校的实践」只有 14 个
 * 码点，根本不需要省略号；被占掉的前 10 个码点讲的是「我要你做一件事」——一个对所有消息
 * 都成立、因此零信息量的事实。
 *
 * ⚠ 这条落回路径在本地版是**常态**：起名的模型往返只有 3 秒预算，而它与用户刚发起的那次
 * run 抢同一个本地模型槽（实测冷启一次起名 6.2 秒，必然超预算）。所以这个纯函数的产出
 * 质量，就是本地版大多数线程标题的质量。
 */
import { describe, expect, it } from "vitest";
import { AUTO_TITLE_MAX_LENGTH, deriveThreadTitle } from "../../src/domain/chat/thread-title";

describe("deriveThreadTitle 剥请求式开场白", () => {
  it("截图那一条：剥掉开场白之后不再需要省略号，主题完整留下", () => {
    const title = deriveThreadTitle("做一个深度研究，关于 AI 原型转型在中国的高校的实践");
    expect(title).toBe("AI 原型转型在中国的高校的实践");
    expect(title).not.toContain("…");
    expect(Array.from(title ?? "").length).toBeLessThanOrEqual(AUTO_TITLE_MAX_LENGTH);
  });

  it("最长优先：不会只剥掉「做一个」而把「深度研究，关于」留在标题开头", () => {
    // 「做一个深度研究，关于」与「做一个」都在闭集里；按长度降序匹配，否则只剥一层。
    // ⚠ 正文必须**超过上限**才会触发剥离（见 `needsFramingStrip`），所以这里用一条长正文——
    //   短正文逐字节不变是刻意的既有行为。
    expect(deriveThreadTitle("做一个深度研究，关于医保改革在县域医共体里的落地阻力")).toBe("医保改革在县域医共体里的落地阻力");
  });

  it("正文装得下时一个字都不动——剥离只在会被截断时才有收益", () => {
    // 「帮我写一份周报」剥成「写一份周报」：同样不截断、同样七个字、少一个人称，零收益。
    expect(deriveThreadTitle("帮我写一份周报")).toBe("帮我写一份周报");
    expect(deriveThreadTitle("请分析这份数据")).toBe("请分析这份数据");
  });

  it("连接词与标点一起剥，标题不会以「，」或「关于」开头", () => {
    for (const body of [
      "帮我分析一下，关于团队协作在跨时区远程办公下的沟通瓶颈",
      "请介绍：知识图谱在企业内部检索场景里的落地路径与代价",
    ]) {
      const title = deriveThreadTitle(body) ?? "";
      expect(title.startsWith("，"), body).toBe(false);
      expect(title.startsWith("关于"), body).toBe(false);
      expect(title.startsWith("："), body).toBe(false);
    }
  });

  it("剥完剩不下东西就原样返回——更短但无意义的标题比带框架的长标题更糟", () => {
    // 整句都是框架，没有主题可留
    expect(deriveThreadTitle("帮我写一下")).toBe("帮我写一下");
    expect(deriveThreadTitle("请")).toBe("请");
  });

  it("不是请求式开场白的消息一个字都不动", () => {
    for (const body of ["AI 原型转型的三个阶段", "今天的会议纪要", "for the record: budget"]) {
      expect(deriveThreadTitle(body)).toBe(body);
    }
  });

  it("空白仍然返回 null（写空标题比留「新对话」更糟，见 deriveThreadTitle 头注）", () => {
    expect(deriveThreadTitle("   ")).toBeNull();
    expect(deriveThreadTitle("")).toBeNull();
  });

  it("剥完仍然超长时照旧按码点截断，且总长不超上限", () => {
    const title = deriveThreadTitle(`请分析一下${"甲乙丙丁戊己庚辛".repeat(6)}`) ?? "";
    expect(Array.from(title).length).toBe(AUTO_TITLE_MAX_LENGTH);
    expect(title.endsWith("…")).toBe(true);
  });
});
