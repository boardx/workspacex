/**
 * 形式与语言 —— 「全线上」自动增删两个议程环节（F19 / `uc-2-1` R3 步骤 2 + A2 / I-16 / V5，
 * 契约 `setFormatAndLanguage`）。
 *
 * 纯函数：给定切换前后的形式（以及当前档位对应的基础议程环节数），算出要自动追加/
 * 移除哪两个环节，以及切换后的总议程环节数。
 *
 * ## 「对称」是可断言的
 *
 * 契约注释逐字：「『对称』是可断言的：加过什么就移除什么，**不是『移除所有 optional
 * 的』**」——本文件只认 `ONLINE_AUTO_SEGMENTS` 这两个固定 key，不去碰
 * `duration-tier.ts` 那批因升档而 optional 的环节。切回非线上只移除这两个，
 * 其余可选环节（例如因升档新增的商业模式草稿环节）原样保留。
 *
 * ## 语言
 *
 * 语言三选一（中文 / English / 双语现场）只影响产出物与报告模板的生成语言
 * （下游产出生成的职责，不在本 feature 范围内），本文件不对语言做任何议程环节联动。
 */
import type { z } from "zod";
import { templates } from "@repo/contracts";
import type { AgendaSegmentRefLike } from "./duration-tier";

/** 切「全线上」时固定追加的两个环节（R3 步骤 2 / A2 原文：「破冰」「举手排队」）。 */
export const ONLINE_AUTO_SEGMENTS: readonly AgendaSegmentRefLike[] = [
  { agendaSegmentId: "icebreaker", title: "破冰", addedBy: "format-setting", optional: true },
  { agendaSegmentId: "hand-raise-queue", title: "举手排队", addedBy: "format-setting", optional: true },
];

/** 派生自契约，不重写（`lint-contract-source` 强制）。 */
export type SessionFormat = z.infer<typeof templates.SessionFormat>;

export interface PlanFormatChangeInput {
  /** 当前档位对应的议程环节数，**不含**「全线上」自动追加的两个（由 `agenda-segment-table.ts` 算） */
  readonly baseAgendaSegmentCount: number;
  readonly previousFormat: SessionFormat;
  readonly nextFormat: SessionFormat;
}

export interface FormatChangeResult {
  readonly agendaSegmentCount: number;
  readonly autoAdded: readonly AgendaSegmentRefLike[];
  readonly autoRemoved: readonly AgendaSegmentRefLike[];
}

export function planFormatChange(input: PlanFormatChangeInput): FormatChangeResult {
  const wasOnline = input.previousFormat === "online";
  const isOnline = input.nextFormat === "online";

  const autoAdded = !wasOnline && isOnline ? ONLINE_AUTO_SEGMENTS : [];
  const autoRemoved = wasOnline && !isOnline ? ONLINE_AUTO_SEGMENTS : [];

  return {
    agendaSegmentCount: input.baseAgendaSegmentCount + (isOnline ? ONLINE_AUTO_SEGMENTS.length : 0),
    autoAdded,
    autoRemoved,
  };
}
