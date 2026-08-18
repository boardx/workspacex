/**
 * canvas 束的应用层错误。
 *
 * ## 一个类，不是每码一个类
 *
 * 与 `application/project/errors.ts` 同一条理由，逐字适用：分成多个类会引来分别 `catch`，
 * 然后两个码长出两种响应形状。这里只有一个类，`reasonCode` 是契约 `CanvasError` 的成员，
 * 控制器按码选状态码，而不是按类型选。
 *
 * ## `CanvasIllegalTransitionError` 为什么**不带** reasonCode
 *
 * 「在 published 状态点试跑」「恢复一个没归档的模板」这类非法转移，在契约的 `err` 联合里
 * **没有对应的码**——`trialTemplate.err` 只有 `TEMPLATE_NOT_FOUND` / `ROLE_INSUFFICIENT` /
 * `DEPENDENCY_UNAVAILABLE` 三个。给它硬塞一个最像的码，前端就会按那个码分支，而那个码
 * 在契约里的含义是另一件事。所以它抛的是不带 `reasonCode` 的裸 400——同
 * `ProjectArchiveBlockedByActiveSegmentError` 的处理。这是契约缺口，已在 #463 报出，
 * 不在这里用一个看起来差不多的码把它盖住。
 */
import type { canvas } from "@repo/contracts";
import type { z } from "zod";

export type CanvasReasonCode = z.infer<typeof canvas.CanvasError>;

export class CanvasError extends Error {
  readonly reasonCode: CanvasReasonCode;
  constructor(reasonCode: CanvasReasonCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "CanvasError";
  }
}

/** 状态机拒绝了这次动作。契约没有对应错误码 —— 见文件头。 */
export class CanvasIllegalTransitionError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "CanvasIllegalTransitionError";
  }
}

/**
 * 同一个 key 已经有一个 published 版本，本次动作会产生第二个。
 *
 * 只可能来自 `restoreTemplate`：`publishTemplate` 自己会先归档旧版（I-4），而恢复
 * **不该**顺手归档现任——「恢复」这个动作的语义里没有「把别人挤下去」。所以它是冲突，
 * 由人决定先归档哪一个，不是由实现替人挑一个。契约的 `restoreTemplate.err` 同样没有
 * 对应码 ⇒ 裸 409。
 */
export class CanvasPublishedVersionConflictError extends Error {
  constructor(readonly key: string) {
    super(`template ${key} already has a published version`);
    this.name = "CanvasPublishedVersionConflictError";
  }
}

/**
 * `applyStickyChange`：`stickyId` 在 head 版本的 markdown 里不存在（客户端状态陈旧
 * ——stickyId 是文档序派生的，head 推进后可能重排，见 source-projection.ts 文件头）。
 * 契约 `applyStickyChange.err` 闭集里**没有码**给它（只有 NOT_IN_GROUP /
 * INSTANCE_NOT_FOUND / AUTHORIZATION_REVOKED / DEPENDENCY_UNAVAILABLE）——硬借
 * `INSTANCE_NOT_FOUND` 会让前端把「便签过期」当成「画布没了」。裸 404，缺口在 PR 里报出。
 */
export class CanvasStickyNotFoundError extends Error {
  constructor(readonly stickyId: string) {
    super(`sticky ${stickyId} not found in head markdown`);
    this.name = "CanvasStickyNotFoundError";
  }
}

/**
 * `applyStickyChange`：`patch.color` 不是已注册颜色（引擎 `STICKY_COLORS` 的名字或
 * hex 值）。契约 `patch.color` 是开放 `z.string()`，闭集校验只能落在这里；err 闭集
 * 同样没有码 ⇒ 裸 400（同 `CanvasIllegalTransitionError` 的处置）。
 */
export class CanvasUnknownStickyColorError extends Error {
  constructor(readonly color: string) {
    super(`unknown sticky color: ${color}`);
    this.name = "CanvasUnknownStickyColorError";
  }
}

/**
 * `applyStickyChange`：`patch.sectionId` 指向的分区在 head 版本的 markdown 里没有
 * 对应的 `## 段落`（既不匹配冻结模板分区名，也不匹配派生 `md:<名字>`）。
 * err 闭集没有码 ⇒ 裸 400。
 */
export class CanvasUnknownSectionError extends Error {
  constructor(readonly sectionId: string) {
    super(`unknown target section: ${sectionId}`);
    this.name = "CanvasUnknownSectionError";
  }
}
