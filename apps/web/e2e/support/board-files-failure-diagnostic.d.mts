export type FilesFailurePhase = 'NO_PRIMARY_FAILURE' | 'SETUP' | 'HEAD_BEFORE' | 'UPLOAD' | 'UPLOAD_STATUS' | 'UPLOAD_SCHEMA' | 'METADATA' | 'DIGEST' | 'UNIQUE_ASSET' | 'DOWNLOAD' | 'DOWNLOAD_STATUS' | 'DOWNLOAD_BYTES' | 'DOWNLOAD_HEADERS' | 'STORED_METADATA' | 'HEAD_UNCHANGED' | 'ROW_COUNT' | 'SERVER_EVIDENCE' | 'DELETE_OWNED' | 'END_RUNTIME_IDENTITY';
export function fixedFilesFailure(phase: FilesFailurePhase, ordinal: number, deleteFailures: number, identityFailures: number): string;
export function parseFilesFailure(message: unknown, location: unknown, root?: string): Readonly<{phase: FilesFailurePhase; ordinal: number; deleteFailures: number; identityFailures: number}> | null;
export declare function filesFailureAggregateLine(root: string): number | null;
