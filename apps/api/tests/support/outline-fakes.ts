/**
 * F85 —— `OutlineRepository` 的内存实现，供不连 Postgres 的纯测试使用（issue #74）。
 *
 * ⚠ 与 `pg-outline-repository.ts` 同一份状态机：`updateSections` 置 `manuallyEdited = true`，
 *   且已确认的大纲手改后打回 `pending_confirm`；`replaceSections`（AI 重新生成）恒置
 *   `manuallyEdited = false`。两处分叉就是这个 fake 存在的意义落空。
 */
import { guard } from "../../src/application/security/permission-filter";
import type { OrgId } from "../../src/domain/org-id";
import type { OutlineSectionDraft } from "../../src/domain/interview/outline";
import type {
  CreateOutlineInput,
  GuardedOutlineRow,
  OutlineRecord,
  OutlineRepository,
  OutlineStatusName,
} from "../../src/application/interview/outline-ports";

function toSectionRecords(sections: readonly OutlineSectionDraft[], outlineId: string): OutlineRecord["sections"] {
  return sections.map((s) => ({
    sectionId: `${outlineId}-sec-${s.order}`,
    objective: s.objective,
    openers: s.openers,
    minutes: s.minutes,
    order: s.order,
    status: null,
  }));
}

interface Row {
  outlineId: string;
  interviewId: string;
  status: OutlineStatusName;
  sections: OutlineRecord["sections"];
  manuallyEdited: boolean;
}

export class InMemoryOutlineRepository implements OutlineRepository {
  private readonly byOutlineId = new Map<string, Row>();
  private readonly byInterviewId = new Map<string, string>();

  async create(input: CreateOutlineInput): Promise<OutlineRecord> {
    const row: Row = {
      outlineId: input.outlineId,
      interviewId: input.interviewId,
      status: "pending_confirm",
      sections: toSectionRecords(input.sections, input.outlineId),
      manuallyEdited: false,
    };
    this.byOutlineId.set(input.outlineId, row);
    this.byInterviewId.set(input.interviewId, input.outlineId);
    return toRecord(row);
  }

  async getByInterview(_orgId: OrgId, _viewerUserId: string, interviewId: string): Promise<GuardedOutlineRow | null> {
    const outlineId = this.byInterviewId.get(interviewId);
    if (outlineId === undefined) return null;
    const row = this.byOutlineId.get(outlineId);
    if (row === undefined) return null;
    return {
      item: guard({ kind: "interview", id: interviewId }, toRecord(row)),
      facts: { projectId: null, createdBy: "test-fixture", isExplicitCollaborator: true },
    };
  }

  async replaceSections(
    _orgId: OrgId,
    outlineId: string,
    sections: readonly OutlineSectionDraft[],
  ): Promise<OutlineRecord> {
    const row = this.mustGet(outlineId);
    row.sections = toSectionRecords(sections, outlineId);
    row.manuallyEdited = false;
    row.status = "pending_confirm";
    return toRecord(row);
  }

  async confirm(_orgId: OrgId, outlineId: string): Promise<OutlineRecord> {
    const row = this.mustGet(outlineId);
    row.status = "confirmed";
    return toRecord(row);
  }

  async getById(_orgId: OrgId, outlineId: string): Promise<OutlineRecord | null> {
    const row = this.byOutlineId.get(outlineId);
    return row === undefined ? null : toRecord(row);
  }

  async updateSections(
    _orgId: OrgId,
    outlineId: string,
    sections: readonly OutlineSectionDraft[],
  ): Promise<OutlineRecord> {
    const row = this.mustGet(outlineId);
    row.sections = toSectionRecords(sections, outlineId);
    row.manuallyEdited = true;
    if (row.status === "confirmed") row.status = "pending_confirm";
    return toRecord(row);
  }

  private mustGet(outlineId: string): Row {
    const row = this.byOutlineId.get(outlineId);
    if (row === undefined) throw new Error(`outline ${outlineId} not found`);
    return row;
  }
}

function toRecord(row: Row): OutlineRecord {
  return {
    outlineId: row.outlineId,
    interviewId: row.interviewId,
    status: row.status,
    sections: row.sections,
    manuallyEdited: row.manuallyEdited,
  };
}
