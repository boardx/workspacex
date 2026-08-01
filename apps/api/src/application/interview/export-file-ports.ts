/**
 * Where an `exportSubjects` (F98) output lands. Minimal on purpose.
 *
 * R10 (uc-6-7) says the export's *product* is a file that must be registered as an
 * `artifacts` row and shown in the project file browser (22-files integration) -- but that
 * integration is a whole other bundle's write path and is not this feature's scope (F98 is
 * "联系方式遮盖/查看留痕/导出排除", not "wire every export into 22-files"). Reported here as a
 * known gap rather than silently assumed done: this port is the seam where that wiring
 * belongs, and `InMemoryExportFileStore` is a stand-in that proves the CONTENT excludes
 * contact -- it is not a claim that the file is visible in any file browser yet.
 */
export interface ExportedSubjectRow {
  readonly subjectId: string;
  readonly displayName: string;
  readonly roleTitle: string;
  readonly orgName: string | null;
  readonly groupId: string | null;
  readonly sourceKind: "human" | "virtual";
}

export interface ExportFileStore {
  /** Returns the new file's id. */
  put(orgId: string, rows: readonly ExportedSubjectRow[]): Promise<string>;
}
