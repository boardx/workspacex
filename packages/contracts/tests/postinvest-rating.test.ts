/**
 * 契约束 `postinvest-rating`（Phase 16 F02）的形状门控。
 *
 * 守四件事（都是 `contract-design.md` 硬规则 5/6/7 的落法）：
 * 1. 枚举**封闭**——未声明的值不能通过（断言封闭性，不断言成员数，硬规则 7）；
 * 2. 每个操作的 `out` 拒绝漂移的 body（硬规则 6 的反向断言，否则 safeParse 只挡一半）；
 * 3. R7-6 铁律的形状：`subjective` ⇒ `recorded_only` 且无新版本；其余四类 ⇒ `rerun_started` + 新版本；
 * 4. D2 种子域名逐条满足 `TrustedSourceDomain`，且匹配规则拒绝带协议 / 路径 / 通配的写法。
 *
 * 这里刻意**不**出现任何分数阈值 / 分级文案（R7-1：那些只在 skill 包里）。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as C from "../src/postinvest-rating";

const ISO = "2026-09-15T00:00:00.000Z";
const SHA = "a".repeat(64);

const evidenceRow: C.EvidenceRow = {
  field: "revenue_current",
  value: null,
  unit: "CNY",
  sourceFileId: "file-1",
  sourceLocator: "合并利润表 › 营业收入 › 本期金额",
  scoreComponent: "S1",
};

const record: C.PostinvestRatingRecord = {
  id: "rec-1",
  projectId: "proj-1",
  version: 1,
  status: "draft",
  grade: "C",
  gradeMeta: { grade: "C", colorToken: "rating.grade.c", meaning: "m", advice: "a" },
  flags: ["incomplete"],
  scores: { s1: 1, s2: null, s3: 1, total: null, intermediates: { cash_months: null }, scriptVersion: "1.0.0" },
  evidence: [evidenceRow],
  uncertainties: ["首次评级，无趋势判断"],
  discardedOffWhitelistCount: 0,
  inputFiles: [{ fileId: "file-1", filename: "2025.xlsx", sha256: SHA, kind: "statement" }],
  reports: [{ artifactId: "art-1", kind: "pdf", verified: false }],
  runId: "run-1",
  createdAt: ISO,
  corrections: [],
};

/** 每个操作一份能通过 `out` 的合法样例——漂移断言在它上面加一个未声明字段。 */
const validOut: Record<keyof typeof C.operations, unknown> = {
  createRatingRun: { runId: "run-1", recordId: "rec-1" },
  getRatingRecord: record,
  listRatingRecords: { projectId: "proj-1", versions: [record] },
  submitFeedback: { feedbackId: "fb-1", outcome: "recorded_only" },
  confirmRatingRecord: { ...record, status: "confirmed", confirmedBy: "user-1", confirmedAt: ISO },
  getTrustedSourceWhitelist: { domains: [...C.TRUSTED_SOURCE_SEED_DOMAINS], updatedBy: null, updatedAt: ISO },
  updateTrustedSourceWhitelist: { domains: ["example.com"], updatedBy: "admin-1", updatedAt: ISO },
  decideRatingHitl: { runId: "run-1", decision: "approve" },
};

describe("枚举封闭性（未声明的值不能通过）", () => {
  const enums: [string, z.ZodEnum<[string, ...string[]]>][] = [
    ["RatingGrade", C.RatingGrade],
    ["DataQualityFlag", C.DataQualityFlag],
    ["MissingDataReasonCode", C.MissingDataReasonCode],
    ["FeedbackType", C.FeedbackType],
    ["FeedbackOutcome", C.FeedbackOutcome],
    ["RatingRecordStatus", C.RatingRecordStatus],
    ["RatingRunPhase", C.RatingRunPhase],
    ["ScoreComponent", C.ScoreComponent],
    ["RatingInputFileKind", C.RatingInputFileKind],
    ["RatingReportKind", C.RatingReportKind],
    ["RatingHitlDecision", C.RatingHitlDecision],
    ["PostinvestRatingError", C.PostinvestRatingError],
  ];
  it.each(enums)("%s 拒绝未声明的值，接受每一个已声明的值", (_name, schema) => {
    for (const v of schema.options) expect(schema.safeParse(v).success).toBe(true);
    expect(schema.safeParse("__undeclared__").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });

  it("等级 F / 标注「其它」之类没有在 skill 包分级表里的值不进契约", () => {
    expect(C.RatingGrade.safeParse("F").success).toBe(false);
    expect(C.DataQualityFlag.safeParse("其它").success).toBe(false);
  });

  it("每个操作声明的 err 都是 PostinvestRatingError 的成员", () => {
    for (const [op, def] of Object.entries(C.operations)) {
      for (const code of def.err) {
        expect(C.PostinvestRatingError.safeParse(code).success, `${op} 的 ${code} 未在失败面枚举里声明`).toBe(true);
      }
    }
  });
});

describe("每个操作的 out 拒绝漂移的 body", () => {
  it.each(Object.keys(C.operations) as (keyof typeof C.operations)[])("%s", (op) => {
    const out = C.operations[op].out;
    const body = validOut[op] as Record<string, unknown>;
    expect(out.safeParse(body).success, `${op} 的合法样例本身没过——测试空转`).toBe(true);
    expect(out.safeParse({ ...body, driftedField: "x" }).success).toBe(false);
  });

  it("嵌套对象也拒绝漂移（依据行 / 输入文件 / 修正记录）", () => {
    expect(C.PostinvestRatingRecord.safeParse({ ...record, evidence: [{ ...evidenceRow, page: 3 }] }).success).toBe(false);
    expect(C.PostinvestRatingRecord.safeParse({ ...record, inputFiles: [{ ...record.inputFiles[0], mime: "x" }] }).success).toBe(false);
    expect(C.PostinvestRatingRecord.safeParse({ ...record, scores: { ...record.scores, threshold: 1 } }).success).toBe(false);
  });

  it("缺失记 null 而不是零：依据行 value 接受 null，拒绝字符串", () => {
    expect(C.EvidenceRow.safeParse({ ...evidenceRow, value: null }).success).toBe(true);
    expect(C.EvidenceRow.safeParse({ ...evidenceRow, value: "0" }).success).toBe(false);
    expect(C.EvidenceRow.safeParse({ ...evidenceRow, sourceLocator: "" }).success).toBe(false);
  });

  it("版本号从 1 起、SHA256 必须是 64 位十六进制", () => {
    expect(C.PostinvestRatingRecord.safeParse({ ...record, version: 0 }).success).toBe(false);
    expect(C.RatingInputFile.safeParse({ ...record.inputFiles[0], sha256: "abc" }).success).toBe(false);
  });
});

describe("R7-6 反馈分流铁律的形状", () => {
  it("主观偏差是 record-only 类型，只记录不重算", () => {
    expect(C.RECORD_ONLY_FEEDBACK_TYPE).toBe("subjective");
    expect(C.FeedbackType.safeParse(C.RECORD_ONLY_FEEDBACK_TYPE).success).toBe(true);
    // recorded_only 的合法回包：没有 newRecordId
    expect(C.SubmitRatingFeedbackOutput.safeParse({ feedbackId: "fb-1", outcome: "recorded_only" }).success).toBe(true);
    // 其余四类：rerun_started + 新版本 id
    for (const type of C.FeedbackType.options.filter((t) => t !== C.RECORD_ONLY_FEEDBACK_TYPE)) {
      expect(C.SubmitRatingFeedbackInput.safeParse({ recordId: "rec-1", type, basis: "依据" }).success).toBe(true);
      expect(
        C.SubmitRatingFeedbackOutput.safeParse({ feedbackId: "fb-1", outcome: "rerun_started", newRecordId: "rec-2" }).success,
      ).toBe(true);
    }
  });

  it("错误类型单选必填：缺 type 的反馈不收", () => {
    expect(C.SubmitRatingFeedbackInput.safeParse({ recordId: "rec-1", basis: "依据" }).success).toBe(false);
    expect(C.operations.submitFeedback.err).toContain("FEEDBACK_TYPE_REQUIRED");
  });

  it("confirmed 不可逆：确认与反馈都声明 RECORD_ALREADY_CONFIRMED", () => {
    expect(C.operations.confirmRatingRecord.err).toContain("RECORD_ALREADY_CONFIRMED");
    expect(C.operations.submitFeedback.err).toContain("RECORD_ALREADY_CONFIRMED");
    expect(C.operations.confirmRatingRecord.err).toContain("ADMIN_CANNOT_CONFIRM");
  });
});

describe("D2 可信渠道白名单", () => {
  it("种子域名逐条满足 TrustedSourceDomain", () => {
    for (const d of C.TRUSTED_SOURCE_SEED_DOMAINS) {
      expect(C.TrustedSourceDomain.safeParse(d).success, d).toBe(true);
    }
    expect(new Set(C.TRUSTED_SOURCE_SEED_DOMAINS).size).toBe(C.TRUSTED_SOURCE_SEED_DOMAINS.length);
  });

  it("只收裸域名：协议 / 路径 / 通配 / 大写 / 端口都拒（不做路径级规则）", () => {
    for (const bad of ["https://sse.com.cn", "sse.com.cn/disclosure", "*.sse.com.cn", "SSE.com.cn", "sse.com.cn:443", "localhost", "-bad.com"]) {
      expect(C.TrustedSourceDomain.safeParse(bad).success, bad).toBe(false);
    }
    expect(C.UpdateTrustedSourceWhitelistInput.safeParse({ domains: ["https://sse.com.cn"] }).success).toBe(false);
    expect(C.operations.updateTrustedSourceWhitelist.err).toContain("WHITELIST_INVALID_DOMAIN");
  });
});

describe("契约不复述 skill 包的数值（R7-1）", () => {
  it("RatingGradeMeta 只约束非空，不携带阈值字段", () => {
    const keys = Object.keys(C.RatingGradeMeta.shape).sort();
    expect(keys).toEqual(["advice", "colorToken", "grade", "meaning"]);
    expect(C.RatingGradeMeta.safeParse({ grade: "A", colorToken: "", meaning: "m", advice: "a" }).success).toBe(false);
  });

  it("ScoreBreakdown 的中间量是开放键名的 record，不在契约里枚举口径", () => {
    expect(C.ScoreBreakdown.shape.intermediates).toBeInstanceOf(z.ZodRecord);
  });
});
