/**
 * A pure, in-process `SubjectRepository` fake (F98).
 *
 * ## Why this exists
 *
 * Issue #74 (full-suite Postgres nondeterminism) is why this worker's standing instruction
 * is "skip Postgres-dependent tests locally, typecheck only". `contact-mask-audit-export-
 * exclude.test.ts` and `ai-suggest-candidate-no-autofill-contact.test.ts` need a
 * `SubjectRepository` to exercise `revealContact` / `exportSubjects` / the candidate flow,
 * but neither of those use cases needs a REAL database to prove its guarantees -- both are
 * pure application-layer logic over whatever the repository returns. So this fake
 * implements the full interface in memory, wired through the SAME `guard()`/`Guarded<T>`
 * machinery the Postgres implementation uses (not a shortcut that skips permission-filter
 * entirely), so a test that asserts "the observer never sees this" is asserting something
 * that would also hold against the real repository.
 *
 * Sealing/unsealing goes through the SAME `sealContact`/`ContactCipher` port the Postgres
 * repository uses -- this fake stores `SealedContact` envelopes, never plaintext, exactly
 * like the real `contact_cipher` column does after F98.
 */
import { randomUUID } from "node:crypto";
import type { OrgId } from "../../src/domain/org-id";
import type { SubjectMode, SubjectRecord } from "../../src/domain/interview/subject";
import type { SubjectVisibilityFacts } from "../../src/domain/interview/subject-visibility";
import { sealContact, type ContactCipher, type SealedContact } from "../../src/domain/interview/contact-vault";
import { guard } from "../../src/application/security/permission-filter";
import type {
  CreateSubjectInput,
  GuardedSubjectRow,
  SubjectRepository,
  UpdateSubjectInput,
} from "../../src/application/interview/subject-ports";

interface Row {
  record: SubjectRecord;
  sealed: SealedContact | null;
}

export interface FakeGroupMembership {
  readonly orgRole: string | null;
  readonly teamId: string | null;
  readonly projectRole: "facilitator" | "groupLead" | "member" | "observer" | null;
}

export class FakeSubjectRepository implements SubjectRepository {
  private readonly rows = new Map<string, Row>();
  /** `${orgId}:${userId}:${groupId}` -> membership. Set up by the test via `setGroupContext`. */
  private readonly groupContext = new Map<string, FakeGroupMembership>();
  /** `${orgId}:${userId}` -> org-level membership (no project role). */
  private readonly orgContext = new Map<string, { orgRole: string | null; teamId: string | null }>();

  constructor(private readonly cipher: ContactCipher) {}

  setGroupContext(orgId: OrgId, userId: string, groupId: string, ctx: FakeGroupMembership): void {
    this.groupContext.set(`${orgId}:${userId}:${groupId}`, ctx);
  }

  setOrgContext(orgId: OrgId, userId: string, ctx: { orgRole: string | null; teamId: string | null }): void {
    this.orgContext.set(`${orgId}:${userId}`, ctx);
  }

  async create(input: CreateSubjectInput): Promise<SubjectRecord> {
    const subjectId = `subj-${randomUUID()}`;
    const record: SubjectRecord = {
      subjectId,
      groupId: input.groupId,
      displayName: input.displayName,
      roleTitle: input.roleTitle,
      orgName: input.orgName,
      backgroundAndQuestions: input.backgroundAndQuestions ?? "",
      mode: input.mode ?? "interview",
      sourceKind: input.sourceKind,
      contactMask: maskContact(input.contact),
      createdBy: input.createdBy,
      createdAt: new Date(0).toISOString(),
    };
    const sealed =
      input.contact === null || input.contact.length === 0
        ? null
        : sealContact(input.contact, this.cipher, new Date(0).toISOString());
    this.rows.set(subjectId, { record, sealed });
    return record;
  }

  async update(input: UpdateSubjectInput): Promise<SubjectRecord> {
    const existing = this.rows.get(input.subjectId);
    if (existing === undefined) throw new Error(`no such subject ${input.subjectId}`);
    const record: SubjectRecord = {
      ...existing.record,
      displayName: input.displayName ?? existing.record.displayName,
      roleTitle: input.roleTitle ?? existing.record.roleTitle,
      orgName: input.orgName,
      groupId: input.groupId,
      contactMask: input.contact === null ? existing.record.contactMask : maskContact(input.contact),
    };
    const sealed =
      input.contact === null
        ? existing.sealed
        : sealContact(input.contact, this.cipher, new Date(0).toISOString());
    this.rows.set(input.subjectId, { record, sealed });
    return record;
  }

  async findGuardedById(_orgId: OrgId, subjectId: string): Promise<GuardedSubjectRow | null> {
    const row = this.rows.get(subjectId);
    return row === undefined ? null : toGuarded(row.record);
  }

  async listByGroup(_orgId: OrgId, groupId: string): Promise<GuardedSubjectRow[]> {
    return [...this.rows.values()].filter((r) => r.record.groupId === groupId).map((r) => toGuarded(r.record));
  }

  async listByInterviewSession(): Promise<GuardedSubjectRow[]> {
    return [];
  }

  async listByOrgName(_orgId: OrgId, orgName: string): Promise<GuardedSubjectRow[]> {
    return [...this.rows.values()].filter((r) => r.record.orgName === orgName).map((r) => toGuarded(r.record));
  }

  async listByProjectScope(): Promise<GuardedSubjectRow[]> {
    // Fake doesn't model `groups.project_id` -- tests that need `exportSubjects` seed rows
    // directly and call this indirectly through a project-scope stub where needed.
    return [...this.rows.values()].map((r) => toGuarded(r.record));
  }

  async attachToSession(): Promise<void> {
    /* no-op: not exercised by F98's tests */
  }

  async viewerContextForGroup(orgId: OrgId, userId: string, groupId: string) {
    const ctx = this.groupContext.get(`${orgId}:${userId}:${groupId}`);
    return ctx ?? { orgRole: null, teamId: null, projectRole: null };
  }

  async orgMembershipOf(orgId: OrgId, userId: string) {
    const ctx = this.orgContext.get(`${orgId}:${userId}`);
    return ctx ?? { orgRole: null, teamId: null };
  }

  async findContactForReveal(
    _orgId: OrgId,
    subjectId: string,
  ): Promise<{ facts: SubjectVisibilityFacts; sealed: SealedContact | null } | null> {
    const row = this.rows.get(subjectId);
    if (row === undefined) return null;
    return { facts: { groupId: row.record.groupId, createdBy: row.record.createdBy }, sealed: row.sealed };
  }
}

function maskContact(contact: string | null): string | null {
  if (contact === null || contact.length === 0) return null;
  if (contact.length <= 4) return "*".repeat(contact.length);
  return "*".repeat(contact.length - 4) + contact.slice(-4);
}

function toGuarded(record: SubjectRecord): GuardedSubjectRow {
  return {
    item: guard({ kind: "subject", id: record.subjectId }, record),
    facts: { groupId: record.groupId, createdBy: record.createdBy },
  };
}
