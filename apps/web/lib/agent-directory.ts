import { translate, type MessageKey } from "./i18n/messages";
import authoredTitles from "../../../skills/localizations/work-stack-v2.json";
import { applyDisplayUpdate, getDisplayUpdateOffer } from "./authored-display-update";
/**
 * AG04（契约束 `agent-role` UC-4）—— 成员 Agent 目录的前端薄封装。
 *
 * 与 `lib/live-skill.ts` 同一条纪律：这个文件不做判断。没有「是不是管理员」的分支，
 * 没有把 404 翻译成「隐藏卡片」的逻辑——权限是服务端的裁决（`listAgentDirectory`/
 * `getAgentDirectoryCard` 用例），这一层只把契约里的形状原样送过去、把失败原样带回来。
 * 形状与路径全部来自 `@repo/contracts`，不手写第二份。
 */
import { agentRole, wave2Runtime } from "@repo/contracts";
import type { z } from "zod";
import { ApiError, apiRequest } from "./api-client";
import type { Locale } from "@repo/contracts/locale";
import type { LocalizedEntityDisplay } from "@repo/contracts/entity-localization";
import { localizedText, translatedText } from "./entity-localization";

export type AgentDirectoryCard = z.infer<typeof agentRole.AgentDirectoryCard>;
export type AgentRoleCategory = z.infer<typeof agentRole.AgentRoleCategory>;

export const AGENT_ROLE_CATEGORIES = agentRole.AgentRoleCategory.options;

/** ui.md 没有给中文标签表；沿用 `lib/mock/work-stack.ts` 已在用的四个 + 契约多出的 `general`。 */
export const ROLE_CATEGORY_LABEL: Record<AgentRoleCategory, string> = {
  research: "研究",
  product: "产品",
  sales: "销售",
  design: "设计",
  general: "通用",
  executive: "高管战略",
  customer_success: "客户成功",
  operations: "项目运营",
};

export async function listAgentDirectory(
  filters: { readonly roleCategory?: AgentRoleCategory; readonly q?: string; readonly locale?: Locale } = {},
): Promise<readonly AgentDirectoryCard[]> {
  const out = await apiRequest<unknown>(agentRole.operations.listAgentDirectory.path, {
    method: "GET",
    query: { roleCategory: filters.roleCategory, q: filters.q, ...(filters.locale !== undefined ? { locale: filters.locale } : {}) },
  });
  return agentRole.operations.listAgentDirectory.out.parse(out).items;
}

export async function getAgentDirectoryCard(agentId: string, locale?: Locale): Promise<AgentDirectoryCard> {
  const out = await apiRequest<unknown>(
    agentRole.operations.getAgentDirectoryCard.path.replace(":agentId", encodeURIComponent(agentId)),
    { method: "GET", ...(locale !== undefined ? { query: { locale } } : {}) },
  );
  return agentRole.operations.getAgentDirectoryCard.out.parse(out);
}

export type OfficialRolePackOffer = z.infer<typeof agentRole.OfficialRolePackOffer>;
export type PendingOfficialRole = OfficialRolePackOffer["pending"][number];

/** 本组织尚未启用的官方数字人（成员可读；`canEnable` 由服务端按管理员身份裁决）。 */
export async function getOfficialRolePackOffer(): Promise<OfficialRolePackOffer> {
  const out = await apiRequest<unknown>(agentRole.operations.getOfficialRolePackOffer.path, { method: "GET" });
  return agentRole.operations.getOfficialRolePackOffer.out.parse(out);
}

/** 一键启用的进度：第 `step` 步（从 1 起）/ 共 `total` 步，`label` 是给人看的这一步在做什么。 */
export interface EnableProgress {
  readonly step: number;
  readonly total: number;
  readonly label: string;
  /** Owned UI provenance; callers with raw labels remain supported. */
  readonly labelKey?: MessageKey;
}

/**
 * 管理员一键启用 = 「启用即可用」（2026-09-30 人类代决）：
 *   1. 逐个导入要约里的 `requiredSkillPacks`（既有 `importSkillStarterPack`，服务端导入后发布内置 Workflow）；
 *   2. 导入官方角色包（既有 UC-3 导入）。
 * 幂等键都按包坐标固定——重复点击 / 中途失败后重试回放同一结果，不重复落库。
 * Skill 包 409（本组织已用别的幂等键导入过同一包）视为「已具备」继续；其余失败原样抛出。
 */
export interface OfficialRoleImportScope {
  readonly orgId: string;
  readonly sessionToken: string;
  readonly isCurrent: () => boolean;
  readonly signal: AbortSignal;
}

export async function enableOfficialRolePack(
  offer: Pick<OfficialRolePackOffer, "packId" | "packVersion"> & { readonly requiredSkillPacks?: OfficialRolePackOffer["requiredSkillPacks"] },
  onProgress?: (p: EnableProgress) => void,
  scope?: OfficialRoleImportScope,
): Promise<void> {
  const checkScope = () => {
    if (scope && (scope.signal.aborted || !scope.isCurrent())) throw new Error("official_role_import_scope_changed");
  };
  const scopedRequest = scope ? { sessionToken: scope.sessionToken, signal: scope.signal } : {};
  const expectedOrg = scope ? { expectedOrgId: scope.orgId } : {};
  checkScope();
  let metadataVersion: string | undefined;
  if (scope) {
    try {
      metadataVersion = (await getDisplayUpdateOffer(scope.sessionToken,scope.signal)).metadataVersion;
    } catch (error) { checkScope(); throw error; }
    checkScope();
  }
  const rolePackVersion = metadataVersion ?? offer.packVersion;
  const packs = offer.requiredSkillPacks ?? [];
  const total = packs.length + 1;
  const skillOp = wave2Runtime.operations.importSkillStarterPack;
  for (const [i, pack] of packs.entries()) {
    checkScope();
    onProgress?.({ step: i + 1, total, label: translate("zh-CN", "chatPicker.prepareSkills"), labelKey: "chatPicker.prepareSkills" });
    try {
      checkScope();
      await apiRequest<unknown>(skillOp.path, {
        method: "POST", ...scopedRequest,
        body: { ...expectedOrg, packId: pack.packId, packVersion: pack.packVersion, idempotencyKey: `picker-enable-skill-${pack.packId}@${pack.packVersion}` },
      });
      checkScope();
    } catch (error) {
      checkScope();
      if (!(error instanceof ApiError && error.status === 409)) throw error;
    }
  }
  checkScope();
  onProgress?.({ step: total, total, label: translate("zh-CN", "chatPicker.enableOfficials"), labelKey: "chatPicker.enableOfficials" });
  const op = wave2Runtime.operations.importAgentStarterPack;
  checkScope();
  await apiRequest<unknown>(op.path, {
    method: "POST", ...scopedRequest,
    body: { ...expectedOrg, packId: offer.packId, packVersion: rolePackVersion, idempotencyKey: `picker-enable-${offer.packId}@${rolePackVersion}` },
  });
  checkScope();
  if (metadataVersion && scope) {
    await applyDisplayUpdate(metadataVersion,crypto.randomUUID(),scope);
    checkScope();
  }
}

export type AgentDirectoryProfile = z.infer<typeof agentRole.AgentDirectoryProfile>;

/** AG04 follow-up：成员详情页补充信息（职责 / 技能引用 / 可转交对象）。 */
export async function getAgentDirectoryProfile(agentId: string, locale?: Locale): Promise<AgentDirectoryProfile> {
  const out = await apiRequest<unknown>(
    agentRole.operations.getAgentDirectoryProfile.path.replace(":agentId", encodeURIComponent(agentId)),
    { method: "GET", ...(locale !== undefined ? { query: { locale } } : {}) },
  );
  return agentRole.operations.getAgentDirectoryProfile.out.parse(out);
}

/**
 * 官方数字人的中文称呼与一句话职责——**只是展示层本地化**，按头像 key（官方角色包里每个角色
 * 独占一个 `dh-NN-*` 头像）查。官方角色包的名字是英文角色头衔（签名包内容，改它会改摘要），
 * 成员界面不直接露英文（uiux-r1 cross-cutting）。查不到的 key 原样用后端给的名字。
 */
const LEGACY_OFFICIAL_DUTIES: Readonly<Record<string,string>> = {
  "dh-02-research-knowledge-analyst": "做结构化调研，每个结论都对应一条可追溯的来源，并把发现沉淀进组织知识库；不在证据之外加主观判断。",
  "dh-03-product-manager": "把调研信号变成有优先级的问题陈述和需求文档，让路线图可以追溯到证据，交付可直接进迭代的范围。",
  "dh-05-sales-representative": "筛选线索，推进从首次会面到签约的整条销售管道，每次阶段变化都以客户管理系统里的记录为准。",
  "dh-11-design-thinking-expert": "主持从洞察到机会、再到实验验证的循环，在做决定前保留多个方向，并把取舍理由记在选中的方案旁边。"
};
function legacyOfficialCopy(avatarKey: string | null | undefined, locale: Locale = "zh-CN") {
  if (!avatarKey || !Object.prototype.hasOwnProperty.call(LEGACY_OFFICIAL_DUTIES,avatarKey)) return undefined;
  const number = /^dh-(\d{2})-/.exec(avatarKey)?.[1];
  const id = number ? `D${number.padStart(3,"0")}` : "";
  const name = authoredTitles.agents[id as keyof typeof authoredTitles.agents]?.[locale].name;
  return name ? { name,duty: LEGACY_OFFICIAL_DUTIES[avatarKey]! } : undefined;
}

type NamedAgent = Pick<AgentDirectoryCard, "name" | "catalogSource" | "avatar" | "display">;

/** 成员界面上的数字人称呼；显式 locale 只消费匹配语言的展示投影。 */
export function agentDisplayName(agent: NamedAgent, locale?: Locale): string {
  const authored = agent.catalogSource === "official" && agent.avatar
    ? legacyOfficialCopy(agent.avatar.key, locale)?.name : undefined;
  const display = locale === undefined || agent.display?.requestedLocale === locale ? agent.display : undefined;
  return localizedText(display, "name", authored ?? agent.name);
}

/** 显式语言模式需要来源证明，不能仅凭组织用户也可选择的头像推断官方身份。 */
export function agentDisplayNameByAvatar(
  avatarKey: string | null | undefined,
  fallback: string,
  display?: LocalizedEntityDisplay,
  locale?: Locale,
  catalogSource?: AgentDirectoryCard["catalogSource"],
): string {
  const authored = locale === undefined || catalogSource === "official"
    ? legacyOfficialCopy(avatarKey, locale)?.name : undefined;
  const matchingDisplay = locale === undefined || display?.requestedLocale === locale ? display : undefined;
  return localizedText(matchingDisplay, "name", authored ?? fallback);
}

/** 官方角色的中文一句话职责；非官方或未登记返回 null。 */
export function officialRoleDuty(agent: NamedAgent): string | null {
  const fallback = agent.catalogSource === "official" && agent.avatar ? legacyOfficialCopy(agent.avatar.key)?.duty ?? null : null;
  return localizedText(agent.display, "duty", fallback);
}

/**
 * 角色副标题：与称呼相同（或只是英文原名）时不重复显示——回退到职责一句话，再回退到分类。
 */
export function agentSubtitle(card: AgentDirectoryCard, duty: string | null = null): string | null {
  const display = agentDisplayName(card);
  const translated = translatedText(card.display, "roleLabel");
  const label = (translated ?? card.roleLabel).trim();
  const redundant = label.length === 0 || label === display || label === card.name.trim();
  if (!redundant && (translated !== null || !/^[\x20-\x7e]+$/.test(label))) return label;
  const d = localizedText(card.display, "duty", duty ?? officialRoleDuty(card));
  if (d) return d;
  return card.roleCategory ? `${ROLE_CATEGORY_LABEL[card.roleCategory]}类数字人` : null;
}

/** 「开始对话 / 在对话中发起」的深链：`?agent=` 选中数字人，`?prefill=` 预填输入框（新对话一次性）。 */
export function agentChatHref(agentId: string, prefill?: string): string {
  const q = new URLSearchParams({ agent: agentId });
  if (prefill) q.set("prefill", prefill);
  return `/chat?${q.toString()}`;
}

/** Explicit selected-role upgrade; frozen org/session scope matches the import path. */
export async function upgradeOfficialRoleSelections(
  offer: OfficialRolePackOffer,
  selections: readonly { agentId: string; expectedPublishedVersionId: string }[],
  idempotencyKey: string,
  scope: OfficialRoleImportScope,
): Promise<void> {
  if (scope.signal.aborted || !scope.isCurrent()) throw new Error("official_role_upgrade_scope_changed");
  const op = agentRole.operations.upgradeOfficialRoles;
  const result = await apiRequest<unknown>(op.path, { method: "POST", sessionToken: scope.sessionToken, signal: scope.signal,
    body: { packVersion: offer.packVersion, expectedOrgId: scope.orgId, selections, idempotencyKey } });
  op.out.parse(result);
  if (scope.signal.aborted || !scope.isCurrent()) throw new Error("official_role_upgrade_scope_changed");
}

/** Pending built-in roles have no tenant localization row yet. Only recognized
 * authored originals receive their release title; custom text stays verbatim. */
export function authoredPendingRoleName(roleRef: string, locale: Locale, original: string): string {
  const titles = authoredTitles.agents[roleRef as keyof typeof authoredTitles.agents];
  return titles && Object.values(titles).some(copy => copy.name === original) ? titles[locale].name : original;
}
