/**
 * 项目中枢 B3-T1（#4495）—— 四个采集器共用的形状与两个小函数。
 *
 * 采集器的契约：拿着调用方交出的项目判定（`PermissionDecision`，对着 `project:<id>` 的 `read.published`）
 * 把来源读出来，逐条 `upsert` 成证据单元；判定不允许 ⇒ 什么都不写、什么都不回（`CollectResult` 全 0）。
 * 采集器**不判权**——判权是用例的事（挂载用例 / B3-T2 的入图用例），采集器只消费它的结果。
 */
import type { PermissionDecision } from "../../../domain/identity/permission-decision";
import type { OrgId } from "../../../domain/org-id";
import { discloseDecided, isDisclosed, type Guarded } from "../../security/permission-filter";
import type { ProjectEvidencePort, UpsertEvidenceCommand } from "../project-evidence-ports";
import type { ProjectEvidenceSourcePort } from "./ports";

/** 契约 `ProjectEvidenceItem.excerpt` 的上限。 */
export const EVIDENCE_EXCERPT_MAX = 280;

export interface CollectorDeps {
  readonly sources: ProjectEvidenceSourcePort;
  readonly evidence: ProjectEvidencePort;
}

export interface CollectorInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  /** 调用方对这个项目的判定；`allowed: false` ⇒ 采集器静默不采。 */
  readonly decision: PermissionDecision;
}

export interface CollectResult {
  /** 读到的候选条数（含空文本被跳过的）。 */
  readonly scanned: number;
  readonly created: number;
  readonly refreshed: number;
}

export const EMPTY_RESULT: CollectResult = { scanned: 0, created: 0, refreshed: 0 };

/** 压成一段可读摘录：折叠空白、去首尾、截到上限。空 ⇒ `""`（调用方跳过）。 */
export function clipExcerpt(text: string): string {
  const folded = text.replace(/\s+/g, " ").trim();
  return folded.length <= EVIDENCE_EXCERPT_MAX ? folded : `${folded.slice(0, EVIDENCE_EXCERPT_MAX - 1)}…`;
}

/** 判定不允许 ⇒ `null`（采集器据此静默返回）。 */
export function disclosedOrNull<T>(guarded: Guarded<T>, decision: PermissionDecision): T | null {
  const d = discloseDecided(guarded, decision);
  return isDisclosed(d) ? d.payload : null;
}

/** 逐条 upsert 并累计计数；摘录为空的条目跳过（一条没有内容的证据不是证据）。 */
export async function upsertAll(
  evidence: ProjectEvidencePort,
  commands: readonly UpsertEvidenceCommand[],
): Promise<CollectResult> {
  let created = 0;
  let refreshed = 0;
  let scanned = 0;
  for (const cmd of commands) {
    scanned += 1;
    if (cmd.excerpt === "") continue;
    const out = await evidence.upsert(cmd);
    if (out.created) created += 1;
    else refreshed += 1;
  }
  return { scanned, created, refreshed };
}

export function sumResults(parts: readonly CollectResult[]): CollectResult {
  return parts.reduce(
    (acc, p) => ({ scanned: acc.scanned + p.scanned, created: acc.created + p.created, refreshed: acc.refreshed + p.refreshed }),
    EMPTY_RESULT,
  );
}
