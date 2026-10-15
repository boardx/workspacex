import { z } from "zod";

/** Public export limits; shared by API validation and the reading page. */
export const SHARE_LIMITS = { messages: 2000, snapshotBytes: 16 * 1024 * 1024, imageBytes: 5 * 1024 * 1024 } as const;
export const Token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const ImageMime = z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export const Attachment = z.object({
  filename: z.string(), mime: z.string(), bytes: z.number().int().nonnegative(),
  imageData: z.string().optional(),
}).strict();
export const Snapshot = z.object({
  title: z.string(),
  messages: z.array(z.object({
    authorKind: z.enum(["human", "agent"]), text: z.string(), createdAt: z.string(),
    attachments: z.array(Attachment),
  }).strict()).max(SHARE_LIMITS.messages),
}).strict();
export const Preview = z.object({ snapshot: Snapshot, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const Share = z.object({ id: z.string(), createdAt: z.string(), revokedAt: z.string().nullable() }).strict();
export const CreateInput = z.object({ revision: Preview.shape.revision }).strict();
export const Created = z.object({ share: Share, token: Token }).strict();
export const PublicSnapshot = z.object({ snapshot: Snapshot, createdAt: z.string() }).strict();
export type SnapshotValue = z.infer<typeof Snapshot>;
export type PreviewValue = z.infer<typeof Preview>;
export type ShareValue = z.infer<typeof Share>;
export const paths = {
  preview: "/chat/threads/:threadId/share-preview",
  manage: "/chat/threads/:threadId/shares",
  revoke: "/chat/threads/:threadId/shares/:shareId",
  read: "/chat/shares/:token",
} as const;
