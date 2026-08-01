/**
 * F114 —— 对话产出落地的纯判定（chat 束 domain.md F 组，uc-8-3 UC-20 / I-33 / I-37）。
 *
 * ## 这里判定什么，不判定什么
 *
 * `landAsArtifact` 的真正版本机制（写对象存储、写 `artifact_versions`、三模式绑定的
 * 升降级规则）在 phase-00 `artifact`（F04/F05/F06），本 UC 不重实现（D-38）。
 * 这个文件只回答两件事，且都是**结构性、可测的纯判断**：
 *
 *   1. `hasSource`：这条结论有没有挂引用——`citationCount > 0`。这是 I-37 的**唯一**
 *      事实源，`listThreadArtifacts` 的 `hasSource` 字段与这里必须是同一个判断，
 *      不是两处各自数一遍。
 *   2. 请求的 `mode` 在当前证据状态下是否**可被接受**：
 *      - I-33：`draft` 之外的任何模式都要求出处回链非空——**这里的"非空"取
 *        `citationCount > 0`**，而不是"结构体字段存在"，因为落地请求本身恒携带
 *        `threadId`/`messageId`（否则连 HTTP 层的 schema 校验都过不了），真正会
 *        缺失的只有"这条消息到底挂没挂引用"这件事。
 *      - V4d：`pinned` 还要求**100% 引用可定位**——任一不可定位 ⇒ 只能落草稿。
 *
 * ## 为什么是"拒绝重新提交"而不是"静默降级模式"
 *
 * usecases.md 把两条都列在 `err`（`MISSING_PROVENANCE_BACKLINK` /
 * `CITATION_UNRESOLVABLE_REQUIRES_DRAFT`），不是 `out` 的一个字段。一个把
 * "调用者要 pinned、系统悄悄给了 draft"包装成 200 成功的实现，会让调用者以为
 * 定版已经发生——这正是 R4 E1"失败不得被呈现为成功"要防的事。所以这里返回
 * 判别联合，`ok` 之外的两支都是"整个请求被拒，请显式改用 draft 重新提交"。
 */

export type LandingModeName = "draft" | "live" | "pinned";

export interface LandingRequest {
  readonly requestedMode: LandingModeName;
  /** 该消息挂着的引用条数（不是"该消息是否存在引用字段"，是真实计数）。 */
  readonly citationCount: number;
  /** 仅在 `requestedMode === "pinned"` 时才有意义地被读取——见下方判定顺序。 */
  readonly allCitationsLocatable: boolean;
}

export type LandingVerdict =
  | { readonly kind: "ok"; readonly mode: LandingModeName; readonly hasSource: boolean }
  /** I-33 / AC3：无引用的结论不得升到 live/pinned——只能显式落 draft。 */
  | { readonly kind: "missing-provenance-backlink" }
  /** V4d：有引用但存在不可定位的一条，pinned 被拒，只能落 draft。 */
  | { readonly kind: "citation-unresolvable-requires-draft" };

/** I-37 的唯一事实源：`hasSource` 就是"这条结论挂没挂引用"，不是别的近似。 */
export function hasSource(citationCount: number): boolean {
  return citationCount > 0;
}

export function decideLanding(req: LandingRequest): LandingVerdict {
  const grounded = hasSource(req.citationCount);

  if (req.requestedMode !== "draft" && !grounded) {
    return { kind: "missing-provenance-backlink" };
  }
  if (req.requestedMode === "pinned" && !req.allCitationsLocatable) {
    return { kind: "citation-unresolvable-requires-draft" };
  }
  return { kind: "ok", mode: req.requestedMode, hasSource: grounded };
}

/**
 * I-34：下游引用四用途恒要求 `mode === "pinned"`。
 *
 * 这是本文件里**唯一**判"能不能被下游引用"的地方——`check-downstream-eligibility.ts`
 * 只调用它，不再自己写一遍 `=== "pinned"`。
 */
export function isEligibleForDownstream(mode: LandingModeName): boolean {
  return mode === "pinned";
}
