import { describe, expect, it } from "vitest";
import { designPrototype } from "../src/index.js";
import { HTML_PAGE_MAX_CHARS, htmlPageInteractiveCount, htmlPageLinks, htmlPageVisibleText, sanitizeHtmlPage } from "../src/design-html-page.js";

const dirty =
  '<!doctype html><html><head><title>x</title><meta charset="utf-8"><link rel="stylesheet" href="https://evil.test/a.css">' +
  '<style>@import url(https://evil.test/x.css); .a{background:url(https://evil.test/i.png);color:red}</style><script>alert(1)</script></head>' +
  '<body onload="steal()"><div class="a" onclick="x()" style="background:url(javascript:alert(1));color:blue">你好' +
  '<a href="https://evil.test">外链</a><img src="https://evil.test/p.png" alt="p"><img src="data:image/png;base64,AAAA" alt="ok">' +
  '<iframe src="https://evil.test"></iframe><button data-goto="1">去第二页</button></div></body></html>';

describe("sanitizeHtmlPage", () => {
  const { html, removed } = sanitizeHtmlPage(dirty);

  it("不留下任何能执行或加载外部内容的东西", () => {
    expect(html).not.toMatch(/<script|<iframe|<link|<meta|<title|onclick|onload|evil\.test|javascript:|@import/i);
    expect(removed.length).toBeGreaterThan(0);
  });

  it("保留版面与文字，data: 图片与页内跳转", () => {
    expect(html).toContain("你好");
    expect(html).toContain("color:red");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('href="#"');
    expect(html).toContain('data-goto="1"');
  });

  it("幂等", () => {
    expect(sanitizeHtmlPage(html).html).toBe(html);
  });

  it("从不抛，任何输入都给片段", () => {
    for (const x of ["", "<", "<div", "<<<>>>", "<style>", "<script>", "\u0000", "<div ".repeat(1000)]) {
      expect(() => sanitizeHtmlPage(x)).not.toThrow();
    }
  });

  it("CSS 转义绕行拿不到 url()", () => {
    const r = sanitizeHtmlPage('<div style="background:\\75rl(https://evil.test/a.png)">x</div>');
    expect(r.html).not.toMatch(/evil\.test/);
  });

  it("超长被截断到上限内", () => {
    expect(sanitizeHtmlPage("<p>" + "字".repeat(HTML_PAGE_MAX_CHARS * 3)).html.length).toBeLessThanOrEqual(HTML_PAGE_MAX_CHARS);
  });
});

describe("跳转与统计", () => {
  it("data-goto 补齐 data-link，并投影成 links", () => {
    const { html } = sanitizeHtmlPage('<button data-goto="2">a</button><a data-goto="0">b</a><button data-goto="2">c</button>');
    const links = htmlPageLinks(html);
    expect(links.map((l) => l.to)).toEqual([2, 0, 2]);
    expect(new Set(links.map((l) => l.from)).size).toBe(3);
  });

  it("可见文字与可交互数", () => {
    const { html } = sanitizeHtmlPage("<style>.a{}</style><div>你好 <b>世界</b></div><button>点</button><input placeholder=x>");
    expect(htmlPageVisibleText(html)).toBe("你好 世界 点");
    expect(htmlPageInteractiveCount(html)).toBe(2);
  });
});

describe("html 节点进契约", () => {
  const node = (h: string) => ({ type: "html", props: { html: h } });

  it("干净的过，脏的拒", () => {
    const clean = sanitizeHtmlPage("<div>你好</div>").html;
    expect(designPrototype.PrototypeNode.safeParse(node(clean)).success).toBe(true);
    expect(designPrototype.PrototypeNode.safeParse(node("<div onclick=1>x</div>")).success).toBe(false);
  });

  it("coercePrototypeRaw 会先清洗，脏输入清洗后能过", () => {
    const coerced = designPrototype.coercePrototypeRaw(node('<div onclick="x()">你好</div><script>1</script>'));
    expect(designPrototype.PrototypeNode.safeParse(coerced).success).toBe(true);
  });

  it("setProps 补丁写入的脏 html 也被清洗", () => {
    const screens = [{ frame: "a", root: { id: "p1", type: "html", props: { html: "<div>旧</div>" } } }, { frame: "b", root: { type: "html", props: { html: "<div>b</div>" } } }] as never;
    const out = designPrototype.applyPrototypePatch(screens, [{ op: "setProps", id: "p1", props: { html: '<div onclick="x()">新</div>' } }]);
    expect(JSON.stringify(out)).not.toContain("onclick");
    expect(JSON.stringify(out)).toContain("新");
  });

  it("跳转的 from 可以是 HTML 里的 data-link", () => {
    const { html } = sanitizeHtmlPage('<button data-goto="1">下一页</button>');
    const from = htmlPageLinks(html)[0]!.from;
    const screens = [
      { root: { id: "p1", type: "html", props: { html } }, links: [{ from, to: 1 }] },
      { root: { id: "p2", type: "html", props: { html: "<div>b</div>" } } },
    ] as never;
    const r = designPrototype.validateLinks(screens);
    expect(r.dropped).toEqual([]);
    expect(r.links[0]).toEqual([{ from, to: 1 }]);
  });
});
