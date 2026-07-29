// evidence-fingerprint.ts — evidence 日志与「命令真的执行过」之间的机器绑定。
//
// 背景（2026-07-29 控制平面健康度审计，见 .harness/state/quality-document.md）：
// 在干净仓库上把一个 not_started 的 feature 手改成 passing，再手写一份 5 行、含
// `[exit 0]` 的日志并提交，最后手对齐 PROGRESS.md 的表格计数 —— `harness doctor`
// 报「✓ 审计链完整：所有 passing 都有真实非空证据」。整条审计链的可信度上限，
// 等于一个纯文本文件的可信度。
//
// ⚠ 这不是防伪。信任锚在仓库内部，读得懂本文件的人就能重算哈希。它做的是**把
// 「顺手手写一份」的成本，从写 5 行文本抬到必须复现本文件的逻辑**，并让任何对
// 日志正文的事后改动在 doctor 里立刻变红。对「被交付压力驱使的 agent 走捷径」
// 这个真实威胁模型，这一层足够；对蓄意造假者不够 —— 要防后者需要脱离仓库的
// 信任锚（CI 侧签名 artifact），属于另一个决策。**别把本文件当成防伪。**
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sh } from "./sh";
import { REPO_ROOT } from "./paths";

/** 尾行格式：`[harness-verify v1 sha256=<64hex> commit=<sha|unknown> at=<ISO>]` */
const TRAILER_RE = /^\[harness-verify v1 sha256=([0-9a-f]{64}) commit=(\S+) at=(\S+)\]$/m;

function digest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * 给日志正文补上尾行。正文与尾行之间固定一个换行——校验侧按同样规则切回去，
 * 两边都只认这一种形态，避免「写的时候多一个空行、验的时候哈希就对不上」。
 */
export function appendFingerprint(body: string): string {
  const head = sh("git rev-parse HEAD");
  const commit = head.code === 0 ? head.stdout.trim() : "unknown";
  return `${body}\n[harness-verify v1 sha256=${digest(body)} commit=${commit} at=${new Date().toISOString()}]`;
}

export type FingerprintVerdict =
  | { kind: "ok"; commit: string }
  /** 没有尾行：verify 从未产出过它（手写的日志、或本门控上线前的历史日志） */
  | { kind: "missing" }
  /** 有尾行但哈希对不上：日志正文在 verify 落盘之后被改过 */
  | { kind: "tampered"; expected: string; actual: string };

export function checkFingerprint(content: string): FingerprintVerdict {
  const m = TRAILER_RE.exec(content);
  if (!m) return { kind: "missing" };
  // 正文 = 尾行之前的部分，去掉 appendFingerprint 加的那一个换行
  const body = content.slice(0, m.index).replace(/\n$/, "");
  const actual = digest(body);
  return actual === m[1] ? { kind: "ok", commit: m[2] } : { kind: "tampered", expected: m[1], actual };
}

const LEGACY_PATH = join(REPO_ROOT, ".harness/state/evidence-legacy.json");

/**
 * 指纹门控上线前就已 passing 的历史存量 —— 缺指纹判 WARN 而非 FAIL。
 *
 * 这个名单是**显式、可数、只减不增**的技术债，不是后门：新做的 feature 不在名单里，
 * 缺指纹一律 FAIL，所以「手写日志冒充 passing」这条路对新增 feature 是堵死的。
 */
export function isLegacyEvidence(phaseId: string, featureId: string): boolean {
  if (!existsSync(LEGACY_PATH)) return false;
  try {
    const list: unknown = JSON.parse(readFileSync(LEGACY_PATH, "utf8")).grandfathered;
    return Array.isArray(list) && list.includes(`${phaseId}/${featureId}`);
  } catch {
    return false; // 名单读不出来时按「不豁免」处理：宁可多红，不可漏放
  }
}
