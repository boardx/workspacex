/**
 * `listTemplates` —— 后台模板库与绑定选择器**共用的那一个端口**（F100 / F101，I-5）。
 *
 * ## 共用一个端口的全部价值在这个文件里，而且只在这里
 *
 * 契约说得很直白：共用是为了避免「后台一份过滤、绑定面板另一份过滤」的第二处声明。
 * 那条价值只有在**过滤规则也只有一份**时才成立——所以 `forBinding` 与 `filter` 到状态
 * 集合的映射写在下面这一个函数里，仓储只收一个已经算好的状态数组（见 `template-ports.ts`
 * 里 `ListCanvasTemplatesQuery.statuses` 那条注释）。
 *
 * ## `forBinding` 用的是 `canCreateNewBinding`，不是自己再判一次
 *
 * I-5 的「哪些模板能被新绑定」在 `domain/canvas/template-lifecycle.ts` 里已经是一个具名
 * 谓词，并被 F101 的测试逐状态穷举过。这里调用它而不是写
 * `s !== "draft" && s !== "archived"`，因为后者是**同一条规则的第二份副本**：契约的散文
 * 只点了 draft 与 archived 两个必须挡的，而谓词说的是「只有 published 放行」，两者今天
 * 一致、明天多一个状态就不一致，而不一致的那天没有任何东西会报警。
 *
 * ## 「全部」（`filter=all`）与不带 `filter` 时，归档的都**不出现**
 *
 * #2366（人类签核确认）：「全部」tab 不是字面意义的「所有状态」，是「所有**未归档**的」——
 *   已归档模板只应在专属的「已归档」tab（`filter=archived`）里看到。这与#463的验收
 *   一致收口：「归档 → 默认列表不可见但按归档筛选可见」，「默认列表」与「全部」现在是
 *   同一条规则，不再是两条可能打架的解释。
 */
import { canCreateNewBinding, type TemplateStatus } from "../../domain/canvas/template-lifecycle";
import { decideCapabilityVisibility } from "../../domain/identity/capability-listing";
import type { OrgId } from "../../domain/org-id";
import type { DecisionIdFactory, IdentityRepository } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { requireOrgMember } from "./template-admin";
import type {
  CanvasTemplateListing,
  CanvasTemplateRepository,
} from "./template-ports";

export interface ListTemplatesDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
  readonly ids: DecisionIdFactory;
}

export type TemplateFilter = "all" | "published" | "draft" | "archived";

export interface ListTemplatesInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly filter?: TemplateFilter;
  readonly forBinding?: boolean;
}

const ALL_STATUSES: readonly TemplateStatus[] = ["draft", "trial", "published", "archived"];

/**
 * 两个参数如何合成一个状态集合。导出是为了让它可以脱离数据库被断言——
 * 「绑定选择器看得见归档模板」这类缺陷应该在一个纯函数上红，而不是等一次 HTTP 往返。
 */
export function statusesFor(input: {
  readonly filter?: TemplateFilter;
  readonly forBinding?: boolean;
}): readonly TemplateStatus[] {
  // `forBinding` 赢：它问的是「哪些能被新绑定」，那是 I-5 的判定，不是一个视图偏好。
  // 若两个参数同时出现且打架（forBinding=true & filter=archived），答案必须是空集合，
  // 而不是「按 filter 来」——后者会让绑定面板显示出归档模板。
  const byBinding = input.forBinding === true ? ALL_STATUSES.filter(canCreateNewBinding) : ALL_STATUSES;

  const byFilter: readonly TemplateStatus[] =
    input.filter === undefined || input.filter === "all"
      ? // 见文件头 #2366：缺省与「全部」同规则，都排除 archived。
        ALL_STATUSES.filter((s) => s !== "archived")
      : ALL_STATUSES.filter((s) => s === input.filter);

  return byBinding.filter((s) => byFilter.includes(s));
}

export async function listTemplates(
  deps: ListTemplatesDeps,
  input: ListTemplatesInput,
): Promise<{ readonly templates: readonly CanvasTemplateListing[] }> {
  const membership = await requireOrgMember({ identity: deps.identity }, input);

  const rows = await deps.templates.list({
    orgId: input.orgId,
    statuses: statusesFor(input),
  });

  const visible: CanvasTemplateListing[] = [];
  for (const row of rows) {
    // 可见性判定与 capability listing 共用同一个函数：契约声明 `TemplateVisibility` 与
    // `identity.VisibilityScope` 是同一套语义，所以判它们的也必须是同一段代码。
    const decision = decideCapabilityVisibility({
      decisionId: deps.ids.next(),
      orgRole: membership.orgRole,
      requesterTeamId: membership.teamId,
      scope: row.facts.scope,
      ownerTeamId: row.facts.ownerTeamId,
    });
    // payload 除了这一句拿不出来——忘了判定是**类型错误**，不是一个疏漏。
    const disclosed = discloseDecided(row.listing, decision);
    if (isDisclosed(disclosed)) visible.push(disclosed.payload);
  }

  return { templates: visible };
}
