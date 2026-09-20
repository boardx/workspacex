import { randomUUID } from "node:crypto";
import type { SurveyLibraryTemplate, SurveyTemplateInput } from "@repo/contracts/survey-template-library";
import type { OrgId } from "../../domain/org-id";
import { SurveyError } from "./survey-service";

export const SURVEY_TEMPLATE_REPOSITORY = Symbol("SurveyTemplateRepository");
export interface SurveyTemplateRepository {
  listTemplates(orgId: OrgId, ownerId: string, kind?: SurveyTemplateInput["kind"]): Promise<SurveyLibraryTemplate[]>;
  createTemplate(orgId: OrgId, ownerId: string, model: SurveyLibraryTemplate): Promise<void>;
  getTemplate(orgId: OrgId, ownerId: string, id: string): Promise<SurveyLibraryTemplate>;
  updateTemplate(orgId: OrgId, ownerId: string, id: string, version: number, input: SurveyTemplateInput): Promise<SurveyLibraryTemplate>;
  deleteTemplate(orgId: OrgId, ownerId: string, id: string, version: number): Promise<void>;
}
/** Personal templates share existing principal + owner isolation; they are not projects. */
export class SurveyTemplateService {
  constructor(private readonly repo: SurveyTemplateRepository) {}
  list(orgId: OrgId, ownerId: string, kind?: SurveyTemplateInput["kind"]) {
    return this.repo.listTemplates(orgId, ownerId, kind);
  }
  async create(orgId: OrgId, ownerId: string, input: SurveyTemplateInput) {
    const model: SurveyLibraryTemplate = { ...input, id: randomUUID(), version: 1, updatedAt: new Date().toISOString() };
    await this.repo.createTemplate(orgId, ownerId, model);
    return model;
  }
  get(orgId: OrgId, ownerId: string, id: string) { return this.repo.getTemplate(orgId, ownerId, id); }
  save(orgId: OrgId, ownerId: string, id: string, version: number, input: SurveyTemplateInput) {
    return this.repo.updateTemplate(orgId, ownerId, id, version, input);
  }
  delete(orgId: OrgId, ownerId: string, id: string, version: number) {
    return this.repo.deleteTemplate(orgId, ownerId, id, version);
  }
}
export function assertTemplateUpdate(current: SurveyLibraryTemplate, version: number, kind: SurveyTemplateInput["kind"]): void {
  if (current.version !== version) throw new SurveyError("version_conflict");
  if (current.kind !== kind) throw new SurveyError("invalid_survey");
}
