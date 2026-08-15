/**
 * `AgendaSegmentRepository` 的 PostgreSQL 实现（F119）。
 *
 * ## 一个事务里的两条语句，顺序不可交换
 *
 *   ① `UPDATE agenda_segments SET state = $nextState, merged_into = $mergedInto WHERE id = ...`
 *        —— 当前环节的终态生效。`WHERE` 同时钉住 `workshop_id` 与 `org_id`：即便调用方传了
 *           一个真实存在但**不属于本工作坊**的 `segmentId`，这条 `UPDATE` 也影响 0 行，
 *           而不是跨工作坊改到别处的环节（同 F118 复合外键防「绑到别的工作坊」的理由）。
 *   ② 紧邻其后（`ordinal` 更大、状态为 `pending`）的一条环节，若存在，置为 `active`。
 *        这一条会撞上 `agenda_segments_one_active_per_workshop` 部分唯一索引——那正是
 *        「唯一驱动源」在并发下的判据（I-P44），`23505` 原样向上抛，
 *        由 `application/project/advance-agenda-segment.ts` 翻译成 `SEGMENT_ALREADY_ACTIVE`。
 *
 * ① 必须在 ② 之前：先让当前环节离开 `active`（或它本就不是 `active`——`skip` 可以作用于
 * `pending` 环节），部分唯一索引才可能放行 ② 的写入；反过来做，当前环节还占着
 * （工作坊, active）这个键位时，② 十有八九会先撞上它，而那不是本操作想表达的冲突。
 *
 * ⚠ 没有 `findById` 的第二个实现、也没有第二处 `UPDATE agenda_segments`——本仓储是
 * 全仓唯一一处推进环节状态机的写点（同 F118 建表时的『唯一创建路径』纪律）。这条
 * claim 在 #627 加了 `create()`（一个 `INSERT`）之后依然成立——create 不推进任何
 * 既有状态机，是开一台新的（初始 `pending`），跟这句话说的是两件事。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { IdFactory } from "../../application/artifact/ports";
import type {
  AdvanceAgendaSegmentCommand,
  AdvanceAgendaSegmentResult,
  AgendaSegmentRepository,
  AgendaSegmentRow,
  CreateAgendaSegmentCommand,
  CreateAgendaSegmentOutcome,
} from "../../application/project/ports";

interface SegmentRecord {
  id: string;
  workshop_id: string;
  ordinal: number;
  title: string;
  duration: number;
  state: "pending" | "active" | "closed" | "skipped";
  merged_into: string | null;
  agenda_segment_definition_id: string | null;
  accepted_sources: string[];
}

function toRow(r: SegmentRecord): AgendaSegmentRow {
  return {
    id: r.id,
    workshopId: r.workshop_id,
    ordinal: r.ordinal,
    title: r.title,
    duration: r.duration,
    state: r.state,
    mergedInto: r.merged_into,
    agendaSegmentDefinitionId: r.agenda_segment_definition_id,
    acceptedSources: r.accepted_sources,
  };
}

const SELECT_COLUMNS = `id, workshop_id, ordinal, title, duration, state, merged_into,
       agenda_segment_definition_id, accepted_sources`;

export class PgAgendaSegmentRepository implements AgendaSegmentRepository {
  constructor(
    private readonly db: DatabasePort,
    // #627：只有 create() 用它——advance() 从不生成新 id，改的是既有行。
    private readonly ids: IdFactory,
  ) {}

  async findById(orgId: OrgId, workshopId: string, segmentId: string): Promise<AgendaSegmentRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const row = await findSegment(s, workshopId, segmentId);
      return row === null ? null : toRow(row);
    });
  }

  async advance(cmd: AdvanceAgendaSegmentCommand): Promise<AdvanceAgendaSegmentResult> {
    return this.db.withTenant(cmd.orgId, async (s) => {
      const updated = await s.query<SegmentRecord>(
        `UPDATE agenda_segments
            SET state = $1, merged_into = $2
          WHERE id = $3 AND workshop_id = $4
          RETURNING ${SELECT_COLUMNS}`,
        [cmd.nextState, cmd.mergedInto, cmd.segmentId, cmd.workshopId],
      );
      const segmentRow = updated.rows[0];
      if (segmentRow === undefined) {
        // 调用方已经在 application 层做过 `findById` 存在性检查；这里再次 0 行只可能是
        // 竞态下环节在两次读写之间被删——而本域没有删除环节的操作（同 Q-9 的推理），
        // 所以这条分支在正常运行下不可达，抛出而不是静默返回，避免它被误读成「合法的空」。
        throw new Error(`agenda segment ${cmd.segmentId} vanished between check and update`);
      }
      const segment = toRow(segmentRow);

      const next = await s.query<SegmentRecord>(
        `SELECT ${SELECT_COLUMNS}
           FROM agenda_segments
          WHERE workshop_id = $1 AND state = 'pending' AND ordinal > $2
          ORDER BY ordinal ASC
          LIMIT 1`,
        [cmd.workshopId, segment.ordinal],
      );
      const nextRow = next.rows[0];
      if (nextRow === undefined) {
        // 本环节是工作坊里最后一条——没有下一条可激活，不是错误（见 `ports.ts` 注释）。
        return { segment, activatedNext: null };
      }

      // 这条 UPDATE 会撞上 `agenda_segments_one_active_per_workshop`（若并发的另一路
      // 刚激活了别的环节）——`23505` 原样冒泡，见文件头。
      const activated = await s.query<SegmentRecord>(
        `UPDATE agenda_segments SET state = 'active' WHERE id = $1
          RETURNING ${SELECT_COLUMNS}`,
        [nextRow.id],
      );
      const activatedRow = activated.rows[0];
      if (activatedRow === undefined) {
        throw new Error(`agenda segment ${nextRow.id} vanished while being activated`);
      }
      return { segment, activatedNext: toRow(activatedRow) };
    });
  }

  /**
   * #627：新建一条环节。`state` 不接受入参——恒 `'pending'`，与 F118 的
   * `DEFAULT 'pending'` 是同一件事的两面（这里显式写出来，不依赖 DEFAULT 隐式生效，
   * 免得下一次改列默认值时悄悄改了本操作的行为）。
   *
   * 不先查工作坊是否存在/是否归档——见 `ports.ts` `create()` 的文档。两种驱动异常：
   *   `23503`（外键，`workshop_id`/`org_id` 复合外键指不到任何工作坊）→ `not-found`
   *   `42501`（RLS，F124 `agenda_segments_project_archived_ins` 拒写）→ `archived`
   * 其余异常原样冒泡——不在这里吞掉再自造一个语义（同 `advance()` 的纪律）。
   */
  async create(cmd: CreateAgendaSegmentCommand): Promise<CreateAgendaSegmentOutcome> {
    const id = this.ids.next("seg");
    try {
      return await this.db.withTenant(cmd.orgId, async (s) => {
        const inserted = await s.query<SegmentRecord>(
          `INSERT INTO agenda_segments
             (id, org_id, workshop_id, agenda_segment_definition_id, ordinal, title, duration, state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
           RETURNING ${SELECT_COLUMNS}`,
          [id, cmd.orgId, cmd.workshopId, cmd.agendaSegmentDefinitionId, cmd.ordinal, cmd.title, cmd.duration],
        );
        const row = inserted.rows[0];
        if (row === undefined) {
          // INSERT ... RETURNING 在没有冲突/策略拒绝时不可能返回 0 行——到这里说明
          // 驱动层把拒绝表达成了空结果而不是异常，是本函数没预料到的第三种形状。
          throw new Error(`agenda segment insert for workshop ${cmd.workshopId} returned no row`);
        }
        return { kind: "created", row: toRow(row) };
      });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "23503") return { kind: "not-found" };
      if (code === "42501") return { kind: "archived" };
      throw e;
    }
  }

  /**
   * #853：按 `ordinal` 升序返回一个工作坊的**全部**环节（不筛状态）。纯读，没有
   * 「不存在的工作坊」与「存在但没有环节」的区分——两者在这里都是空数组，同 `ports.ts`
   * `list()` 的文档；调用方（application 层）若要区分容器存在性，走 `authorize()` 那一层。
   */
  async list(orgId: OrgId, workshopId: string): Promise<readonly AgendaSegmentRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<SegmentRecord>(
        `SELECT ${SELECT_COLUMNS} FROM agenda_segments WHERE workshop_id = $1 ORDER BY ordinal ASC`,
        [workshopId],
      );
      return r.rows.map(toRow);
    });
  }
}

async function findSegment(
  s: TenantSession,
  workshopId: string,
  segmentId: string,
): Promise<SegmentRecord | null> {
  const r = await s.query<SegmentRecord>(
    `SELECT ${SELECT_COLUMNS} FROM agenda_segments WHERE id = $1 AND workshop_id = $2`,
    [segmentId, workshopId],
  );
  return r.rows[0] ?? null;
}
