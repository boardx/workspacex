import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { designHtmlPage } from "@repo/contracts";
import { PrototypeCanvas } from "@/components/design-loop/prototype-canvas";
import { buildHtmlPageSrcdoc } from "@/lib/html-page-srcdoc";

const html = designHtmlPage.sanitizeHtmlPage('<style>.a{color:red}</style><div class="a">你好</div><button data-goto="1">下一页</button><script>alert(1)</script>').html;

describe("HTML 页渲染", () => {
  it("srcdoc 带 CSP，脚本只认 nonce", () => {
    const doc = buildHtmlPageSrcdoc(html);
    expect(doc).toContain("default-src 'none'");
    expect(doc).toMatch(/script-src 'nonce-wsx[a-z0-9]+'/);
    expect(doc).not.toContain("alert(1)");
    expect(doc.match(/<script/g)).toHaveLength(1);
  });

  it("同一份内容 nonce 稳定（服务端渲染与水合一致）", () => {
    expect(buildHtmlPageSrcdoc(html)).toBe(buildHtmlPageSrcdoc(html));
  });

  it("画布把它渲染成沙箱 iframe：只给 allow-scripts，不给同源", () => {
    const markup = renderToStaticMarkup(
      React.createElement(PrototypeCanvas, { label: "首页", root: { id: "p1", type: "html", props: { html } }, mode: "preview" as const, links: [] }),
    );
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).toContain("design-html-page");
  });
});
