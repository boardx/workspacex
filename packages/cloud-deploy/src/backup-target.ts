import { z } from "zod";
/** The JSON value resolved from backupTargetRef; credentials remain in the ECS role. */
export const BackupTargetSchema = z.object({
  backend: z.literal("oss"), region: z.string().regex(/^[a-z]{2}-[a-z]+(?:-\d+)?$/),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  endpoint: z.string().url(), prefix: z.string().max(700).regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
  authMode: z.literal("ecs-role"), roleName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
}).strict().superRefine((v, ctx) => {
  if (![ `https://oss-${v.region}.aliyuncs.com`, `https://oss-${v.region}-internal.aliyuncs.com` ].includes(v.endpoint))
    ctx.addIssue({ code: "custom", path: ["endpoint"], message: "region mismatch" });
});
export type BackupTarget = z.infer<typeof BackupTargetSchema>;
export function parseBackupTarget(raw: string): BackupTarget {
  try { return BackupTargetSchema.parse(JSON.parse(raw)); }
  catch { throw new Error("INVALID_BACKUP_TARGET"); }
}
