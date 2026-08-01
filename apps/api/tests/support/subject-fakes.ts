/**
 * In-memory 实现（F87）—— `SubjectRepository` + `ConsentSubmissionStore`（F97 端口）。
 *
 * ⚠ 与 `in-memory-consent-token-repository.ts`（F86）同一立场：这是测试用的过渡实现，
 *   不是"更快的 Postgres 替代品"。进程内、不跨副本、重启即丢；写在这里是为了让
 *   「同意位分发 / 只读镜像」这条编排逻辑能在**不起数据库**的情况下被单元测试覆盖——
 *   Postgres 版本的行为已经由 `consent-status-single-source.test.ts`（F97）与
 *   `pg-consent-submission-store.ts` 的 SQL 断言覆盖，这里不重复验证「SQL 对不对」，
 *   只验证「编排逻辑对不对」。
 */
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { OrgId } from "../../src/domain/org-id";
import type { ConsentBits, SubjectMode, SubjectRecord } from "../../src/domain/interview/subject";
import type { SubjectVisibilityFacts } from "../../src/domain/interview/subject-visibility";
import type {
  ConsentSubmissionStore,
  CreateSubjectInput,
  GuardedSubjectRow,
  SubjectRepository,
  UpdateSubjectInput,
} from "../../src/application/interview/subject-ports";

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function maskContact(contact: string | null): string | null {
  if (contact === null) return null;
  return contact.length <= 4 ? "****" : `${contact.slice(0, 2)}****${contact.slice(-2)}`;
}

interface StoredSubject {
  record: SubjectRecord;
  facts: SubjectVisibilityFacts;
  sessionIds: Set<string>;
}

export class InMemorySubjectRepository implements SubjectRepository {
  private readonly byId = new Map<string, StoredSubject>();
  private readonly viewerContexts = new Map<
    string,
    { orgRole: string | null; teamId: string | null; projectRole: "facilitator" | "groupLead" | "member" | "observer" | null }
  >();
  private readonly orgMemberships = new Map<string, { orgRole: string | null; teamId: string | null }>();

  /** 测试装配：某个 viewer 在某个组里的项目角色。 */
  setViewerContextForGroup(
    userId: string,
    groupId: string,
    ctx: { orgRole: string | null; teamId: string | null; projectRole: "facilitator" | "groupLead" | "member" | "observer" | null },
  ): void {
    this.viewerContexts.set(`${userId}:${groupId}`, ctx);
  }

  /** 测试装配：某个 viewer 的组织角色（未归组对象走这条）。 */
  setOrgMembership(userId: string, membership: { orgRole: string | null; teamId: string | null }): void {
    this.orgMemberships.set(userId, membership);
  }

  async create(input: CreateSubjectInput): Promise<SubjectRecord> {
    const record: SubjectRecord = {
      subjectId: nextId("subj"),
      groupId: input.groupId,
      displayName: input.displayName,
      roleTitle: input.roleTitle,
      orgName: input.orgName,
      backgroundAndQuestions: input.backgroundAndQuestions ?? "",
      mode: input.mode ?? "interview",
      sourceKind: input.sourceKind,
      contactMask: maskContact(input.contact),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(record.subjectId, {
      record,
      facts: { groupId: record.groupId, createdBy: record.createdBy },
      sessionIds: new Set(),
    });
    return record;
  }

  async update(input: UpdateSubjectInput): Promise<SubjectRecord> {
    const stored = this.byId.get(input.subjectId);
    if (stored === undefined) throw new Error(`InMemorySubjectRepository: unknown subject ${input.subjectId}`);
    const updated: SubjectRecord = {
      ...stored.record,
      displayName: input.displayName ?? stored.record.displayName,
      roleTitle: input.roleTitle ?? stored.record.roleTitle,
      orgName: input.orgName,
      groupId: input.groupId,
      contactMask: input.contact !== null ? maskContact(input.contact) : stored.record.contactMask,
      backgroundAndQuestions: input.backgroundAndQuestions ?? stored.record.backgroundAndQuestions,
      mode: (input.mode ?? stored.record.mode) as SubjectMode,
    };
    stored.record = updated;
    stored.facts = { groupId: updated.groupId, createdBy: updated.createdBy };
    return updated;
  }

  async findGuardedById(_orgId: OrgId, subjectId: string): Promise<GuardedSubjectRow | null> {
    const stored = this.byId.get(subjectId);
    if (stored === undefined) return null;
    return { item: guard({ kind: "subject", id: subjectId }, stored.record), facts: stored.facts };
  }

  async listByGroup(_orgId: OrgId, groupId: string): Promise<GuardedSubjectRow[]> {
    const out: GuardedSubjectRow[] = [];
    for (const stored of this.byId.values()) {
      if (stored.record.groupId !== groupId) continue;
      out.push({ item: guard({ kind: "subject", id: stored.record.subjectId }, stored.record), facts: stored.facts });
    }
    return out;
  }

  async listByInterviewSession(_orgId: OrgId, interviewSessionId: string): Promise<GuardedSubjectRow[]> {
    const out: GuardedSubjectRow[] = [];
    for (const stored of this.byId.values()) {
      if (!stored.sessionIds.has(interviewSessionId)) continue;
      out.push({ item: guard({ kind: "subject", id: stored.record.subjectId }, stored.record), facts: stored.facts });
    }
    return out;
  }

  async attachToSession(_orgId: OrgId, interviewSessionId: string, subjectId: string, _addedBy: string): Promise<void> {
    const stored = this.byId.get(subjectId);
    if (stored === undefined) throw new Error(`InMemorySubjectRepository: unknown subject ${subjectId}`);
    stored.sessionIds.add(interviewSessionId);
  }

  async viewerContextForGroup(
    _orgId: OrgId,
    userId: string,
    groupId: string,
  ): Promise<{ orgRole: string | null; teamId: string | null; projectRole: "facilitator" | "groupLead" | "member" | "observer" | null }> {
    return this.viewerContexts.get(`${userId}:${groupId}`) ?? { orgRole: null, teamId: null, projectRole: null };
  }

  async orgMembershipOf(_orgId: OrgId, userId: string): Promise<{ orgRole: string | null; teamId: string | null }> {
    return this.orgMemberships.get(userId) ?? { orgRole: null, teamId: null };
  }
}

interface SubmissionRow {
  bits: ConsentBits;
  submittedAt: Date;
}

export class InMemoryConsentSubmissionStore implements ConsentSubmissionStore {
  // append-only：一个 (session, subject) 组合对应一个数组，永不覆盖旧行（同 I-16）。
  private readonly rows = new Map<string, SubmissionRow[]>();

  #key(interviewSessionId: string, subjectId: string): string {
    return `${interviewSessionId}:${subjectId}`;
  }

  async latestFor(_orgId: OrgId, interviewSessionId: string, subjectId: string): Promise<Guarded<ConsentBits | null>> {
    const list = this.rows.get(this.#key(interviewSessionId, subjectId)) ?? [];
    const latest = list[list.length - 1];
    return guard({ kind: "subject", id: subjectId }, latest === undefined ? null : latest.bits);
  }

  async latestSubmissionMeta(
    _orgId: OrgId,
    interviewSessionId: string,
    subjectId: string,
  ): Promise<Guarded<{ readonly bits: ConsentBits; readonly submittedAt: Date } | null>> {
    const list = this.rows.get(this.#key(interviewSessionId, subjectId)) ?? [];
    const latest = list[list.length - 1];
    return guard(
      { kind: "subject", id: subjectId },
      latest === undefined ? null : { bits: latest.bits, submittedAt: latest.submittedAt },
    );
  }

  async submit(_orgId: OrgId, interviewSessionId: string, subjectId: string, bits: ConsentBits): Promise<void> {
    const k = this.#key(interviewSessionId, subjectId);
    const list = this.rows.get(k) ?? [];
    list.push({ bits, submittedAt: new Date() });
    this.rows.set(k, list);
  }

  /** 测试直读全部历史提交——用来断言"是不是真的 append-only、有几条"。 */
  historyFor(interviewSessionId: string, subjectId: string): readonly SubmissionRow[] {
    return this.rows.get(this.#key(interviewSessionId, subjectId)) ?? [];
  }
}
