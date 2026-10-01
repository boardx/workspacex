import { describe, expect, it } from "vitest";
import { aggregateTags, dedupeTags, hasTag, matchesQuery, matchesTags, normalizeTag, sameTag, searchPlaceholder } from "@/lib/tag-utils";

describe("tag-utils（标签比较/匹配/聚合的唯一口径）", () => {
  it("normalizeTag：去首尾空白、折叠连续空白", () => {
    expect(normalizeTag("  客户   访谈 ")).toBe("客户 访谈");
  });

  it("sameTag / hasTag：忽略大小写与空白", () => {
    expect(sameTag("Client", " client ")).toBe(true);
    expect(sameTag("客户", "客户A")).toBe(false);
    expect(hasTag(["Alpha", "Beta"], "beta")).toBe(true);
  });

  it("dedupeTags：忽略大小写去重，保留先出现的写法与顺序，丢空串", () => {
    expect(dedupeTags(["Client", "client ", "", "  ", "Beta", "BETA"])).toEqual(["Client", "Beta"]);
  });

  it("aggregateTags：按用量降序，忽略大小写合并，显示先出现的写法", () => {
    const m = aggregateTags([{ tags: ["b", "A"] }, { tags: ["a"] }, { tags: ["A", "c"] }, { tags: null }, {}]);
    expect([...m.entries()]).toEqual([["A", 3], ["b", 1], ["c", 1]]);
  });

  it("matchesTags：空选择不过滤；any 命中任一；all 必须全含", () => {
    expect(matchesTags(["x"], [])).toBe(true);
    expect(matchesTags(["x", "y"], ["y", "z"])).toBe(true);
    expect(matchesTags(["x", "y"], ["y", "z"], "all")).toBe(false);
    expect(matchesTags(["X", "y"], ["x", "Y"], "all")).toBe(true);
  });

  it("matchesQuery：名称/描述或任一标签命中；空查询不过滤；忽略大小写", () => {
    expect(matchesQuery("", ["任意"], [])).toBe(true);
    expect(matchesQuery("供应", ["供应链创新", null], [])).toBe(true);
    expect(matchesQuery("战略", ["供应链创新"], ["战略", "Q4"])).toBe(true);
    expect(matchesQuery("q4", ["供应链创新"], ["战略", "Q4"])).toBe(true);
    expect(matchesQuery("不存在", ["供应链创新"], ["战略"])).toBe(false);
  });

  it("searchPlaceholder：占位文案明确标签也能搜", () => {
    expect(searchPlaceholder("项目")).toBe("搜索项目名称或标签");
  });
});
