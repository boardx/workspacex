/**
 * 项目文件浏览器（22-files）的 mock 数据 —— **纯数据模块，不带 `"use client"`**。
 *
 * ⚠ 这是原型「确认缺失」的模块：原型里只有四处计数钩子（材料准备 9 已入库 /
 *    蓝本项目材料 9 件 / 分组打印素材 4 件 / 对话右栏 材料 12），没有浏览器本体。
 *    因此这里的一切结构都是 [设计]，需人类 sign-off。密度按 UC-22.1 R9「单项目 5000
 *    artifact」的量级取一个可读切片（~40 份），并**刻意塞进边界值**：超大音频、隔离中、
 *    扫描留痕、待人工复核、完整性校验失败、派生物生成中、agent 产出、机密标记。
 *
 * file-first 第 1 条：文件浏览器是 `artifacts / artifact_versions` 的**投影**，
 * 既含用户上传的原件（`file`），也含系统产出物（survey/interview/workshop/research/
 * conversation/canvas/generated 七类物化文件）。`system` 字段用于让界面一眼区分两者。
 */

import { WITHDRAWAL_FLOW } from "@/lib/withdrawal-flow";

/* ── 来源类型（八值枚举，UC-22.1 R3 第 2 步；与各上游模块同一份定义）───────── */

export type SourceType =
  | "file" | "survey" | "interview" | "workshop"
  | "research" | "conversation" | "canvas" | "generated";

export interface SourceMeta {
  key: SourceType;
  label: string;
  /** false = 用户上传的原件；true = 系统物化产出物（file-first 第 1 条要一眼区分） */
  system: boolean;
  hint: string;
}

export const SOURCE_META: SourceMeta[] = [
  { key: "file", label: "文件", system: false, hint: "用户上传的 Word / PDF / PPT / 图片 / 音频" },
  { key: "survey", label: "问卷", system: true, hint: "responses.csv + schema.json（12-survey 物化）" },
  { key: "interview", label: "访谈", system: true, hint: "音频 + transcript.jsonl + notes.md（06-itv 物化）" },
  { key: "workshop", label: "工作坊", system: true, hint: "多路音频 + diarization 转录 + 白板照片（05-rec 物化）" },
  { key: "research", label: "研究", system: true, hint: "网页快照 + citations.json（研究 Studio 物化）" },
  { key: "conversation", label: "对话", system: true, hint: "messages.jsonl，以会话为文件粒度（08-chat 物化）" },
  { key: "canvas", label: "画布", system: true, hint: "mermaid 源码 .md + 布局快照（07-canvas 物化，D-08）" },
  { key: "generated", label: "AI 生成", system: true, hint: "内容文件 + provenance.json（醒目标 synthesized）" },
];

export const SOURCE_LABEL: Record<SourceType, string> =
  Object.fromEntries(SOURCE_META.map((s) => [s.key, s.label])) as Record<SourceType, string>;

/* ── 摄取九态状态机（UC-22.2 R8 界面表：每态有文案 + 出口）───────────────── */

export type IngestState =
  | "RECEIVED" | "QUARANTINED" | "SCANNED" | "STORED" | "EXTRACTED"
  | "SEGMENTED" | "ENRICHED" | "INDEXED" | "REVIEW_PENDING" | "READY";

export type IngestTone = "neutral" | "primary" | "warning" | "danger" | "success";

export interface IngestMeta {
  key: IngestState;
  /** 界面文案（不是裸状态名） */
  label: string;
  /** 用户可见的出口——没有出口的中间态等于黑洞（UC-22.2 R7） */
  exits: string[];
  tone: IngestTone;
  /** 一句话解释「它卡在这一步意味着什么」，避免做成转圈圈 */
  meaning: string;
  /** 是否已可在浏览器下载原件（STORED 之后即可，UC-22.2 R3 第 6 步） */
  downloadable: boolean;
  /** 是否已进入检索召回（仅 READY / INDEXED 之后） */
  retrievable: boolean;
}

/** 九态（+REVIEW_PENDING）的完整界面契约。顺序即流水线顺序。 */
export const INGEST_PIPELINE: IngestMeta[] = [
  { key: "RECEIVED", label: "已接收", exits: ["取消上传"], tone: "neutral",
    meaning: "字节流已到达，已算出 content_hash，尚未做任何检查。", downloadable: false, retrievable: false },
  { key: "QUARANTINED", label: "安全检查中", exits: ["取消"], tone: "warning",
    meaning: "文件在隔离区，尚未进入项目可见范围，正在等恶意扫描。", downloadable: false, retrievable: false },
  { key: "SCANNED", label: "安全检查通过", exits: ["—（自动流转）"], tone: "neutral",
    meaning: "恶意扫描 + MIME 嗅探 + 解压炸弹三项检查通过。", downloadable: false, retrievable: false },
  { key: "STORED", label: "已入库（可下载）", exits: ["下载原件", "在文件浏览器中查看"], tone: "primary",
    meaning: "原件已落对象存储正式区，此刻起即可见可下载——哪怕后续步骤没跑完。", downloadable: true, retrievable: false },
  { key: "EXTRACTED", label: "正在读取内容", exits: ["失败时：重试 / 手工补文本版"], tone: "neutral",
    meaning: "按类型抽取正文：PDF/Office 解析、图片 OCR、音视频 ASR、CSV/JSONL 结构化读取。", downloadable: true, retrievable: false },
  { key: "SEGMENTED", label: "正在切分", exits: ["失败时：重试"], tone: "neutral",
    meaning: "切成 Segment 并生成 anchor，每段能回到页码 / 时间码 / 消息 / 图片区域。", downloadable: true, retrievable: false },
  { key: "ENRICHED", label: "正在建立语义索引", exits: ["失败时：重试（不影响原件可用）"], tone: "neutral",
    meaning: "生成 embedding、实体候选、视觉描述，全部记录模型与版本。", downloadable: true, retrievable: false },
  { key: "INDEXED", label: "已可检索", exits: ["—"], tone: "primary",
    meaning: "写入 FTS 与 pgvector，权限已随之传播到 Segment / embedding / 图节点 / 缓存。", downloadable: true, retrievable: true },
  { key: "REVIEW_PENDING", label: "等待人工确认", exits: ["接受", "拒绝", "查看检出详情"], tone: "warning",
    meaning: "命中机密标记 / 疑似 PII / 解析质量过低，须人接受后才 READY，接受前不进检索。", downloadable: true, retrievable: false },
  { key: "READY", label: "就绪", exits: ["查看", "下载", "归入环节"], tone: "success",
    meaning: "全链路完成，已进入检索召回范围。", downloadable: true, retrievable: true },
];

export const INGEST_META: Record<IngestState, IngestMeta> =
  Object.fromEntries(INGEST_PIPELINE.map((s) => [s.key, s])) as Record<IngestState, IngestMeta>;

/** REVIEW_PENDING 的三类原因（UC-22.2 R3 第 11 步）*/
export type ReviewReason = "confidential" | "pii" | "low-quality";
export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  confidential: "勾选了含客户机密",
  pii: "检出疑似 PII（邮箱 / 手机号 / 身份证 / 银行卡 / 详细住址）",
  "low-quality": "解析质量低于阈值（OCR 置信度过低）",
};

/* ── 权限与可见性 ──────────────────────────────────────────────────────── */

export type Visibility = "all" | "group" | "private" | "team";
export const VISIBILITY_LABEL: Record<Visibility, string> = {
  all: "全场", group: "本组", private: "私有", team: "仅某团队",
};

/* ── 议程环节（本模块唯一使用的环节字段：agenda_segment，D-03a）─────────── */

export interface AgendaSegment { id: string; name: string; }
export const AGENDA_SEGMENTS: AgendaSegment[] = [
  { id: "seg-1", name: "环节 1 · 立项与目标对齐" },
  { id: "seg-3", name: "环节 3 · 现状诊断（采购流程）" },
  { id: "seg-5", name: "环节 5 · 假设风暴" },
  { id: "seg-7", name: "环节 7 · 商业模式共创" },
];
/** 未绑定环节的落点——必须存在且不可隐藏（UC-22.1 R3 第 2 步）*/
export const UNSEGMENTED = { id: "seg-none", name: "未归入环节" };

/* ── 上传者（人或 agent；agent 必须显示 agent 名 + agent_run_id）──────────── */

export type UploaderType = "human" | "agent";
export interface Uploader {
  type: UploaderType;
  name: string;
  /** agent 上传者必带；人恒为 undefined（V10：不存在 human 却带 agent_run_id）*/
  agentRunId?: string;
}

/* ── 版本 / 派生物 ─────────────────────────────────────────────────────── */

export interface FileVersion {
  version: number;
  createdAt: string;
  by: Uploader;
  sizeBytes: number;
  sha256: string;
  /** 变更来源：上传 / 物化 / 重跑 */
  changeSource: "上传" | "物化" | "重跑";
  current: boolean;
}

export interface DerivedFile {
  name: string;
  kind: "ocr" | "transcript" | "summary" | "layout" | "provenance" | "embedding";
  sizeBytes: number;
  /** 指回具体版本（不是 artifact_id，UC-22.4 R3 第 5 步）*/
  derivedFromVersion: number;
  generatorModel: string;
  generatorVersion: string;
  /** embedding 只登记不物化成可下载文件；其余都可下载 */
  downloadable: boolean;
  /** 派生物本身也可能还在生成中（A4：音频先入库、转录后到）*/
  generating?: boolean;
}

/* ── 预览类型（UC-22.1 R3 第 4 步）──────────────────────────────────────── */

export type PreviewKind = "pdf" | "image" | "audio" | "text" | "markdown" | "jsonl" | "csv" | "unsupported";

/* ── 文件条目 ─────────────────────────────────────────────────────────── */

export interface FileItem {
  id: string;
  name: string;
  ext: string;
  sourceType: SourceType;
  segmentId: string;            // agenda_segment_id 或 UNSEGMENTED.id
  sizeBytes: number;
  versionCount: number;
  createdAt: string;
  uploader: Uploader;
  visibility: Visibility;
  confidential: boolean;
  ingest: IngestState;
  reviewReasons?: ReviewReason[];
  sha256: string;
  synthesized?: boolean;        // generated 类必带
  integrity?: "ok" | "failed";  // 完整性校验（SHA-256 比对）
  preview: PreviewKind;
  /** 隔离/扫描不通过的留痕记录：可见但不可下载（UC-22.2 E2）*/
  quarantineNote?: string;
  derived?: DerivedFile[];
  versions?: FileVersion[];
  /** 从哪个业务对象物化而来（UC-22.3 双向导航）*/
  sourceRef?: string;
}

const sha = (s: string) => `sha256:${s}`;

/**
 * ~40 份文件的可读切片。字段完整度按 UC-22.1 R3 第 3 步的十列做满。
 * 边界值集中在文件区与访谈区，方便 sign-off 逐个核对信息密度。
 */
export const FILES: FileItem[] = [
  // ── file（用户上传原件）──────────────────────────────────────────────
  { id: "a-001", name: "客户 RFP · 欧洲储能进入", ext: "pdf", sourceType: "file", segmentId: "seg-1",
    sizeBytes: 4_820_331, versionCount: 3, createdAt: "2026-07-12 09:41", uploader: { type: "human", name: "林可" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("9f2a…c714"), preview: "pdf",
    derived: [
      { name: "客户 RFP.ocr.txt", kind: "ocr", sizeBytes: 88_402, derivedFromVersion: 3, generatorModel: "paddle-ocr", generatorVersion: "2.7.1", downloadable: true },
      { name: "客户 RFP.summary.md", kind: "summary", sizeBytes: 12_940, derivedFromVersion: 3, generatorModel: "gpt-5.2", generatorVersion: "2026-06", downloadable: true },
    ],
    versions: [
      { version: 1, createdAt: "2026-07-08 16:02", by: { type: "human", name: "林可" }, sizeBytes: 4_610_002, sha256: sha("11ab…9930"), changeSource: "上传", current: false },
      { version: 2, createdAt: "2026-07-10 11:20", by: { type: "human", name: "高琳" }, sizeBytes: 4_781_113, sha256: sha("77cd…2041"), changeSource: "上传", current: false },
      { version: 3, createdAt: "2026-07-12 09:41", by: { type: "human", name: "林可" }, sizeBytes: 4_820_331, sha256: sha("9f2a…c714"), changeSource: "上传", current: true },
    ] },
  { id: "a-002", name: "德国工商储电价机制核查", ext: "docx", sourceType: "file", segmentId: "seg-3",
    sizeBytes: 264_118, versionCount: 1, createdAt: "2026-07-13 10:05", uploader: { type: "human", name: "陈默" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("2b8e…40f1"), preview: "unsupported" },
  { id: "a-003", name: "客户内部成本模型", ext: "xlsx", sourceType: "file", segmentId: "seg-7",
    sizeBytes: 1_204_882, versionCount: 2, createdAt: "2026-07-14 14:33", uploader: { type: "human", name: "林可" },
    visibility: "team", confidential: true, ingest: "REVIEW_PENDING", reviewReasons: ["confidential"],
    sha256: sha("aa19…7c02"), preview: "unsupported" },
  { id: "a-004", name: "现场照片 · 采购部白板", ext: "jpg", sourceType: "file", segmentId: "seg-3",
    sizeBytes: 6_910_223, versionCount: 1, createdAt: "2026-07-15 15:52", uploader: { type: "human", name: "陈默" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("c3d0…8891"), preview: "image",
    derived: [{ name: "白板照片.ocr.txt", kind: "ocr", sizeBytes: 3_204, derivedFromVersion: 1, generatorModel: "paddle-ocr", generatorVersion: "2.7.1", downloadable: true }] },
  { id: "a-005", name: "扫描件 · 供应商资质（损坏）", ext: "pdf", sourceType: "file", segmentId: "seg-3",
    sizeBytes: 812_004, versionCount: 1, createdAt: "2026-07-15 16:10", uploader: { type: "human", name: "陈默" },
    visibility: "all", confidential: false, ingest: "EXTRACTED", sha256: sha("de44…1120"), preview: "pdf" },
  { id: "a-006", name: "疑似恶意宏文档", ext: "docm", sourceType: "file", segmentId: UNSEGMENTED.id,
    sizeBytes: 402_119, versionCount: 0, createdAt: "2026-07-16 08:22", uploader: { type: "human", name: "外部投递" },
    visibility: "private", confidential: false, ingest: "QUARANTINED", sha256: sha("evil…dead"), preview: "unsupported",
    quarantineNote: "恶意扫描：检出 VBA 自动执行宏（Trojan.Downloader.Generic）。已拒绝入正式区，仅合规角色可处置。" },
  { id: "a-007", name: "客户品牌手册", ext: "pdf", sourceType: "file", segmentId: UNSEGMENTED.id,
    sizeBytes: 22_408_119, versionCount: 1, createdAt: "2026-07-11 12:00", uploader: { type: "human", name: "林可" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("bb71…0043"), integrity: "failed", preview: "pdf" },

  // ── survey（问卷物化：responses.csv + schema.json）───────────────────
  { id: "a-010", name: "采购决策问卷 · responses", ext: "csv", sourceType: "survey", segmentId: "seg-3",
    sizeBytes: 148_220, versionCount: 4, createdAt: "2026-07-14 18:00", uploader: { type: "agent", name: "物化器 · survey", agentRunId: "run-svy-8841" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("55aa…9021"), preview: "csv", sourceRef: "survey-204",
    versions: [
      { version: 1, createdAt: "2026-07-13 20:00", by: { type: "agent", name: "物化器 · survey", agentRunId: "run-svy-8801" }, sizeBytes: 41_002, sha256: sha("10aa…0001"), changeSource: "物化", current: false },
      { version: 4, createdAt: "2026-07-14 18:00", by: { type: "agent", name: "物化器 · survey", agentRunId: "run-svy-8841" }, sizeBytes: 148_220, sha256: sha("55aa…9021"), changeSource: "物化", current: true },
    ] },
  { id: "a-011", name: "采购决策问卷 · schema", ext: "json", sourceType: "survey", segmentId: "seg-3",
    sizeBytes: 9_882, versionCount: 1, createdAt: "2026-07-13 20:00", uploader: { type: "agent", name: "物化器 · survey", agentRunId: "run-svy-8801" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("77bb…3120"), preview: "text", sourceRef: "survey-204" },

  // ── interview（访谈物化：音频 + transcript.jsonl + notes.md）──────────
  { id: "a-020", name: "客户访谈 07 · 采购总监", ext: "m4a", sourceType: "interview", segmentId: "seg-3",
    sizeBytes: 2_314_882_004, versionCount: 1, createdAt: "2026-07-15 14:12", uploader: { type: "human", name: "林可" },
    visibility: "all", confidential: true, ingest: "READY", sha256: sha("f001…aa20"), preview: "audio", sourceRef: "itv-07",
    derived: [
      { name: "访谈 07.transcript.jsonl", kind: "transcript", sizeBytes: 204_882, derivedFromVersion: 1, generatorModel: "whisper-large-v3", generatorVersion: "2026-05", downloadable: true },
      { name: "访谈 07.notes.md", kind: "summary", sizeBytes: 8_204, derivedFromVersion: 1, generatorModel: "gpt-5.2", generatorVersion: "2026-06", downloadable: true },
    ] },
  { id: "a-021", name: "客户访谈 09 · 财务负责人", ext: "m4a", sourceType: "interview", segmentId: "seg-7",
    sizeBytes: 1_882_004_112, versionCount: 1, createdAt: "2026-07-16 10:40", uploader: { type: "human", name: "高琳" },
    visibility: "all", confidential: false, ingest: "EXTRACTED", sha256: sha("f102…bb31"), preview: "audio", sourceRef: "itv-09",
    derived: [{ name: "访谈 09.transcript.jsonl", kind: "transcript", sizeBytes: 0, derivedFromVersion: 1, generatorModel: "whisper-large-v3", generatorVersion: "2026-05", downloadable: false, generating: true }] },

  // ── workshop（工作坊物化：多路音频 + diarization 转录 + 白板照片）──────
  { id: "a-030", name: "工作坊录音 · 主麦", ext: "wav", sourceType: "workshop", segmentId: "seg-5",
    sizeBytes: 984_112_004, versionCount: 1, createdAt: "2026-07-16 16:00", uploader: { type: "human", name: "林可" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("ab01…cd02"), preview: "audio", sourceRef: "wks-2",
    derived: [{ name: "工作坊.transcript.jsonl", kind: "transcript", sizeBytes: 312_004, derivedFromVersion: 1, generatorModel: "pyannote+whisper", generatorVersion: "2026-05", downloadable: true }] },
  { id: "a-031", name: "工作坊白板 · 假设墙", ext: "png", sourceType: "workshop", segmentId: "seg-5",
    sizeBytes: 8_112_882, versionCount: 1, createdAt: "2026-07-16 16:05", uploader: { type: "human", name: "陈默" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("ba10…dc20"), preview: "image", sourceRef: "wks-2" },

  // ── research（研究物化：网页快照 + citations.json）────────────────────
  { id: "a-040", name: "Bundesnetzagentur 并网年报 2025（快照）", ext: "html", sourceType: "research", segmentId: "seg-3",
    sizeBytes: 1_402_882, versionCount: 1, createdAt: "2026-07-14 09:12", uploader: { type: "agent", name: "Scout · 同行情报", agentRunId: "run-rsh-3320" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("cc01…ee02"), preview: "unsupported", sourceRef: "rsh-11" },
  { id: "a-041", name: "研究 run 11 · citations", ext: "json", sourceType: "research", segmentId: "seg-3",
    sizeBytes: 24_118, versionCount: 1, createdAt: "2026-07-14 09:12", uploader: { type: "agent", name: "Scout · 同行情报", agentRunId: "run-rsh-3320" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("cd10…ef20"), preview: "text", sourceRef: "rsh-11" },

  // ── conversation（对话物化：以会话为文件粒度）────────────────────────
  { id: "a-050", name: "线程 · 假设梳理（52 条消息）", ext: "jsonl", sourceType: "conversation", segmentId: "seg-5",
    sizeBytes: 402_119, versionCount: 6, createdAt: "2026-07-16 17:20", uploader: { type: "agent", name: "物化器 · conversation", agentRunId: "run-cnv-9021" },
    visibility: "group", confidential: false, ingest: "READY", sha256: sha("dd01…ff02"), preview: "jsonl", sourceRef: "thread-118" },
  { id: "a-051", name: "线程 · 采购比选（含机密引用）", ext: "jsonl", sourceType: "conversation", segmentId: "seg-3",
    sizeBytes: 210_882, versionCount: 3, createdAt: "2026-07-16 12:02", uploader: { type: "agent", name: "物化器 · conversation", agentRunId: "run-cnv-9040" },
    visibility: "team", confidential: true, ingest: "READY", sha256: sha("de11…fa22"), preview: "jsonl", sourceRef: "thread-121" },

  // ── canvas（画布物化：mermaid 源码 .md + 布局快照）────────────────────
  { id: "a-060", name: "进入模式假设树 v3（mermaid）", ext: "md", sourceType: "canvas", segmentId: "seg-5",
    sizeBytes: 6_204, versionCount: 3, createdAt: "2026-07-16 15:40", uploader: { type: "human", name: "高琳" },
    visibility: "all", confidential: false, ingest: "READY", sha256: sha("ea01…0b02"), preview: "markdown", sourceRef: "canvas-31",
    derived: [{ name: "假设树.layout.png", kind: "layout", sizeBytes: 220_118, derivedFromVersion: 3, generatorModel: "mermaid-render", generatorVersion: "10.9", downloadable: true }] },

  // ── generated（AI 生成：内容文件 + provenance.json，醒目标 synthesized）─
  { id: "a-070", name: "缺料补齐 · 竞品定价假设（草稿）", ext: "md", sourceType: "generated", segmentId: "seg-7",
    sizeBytes: 18_402, versionCount: 1, createdAt: "2026-07-16 18:30", uploader: { type: "agent", name: "Ledger · 收益测算", agentRunId: "run-gen-7781" },
    visibility: "all", confidential: false, ingest: "REVIEW_PENDING", reviewReasons: ["low-quality"], synthesized: true,
    sha256: sha("fa01…1c02"), preview: "markdown", sourceRef: "gen-55",
    derived: [{ name: "provenance.json", kind: "provenance", sizeBytes: 2_118, derivedFromVersion: 1, generatorModel: "gpt-5.2", generatorVersion: "2026-06", downloadable: true }] },
  { id: "a-071", name: "数字专家结论 · 采购风险画像", ext: "md", sourceType: "generated", segmentId: "seg-3",
    sizeBytes: 20_882, versionCount: 2, createdAt: "2026-07-15 21:10", uploader: { type: "agent", name: "Warden · 风险与合规", agentRunId: "run-gen-7620" },
    visibility: "all", confidential: false, ingest: "READY", synthesized: true,
    sha256: sha("fb10…2d20"), preview: "markdown", sourceRef: "gen-52",
    derived: [{ name: "provenance.json", kind: "provenance", sizeBytes: 2_402, derivedFromVersion: 2, generatorModel: "gpt-5.2", generatorVersion: "2026-06", downloadable: true }] },
];

/* ── 树结构（来源类型 → agenda_segment）──────────────────────────────── */

export interface TreeSegNode { seg: AgendaSegment | typeof UNSEGMENTED; count: number; }
export interface TreeSourceNode { meta: SourceMeta; count: number; children: TreeSegNode[]; }

/** 把 FILES 投影成树。空来源节点仍显示（A5：来源存在但还没有内容，不隐藏）。 */
export function buildTree(files: FileItem[] = FILES): TreeSourceNode[] {
  const segs = [...AGENDA_SEGMENTS, UNSEGMENTED];
  return SOURCE_META.map((meta) => {
    const inSource = files.filter((f) => f.sourceType === meta.key);
    const children = segs
      .map((seg) => ({ seg, count: inSource.filter((f) => f.segmentId === seg.id).length }))
      .filter((c) => c.count > 0);
    return { meta, count: inSource.length, children };
  });
}

/* ── 摄取进度抽屉：正在处理中的上传（跨九态各取一例）──────────────────── */

export interface IngestionRun {
  id: string;
  fileName: string;
  state: IngestState;
  elapsed: string;
  /** 失败态的三段式：在哪一步失败 + 为什么 + 能做什么（UC-22.2 R8）*/
  failure?: { where: string; why: string };
  /** 幂等命中：这份材料已在库（UC-22.2 A3）*/
  duplicateOf?: string;
  reviewReasons?: ReviewReason[];
  /** 对应的 artifact_id（D-U11）：复核处置以它为键，抽屉与独立复核屏共享同一份状态。
   *  只有已入库、能进复核队列的运行才有。 */
  artifactId?: string;
}

export const INGESTION_RUNS: IngestionRun[] = [
  { id: "run-1", fileName: "季度供应商评估.pptx", state: "RECEIVED", elapsed: "2 秒" },
  { id: "run-2", fileName: "疑似恶意宏文档.docm", state: "QUARANTINED", elapsed: "8 秒" },
  { id: "run-3", fileName: "采购合同 2024（扫描）.pdf", state: "EXTRACTED", elapsed: "41 秒" },
  { id: "run-4", fileName: "客户内部成本模型.xlsx", state: "REVIEW_PENDING", elapsed: "1 分 12 秒", reviewReasons: ["confidential"], artifactId: "a-003" },
  { id: "run-5", fileName: "现场录音 · 补充访谈.m4a", state: "STORED", elapsed: "3 分 40 秒",
    failure: { where: "读取内容（EXTRACTED）", why: "ASR 服务暂不可用——原件已入库可下载，转录稍后重试。" } },
  { id: "run-6", fileName: "客户 RFP · 欧洲储能进入.pdf", state: "READY", elapsed: "已完成",
    duplicateOf: "已在库（v3，2026-07-12 由 林可 上传）" },
  { id: "run-7", fileName: "解压炸弹.zip", state: "QUARANTINED", elapsed: "5 秒",
    failure: { where: "安全检查（SCANNED）", why: "解压后总量 42 GB 超上限 2 GB，嵌套 9 层超上限 3 层。已拒绝，未完整解压。" } },
];

/* ── 删除影响面（UC-22.4 R3 第 8~9 步：删除前必须让人看见代价）──────────── */

export interface CascadeItem { no: string; object: string; effect: string; emphasis?: "danger" | "human"; }

export interface DeleteImpact {
  fileName: string;
  versionCount: number;
  derivedCount: number;
  segmentCount: number;
  /** 被哪些 Claim / 报告段落引用 */
  claims: string[];
  reportParagraphs: string[];
  legalHold: boolean;
  /** 是否已导出到组织外（回执须如实说明无法回收，UC-22.4 E2）*/
  exportedOutside?: string;
  cascade: CascadeItem[];
}

export const DELETE_IMPACT: DeleteImpact = {
  fileName: "客户访谈 07 · 采购总监.m4a",
  versionCount: 1,
  derivedCount: 2,
  segmentCount: 38,
  claims: ["C-114 采购委员会决策周期约 90 天", "C-131 质保条款是签约主要障碍"],
  reportParagraphs: ["《欧洲进入策略》§3.2 采购路径", "《欧洲进入策略》§4.1 风险清单"],
  legalHold: false,
  exportedOutside: "2026-07-16 由 林可 导出为 zip（导出包 exp-3391），客户已下载 —— 已出域内容无法回收。",
  cascade: [
    { no: "①", object: "文件浏览器中的条目", effect: "原件与全部版本、全部派生物均不再出现、不可下载", emphasis: "danger" },
    { no: "②", object: "OCR / 转录 / 摘要等派生文件", effect: "2 个派生物一并进入待删除队列" },
    { no: "③", object: "embedding（pgvector）", effect: "38 段退出向量召回" },
    { no: "④", object: "FTS 索引与 Segment", effect: "38 段退出全文检索召回" },
    { no: "⑤", object: "图边（ontology_edges）", effect: "6 条相关边标记 invalidated" },
    { no: "⑥", object: "缓存与已构建 Context Pack", effect: "4 个 Context Pack 失效；后续检索不再返回其内容" },
    { no: "⑦", object: "报告段落", effect: "2 处引用标为「证据已撤回」；已支撑已签字决策，通知拍板人复核，不自动改结论", emphasis: "human" },
  ],
};

/* ── 待删除队列（合规角色专属屏；五步流程，D-13 前置进 phase-1）──────────── */

export type TrashStepState = "done" | "active" | "pending" | "human";

export interface TrashTask {
  id: string;
  fileName: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  /** 物理删除截止（≤30 天，O-01 宽限期）*/
  physicalDeleteDue: string;
  overdue?: boolean;
  legalHold?: boolean;
  partialFailure?: string;
  steps: { no: string; label: string; sla: string; state: TrashStepState }[];
}

/**
 * ⚠ 五步与其 SLA 来自单一事实源 `lib/withdrawal-flow.ts`（裁决 D-13 / D-15 / D-19）。
 * 此前这里维护了一份副本，第 03 步写成「即时」，与同意书那份的「≤5 分钟」**已经漂移**。
 * 本函数现在只负责把「进度状态」叠加到那份权威定义上，**不再复述内容与时限**。
 */
const FIVE_STEPS = (states: TrashStepState[]) =>
  WITHDRAWAL_FLOW.map((s, i) => ({
    no: s.no,
    label: s.step,
    sla: s.sla,
    state: states[i]!,
  }));

export const TRASH_TASKS: TrashTask[] = [
  { id: "del-1", fileName: "客户访谈 03 · 物流总监.m4a", reason: "受访者撤回同意（撤回录音 + 分析）",
    requestedBy: "受访者自助门户", requestedAt: "2026-07-16 20:10", physicalDeleteDue: "2026-08-15",
    steps: FIVE_STEPS(["done", "done", "done", "human", "pending"]) },
  { id: "del-2", fileName: "内部草稿 · 定价测算 v1.xlsx", reason: "留存期到期（材料保留期 180 天）",
    requestedBy: "系统 · 到期扫描", requestedAt: "2026-07-10 03:00", physicalDeleteDue: "2026-07-18",
    overdue: true, steps: FIVE_STEPS(["done", "done", "done", "done", "active"]) },
  { id: "del-3", fileName: "客户机密 · 并购意向备忘.pdf", reason: "项目负责人发起删除",
    requestedBy: "林可", requestedAt: "2026-07-16 18:44", physicalDeleteDue: "—",
    legalHold: true, steps: FIVE_STEPS(["done", "pending", "pending", "pending", "pending"]) },
  { id: "del-4", fileName: "工作坊录音 · 分组 B.wav", reason: "受访者撤回同意（仅撤回 AI 分析，音频保留）",
    requestedBy: "受访者自助门户", requestedAt: "2026-07-15 11:20", physicalDeleteDue: "进行中",
    partialFailure: "第 ⑤ 项（图边失效）执行失败 —— 任务标为「部分失败」，未出回执，已告警并重试中。",
    steps: FIVE_STEPS(["done", "done", "done", "active", "pending"]) },
];

/* ── 工具函数（纯函数，可在服务端与客户端共用）──────────────────────────── */

export function formatBytes(n: number): string {
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export type FilesScreen = "browser" | "upload" | "ingestion" | "review" | "versions" | "delete" | "trash";
export const FILES_SCREENS: FilesScreen[] = ["browser", "upload", "ingestion", "review", "versions", "delete", "trash"];
export const FILES_SCREEN_LABEL: Record<FilesScreen, string> = {
  browser: "浏览器主屏", upload: "上传弹层", ingestion: "摄取进度抽屉",
  review: "人工复核", versions: "版本列表", delete: "删除确认", trash: "待删除队列",
};
export function resolveFilesScreen(raw: string | string[] | undefined): FilesScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return FILES_SCREENS.includes(v as FilesScreen) ? (v as FilesScreen) : "browser";
}

/** 六项筛选（UC-22.1 R3 第 7 步）—— 仅用于顶栏展示，真实过滤在服务端 RLS */
export const FILTERS = [
  { key: "source", label: "来源类型" },
  { key: "segment", label: "所属环节" },
  { key: "time", label: "时间范围" },
  { key: "uploader", label: "上传者" },
  { key: "confidential", label: "含机密标记" },
  { key: "ingest", label: "摄取状态" },
] as const;
