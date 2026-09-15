/**
 * `/agent/team2` 投后财务项目评级工作台 —— 签核用 mock 数据。
 *
 * ⚠ 这是 UI 先行阶段（F03）的原型 mock：不接后端、不接 DB（ui-prototyper 硬规则 ③）。
 *   形状**全部**来自契约 `@repo/contracts/postinvest-rating`（单一事实源，ADR-020）——
 *   本文件不声明任何字段形状，只用契约导出的类型约束下面的字面量；契约错了这里当场编译失败。
 *   契约生成的样例见 `apps/web/lib/generated/postinvest-rating.mock.ts`，本文件以它为「消费证据」
 *   的种子（下面 import 了它），并按签核所需的信息密度扩成 ≥15 条依据 / 3 个版本 / 多标注。
 *
 * ⚠ 不放在 `apps/web/lib/mock/`：那是 `lint-no-builtin-capabilities` 申报的原型 mock 债务区，
 *   本文件是契约投影而非「内建能力清单」，放此处避免污染那条台账。
 *
 * 颜色 / 含义 / 建议**不在前端另写映射表**（R8 `rating-result-card`）：`gradeMeta` 的
 *   colorToken / meaning / advice 由 API 从 skill 包分级表原样带回，这里的 mock 值即代表
 *   「skill 包那一行」。前端只做 colorToken→CSS token 的呈现解析（见 grade-visual.ts）。
 */
import type {
  PostinvestRatingRecord,
  EvidenceRow,
  RatingGradeMeta,
  TrustedSourceWhitelist,
  RatingInputFile,
} from "@repo/contracts/postinvest-rating";
import { TRUSTED_SOURCE_SEED_DOMAINS } from "@repo/contracts/postinvest-rating";
// 消费契约生成的样例（证明本 mock 是契约的下游消费者，而非手写第二份形状）。
import { getRatingRecordMock } from "@/lib/generated/postinvest-rating.mock";

/** 生成的样例被真实读取一次：作为占位记录的种子，保证形状始终与契约同步。 */
export const CONTRACT_SEED_RECORD: PostinvestRatingRecord = getRatingRecordMock;

const YUAN = "元";

/** 16 条依据行：覆盖 S1/S2/S3/quality/none 与「缺失记 null 不填零」（R7-3）。 */
const EVIDENCE: EvidenceRow[] = [
  { field: "营业收入（本年）", value: 384_520_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并利润表·营业总收入行", scoreComponent: "S1" },
  { field: "营业收入（上年）", value: 351_200_000, unit: YUAN, sourceFileId: "file-stmt-2024", sourceLocator: "合并利润表·营业总收入行", scoreComponent: "S1" },
  { field: "净利润（本年）", value: 28_640_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并利润表·净利润行", scoreComponent: "S2" },
  { field: "净利润（上年）", value: 31_050_000, unit: YUAN, sourceFileId: "file-stmt-2024", sourceLocator: "合并利润表·净利润行", scoreComponent: "S2" },
  { field: "货币资金", value: 62_300_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·货币资金行", scoreComponent: "S3" },
  { field: "经营活动现金流净额", value: 18_900_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并现金流量表·经营活动产生的现金流量净额", scoreComponent: "S3" },
  { field: "近12月经营现金流出", value: 74_800_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并现金流量表·经营活动现金流出小计", scoreComponent: "S3" },
  { field: "应收账款", value: 96_400_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·应收账款行", scoreComponent: "quality" },
  { field: "存货", value: 58_100_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·存货行", scoreComponent: "quality" },
  { field: "其他应收款（本年）", value: 12_700_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·其他应收款行", scoreComponent: "quality" },
  { field: "其他应收款（上年）", value: null, unit: YUAN, sourceFileId: "file-stmt-2024", sourceLocator: "上年合并报表未提供该科目明细", scoreComponent: "quality" },
  { field: "总资产", value: 512_800_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·资产总计行", scoreComponent: "S1" },
  { field: "净资产", value: 214_300_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·所有者权益合计行", scoreComponent: "S1" },
  { field: "流动资产", value: 268_900_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·流动资产合计行", scoreComponent: "S3" },
  { field: "流动负债", value: 176_200_000, unit: YUAN, sourceFileId: "file-stmt-2025", sourceLocator: "合并资产负债表·流动负债合计行", scoreComponent: "S3" },
  { field: "管理层对回款周期的说明", value: null, unit: "定性", sourceFileId: "file-audio-itv", sourceLocator: "访谈转录 07:42「回款周期同比拉长约一个月」（当事人陈述）", scoreComponent: "none" },
];

/** 分级表投影（gradeMeta）：值即代表 skill 包分级表那一行；前端不另写映射。 */
const GRADE_META_B: RatingGradeMeta = {
  grade: "B",
  colorToken: "rating.grade.b",
  meaning: "经营稳健，财务风险总体可控，个别指标需持续关注。",
  advice: "维持常规投后跟踪频率，重点关注应收账款回款与现金流覆盖，季度复评。",
};

const INPUT_FILES: RatingInputFile[] = [
  { fileId: "file-stmt-2025", filename: "2025年度合并财务报表.xlsx", sha256: "a".repeat(64), kind: "statement" },
  { fileId: "file-stmt-2024", filename: "2024年度合并财务报表.pdf", sha256: "b".repeat(64), kind: "statement" },
  { fileId: "file-audit-2025", filename: "2025年度审计报告.pdf", sha256: "c".repeat(64), kind: "audit_report" },
  { fileId: "file-audio-itv", filename: "管理层访谈-2026Q1.m4a", sha256: "d".repeat(64), kind: "recording" },
];

const UNCERTAINTIES = [
  "缺失字段：其他应收款（上年）—— 上年合并报表未披露该科目，占总资产比率无法同比。",
  "估算项：近12月经营现金流出按半年报数据年化，标记为「数据暂估」。",
  "解析警告：审计报告第 23 页存在扫描页，未启用 OCR，该页数据未纳入。",
  "已丢弃 2 条非白名单来源（见「可信渠道白名单」面板）。",
  "录音仅用于定性佐证，不参与算分（R3-5）。",
];

function record(over: Partial<PostinvestRatingRecord>): PostinvestRatingRecord {
  const base: PostinvestRatingRecord = {
    id: "rec-v1",
    projectId: "proj-hcz-anhe",
    version: 1,
    status: "draft",
    grade: "B",
    gradeMeta: GRADE_META_B,
    flags: ["incomplete", "estimated", "suspected_abnormal"],
    scores: {
      s1: 24, s2: 18, s3: 21, total: 63,
      intermediates: {
        体量档: 4, 营收增长率对数得分: 6.2, 净利润率: 7.4,
        现金自给月数: 9.6, 应收存货占收入比: 40.1, 其他应收占总资产比: 2.5,
      },
      scriptVersion: "postinvest-rating@1.0.0",
    },
    evidence: EVIDENCE,
    uncertainties: UNCERTAINTIES,
    discardedOffWhitelistCount: 2,
    inputFiles: INPUT_FILES,
    reports: [
      { artifactId: "art-pdf", kind: "pdf", verified: true },
      { artifactId: "art-xlsx", kind: "xlsx", verified: true },
      { artifactId: "art-png", kind: "png", verified: false },
    ],
    runId: "run-2026-09-15-001",
    createdAt: "2026-09-15T09:12:00+08:00",
    corrections: [],
  };
  return { ...base, ...over };
}

/** 版本链（3 版）：v1 初评 → v2 因「对标错」重算 → v3 当前 draft，待采纳。 */
export const RATING_VERSIONS: PostinvestRatingRecord[] = [
  record({ id: "rec-v1", version: 1, status: "confirmed", confirmedBy: "投资经理·林岚", confirmedAt: "2026-09-15T10:02:00+08:00" }),
  record({
    id: "rec-v2", version: 2, status: "confirmed",
    scores: { s1: 24, s2: 16, s3: 21, total: 61, intermediates: { 体量档: 4, 营收增长率对数得分: 6.2, 净利润率: 6.9, 现金自给月数: 9.6, 应收存货占收入比: 40.1, 其他应收占总资产比: 2.5 }, scriptVersion: "postinvest-rating@1.0.0" },
    confirmedBy: "投资经理·林岚", confirmedAt: "2026-09-15T11:20:00+08:00",
    corrections: [
      { feedbackId: "fb-1", type: "mapping_error", before: "净利润（本年）=31,050,000", after: "净利润（本年）=28,640,000", basis: "本年净利润误取上年列，已按 2025 合并利润表更正。", createdAt: "2026-09-15T11:05:00+08:00" },
    ],
  }),
  record({ id: "rec-v3", version: 3, status: "draft" }),
];

/** 当前展示的记录（结果态）= 版本链最新的 draft。 */
export const CURRENT_RECORD: PostinvestRatingRecord = RATING_VERSIONS[RATING_VERSIONS.length - 1]!;

/** 可信渠道白名单（只读面板；种子来自契约 D2，管理员曾登记被评公司官网）。 */
export const TRUSTED_WHITELIST: TrustedSourceWhitelist = {
  domains: [...TRUSTED_SOURCE_SEED_DOMAINS, "anhe-material.com.cn"],
  updatedBy: "组织管理员·周珂",
  updatedAt: "2026-09-10T14:00:00+08:00",
};

/** 项目选择器候选。 */
export const PROJECT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "proj-hcz-anhe", label: "安核新材料（投后 A 轮）" },
  { value: "proj-hcz-bolt", label: "博尔特智能装备（投后 B 轮）" },
  { value: "proj-hcz-cirr", label: "西润生物（投后天使轮）" },
];

/** 上传区回显用的文件条（含录音「原件上传」路径提示，D5）。 */
export type UploadRow = {
  readonly fileId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly kind: RatingInputFile["kind"];
  readonly parseStatus: "parsed" | "parsing" | "failed";
  readonly viaArtifactUpload: boolean;
};

export const UPLOAD_ROWS: readonly UploadRow[] = [
  { fileId: "file-stmt-2025", filename: "2025年度合并财务报表.xlsx", sizeBytes: 384_512, sha256: "a".repeat(64), kind: "statement", parseStatus: "parsed", viaArtifactUpload: false },
  { fileId: "file-stmt-2024", filename: "2024年度合并财务报表.pdf", sizeBytes: 1_204_880, sha256: "b".repeat(64), kind: "statement", parseStatus: "parsed", viaArtifactUpload: false },
  { fileId: "file-audit-2025", filename: "2025年度审计报告.pdf", sizeBytes: 2_931_712, sha256: "c".repeat(64), kind: "audit_report", parseStatus: "failed", viaArtifactUpload: false },
  { fileId: "file-audio-itv", filename: "管理层访谈-2026Q1.m4a", sizeBytes: 48_226_304, sha256: "d".repeat(64), kind: "recording", parseStatus: "parsed", viaArtifactUpload: true },
];

/** 运行态进度步骤（复用 agent workbench 的进度/工具调用可见性结构）。 */
export type RunStep = {
  readonly tool: string;
  readonly label: string;
  readonly status: "done" | "running" | "pending";
};

export const RUN_STEPS: readonly RunStep[] = [
  { tool: "wx_document_parse", label: "解析财务报表与审计报告", status: "done" },
  { tool: "wx_audio_transcribe", label: "转录管理层访谈录音", status: "done" },
  { tool: "data-analysis", label: "清洗字段并对齐口径（合并/单体、单位、期间）", status: "done" },
  { tool: "postinvest-rating", label: "确定性脚本计算 S1/S2/S3 与总分", status: "running" },
  { tool: "wx_knowledge_search", label: "检索历史评级与报表做趋势对比", status: "pending" },
  { tool: "web-research", label: "白名单渠道补充行业背景", status: "pending" },
  { tool: "wx_artifact_publish", label: "生成评级报告 / 明细表 / 趋势图", status: "pending" },
];

/** 反馈错误类型（单选，文案来自 R3-13；code 与契约 FeedbackType 一一对应）。 */
export const FEEDBACK_TYPE_OPTIONS: readonly { code: string; label: string; hint: string }[] = [
  { code: "calc_error", label: "明确算错", hint: "得分与依据数值明显不符" },
  { code: "mapping_error", label: "对标错", hint: "字段抽取或口径映射错误" },
  { code: "misunderstanding", label: "信息误解", hint: "转录 / 文档理解错误" },
  { code: "missing_info", label: "信息缺失", hint: "我补充新材料后重算" },
  { code: "subjective", label: "主观偏差", hint: "仅与印象不符——只记录，评级不变" },
];

/** 缺失原因选项（code 与契约 MissingDataReasonCode 一一对应）。 */
export const MISSING_REASON_OPTIONS: readonly { code: string; label: string }[] = [
  { code: "confidentiality_period", label: "保密期（上市/并购）" },
  { code: "relationship_broken", label: "关系交恶" },
  { code: "major_litigation", label: "重大诉讼" },
  { code: "lost_contact", label: "失联" },
  { code: "suspended", label: "停业" },
  { code: "bankrupt", label: "破产" },
  { code: "other", label: "其他（自由文本）" },
];
