import {z} from 'zod';
import {WHITEBOARD_LIMITS,WhiteboardObject} from './whiteboard-document';
import {WHITEBOARD_IMPORT_LIMITS} from './whiteboard-import';
import {WhiteboardImageMime} from './whiteboard-asset';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const boundedBytes=z.number().int().positive().max(WHITEBOARD_IMPORT_LIMITS.uploadBytes);
// Base64 emits complete four-character quanta. `ceil(bytes * 4 / 3)` is one
// character too small whenever the byte limit is not divisible by three (the
// 32 MiB Board limit leaves a remainder of two), rejecting a valid max-size
// portable file before the service can verify its declared byte length/hash.
const maxBase64Characters=4*Math.ceil(WHITEBOARD_IMPORT_LIMITS.uploadBytes/3);
export const PortableMedia=z.object({path:z.string().regex(/^images\/[a-f0-9]{64}$/),assetId:z.string().min(1).max(200),sha256:hash,sizeBytes:boundedBytes,mime:WhiteboardImageMime.exclude(['image/svg+xml']),contentBase64:z.string().max(maxBase64Characters)}).strict();
export const PortableBoardBundle=z.object({format:z.literal('workspacex.board.bundle.v1'),revision:z.object({epoch:z.number().int().positive(),seq:z.number().int().nonnegative()}).strict(),objects:z.object({path:z.literal('objects.json'),sha256:hash,sizeBytes:boundedBytes,content:z.array(WhiteboardObject).max(WHITEBOARD_LIMITS.objects)}).strict(),media:z.array(PortableMedia).max(WHITEBOARD_IMPORT_LIMITS.files)}).strict();
export const PortableFile=z.object({sizeBytes:boundedBytes,sha256:hash,contentBase64:z.string().max(maxBase64Characters)}).strict();
export const PortableImportRequest=z.object({requestId:z.string().uuid(),expectedEpoch:z.number().int().positive(),file:PortableFile}).strict();
export const PortableImportResult=z.object({epoch:z.number().int().positive(),seq:z.number().int().nonnegative(),replayed:z.boolean(),objectCount:z.number().int().nonnegative(),assetCount:z.number().int().nonnegative()}).strict();
export const PortableExportResult=PortableFile.extend({fileName:z.string(),mime:z.literal('application/json')});
export const portableOperations={export:{method:'POST',path:'/whiteboards/:boardId/portable/export',out:PortableExportResult},import:{method:'POST',path:'/whiteboards/:boardId/portable/import',in:PortableImportRequest,out:PortableImportResult}} as const;
