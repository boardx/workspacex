import type { PhysicalPurgePort } from '../../application/files/physical-delete-ports';
import type { WhiteboardFileExportCleaner } from '../../application/whiteboard/file-export-ports';

/** Narrow purge capability: this adapter cannot delete outside the export namespace. */
export class PhysicalWhiteboardFileExportCleaner implements WhiteboardFileExportCleaner {
  constructor(private readonly physicalPurge: PhysicalPurgePort) {}
  async purge(objectKey: string): Promise<boolean> {
    if (!/^whiteboard-exports\/[a-zA-Z0-9_-]+\/[0-9a-f-]{36}\.(?:png|svg|pdf|csv)$/.test(objectKey)) return false;
    const result = await this.physicalPurge.purgeAll([objectKey]);
    return result.length === 1 && result[0]!.objectKey === objectKey && result[0]!.deleted;
  }
}
