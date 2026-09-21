/**
 * 首启那一屏的三条性质。Night 0 的外壳缺这一屏，结果是「装完了登不进去」——
 * 这类断链不该靠人工点一遍才发现。
 */
import { describe, expect, it } from "vitest";
import { escapeHtml, welcomeDataUrl, welcomeHtml } from "../src/welcome";

const view = {
  webUrl: "http://127.0.0.1:3100",
  email: "me@local.workspacex",
  password: "s3cret-Pa55word",
  warnings: ["未找到 Ollama：API 已启动，但聊天没有可用模型"],
  dataDir: "/Users/someone/Library/Application Support/WorkspaceX/local",
};

describe("desktop welcome screen", () => {
  it("shows the generated credentials and the way into the workspace", () => {
    const html = welcomeHtml(view);
    expect(html).toContain(view.email);
    expect(html).toContain(view.password);
    // 「打开工作区」必须真的带着 web 地址，否则这一屏就是死路
    expect(html).toContain(JSON.stringify(view.webUrl));
    // 起不来的能力如实列出，而不是等用户在功能里撞墙
    expect(html).toContain("未找到 Ollama");
    // 密码在哪个文件里，也要说——人第一次多半没记住
    expect(html).toContain("secrets.json");
  });

  it("escapes everything it interpolates", () => {
    const html = welcomeHtml({
      ...view,
      password: '"><script>alert(1)</script>',
      warnings: ["<img src=x onerror=alert(1)>"],
      dataDir: "/tmp/<dir>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(escapeHtml('<&>"\'')).toBe("&lt;&amp;&gt;&quot;&#39;");
  });

  it("pulls in nothing from the network -- the local build promises zero egress", () => {
    const html = welcomeHtml(view);
    expect(html).not.toMatch(/\bsrc=["']https?:/);
    expect(html).not.toMatch(/\bhref=["']https?:/);
    // 唯一出现的 http 地址是本机 web
    for (const url of html.match(/https?:\/\/[^\s"'<)]+/g) ?? []) {
      expect(url.startsWith("http://127.0.0.1:")).toBe(true);
    }
  });

  it("produces a loadable data URL", () => {
    const url = welcomeDataUrl(view);
    expect(url.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:text/html;charset=utf-8,".length))).toBe(welcomeHtml(view));
  });
});
