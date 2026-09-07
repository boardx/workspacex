/**
 * 「把平台自有的 skill 放到一边」——所有空态断言共用的**唯一**判据。
 *
 * ## 为什么需要它（e2e-full 9 条空态断言集体变红的根因）
 *
 * design-delta `platform-owned-skills`：`org-platform` 下的 skill 行对**每一个** org
 * 可见（`pg-skill-contract-repository.ts` 的 `OR sk.org_id = PLATFORM_ORG_ID`，加上
 * RLS 的四条 `_platform_read` 策略）。它们不是任何 org 自己的配置，所以断言「没配置
 * 过的 org 拿到空列表」时要先把它们排除掉。
 *
 * 这件事本身早就做对了——做错的是**怎么认出它们**。四个测试文件各自写了一份
 *
 *     OFFICIAL_SKILLS.some((s) => s.skillId === id)      // 恰好四个，逐字写死
 *
 * 而 `ensureStandardSkillPacksSeeded()`（`STANDARD_PLATFORM_PACKS` 九个包）后来又往
 * `org-platform` 里种了 16 个 skill，id 是导入时现铸的 `skill-<uuid>`，四条硬编码
 * 名字一个都盖不住。于是「放到一边」只放掉了 4/20，剩下 16 个漏进断言，9 条空态用例
 * 在 e2e-full 里集体变红——而且是**顺序依赖的红**：只有当同一个共享隔离库里
 * `standard-platform-packs.test.ts` / `ensure-platform-skill-catalog.test.ts` /
 * `office-full-packages.test.ts` 之一先跑过，那 20 行才存在。单独跑这 4 个文件全绿。
 *
 * ⚠ 这不是把断言改宽。「平台自有」的**事实**是 `org_id = 'org-platform'` 这一行数据，
 *   不是某处写死的四个名字——按名字过滤才是本仓一再禁止的那种「同一事实声明两处」，
 *   而且它对第 5 个平台 skill 就已经失效了。按 org 归属过滤严格更窄：
 *   · 产品源码里凭空硬编码出来的内置清单**在 `skills` 表里没有行**，照样漏不掉
 *     （`no-builtin-capability-lists.test.ts` 要守的正是这个）；
 *   · 被测 org 自己的行 `org_id` 不是 `org-platform`，照样漏不掉。
 *
 * ## 为什么先取列表、后读库（顺序是语义的一部分，不是随手写的）
 *
 * vitest 并行跑测试文件，共享同一个隔离库。若先读 id 集合、再取列表，两次之间被别的
 * 文件种进去的平台行会**出现在列表里却不在 id 集合里** ⇒ 随机假红。本函数只接收
 * **已经取回来的** items，DB 读取因此必然发生在列表之后；平台行只增不删
 * （`wave2_skill_immutable_trg` 挡掉删除），所以「列表时刻存在 ⇒ 读库时刻仍存在」。
 * 这个顺序由函数签名保证，调用方写不错。
 */
import { PLATFORM_ORG_ID } from "../../src/domain/org-id";
import { asOwner } from "./db";

/** `org-platform` 名下的全部 skill id（两张投影表取并集：`skills` 与 `capability_listings`）。 */
export async function platformOwnedSkillIds(): Promise<ReadonlySet<string>> {
  return asOwner(async (client) => {
    const rows = await client.query<{ id: string }>(
      `SELECT id FROM skills WHERE org_id = $1
       UNION
       SELECT id FROM capability_listings WHERE org_id = $1 AND kind = 'skill'`,
      [PLATFORM_ORG_ID],
    );
    return new Set(rows.rows.map((row) => row.id));
  });
}

/**
 * 从**已取回**的列表里滤掉平台自有的 skill，剩下的就是「这个 org 自己的」。
 *
 * @param idOf 取 id 的方式——`/capabilities` 的项是 `id`，`GET /skills` 的
 *   `SkillListItem` 是 `skillId`（该契约不带 orgId，只能按 id 认）。
 */
export async function withoutPlatformOwnedSkills<T>(
  items: readonly T[],
  idOf: (item: T) => string,
): Promise<T[]> {
  const platform = await platformOwnedSkillIds();
  return items.filter((item) => !platform.has(idOf(item)));
}
