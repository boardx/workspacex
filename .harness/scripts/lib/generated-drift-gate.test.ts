import { describe, it, expect } from "vitest";
import { findGeneratedDrift } from "./generated-drift-gate";
import { wrapWithHeader } from "./generated-metadata";

const META = {
  rendererId: "evt-short-text",
  sourceInstanceId: "EVT-999-0001",
  sourceTemplateId: "TPL-EVT-001",
  sourceRevision: "abcdef1234567",
};

describe("findGeneratedDrift", () => {
  it("未改动的生成物 + 普通人写文件混扫 → 零 finding，只有带头文件计数", () => {
    const report = findGeneratedDrift([
      { path: "generated/a.md", content: wrapWithHeader("generated/a.md", "正文 A", META) },
      { path: "docs/readme.md", content: "# 人写的普通文档\n" },
      { path: "src/x.ts", content: "export {};\n" },
    ]);
    expect(report.findings).toEqual([]);
    expect(report.stampedFilesChecked).toBe(1);
  });

  it("反证：手改生成物正文 → HMV2016-CONTENT-DRIFT", () => {
    const wrapped = wrapWithHeader("generated/a.md", "原始正文", META);
    const tampered = wrapped.replace("原始正文", "被手改的正文");
    const report = findGeneratedDrift([{ path: "generated/a.md", content: tampered }]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.code).toBe("HMV2016-CONTENT-DRIFT");
    expect(report.findings[0]?.message).toContain("不许手编");
  });

  it("反证：伪造头部哈希 → 同样 CONTENT-DRIFT（改头不改正文也逃不掉）", () => {
    const wrapped = wrapWithHeader("generated/a.md", "正文", META);
    const forged = wrapped.replace(/content-hash: [0-9a-f]{16}/, "content-hash: 0000000000000000");
    const report = findGeneratedDrift([{ path: "generated/a.md", content: forged }]);
    expect(report.findings[0]?.code).toBe("HMV2016-CONTENT-DRIFT");
  });

  it("反证：残缺头（删掉一个字段行）→ HMV2016-MALFORMED-HEADER", () => {
    const wrapped = wrapWithHeader("generated/a.md", "正文", META);
    const truncated = wrapped
      .split("\n")
      .filter((l) => !l.includes("source-revision:"))
      .join("\n");
    const report = findGeneratedDrift([{ path: "generated/a.md", content: truncated }]);
    expect(report.findings.some((f) => f.code === "HMV2016-MALFORMED-HEADER")).toBe(true);
    expect(report.stampedFilesChecked).toBe(1);
  });

  it(".yaml 生成物同样受控", () => {
    const wrapped = wrapWithHeader("generated/b.yaml", "key: v1\n", META);
    const tampered = wrapped.replace("key: v1", "key: v2");
    const report = findGeneratedDrift([{ path: "generated/b.yaml", content: tampered }]);
    expect(report.findings[0]?.code).toBe("HMV2016-CONTENT-DRIFT");
  });

  it("多文件多缺陷累积上报，不早退", () => {
    const good = wrapWithHeader("generated/ok.md", "好的", META);
    const bad1 = wrapWithHeader("generated/t1.md", "v1", META).replace("v1", "v2");
    const bad2 = wrapWithHeader("generated/t2.yaml", "a: 1\n", META).replace("a: 1", "a: 2");
    const report = findGeneratedDrift([
      { path: "generated/ok.md", content: good },
      { path: "generated/t1.md", content: bad1 },
      { path: "generated/t2.yaml", content: bad2 },
    ]);
    expect(report.stampedFilesChecked).toBe(3);
    expect(report.findings).toHaveLength(2);
  });
});
