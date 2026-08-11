import { describe, it, expect } from "vitest";
import { wrapWithHeader, parseGeneratedHeader, verifyContentHash, hashBody, supportedExtensions } from "./generated-metadata";

const META = {
  rendererId: "evt-short-text",
  sourceInstanceId: "EVT-999-0001",
  sourceTemplateId: "TPL-EVT-001",
  sourceRevision: "abcdef1234567",
};

describe("wrapWithHeader", () => {
  it(".md 用 HTML 注释头，wrap→parse 往返无损", () => {
    const body = "# 标题\n\n正文内容\n";
    const wrapped = wrapWithHeader("generated/a.md", body, META);
    expect(wrapped.startsWith("<!--\n")).toBe(true);
    const { parsed, issues } = parseGeneratedHeader("generated/a.md", wrapped);
    expect(issues).toEqual([]);
    expect(parsed?.body).toBe(body);
    expect(parsed?.header).toEqual({ ...META, contentHash: hashBody(body) });
  });

  it(".yaml 用 # 注释头，wrap→parse 往返无损", () => {
    const body = "key: value\nlist:\n  - a\n";
    const wrapped = wrapWithHeader("generated/b.yaml", body, META);
    expect(wrapped.startsWith("# generated-by: ")).toBe(true);
    const { parsed, issues } = parseGeneratedHeader("generated/b.yaml", wrapped);
    expect(issues).toEqual([]);
    expect(parsed?.body).toBe(body);
  });

  it("反证：未登记扩展名抛错，不静默省略头", () => {
    expect(() => wrapWithHeader("generated/c.json", "{}", META)).toThrow(/未登记注释语法/);
    expect(supportedExtensions()).toEqual([".md", ".yaml", ".yml"]);
  });

  it("哈希由 wrap 内部计算，调用方无法传入假哈希", () => {
    const wrapped = wrapWithHeader("generated/a.md", "内容 v1", META);
    const { parsed } = parseGeneratedHeader("generated/a.md", wrapped);
    expect(parsed?.header.contentHash).toBe(hashBody("内容 v1"));
  });
});

describe("parseGeneratedHeader", () => {
  it("无头文件返回 parsed=null 且 issues 为空（不是错误）", () => {
    const { parsed, issues } = parseGeneratedHeader("docs/readme.md", "# 普通文档\n");
    expect(parsed).toBeNull();
    expect(issues).toEqual([]);
  });

  it("未登记扩展名返回 parsed=null 且 issues 为空（该不该有头由 016 判）", () => {
    const { parsed, issues } = parseGeneratedHeader("src/x.ts", "export {};\n");
    expect(parsed).toBeNull();
    expect(issues).toEqual([]);
  });

  it("反证：残缺头（缺字段）必须报 issues，不当成无头文件放过", () => {
    const truncated = "<!--\n  generated-by: evt-short-text\n  source-instance: EVT-1\n-->\n正文";
    const { parsed, issues } = parseGeneratedHeader("generated/a.md", truncated);
    expect(parsed).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("反证：.md 头缺闭合 --> 必须报", () => {
    const wrapped = wrapWithHeader("generated/a.md", "正文", META);
    const noClose = wrapped.replace("\n-->", "\n<<损坏>>");
    const { issues } = parseGeneratedHeader("generated/a.md", noClose);
    expect(issues.some((i) => i.message.includes("闭合"))).toBe(true);
  });
});

describe("verifyContentHash（HMV2-016 drift gate 的核心原语）", () => {
  it("未被改动的生成物校验通过", () => {
    const wrapped = wrapWithHeader("generated/a.md", "原始正文", META);
    const { parsed } = parseGeneratedHeader("generated/a.md", wrapped);
    expect(verifyContentHash(parsed!)).toMatchObject({ ok: true });
  });

  it("反证：手改正文 → 哈希对不上，declared/actual 都给出便于定位", () => {
    const wrapped = wrapWithHeader("generated/a.md", "原始正文", META);
    const tampered = wrapped.replace("原始正文", "被手改的正文");
    const { parsed } = parseGeneratedHeader("generated/a.md", tampered);
    const result = verifyContentHash(parsed!);
    expect(result.ok).toBe(false);
    expect(result.declared).not.toBe(result.actual);
  });

  it("反证：伪造头部哈希 → 同样对不上", () => {
    const wrapped = wrapWithHeader("generated/a.md", "正文", META);
    const forged = wrapped.replace(/content-hash: [0-9a-f]{16}/, "content-hash: 0000000000000000");
    const { parsed } = parseGeneratedHeader("generated/a.md", forged);
    expect(verifyContentHash(parsed!).ok).toBe(false);
  });

  it("行尾字节不同即漂移（刻意不做归一化）", () => {
    const wrapped = wrapWithHeader("generated/a.md", "a\nb\n", META);
    const crlf = wrapped.replace("a\nb\n", "a\r\nb\r\n");
    const { parsed } = parseGeneratedHeader("generated/a.md", crlf);
    expect(verifyContentHash(parsed!).ok).toBe(false);
  });
});
