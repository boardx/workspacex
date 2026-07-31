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
 * 全仓唯一一处推进环节状态机的写点（同 F118 建表时的『唯一创建路径』纪律）。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type {
  AdvanceAgendaSegmentCommand,
  AdvanceAgendaSegmentResult,
  AgendaSegmentRepository,
  AgendaSegmentRow,
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
  constructor(private readonly db: DatabasePort) {}

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
