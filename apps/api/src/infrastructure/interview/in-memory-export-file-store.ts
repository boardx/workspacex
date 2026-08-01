/**
 * In-memory stand-in for `ExportFileStore` (F98). Same posture as
 * `in-memory-candidate-store.ts`: process-local, swappable for a real 22-files-integrated
 * implementation without touching `export-subjects.ts`. See `export-file-ports.ts` for the
 * reported gap this stands in for.
 */
import { randomUUID } from "node:crypto";
import type { ExportedSubjectRow, ExportFileStore } from "../../application/interview/export-file-ports";

export class InMemoryExportFileStore implements ExportFileStore {
  readonly filesById = new Map<string, readonly ExportedSubjectRow[]>();

  async put(_orgId: string, rows: readonly ExportedSubjectRow[]): Promise<string> {
    const fileId = `export-${randomUUID()}`;
    this.filesById.set(fileId, rows);
    return fileId;
  }
}
