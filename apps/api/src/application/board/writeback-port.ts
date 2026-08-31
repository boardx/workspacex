/**
 * F02 -- `WritebackPort`: the contract for "拖动改列在同一事务内回写来源对象"
 * (uc-11-1 R3.3/R7 -- "回写是契约不是尽力而为：回写失败必须显式标记，不得静默丢弃").
 *
 * ## Why this is a port with only a no-op implementation, this round
 *
 * The real source objects this is supposed to write back to -- 会前任务 (02-tpl)、
 * 现场行动项 (06-live)、报告缺料 (10-report/F24)、决策后续动作 (13-deliv/F43) -- do not
 * have adapters yet (that is F03's job: "六来源适配"). Every task this feature can create
 * is manually created (`source_kind = '手工创建'`), which by construction has no external
 * source object to write back to.
 *
 * So instead of stubbing the whole use case out, this file draws the SEAM: an interface
 * that can express "write succeeded" / "write failed, retryable, do not pretend success",
 * plus the one implementation that is honestly correct today (`ManualSourceWriteback`,
 * always a no-op success because there is nothing to write back to). When F03 lands an
 * adapter for a real source kind, it implements this same interface and gets registered
 * next to `ManualSourceWriteback` -- `change-task-status-with-writeback.ts` does not change.
 */
import type { TaskStatus } from "../../domain/board/task-status";
import type { SourceKind } from "../../domain/board/source-kind";

export interface WritebackInput {
  readonly taskId: string;
  readonly sourceKind: SourceKind;
  readonly fromStatus: TaskStatus;
  readonly toStatus: TaskStatus;
}

export type WritebackResult =
  | { readonly ok: true }
  /** `retryable` is carried through so a caller can decide whether to auto-retry or just
   *  surface "未同步" and wait for a human-triggered retry -- this port does not retry
   *  itself (retry policy is the caller's business, not the adapter's). */
  | { readonly ok: false; readonly retryable: boolean; readonly reason: string };

export interface WritebackPort {
  writeback(input: WritebackInput): Promise<WritebackResult>;
}

/**
 * The one adapter this feature actually wires up. Manually-created cards have no source
 * object -- there is nothing to write back to, so "success" here is not a shortcut, it is
 * the honest answer for this source kind.
 */
export class ManualSourceWriteback implements WritebackPort {
  async writeback(_input: WritebackInput): Promise<WritebackResult> {
    return { ok: true };
  }
}

export const WRITEBACK_PORT = Symbol("WritebackPort");
