export const FILES_FAILURE_PHASES = Object.freeze(['NO_PRIMARY_FAILURE','SETUP','HEAD_BEFORE','UPLOAD','UPLOAD_STATUS','UPLOAD_SCHEMA','METADATA','DIGEST','UNIQUE_ASSET','DOWNLOAD','DOWNLOAD_STATUS','DOWNLOAD_BYTES','DOWNLOAD_HEADERS','STORED_METADATA','HEAD_UNCHANGED','ROW_COUNT','SERVER_EVIDENCE','DELETE_OWNED','END_RUNTIME_IDENTITY']);
const phases = new Set(FILES_FAILURE_PHASES);
export function fixedFilesFailure(phase, ordinal, deleteFailures, identityFailures) {
  if (!phases.has(phase) || !Number.isSafeInteger(ordinal) || ordinal < -1 || ordinal > 6 || !Number.isSafeInteger(deleteFailures) || deleteFailures < 0 || deleteFailures > 1 || !Number.isSafeInteger(identityFailures) || identityFailures < 0 || identityFailures > 1) return 'R09_FILES_FAILURE UNKNOWN';
  return `R09_FILES_FAILURE ${JSON.stringify({phase, ordinal, deleteFailures, identityFailures})}`;
}

function ownData(object,key) { try { return object !== null && typeof object === 'object' ? Object.getOwnPropertyDescriptor(object,key)?.value : undefined; } catch { return undefined; } }
export function parseFilesFailure(message, location) {
  if (typeof message !== 'string' || message.length > 1024 || ownData(location,'source') !== 'ASSERTION' || ownData(location,'file') !== 'board-files-filenames.spec.ts' || ownData(location,'line') !== FILES_FAILURE_AGGREGATE_LINE) return null;
  const match=/^(?:AggregateError: )?R09_FILES_FAILURE (\{[^\r\n]*\})$/.exec(message);
  if (!match) return null;
  let value;try { value=JSON.parse(match[1]); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'deleteFailures,identityFailures,ordinal,phase') return null;
  return fixedFilesFailure(value.phase,value.ordinal,value.deleteFailures,value.identityFailures) === `R09_FILES_FAILURE ${match[1]}` ? value : null;
}
export const FILES_FAILURE_AGGREGATE_LINE = 74;
