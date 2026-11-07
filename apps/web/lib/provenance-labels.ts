/**
 * 审计事件类型的中文标签（#1182，活动流用）。
 *
 * ## 这是展示层，不是第二份事实源
 *
 * `ProvenanceEventType` 的**取值**只有契约一处（`packages/contracts/src/provenance.ts`）。
 * 这里给的是「给人看的那句话」，与取值本身是两件东西——同 `AGENT_STATUS_LABEL` 的先例。
 *
 * ⚠ **但它必须对枚举穷尽**，而且穷尽这件事要机械守着，理由很具体：
 *   漏一个类型，那一行就渲染成空白，而**空白在审计流里读作「这条没事发生」**。
 *   契约加了新类型而这里没跟上，是个静默的错——所以 `satisfies Record<ProvenanceEventType, MessageKey>`
 *   的类型约束（编译期）+ `provenance-labels.test.ts` 的逐值断言（运行期）各守一道。
 *   类型约束单独不够：`as` 一下就绕过去了，而 CI 只跑 tsc 不跑人眼。
 */
import type { ProvenanceEventType } from "./live-provenance";
import type { Locale } from "./i18n/locale";
import { translate, type MessageKey } from "./i18n/messages";

const PROVENANCE_EVENT_KEY = {
  /* artifact 束：血缘 */
  "ingested": "adminOverview.event.ingested",
  "transformed": "adminOverview.event.transformed",
  "generated": "adminOverview.event.generated",
  "human-edited": "adminOverview.event.human-edited",
  "pinned": "adminOverview.event.pinned",
  "bound": "adminOverview.event.bound",
  "unbound": "adminOverview.event.unbound",
  "superseded": "adminOverview.event.superseded",
  "evidence-withdrawn": "adminOverview.event.evidence-withdrawn",
  "downloaded": "adminOverview.event.downloaded",

  /* identity 束：治理 */
  "capability-added": "adminOverview.event.capability-added",
  "capability-updated": "adminOverview.event.capability-updated",
  "capability-disabled": "adminOverview.event.capability-disabled",
  "role-changed": "adminOverview.event.role-changed",
  "team-changed": "adminOverview.event.team-changed",
  "admin-project-access": "adminOverview.event.admin-project-access",
  "local-export": "adminOverview.event.local-export",
  "profile-renamed": "adminOverview.event.profile-renamed",
  "avatar-changed": "adminOverview.event.avatar-changed",
  "password-changed": "adminOverview.event.password-changed",
  "team-created": "adminOverview.event.team-created",
  "team-renamed": "adminOverview.event.team-renamed",
  "team-deleted": "adminOverview.event.team-deleted",

  /* project / chat / 治理补齐（ADR-101） */
  "project-created": "adminOverview.event.project-created",
  "project-archived": "adminOverview.event.project-archived",
  "project-unarchived": "adminOverview.event.project-unarchived",
  "agenda-segment-state-changed": "adminOverview.event.agenda-segment-state-changed",
  "thread-created": "adminOverview.event.thread-created",
  "thread-renamed": "adminOverview.event.thread-renamed",
  "thread-deleted": "adminOverview.event.thread-deleted",
  "thread-visibility-changed": "adminOverview.event.thread-visibility-changed",
  "thread-pinned": "adminOverview.event.thread-pinned",
  "thread-unpinned": "adminOverview.event.thread-unpinned",
  "integrity-check-failed": "adminOverview.event.integrity-check-failed",
  "contact-revealed": "adminOverview.event.contact-revealed",
  "approval-requested": "adminOverview.event.approval-requested",
  "approval-decided": "adminOverview.event.approval-decided",
  "deletion-requested": "adminOverview.event.deletion-requested",
  "asset-published": "adminOverview.event.asset-published",
  "review-accepted": "adminOverview.event.review-accepted",
  "review-rejected": "adminOverview.event.review-rejected",
  "legal-hold-applied": "adminOverview.event.legal-hold-applied",
  "legal-hold-released": "adminOverview.event.legal-hold-released",

  /* 安全 */
  "unauthorized-attempt": "adminOverview.event.unauthorized-attempt",
} as const satisfies Record<ProvenanceEventType, MessageKey>;

/** Locale projection of the same exhaustive authority; callers without a locale keep Chinese. */
export function provenanceEventLabel(type: ProvenanceEventType, locale: Locale = "zh-CN"): string {
  return translate(locale, PROVENANCE_EVENT_KEY[type]);
}

export const PROVENANCE_EVENT_LABEL: Record<ProvenanceEventType, string> = Object.fromEntries(
  (Object.keys(PROVENANCE_EVENT_KEY) as ProvenanceEventType[]).map((type) => [type, provenanceEventLabel(type)]),
) as Record<ProvenanceEventType, string>;
