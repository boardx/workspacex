export type FileStorageReceipt = {backend: 'fs'; objectRoot: string; dataDir: string; apiRoot: string; apiPid: number; head: string; startedAt: string; deploymentMarker: string; receiptPath: string; receiptSha256: string};
export type FileStorageManifest = {apiRoot: string; head: string; startedAt: string; deploymentMarker: string; processes: Array<{kind: string; pid: number}>; fileStorage?: FileStorageReceipt};
export function attestFileStorage(input: {manifest: FileStorageManifest; apiEnvironment: Record<string, string | undefined>; dataDir: string}): FileStorageReceipt;
export function verifyFileStorage(manifest: FileStorageManifest): {objectRoot: string; dataDir: string; receiptSha256: string};
export function blockOwnedFileWrite(input: {objectRoot: string; key: string; boardId: string; resolveObjectPath: (root: string, key: string) => string}): {path: string; restore(): void};
