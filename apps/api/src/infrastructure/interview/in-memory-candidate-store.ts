/**
 * In-memory 实现（F98）—— 候选态存储 + 一个基于组织历史对象的启发式建议生成器。
 *
 * 与 `in-memory-consent-token-repository.ts`（F86）同一立场：进程内、不跨副本、
 * 重启即丢，直说而不是藏；接口形状与未来的 Postgres 版本一致，换掉这一个文件、
 * 不改调用方（`suggest-candidates.ts` / `accept-candidate.ts`）。
 */
import type { OrgId } from "../../domain/org-id";
import type {
  CandidateStore,
  CandidateSuggestion,
  CandidateSuggestionPort,
  SubjectCandidate,
} from "../../application/interview/candidate-ports";
import type { GuardedSubjectRow, SubjectRepository } from "../../application/interview/subject-ports";
import { discloseDecided, isDisclosed } from "../../application/security/permission-filter";
import type { PermissionDecision } from "../../domain/identity/permission-decision";

export class InMemoryCandidateStore implements CandidateStore {
  private readonly byId = new Map<string, SubjectCandidate>();

  async put(candidate: SubjectCandidate): Promise<void> {
    this.byId.set(`${candidate.orgId}:${candidate.candidateId}`, candidate);
  }

  async get(orgId: OrgId, candidateId: string): Promise<SubjectCandidate | null> {
    return this.byId.get(`${orgId}:${candidateId}`) ?? null;
  }

  async remove(orgId: OrgId, candidateId: string): Promise<void> {
    this.byId.delete(`${orgId}:${candidateId}`);
  }
}

/** `guard()` 判定用的固定放行——见类头注释：本类只读"展示名/机构名/职位"这类字段
 *  作历史匹配种子，从不解封联系方式，用一个恒放行的判定即可，不需要真的按访问者判定。 */
const ALWAYS_ALLOW: PermissionDecision = {
  allowed: true,
  orgLayer: { role: null, teamId: null, passed: true },
  projectLayer: null,
  scopeLayer: { scope: "org-wide", passed: true },
  reasonCode: null,
  decisionId: "candidate-suggester-internal",
};

interface PublicFacts {
  readonly subjectId: string;
  readonly displayName: string;
  readonly orgName: string | null;
  readonly roleTitle: string;
}

function disclosePublicFacts(row: GuardedSubjectRow): PublicFacts | null {
  const disclosed = discloseDecided(row.item, ALWAYS_ALLOW);
  if (!isDisclosed(disclosed)) return null;
  const p = disclosed.payload;
  return { subjectId: p.subjectId, displayName: p.displayName, orgName: p.orgName, roleTitle: p.roleTitle };
}

/**
 * 「AI 依据项目主题与背景、本组场景、组织已有历史访谈对象」建议人选（R3-3）的启发式实现。
 *
 * ## 这是一个确定性启发式，不是一次真实的模型调用 —— 如实登记
 *
 * 本仓其它束目前没有一个可复用的「访谈 AI」调用点，本 feature 也不新造一个。
 * 这里的判据是**同组织、同机构（`orgName`）的既有访谈对象**——组卡里已经有
 * 「某物流园区运营总监」，就去找组织里其它对「某物流园区」访谈过的人。这满足契约
 * 形状（机器产出标识 + 理由 + 来源 + 候选态，不自动写联系方式）与 V12（AI 服务
 * 不可用时手工加对象仍可用——两条路径本就互不调用），但不是语义理解意义上的
 * 「建议人选」，PR 说明里必须如实报告这条边界，而不是让读者以为背后有一个模型。
 *
 * ⚠ **不读联系方式**：这里只调经 `guard()` 出门、返回 `contactMask`（恒掩码）的
 * `SubjectRepository` 方法——不是靠"生成器不写这个字段"这句自觉遵守的承诺，
 * 是它的输入类型里压根没有明文这一说（O-39）。
 *
 * ⚠ **[待确认]**（uc-6-7 R10）「能否检索组织外部来源」——本实现只查组织内部既有对象，
 * 不接入任何外部数据源，如实反映这条尚未裁决的边界。
 */
export class HistoryBasedCandidateSuggester implements CandidateSuggestionPort {
  constructor(private readonly repo: SubjectRepository) {}

  async suggest(orgId: OrgId, groupId: string): Promise<readonly CandidateSuggestion[]> {
    const groupRows = await this.repo.listByGroup(orgId, groupId);
    const groupFacts = groupRows.map(disclosePublicFacts).filter((f): f is PublicFacts => f !== null);

    const seedOrgNames = [...new Set(groupFacts.map((f) => f.orgName).filter((n): n is string => !!n && n.length > 0))];
    if (seedOrgNames.length === 0) return [];

    const seenSubjectIds = new Set(groupFacts.map((f) => f.subjectId));
    const seenNames = new Set(groupFacts.map((f) => f.displayName));

    const candidates: CandidateSuggestion[] = [];
    for (const orgName of seedOrgNames) {
      const matches = await this.repo.listByOrgName(orgId, orgName);
      for (const row of matches) {
        const facts = disclosePublicFacts(row);
        if (facts === null) continue;
        if (seenSubjectIds.has(facts.subjectId) || seenNames.has(facts.displayName)) continue;
        seenSubjectIds.add(facts.subjectId);
        seenNames.add(facts.displayName);
        candidates.push({
          name: facts.displayName,
          roleTitle: facts.roleTitle,
          reason: `该人选此前已作为本组织「${orgName}」的访谈/观察对象`,
          sources: ["组织历史访谈对象记录"],
          duplicateOfSubjectId: null,
        });
      }
    }
    return candidates;
  }
}
