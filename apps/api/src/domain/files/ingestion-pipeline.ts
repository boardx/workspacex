/**
 * The nine-state ingestion pipeline (+ REVIEW_PENDING) -- uc-22-2 R8's structural contract.
 *
 * Innermost layer -- no I/O, no HTTP, no PostgreSQL. This is the ONLINE state machine's own
 * declaration of "what does each state mean to a user, and what can they do about it" --
 * i.e. exactly the two facts R7/R8 require never be missing:
 *
 *   V2  every state that ever occurs has a non-empty `label` (no bare status codes surfaced)
 *       AND a non-empty `exits` array (a non-terminal state with zero exits is a black hole:
 *       the user's only option is to wait, and nothing tells them for how long).
 *
 * `apps/web/lib/mock/files.ts`'s `INGEST_PIPELINE` is the SAME fact, declared for the UI
 * layer (it predates this file -- the drawer shipped before the backend state machine did).
 * That is a second declaration site, in a different package this one cannot import (api
 * cannot depend on web). It is not left as an unchecked claim: this module documents the
 * agreement in prose and `tests/files/nine-state-visible-exits.test.ts` is the structural
 * assertion over THIS file; a person changing one without the other still has to notice the
 * mismatch by reading both, same tradeoff `ingestion-visibility.ts` already made and states
 * in its own header.
 *
 * ⚠ `originalDownloadable` / `retrievable` are NOT repeated here. They already have one
 * source (`ingestion-visibility.ts`, N-7) and this module imports it rather than restating
 * the same two facts a third time.
 */
import { DOWNLOADABLE_STATES, RETRIEVABLE_STATES, type IngestionStatus } from "./ingestion-visibility";

export type { IngestionStatus };

export interface IngestionStateMeta {
  readonly key: IngestionStatus;
  /** User-facing text. Never the bare enum member -- that is what "no裸错误码" rules out. */
  readonly label: string;
  /**
   * User-visible exits from this state. NEVER empty (V2) -- a state with nothing here is
   * a black hole: the user can only wait, indefinitely, with no signal of how long.
   * `READY` still has exits ("查看" / "下载" / "归入环节") precisely so this holds for the
   * one terminal happy-path state too, not only for the failure/branch states.
   */
  readonly exits: readonly string[];
  /** One sentence: what does being stuck here mean, concretely. */
  readonly meaning: string;
}

/**
 * The pipeline in flow order. `REVIEW_PENDING` is a FORK off `INDEXED` (uc-22-2 R3 step 11),
 * not a tenth rung on the same ladder -- see `legalNextStates` below for the actual graph,
 * which is not a straight line.
 */
export const INGESTION_PIPELINE: readonly IngestionStateMeta[] = [
  {
    key: "RECEIVED",
    label: "已接收",
    exits: ["取消上传"],
    meaning: "字节流已到达，已算出 content_hash，尚未做任何检查。",
  },
  {
    key: "QUARANTINED",
    label: "安全检查中",
    exits: ["取消"],
    meaning: "文件在隔离区，尚未进入项目可见范围，正在等恶意扫描 / MIME 嗅探 / 解压炸弹三项检查。",
  },
  {
    key: "SCANNED",
    label: "安全检查通过",
    exits: ["—（自动流转）"],
    meaning: "三项安全检查通过，即将写入对象存储。",
  },
  {
    key: "STORED",
    label: "已入库（可下载）",
    exits: ["下载原件", "在文件浏览器中查看"],
    meaning: "原件已落对象存储正式区，此刻起即可见可下载——哪怕后续步骤没跑完（file-first 底线）。",
  },
  {
    key: "EXTRACTED",
    label: "正在读取内容",
    exits: ["失败时：重试 / 手工补文本版"],
    meaning: "按类型抽取正文：PDF/Office 解析、图片 OCR、音视频 ASR、CSV/JSONL 结构化读取。",
  },
  {
    key: "SEGMENTED",
    label: "正在切分",
    exits: ["失败时：重试"],
    meaning: "切成 Segment 并生成 anchor，每段能回到页码 / 时间码 / 消息 / 图片区域。",
  },
  {
    key: "ENRICHED",
    label: "正在建立语义索引",
    exits: ["失败时：重试（不影响原件可用）"],
    meaning: "生成 embedding、实体候选、视觉描述，全部记录模型与版本。",
  },
  {
    key: "INDEXED",
    label: "已可检索",
    exits: ["—（自动流转到 READY，或转人工复核）"],
    meaning: "写入 FTS 与 pgvector，权限已随之传播；下一步是 READY 或 REVIEW_PENDING 二选一。",
  },
  {
    key: "REVIEW_PENDING",
    label: "等待人工确认",
    exits: ["接受", "拒绝", "查看检出详情"],
    meaning: "命中机密标记 / 疑似 PII / 解析质量过低，须人接受后才 READY，接受前不进检索。",
  },
  {
    key: "READY",
    label: "就绪",
    exits: ["查看", "下载", "归入环节"],
    meaning: "全链路完成，已进入检索召回范围。",
  },
];

export const INGESTION_STATE_META: Readonly<Record<IngestionStatus, IngestionStateMeta>> = Object.fromEntries(
  INGESTION_PIPELINE.map((s) => [s.key, s]),
) as Record<IngestionStatus, IngestionStateMeta>;

/**
 * Legal successors of a state, i.e. the actual transition graph -- not a straight line,
 * because `INDEXED` forks (uc-22-2 R3 step 11) and `READY` / a rejected `REVIEW_PENDING`
 * are the only two terminals.
 *
 * `RECEIVED`/`QUARANTINED`/`SCANNED` are F35's half of the pipeline (already implemented,
 * pre-`STORED`) and are included here so the WHOLE nine-state graph is one structural fact,
 * not "F35's three states in one file and F36's seven in another".
 */
const TRANSITIONS: Readonly<Record<IngestionStatus, readonly IngestionStatus[]>> = {
  RECEIVED: ["QUARANTINED"],
  QUARANTINED: ["SCANNED"],
  SCANNED: ["STORED"],
  STORED: ["EXTRACTED"],
  EXTRACTED: ["SEGMENTED"],
  SEGMENTED: ["ENRICHED"],
  ENRICHED: ["INDEXED"],
  INDEXED: ["REVIEW_PENDING", "READY"],
  REVIEW_PENDING: ["READY"],
  READY: [],
};

export function legalNextStates(from: IngestionStatus): readonly IngestionStatus[] {
  return TRANSITIONS[from];
}

/** `READY` is the only state nothing legally follows -- everything else has ≥1 successor. */
export function isTerminal(state: IngestionStatus): boolean {
  return TRANSITIONS[state].length === 0;
}

export function originalDownloadableIn(state: IngestionStatus): boolean {
  return DOWNLOADABLE_STATES.includes(state);
}

export function retrievableIn(state: IngestionStatus): boolean {
  return RETRIEVABLE_STATES.includes(state);
}
