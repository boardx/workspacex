/**
 * F80 的 fixture。
 *
 * 与 `db.ts` 的租户 fixture 同一纪律：**以 app 角色在租户上下文里写入**，不走 owner。
 * 迁移 0020 的 `WITH CHECK (org_id = current_setting('app.current_org', true))` 因此是
 * 被真的走过一遍的；owner 写入会绕过它，于是整套断言建立在生产永远写不出来的数据上。
 */
import { asApp, asOwner } from "./db";
import type { ContactCipher } from "../../src/domain/interview/contact-vault";

/**
 * A deterministic fixture cipher for `PgInterviewSubjectRepository` (F98's constructor now
 * requires one -- see that file's header). Base64-encoded, not left as plaintext -- same
 * discipline `phone-encrypted-masked.test.ts` (F72) already uses for `PiiCipher` fixtures:
 * it only needs to prove the stored bytes are not the plaintext bytes. Unlike `PiiCipher`,
 * `ContactCipher` also needs a matching `decrypt` -- F98's `revealContact` is a legitimate
 * reveal path, so this fixture provides one.
 */
export const FIXTURE_CONTACT_CIPHER: ContactCipher = {
  algorithm: "base64-fixture",
  keyId: "k-test-contact-1",
  encrypt: (p) => Buffer.from(p, "utf8").toString("base64"),
  open: (c) => Buffer.from(c, "base64").toString("utf8"),
};

export interface SeedInterviewOpts {
  readonly orgId: string;
  readonly id: string;
  readonly createdBy: string;
  /** `null` = 「不属于任何项目」。**这是本 feature 的主路径，不是异常分支。** */
  readonly projectId?: string | null;
  readonly researchProjectId?: string | null;
  readonly sourceKind?: "human" | "virtual";
  readonly title?: string;
  readonly tags?: string[];
  readonly archived?: boolean;
  /** 显式协作者。第一种投影里唯一的「创建者以外」来源。 */
  readonly collaborators?: string[];
  /** 排序用。省略则由 `now()` 决定，同一批次里可能同秒，故需要顺序的用例要显式给。 */
  readonly createdAt?: Date;
}

export async function seedInterview(o: SeedInterviewOpts): Promise<string> {
  await asApp(o.orgId, async (c) => {
    await c.query(
      `INSERT INTO interview_sessions
         (id, org_id, project_id, research_project_id, source_kind, title, created_by,
          tags, archived, when_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,coalesce($10::timestamptz, now()))`,
      [
        o.id,
        o.orgId,
        o.projectId ?? null,
        o.researchProjectId ?? null,
        o.sourceKind ?? "human",
        o.title ?? `interview ${o.id}`,
        o.createdBy,
        o.tags ?? [],
        o.archived ?? false,
        o.createdAt ?? null,
      ],
    );
    for (const u of o.collaborators ?? []) {
      await c.query(
        `INSERT INTO interview_collaborators (interview_id, user_id, org_id, added_by)
         VALUES ($1,$2,$3,$4)`,
        [o.id, u, o.orgId, o.createdBy],
      );
    }
  });
  return o.id;
}

/**
 * 只删本文件自己造的那几场。
 *
 * 与 `resetOrgs` 同一纪律，不是全表 TRUNCATE：vitest 并行跑测试文件、共用一个数据库，
 * 全局清理会在别的文件跑到一半时删掉它的 fixture，症状是随机的断言失败而不是错误。
 */
export async function resetInterviews(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // 走 owner：0018 刻意不给运行时角色 DELETE（uc-6-0 里没有「删一场访谈」这个操作，
  // 解除挂载 ≠ 删除）。清理不是被断言的路径，所以在这里用 owner 是诚实的；
  // 反过来，**写入** fixture 必须走 app 角色，否则那条 WITH CHECK 从没被走过。
  // 协作者行由 ON DELETE CASCADE 带走。
  await asOwner((c) =>
    c.query("DELETE FROM interview_sessions WHERE org_id = $1 AND id = ANY($2::text[])", [orgId, ids]),
  );
}
