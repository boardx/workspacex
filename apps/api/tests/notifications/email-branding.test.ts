/**
 * `renderBrandEmailHtml`——两条邮件通路（验证邮件 / 任意事务邮件）共用的品牌外壳。
 * 只断言这一层自己的契约：转义、段落切分、CTA 按钮的有无，不重复 transport 层已经
 * 测过的请求形状。
 */
import { describe, expect, it } from "vitest";
import { renderBrandEmailHtml } from "../../src/infrastructure/notifications/email-branding";

describe("renderBrandEmailHtml", () => {
  it("渲染 heading 与按换行切分的正文段落", () => {
    const html = renderBrandEmailHtml({
      heading: "你的反馈《测试问题单》已修复，请测试验收",
      text: "第一段。\n第二段。",
    });
    expect(html).toContain("你的反馈《测试问题单》已修复，请测试验收");
    expect(html).toContain("<p");
    expect(html).toContain("第一段。");
    expect(html).toContain("第二段。");
  });

  it("不带 cta 时不渲染按钮链接", () => {
    const html = renderBrandEmailHtml({ heading: "h", text: "t" });
    expect(html).not.toContain("<a href");
  });

  it("带 cta 时渲染按钮，链接指向给定 url", () => {
    const html = renderBrandEmailHtml({
      heading: "验证你的 WorkspaceX 邮箱",
      text: "点击下方按钮完成邮箱验证。",
      cta: { label: "验证邮箱", url: "https://app.example.com/verify?token=abc" },
    });
    expect(html).toContain('href="https://app.example.com/verify?token=abc"');
    expect(html).toContain("验证邮箱");
  });

  it("正文与 heading 里的特殊字符被转义，不能注入标签", () => {
    const html = renderBrandEmailHtml({
      heading: "<script>alert(1)</script>",
      text: "带 <b>标签</b> 与 & 符号",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>标签</b>");
  });

  it("logotype 里带有品牌粉色的 Workspace 与 X", () => {
    const html = renderBrandEmailHtml({ heading: "h", text: "t" });
    expect(html).toContain(">Workspace<");
    expect(html).toContain('class="wx-logo-x"');
  });
});
