import type { KgClaimKind, KgObjectKind, KgRelation, KgTriState } from "@repo/contracts/chat-knowledge-graph";
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";

const OBJECT_KEYS: Record<KgObjectKind, MessageKey> = {
  person: "chatKnowledge.object.person",
  organization: "chatKnowledge.object.organization",
  project: "chatKnowledge.object.project",
  product: "chatKnowledge.object.product",
  concept: "chatKnowledge.object.concept",
  term: "chatKnowledge.object.term",
  metric: "chatKnowledge.object.metric",
  event: "chatKnowledge.object.event",
};
const CLAIM_KEYS: Record<KgClaimKind, MessageKey> = {
  fact: "aboutMemory.kind.fact",
  hypothesis: "aboutMemory.kind.hypothesis",
  decision: "aboutMemory.kind.decision",
  todo: "aboutMemory.kind.todo",
  risk: "aboutMemory.kind.risk",
  goal: "aboutMemory.kind.goal",
  preference: "aboutMemory.kind.preference",
};
const RELATION_KEYS: Record<KgRelation, MessageKey> = {
  about: "chatKnowledge.relation.about",
  decided_by: "chatKnowledge.relation.decided_by",
  mentions: "chatKnowledge.relation.mentions",
  derived_from: "chatKnowledge.relation.derived_from",
  supersedes: "chatKnowledge.relation.supersedes",
  belongs_to: "chatKnowledge.relation.belongs_to",
  supported_by: "chatKnowledge.relation.supported_by",
  may_shorten: "chatKnowledge.relation.may_shorten",
  blocks: "chatKnowledge.relation.blocks",
  hard_constraint: "chatKnowledge.relation.hard_constraint",
  candidate_for: "chatKnowledge.relation.candidate_for",
  serves_goal: "chatKnowledge.relation.serves_goal",
};
const TRI_KEYS: Record<KgTriState, MessageKey> = { pending: "aboutMemory.tri.pending", confirmed: "aboutMemory.tri.confirmed", conflict: "aboutMemory.tri.conflict" };
export function graphObjectKindLabel(kind: KgObjectKind, locale: Locale = "zh-CN"): string { return translate(locale, OBJECT_KEYS[kind]); }
export function graphClaimKindLabel(kind: KgClaimKind, locale: Locale = "zh-CN"): string { return translate(locale, CLAIM_KEYS[kind]); }
export function graphRelationLabel(relation: KgRelation, locale: Locale = "zh-CN"): string { return translate(locale, RELATION_KEYS[relation]); }
export function graphTriStateLabel(tri: KgTriState, locale: Locale = "zh-CN"): string { return translate(locale, TRI_KEYS[tri]); }
