/**
 * 深度 S10（#3988）—— image 节点的真图（`src`）：只收 data URL、有上限；发给模型前摘掉、写回后按 id 补回。
 */
import { describe, expect, it } from "vitest";
import * as dp from "../src/design-prototype";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const img = (id: string, src?: string) => ({ id, type: "image" as const, props: { alt: "主图", ...(src === undefined ? {} : { src }) } });
const page = (...children: dp.PrototypeNode[]): dp.PrototypeNode => ({ id: "root", type: "stack", children });

describe("image.src 的合法形态", () => {
  it("只收 png/jpeg/webp/gif 的 base64 data URL；网址、svg（能带脚本）、超长都拒", () => {
    const ok = (src: string) => dp.PrototypeNode.safeParse(img("a", src)).success;
    expect(ok(PNG)).toBe(true);
    expect(ok("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
    expect(ok("https://example.com/a.png")).toBe(false);
    expect(ok("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(ok(`data:image/png;base64,${"A".repeat(dp.PROTOTYPE_IMAGE_SRC_MAX_CHARS)}`)).toBe(false);
  });
});

describe("withoutImageSources / restoreImageSources", () => {
  it("发给模型的树里没有 src，别的不变；没有图的树原样返回", () => {
    // ⭐ 反证锚点：不摘 ⇒ 这条红——一张 60 KB 的图就把模型上下文吃掉一大块。
    const tree = page(img("a", PNG), { id: "t", type: "text", props: { content: "标题" } });
    const out = dp.withoutImageSources(tree);
    expect(JSON.stringify(out)).not.toContain("base64");
    expect(out).toEqual(page(img("a"), { id: "t", type: "text", props: { content: "标题" } }));
    const plain = page(img("b"));
    expect(dp.withoutImageSources(plain)).toBe(plain);
    expect(dp.withoutImageSources(null)).toBeNull();
  });

  it("模型写回后按节点 id 补回；模型删掉 / 换了 id 的不硬塞；模型自己给了 src 的不覆盖", () => {
    const before = [page(img("a", PNG), img("gone", PNG)), null];
    const after = page(img("a"), img("new-id"));
    expect(dp.restoreImageSources(before, after)).toEqual(page(img("a", PNG), img("new-id")));
    const other = "data:image/gif;base64,R0lGOD==";
    expect(dp.restoreImageSources(before, page(img("a", other)))).toEqual(page(img("a", other)));
    expect(dp.restoreImageSources(before, undefined)).toBeUndefined();
  });
});
