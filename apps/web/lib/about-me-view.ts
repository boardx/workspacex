/**
 * issue #4360「关于我」的纯投影——只从真实读模型（`getPersonalKnowledge` 的 claims + edges）算。
 *
 * 分组规则只有契约 `kgProfileSection` 一份（召回时每轮带上的画像摘要用的也是它）：目标 / 偏好 / 约束与身份 / 在做的事。
 * 「在做的事」里挂了目标的（活的 `serves_goal` 边，两端都还在）折叠到那个目标下面；没挂的留在「在做的事」里。
 */
import {
  kgProfileSection, KG_PROFILE_SECTION_LABEL_ZH, type KgProfileSection,
} from "@repo/contracts/chat-knowledge-graph";
import type { PersonalKnowledge } from "@/lib/knowledge-graph-api";

type Claim = PersonalKnowledge["claims"][number];

export const ABOUT_ME_SECTION_ORDER: readonly KgProfileSection[] = ["goals", "preferences", "identity", "doing"];

export interface AboutMeGroup {
  readonly section: KgProfileSection;
  readonly label: string;
  /** 这一组要单独列出的条目（「在做的事」只含没挂目标的），最新在前 */
  readonly claims: readonly Claim[];
}

export interface AboutMe {
  /** 四组，按固定顺序；空组也在（界面决定空组怎么说） */
  readonly groups: readonly AboutMeGroup[];
  /** 目标 id → 挂在它下面的决定 / 待办（最新在前） */
  readonly childrenOf: ReadonlyMap<string, readonly Claim[]>;
  /** 决定 / 待办 id → 它挂着的目标 id */
  readonly goalOf: ReadonlyMap<string, string>;
  /** 画像里一共几条（含挂在目标下的） */
  readonly total: number;
}

const newestFirst = (a: Claim, b: Claim) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

export function aboutMe(personal: Pick<PersonalKnowledge, "claims" | "edges">): AboutMe {
  const byId = new Map(personal.claims.map((c) => [c.id, c]));
  const goalOf = new Map<string, string>();
  for (const e of personal.edges) {
    if (e.relation !== "serves_goal" || e.src.kind !== "claim" || e.dst.kind !== "claim") continue;
    const child = byId.get(e.src.id);
    const goal = byId.get(e.dst.id);
    if (child === undefined || goal === undefined || goal.kind !== "goal") continue;
    goalOf.set(child.id, goal.id);
  }
  const bySection = new Map<KgProfileSection, Claim[]>(ABOUT_ME_SECTION_ORDER.map((s) => [s, []]));
  const childrenOf = new Map<string, Claim[]>();
  let total = 0;
  for (const c of personal.claims) {
    const section = kgProfileSection(c.kind, c.statement);
    if (section === null) continue;
    total += 1;
    const goal = goalOf.get(c.id);
    if (section === "doing" && goal !== undefined) childrenOf.set(goal, [...(childrenOf.get(goal) ?? []), c]);
    else bySection.get(section)!.push(c);
  }
  for (const list of childrenOf.values()) list.sort(newestFirst);
  return {
    groups: ABOUT_ME_SECTION_ORDER.map((section) => ({
      section, label: KG_PROFILE_SECTION_LABEL_ZH[section], claims: [...bySection.get(section)!].sort(newestFirst),
    })),
    childrenOf,
    goalOf,
    total,
  };
}
