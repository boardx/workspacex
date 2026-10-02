import { describe, expect, it } from "vitest";
import { designPrototype } from "../src/index.js";
import { HTML_PAGE_MAX_CHARS, describeHtmlPageElement, htmlPageElement, htmlPageInteractiveCount, htmlPageLinks, htmlPageVisibleText, replaceHtmlPageElement, sanitizeHtmlPage } from "../src/design-html-page.js";

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

describe("元素编号与局部替换", () => {
  const { html } = sanitizeHtmlPage('<style>.a{color:red}</style><div class="page"><h1>标题</h1><ul><li>甲</li><li>乙</li></ul><button data-goto="1">去</button><img src="data:image/png;base64,AA" alt="x"></div>');

  it("给块级元素按文档顺序编号；输入里自带的 data-ref 被丢掉重编；幂等", () => {
    expect(html).toMatch(/<div[^>]*data-ref="r1"/);
    expect(html).toMatch(/<h1[^>]*data-ref="r2"/);
    expect(sanitizeHtmlPage('<div data-ref="r99"><p>x</p></div>').html).toBe('<div data-ref="r1"><p data-ref="r2">x</p></div>');
    expect(sanitizeHtmlPage(html).html).toBe(html);
  });

  it("htmlPageElement 取出含嵌套的整个元素（同名标签配平）", () => {
    const ul = designHtmlPage_element("r3");
    expect(ul).toContain("甲");
    expect(ul).toContain("乙");
    expect(ul).not.toContain("<button");
    expect(designHtmlPage_element("r999")).toBeNull();
  });

  it("只替换被选中的元素，其余逐字不动；可追加 CSS；替换内容同样被清洗", () => {
    const out = replaceHtmlPageElement(html, "r2", '<h1 class="big">新标题<script>x()</script></h1>', ".big{color:blue}")!;
    expect(out).toContain("新标题");
    expect(out).toContain(":is(.big):where(.wsx-local-r2){color:blue}");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("x()");
    expect(out).toContain("甲");
    expect(out).toContain('data-goto="1"');
    expect(replaceHtmlPageElement(html, "r404", "<p>x</p>")).toBeNull();
  });

  it("局部 CSS 不写全局规则，替换内容的 style 同样限定作用域", () => {
    const page = sanitizeHtmlPage('<style>.btn{color:blue}</style><div><button class="btn">甲</button><button class="btn">乙</button></div>').html;
    const out = replaceHtmlPageElement(page, "r2", '<button class="btn">新甲</button><style>.btn{background:red}</style>', '.btn{color:red}')!;
    const second = htmlPageElement(out, "r3")!;
    expect(second.html).toContain('class="btn"');
    expect(second.html).not.toContain("wsx-local-");
    expect(out).not.toContain('.btn{color:red}');
    expect(out).not.toContain('.btn{background:red}');
    expect(out).toContain(":where(.wsx-local-");
    expect(sanitizeHtmlPage(out).html).toBe(out);
  });

  it("局部选择器不能闭合 scope 逃逸；伪元素跟随被选中的源元素", () => {
    const page = sanitizeHtmlPage('<div><button class="btn">甲</button><button class="btn">乙</button></div>').html;
    for (const css of ['.btn), .btn, :is(.btn{color:red}', '.btn\\), .btn, :is(.btn{color:red}', '[title="x] .btn{color:red}']) {
      const out = replaceHtmlPageElement(page, "r2", '<button class="btn">新甲</button>', css)!;
      expect(out).not.toContain('color:red');
    }
    const out = replaceHtmlPageElement(page, "r2", '<button class="btn">新甲</button>', '.btn::before{content:"新";color:red}.btn:hover,.btn:focus{color:blue}')!;
    expect(out).toContain(':where(.wsx-local-r2)::before');
    expect(out).toContain(':is(.btn:hover):where(.wsx-local-r2),:is(.btn:focus):where(.wsx-local-r2)');
  });

  it("先规范化 style 闭合标签再 scope，片段样式不能逃到整页", () => {
    const page = sanitizeHtmlPage('<div><button class="btn">甲</button><button class="btn">乙</button></div>').html;
    for (const close of ['</style >', '</STYLE\n>']) {
      const out = replaceHtmlPageElement(page, "r2", `<style>.btn{color:red}${close}<button class="btn">新甲</button>`)!;
      expect(out).not.toContain('.btn{color:red}');
      expect(out).toContain(':is(.btn):where(.wsx-local-r2){color:red}');
      expect(htmlPageElement(out, "r3")!.html).not.toContain('wsx-local-');
    }
  });

  it("describeHtmlPageElement", () => {
    expect(describeHtmlPageElement(html, "r2")).toBe("<h1>「标题」");
  });
});

function designHtmlPage_element(ref: string): string | null {
  return htmlPageElement(sanitizeHtmlPage('<style>.a{color:red}</style><div class="page"><h1>标题</h1><ul><li>甲</li><li>乙</li></ul><button data-goto="1">去</button></div>').html, ref)?.html ?? null;
}
