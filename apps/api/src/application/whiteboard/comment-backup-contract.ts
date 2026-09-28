import { z } from 'zod';
import { WhiteboardComment,WhiteboardCommentThread,WHITEBOARD_COLLABORATION_LIMITS } from '@repo/contracts/whiteboard-collaboration';

export const CommentThreadMetadataSchema=WhiteboardCommentThread.innerType().extend({comments:z.array(WhiteboardComment.omit({body:true})).max(WHITEBOARD_COLLABORATION_LIMITS.commentsPerThread)});
export type CommentThreadMetadata = z.infer<typeof CommentThreadMetadataSchema>;
export interface CommentBlobRef { key:string; hash:string; bytes:number; mime:'application/json'; }
export const CommentBackupDescriptorSchema=z.object({id:z.string().uuid(),objectId:z.string().nullable(),status:WhiteboardCommentThread.innerType().shape.status,revision:z.number().int().positive(),metadata:CommentThreadMetadataSchema,blob:z.object({key:z.string().min(1),hash:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive().max(WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes),mime:z.literal('application/json')}).strict()}).strict();
export type CommentBackupDescriptor = z.infer<typeof CommentBackupDescriptorSchema>;
