import { describe, expect, it } from "vitest";
import { externalHttpUrl, toolUrl } from "@/lib/chat-workbench/external-url";

describe("externalHttpUrl", () => {
  it("http / https 放行，并规范化", () => {
    expect(externalHttpUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(externalHttpUrl("  http://example.com  ")).toBe("http://example.com/");
  });

  // 这条是本文件存在的理由：地址来自模型写的工具参数，正文那层 rehype-sanitize
  // 管不到这条新路径。放行任何一个，就是把一条注入路径画成了可点链接。
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "blob:https://example.com/abc",
    "vbscript:msgbox(1)",
  ])("不放行 %s", (raw) => {
    expect(externalHttpUrl(raw)).toBeNull();
  });

  it("相对地址返回 null——不替模型补 https:// 前缀猜它想访问哪台主机", () => {
    expect(externalHttpUrl("example.com/a")).toBeNull();
    expect(externalHttpUrl("/local/path")).toBeNull();
  });

  it("非字符串 / 空串返回 null", () => {
    expect(externalHttpUrl(null)).toBeNull();
    expect(externalHttpUrl(undefined)).toBeNull();
    expect(externalHttpUrl(123)).toBeNull();
    expect(externalHttpUrl("   ")).toBeNull();
  });
});

describe("toolUrl", () => {
  it("从 url / href 里挑，与 toolObject 取的是同一个字段", () => {
    expect(toolUrl({ url: "https://a.com/x" })).toBe("https://a.com/x");
    expect(toolUrl({ href: "https://b.com/" })).toBe("https://b.com/");
  });
  it("字段在但不是可渲染地址时返回 null，不退回别的字段编一个", () => {
    expect(toolUrl({ url: "javascript:alert(1)", query: "https://real.com" })).toBeNull();
  });
  it("没有地址字段的工具参数返回 null", () => {
    expect(toolUrl({ query: "找一下年报" })).toBeNull();
    expect(toolUrl(null)).toBeNull();
    expect(toolUrl("https://a.com")).toBeNull();
  });
});
