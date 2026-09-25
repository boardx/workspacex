/**
 * backlog E2 —— 内置示例材料的 PII 门。示例内容会原样进每一个新组织，所以：
 *   ① 真实内容必须零命中；
 *   ② 门本身必须能红——每一类形状各给一个反例，证明它不是空转。
 */
import { describe, expect, it } from "vitest";
import { scanForPii, type PiiKind } from "../../src/domain/project/sample-content-pii";
import {
  SAMPLE_DOCUMENTS,
  SAMPLE_PROJECT_NAME,
} from "../../src/application/project/sample-project/sample-project-content";

describe("内置示例项目内容：PII 门", () => {
  it("① 每份示例文档与项目名零 PII 命中", () => {
    expect(SAMPLE_DOCUMENTS.length).toBeGreaterThan(0);
    for (const doc of SAMPLE_DOCUMENTS) {
      expect(scanForPii(doc.filename + "\n" + doc.body), doc.filename).toEqual([]);
    }
    expect(scanForPii(SAMPLE_PROJECT_NAME)).toEqual([]);
  });

  it("每份文档都带「示例材料（虚构）」声明且是允许上传的 .md", () => {
    for (const doc of SAMPLE_DOCUMENTS) {
      expect(doc.body).toContain("示例材料（虚构）");
      expect(doc.filename.endsWith(".md")).toBe(true);
    }
  });

  const counterExamples: readonly (readonly [PiiKind, string])[] = [
    ["cn-mobile", "联系人电话 13812345678 请回电"],
    ["cn-mobile", "手机：138-1234-5678"],
    ["cn-landline", "座机 010-12345678"],
    ["email", "发邮件到 someone@example.com 即可"],
    ["cn-id-card", "身份证 11010519491231002X"],
    ["bank-card", "卡号6222021234567890123"],
  ];

  it.each(counterExamples)("② 反例能让门变红：%s", (kind, text) => {
    const findings = scanForPii(text);
    expect(findings.map((f) => f.kind)).toContain(kind);
  });

  it("② 把反例塞进示例文档，整份扫描即红", () => {
    const polluted = SAMPLE_DOCUMENTS[0]!.body + "\n负责人手机 13912345678";
    expect(scanForPii(polluted).length).toBeGreaterThan(0);
  });
});
