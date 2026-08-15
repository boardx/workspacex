/**
 * live-consent.ts —— issue #854 的接线：受访者同意书写入真实后端。
 *
 * ## 为什么这个文件存在
 *
 * #652 已经把 `setConsentDecision` 的后端写方补齐（`recording.controller.ts:451`，
 * 落库到 `recording_consent_cells`），但 `apps/web/` 里从来没有任何调用方——
 * `grep -rn "setConsentDecision" apps/web/` 命中为零。`components/entry/consent-form.tsx`
 * 的勾选只进 React `useState`，刷新即丢，`startRecording` 的 `CONSENT_NOT_COMPLETED`
 * 门禁因此对真实用户永远不可能被满足（issue #854）。本文件是唯一调用方。
 *
 * ## 鉴权模型是既有的、本文件不新发明
 *
 * `setConsentDecision` 复用本束每一条写路由同一个判据（`NO_PROJECT_ROLE`，见契约
 * `KNOWN_CONTRACT_GAPS.C_REC_6`）——提交者必须是这个项目的成员，「谁能替谁点头」
 * 尚未收窄，任一有项目角色的人可以为任意 `participantId` 写决定。这不是本文件的
 * 判断，是契约已经写死的现状；本文件只是把浏览器接到这条已存在的门上。
 */
import { recording } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

const OPS = recording.operations;

export type ConsentItem = z.infer<typeof recording.RecordingConsentItem>;
export type ConsentItemState = z.infer<typeof recording.ConsentItemState>;
export type SetConsentDecisionOut = z.infer<typeof OPS.setConsentDecision.out>;

export interface SetConsentDecisionInput {
  readonly projectId: string;
  readonly sourceRefId: string;
  readonly participantId: string;
  readonly item: ConsentItem;
  readonly state: ConsentItemState;
}

/**
 * 写一格授权矩阵。一次一格——契约本身就是这个形状（`ConsentMatrixCell` 的主键
 * 是 `org_id, source_ref_id, participant_id, item`），调用方（`consent-form.tsx`）
 * 对同意书上的每一项各发一次。
 */
export async function setConsentDecision(
  input: SetConsentDecisionInput,
  sessionToken?: string,
): Promise<SetConsentDecisionOut> {
  return apiRequest<SetConsentDecisionOut>(OPS.setConsentDecision.path, {
    method: "POST",
    body: input,
    sessionToken,
  });
}
