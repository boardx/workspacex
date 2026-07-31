/**
 * `ProjectRepository` 的 PostgreSQL 实现 —— **全仓唯一一处 `INSERT INTO projects`**。
 *
 * `tests/project/create-project-atomic-two-rows.test.ts` 里有一条断言扫过整个
 * `apps/api/src`，要求这句 SQL 恰好出现在**一个**文件里。那条断言就是「一条创建路径」
 * 的机械判据：第二个写点一出现，它当场变红，而没有它，「唯一」只是一句注释。
 *
 * ## 一个事务里的三条语句，顺序不可交换
 *
 *   ① `project_creation_requests` 占指纹（`ON CONFLICT DO NOTHING`）
 *        └ 命中冲突 ⇒ 这次是**重放**，读出先前那个容器返回，一行都不写
 *   ② `projects`      —— 超类型行
 *   ③ 子类型表        —— 1:1 子行
 *
 * ① 必须在最前：让**数据库**裁决「新建还是重放」，并发下两路才被主键序列化。
 * 先 `SELECT` 再决定的写法在并发下两路都读到「没有」，然后都去建——那正是
 * 契约在 `SEGMENT_ALREADY_ACTIVE` 那条注释里点名的「空转的门」。
 * ①指向的容器行此刻还不存在，所以那条复合外键在迁移 0026 里是 `DEFERRABLE
 * INITIALLY DEFERRED` 的（理由写在迁移里）。
 *
 * ②③ 必须在**同一个** `withTenant`：`withTenant` 一次调用 = 一个事务
 * （见 `application/ports/database.port.ts`）。拆成两次调用就是两次提交，
 * 于是「有容器没子类型」这个 I-P34 想排除的中间态**在两次提交之间真实存在**，
 * 而且崩溃在那一刻的话它会永久留下。反证见测试文件里那条 `FaultAfterQuery`。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { IdFactory } from "../../application/artifact/ports";
import type {
  CreateProjectCommand,
  CreatedProject,
  ProjectRepository,
} from "../../application/project/ports";
import type { ProjectKind } from "../../domain/project/create-project-rules";
import { SUBTYPE_TABLE } from "../../domain/project/subtype-tables";

interface ProjectRow {
  id: string;
  kind: ProjectKind;
  status: "active" | "archived";
}

export class PgProjectRepository implements ProjectRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly ids: IdFactory,
  ) {}

  async create(cmd: CreateProjectCommand): Promise<CreatedProject> {
    // 容器 id **就是**子类型行的 id（超类型模型下 1:1，契约 `createProject.out` 逐字）。
    // 生成在事务外没有意义上的区别，但生成在这里能让「两行同 id」在一处读完。
    const id = this.ids.next("prj");

    return this.db.withTenant(cmd.orgId, async (s) => {
      const claimed = await s.query<{ project_id: string }>(
        `INSERT INTO project_creation_requests (fingerprint, org_id, actor_id, project_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (fingerprint) DO NOTHING
         RETURNING project_id`,
        [cmd.fingerprint, cmd.orgId, cmd.actorId, id],
      );

      if (claimed.rows.length === 0) {
        // 重放。⚠ 这里读的是**先前那次**写下的 project_id，不是本次生成的 `id`——
        // 返回 `id` 会让调用者拿到一个从未存在过的容器，而两次调用的返回值不同
        // 这件事只有把两次的 id 摆在一起才看得见。
        const prior = await s.query<ProjectRow>(
          `SELECT p.id, p.kind, p.status
             FROM project_creation_requests r
             JOIN projects p ON p.id = r.project_id
            WHERE r.fingerprint = $1 AND r.actor_id = $2`,
          [cmd.fingerprint, cmd.actorId],
        );
        const row = prior.rows[0];
        if (row === undefined) {
          // ⚠ `AND r.actor_id = $2` 不是一次多余的收紧，它是本文件在
          //   `lint-permission-paths` 白名单里那条豁免的**全部依据**：加上它之后，
          //   本文件唯一的一次读，读到的只可能是**调用者自己刚提交的那次创建请求**的回声。
          //   （指纹本就含 `actorId`，所以它在功能上冗余——而豁免论证不能建立在
          //   「另一个文件里的某个函数碰巧把 actorId 拌了进去」上。这一条写在 SQL 里，
          //   `tests/project/create-project-idempotent.test.ts` 逐条断言。）
          // 指纹被占着、容器却查不到：在本 schema 下这不可能（复合外键 + 级联），
          // 所以它只会在有人手改库或删了外键时出现。静默返回一个编出来的 id
          // 比抛出去糟得多——那正是「全绿但空转」。
          throw new Error("replay row points at a container that does not exist");
        }
        return { id: row.id, kind: row.kind, status: row.status, created: false };
      }

      // ⚠ `status` 显式写 'active' 而不是吃 DEFAULT：`ProjectStatus` 恰好两态是一条裁决
      //   （Q-5 B），让它由列默认值决定，等于把一条裁决存在一个 `ALTER TABLE` 里。
      const created = await s.query<ProjectRow>(
        `INSERT INTO projects (id, org_id, name, status, kind)
         VALUES ($1, $2, $3, 'active', $4)
         RETURNING id, kind, status`,
        [id, cmd.orgId, cmd.name, cmd.kind],
      );

      // 表名来自 domain 的映射，不是拼出来的字符串；它不含用户输入，也不可能含
      // ——`cmd.kind` 已被 `isProjectKind` 收窄成三值之一，映射的键就是那三个。
      await s.query(`INSERT INTO ${SUBTYPE_TABLE[cmd.kind]} (id, org_id) VALUES ($1, $2)`, [
        id,
        cmd.orgId,
      ]);

      // ⚠ `blueprintVersionId` 到此为止：**没有任何一列存得下它**。
      //   `projects` 的列集合是封闭清单（I-P33），蓝本引用属工作坊机件、应当落在
      //   `workshops` 上，而那一列是 F23 的交付物（蓝本表本身也还不存在）。
      //   Q-1 C 逐字要求「六类初始化**跳过而非写空值**」，所以这里既不写空值，
      //   也**不**顺手加一列——加列会同时越过 F23 与 I-P33 两条边。
      //   ⇒ 后果：本 feature 建出的容器**记不住它是从哪个蓝本来的**，
      //     而 `getProjectOverview.out.blueprint` 需要它。已作为遗留项报给签核人。
      const row = created.rows[0]!;
      return { id: row.id, kind: row.kind, status: row.status, created: true };
    });
  }
}
