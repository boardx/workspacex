export { CommentThreadMetadataSchema, CommentBackupDescriptorSchema } from '@repo/contracts/whiteboard-storage';
export type { CommentThreadMetadata, CommentBackupDescriptor } from '@repo/contracts/whiteboard-storage';
export interface CommentBlobRef { key:string; hash:string; bytes:number; mime:'application/json'; }
