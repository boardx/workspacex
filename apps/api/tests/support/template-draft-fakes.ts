/**
 * In-memory doubles for F83's template + draft ports, so `extractTemplateDraft` /
 * `confirmTemplateDraft` (and the F82 template use cases they reuse) can be exercised as
 * pure unit tests -- no Postgres, no `tests/support/db.ts` -- matching the established
 * pattern in `consent-render-fakes.ts` / `rec-assignment-fakes.ts`: a fake that really
 * stores data, not a stub that hands back canned answers.
 */
import type { OrgId } from "../../src/domain/org-id";
import type { TemplateFieldInput, TemplateSectionInput } from "../../src/domain/interview/template";
import type {
  ApplyTemplateInput,
  ApplyTemplateResult,
  AppliedTemplateSnapshot,
  CreateTemplateInput,
  TemplateRepository,
  TemplateRowRecord,
  TemplateVersionRecord,
  UpdateTemplateInput,
} from "../../src/application/interview/template-ports";
import type {
  SaveTemplateDraftInput,
  SourceInterviewMaterialLookup,
  TemplateDraftRecord,
  TemplateDraftSourceReader,
  TemplateDraftStore,
} from "../../src/application/interview/template-draft-ports";
import type { GuardedInterviewRow, InterviewScopeRepository, ListVisibleInput, ListVisiblePage } from "../../src/application/interview/ports";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { guard } from "../../src/application/security/permission-filter";

interface StoredVersion extends TemplateVersionRecord {}

/** Decision ids need not be unique across a run; they must be non-empty (see `binding-fixture.ts`). */
export class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `d-${this.n}`;
  }
}

/**
 * In-memory `InterviewScopeRepository` for exercising `extractTemplateDraft`'s visibility
 * gate (see that use case's file head: it reuses F80's `findVisibleById` +
 * `decideInterviewVisibility` path, not a new one). Every seeded interview is created by
 * the given viewer with no project (`creator-and-collaborators` projection, trivially
 * visible to its own creator) -- tests that want a denial simply do not seed that id, which
 * mirrors what the real repository does for an id outside the caller's visible set: return
 * `null`, indistinguishable from "does not exist" (uc-6-0/E3).
 */
export class FakeInterviewScopeRepository implements InterviewScopeRepository {
  private readonly rows = new Map<string, GuardedInterviewRow>();

  seedVisible(interviewId: string, createdBy: string): void {
    this.rows.set(interviewId, {
      item: guard({ kind: "interview", id: interviewId }, {
        interviewId,
        title: "",
        sourceKind: "human",
        projectId: null,
        researchProjectId: null,
        tags: [],
        archived: false,
        whenAt: null,
      }),
      facts: { projectId: null, createdBy, isExplicitCollaborator: false },
    });
  }

  async listVisible(_input: ListVisibleInput): Promise<ListVisiblePage> {
    return { rows: [], nextCursor: null, counts: { human: 0, virtual: 0 } };
  }

  async findVisibleById(_orgId: OrgId, _viewerUserId: string, interviewId: string): Promise<GuardedInterviewRow | null> {
    return this.rows.get(interviewId) ?? null;
  }

  async projectIdsOf(_orgId: OrgId, _userId: string): Promise<string[]> {
    return [];
  }

  async orgMembershipOf(_orgId: OrgId, _userId: string): Promise<{ orgRole: string | null; teamId: string | null }> {
    return { orgRole: "member", teamId: null };
  }
}

export class FakeTemplateRepository implements TemplateRepository {
  private readonly heads = new Map<string, StoredVersion>();
  private readonly versions = new Map<string, StoredVersion>();
  private readonly applications = new Map<string, AppliedTemplateSnapshot>();
  private usedCounts = new Map<string, number>();

  async create(input: CreateTemplateInput): Promise<TemplateVersionRecord> {
    const record: StoredVersion = {
      templateId: input.templateId,
      versionId: input.versionId,
      versionNumber: 1,
      name: input.name,
      goal: input.goal,
      sections: input.sections,
      dataFields: input.dataFields,
      tags: input.tags,
      contentHash: input.contentHash,
      sourceInterviewIds: input.sourceInterviewIds ?? [],
    };
    this.heads.set(input.templateId, record);
    this.versions.set(`${input.templateId}:${input.versionId}`, record);
    return record;
  }

  async update(input: UpdateTemplateInput): Promise<TemplateVersionRecord | null> {
    const head = this.heads.get(input.templateId);
    if (head === undefined || head.versionNumber !== input.expectedVersionNumber) return null;

    const record: StoredVersion = {
      templateId: input.templateId,
      versionId: input.versionId,
      versionNumber: head.versionNumber + 1,
      name: input.name,
      goal: input.goal,
      sections: input.sections,
      dataFields: input.dataFields,
      tags: input.tags,
      contentHash: input.contentHash,
      sourceInterviewIds: input.sourceInterviewIds ?? [],
    };
    this.heads.set(input.templateId, record);
    this.versions.set(`${input.templateId}:${input.versionId}`, record);
    return record;
  }

  async getHead(_orgId: OrgId, templateId: string): Promise<TemplateVersionRecord | null> {
    return this.heads.get(templateId) ?? null;
  }

  async getVersion(_orgId: OrgId, templateId: string, versionId: string): Promise<TemplateVersionRecord | null> {
    return this.versions.get(`${templateId}:${versionId}`) ?? null;
  }

  async list(_orgId: OrgId): Promise<readonly TemplateRowRecord[]> {
    return Array.from(this.heads.values()).map((v) => {
      const minutes = v.sections.map((s) => s.minutes);
      return {
        templateId: v.templateId,
        name: v.name,
        usedCount: this.usedCounts.get(v.templateId) ?? 0,
        oneLiner: v.goal,
        questionCount: v.sections.length,
        minutesRangeMin: minutes.length > 0 ? Math.min(...minutes) : 0,
        minutesRangeMax: minutes.length > 0 ? Math.max(...minutes) : 0,
      };
    });
  }

  async usedCount(_orgId: OrgId, templateId: string): Promise<number> {
    return this.usedCounts.get(templateId) ?? 0;
  }

  /** Test-only knob: simulate N applications having happened for a template. */
  setUsedCount(templateId: string, n: number): void {
    this.usedCounts.set(templateId, n);
  }

  async apply(input: ApplyTemplateInput): Promise<ApplyTemplateResult> {
    const version = input.versionId !== null
      ? this.versions.get(`${input.templateId}:${input.versionId}`)
      : this.heads.get(input.templateId);
    if (version === undefined) throw new Error(`template ${input.templateId} not found`);

    const interviewId = input.targetInterviewId ?? input.newInterviewId;
    this.applications.set(interviewId, {
      interviewId,
      templateId: input.templateId,
      templateVersionId: version.versionId,
      sections: version.sections,
      dataFields: version.dataFields,
    });
    this.usedCounts.set(input.templateId, (this.usedCounts.get(input.templateId) ?? 0) + 1);
    return {
      interviewId,
      appliedTemplateVersionId: version.versionId,
      sections: version.sections,
      dataFields: version.dataFields,
    };
  }

  async getAppliedSnapshot(_orgId: OrgId, interviewId: string): Promise<AppliedTemplateSnapshot | null> {
    return this.applications.get(interviewId) ?? null;
  }

  /** Test-only seam: register a source interview's applied snapshot directly, without going
   *  through `apply()` -- used to set up "已办访谈已经套用过某三样东西" fixtures. */
  seedAppliedSnapshot(snapshot: AppliedTemplateSnapshot): void {
    this.applications.set(snapshot.interviewId, snapshot);
  }
}

export class FakeTemplateDraftStore implements TemplateDraftStore {
  private readonly rows = new Map<string, TemplateDraftRecord>();

  async save(input: SaveTemplateDraftInput): Promise<TemplateDraftRecord> {
    const record: TemplateDraftRecord = {
      draftId: input.draftId,
      orgId: input.orgId,
      name: input.name,
      goal: input.goal,
      sections: input.sections,
      dataFields: input.dataFields,
      tags: [],
      sourceInterviewIds: input.sourceInterviewIds,
      confirmedTemplateId: null,
    };
    this.rows.set(input.draftId, record);
    return record;
  }

  async get(_orgId: OrgId, draftId: string): Promise<TemplateDraftRecord | null> {
    return this.rows.get(draftId) ?? null;
  }

  async markConfirmed(_orgId: OrgId, draftId: string, templateId: string): Promise<void> {
    const row = this.rows.get(draftId);
    if (row === undefined) return;
    this.rows.set(draftId, { ...row, confirmedTemplateId: templateId });
  }

  /** Test-only direct read, bypassing the use case -- to assert "what did storage end up with". */
  peek(draftId: string): TemplateDraftRecord | undefined {
    return this.rows.get(draftId);
  }
}

export class FakeSourceInterviewReader implements TemplateDraftSourceReader {
  private readonly rows = new Map<string, SourceInterviewMaterialLookup>();

  /** Seed one source interview's fixture: O-05 consent outcome and material. */
  seed(input: {
    readonly interviewId: string;
    readonly aiAnalysisAllowed?: boolean;
    readonly sections?: readonly TemplateSectionInput[];
    readonly dataFields?: readonly TemplateFieldInput[];
  }): void {
    this.rows.set(input.interviewId, {
      interviewId: input.interviewId,
      aiAnalysisAllowed: input.aiAnalysisAllowed ?? true,
      sections: input.sections ?? [],
      dataFields: input.dataFields ?? [],
    });
  }

  async readSourceMaterials(
    _orgId: OrgId,
    sourceInterviewIds: readonly string[],
  ): Promise<readonly SourceInterviewMaterialLookup[]> {
    return sourceInterviewIds.map(
      (id) =>
        this.rows.get(id) ?? {
          interviewId: id,
          aiAnalysisAllowed: false,
          sections: [],
          dataFields: [],
        },
    );
  }
}
