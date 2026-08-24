/**
 * DA-12 —— `vfs-uri.ts` 纯函数单测：构造/解析往返、非法输入的拒绝面。
 */
import { describe, expect, it } from "vitest";
import { VFS_DOMAINS, buildVfsUri, parseVfsUri } from "../../src/domain/vfs/vfs-uri";

describe("buildVfsUri / parseVfsUri", () => {
  it("往返：build 再 parse 拿回同一个 (domain, id)", () => {
    for (const domain of VFS_DOMAINS) {
      const uri = buildVfsUri(domain, "abc-123_XYZ");
      expect(uri).toBe(`vfs://${domain}/abc-123_XYZ`);
      expect(parseVfsUri(uri)).toEqual({ domain, id: "abc-123_XYZ" });
    }
  });

  it("build 拒绝非法 domain", () => {
    expect(() => buildVfsUri("not-a-domain" as never, "x")).toThrow();
  });

  it("build 拒绝带 '/' 的 id（会让 URI 产生歧义）", () => {
    expect(() => buildVfsUri("attachment", "a/b")).toThrow();
  });

  it("parse 对格式不对的输入一律返回 null，不抛", () => {
    for (const bad of [
      "",
      "not-a-uri",
      "vfs://",
      "vfs://attachment/",
      "vfs://unknown-domain/id-1",
      "http://attachment/id-1",
      "vfs://attachment/id/extra-segment",
      "vfs://attachment/id with space",
    ]) {
      expect(parseVfsUri(bad), bad).toBeNull();
    }
  });

  it("VFS_DOMAINS 是本文件唯一权威——不在别处复述这个枚举", () => {
    expect([...VFS_DOMAINS]).toEqual(["attachment", "artifact"]);
  });
});
