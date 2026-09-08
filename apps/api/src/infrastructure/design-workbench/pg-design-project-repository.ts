/**
 * UC-17.8 B4.2/B4.3 —— `design_projects` + `design_project_chat_messages` 的
 * PostgreSQL 适配器（迁移 `20260904150000_uc178_design_workbench.sql`）。
 *
 * ⚠ 每个方法恰好一次 `withTenant`，没有 `withoutTenant`——同 `pg-feedback-draft-repository.ts`。
 * ⚠ 读方法（`listForOrg`/`get`）**不**接 `ownerId` 谓词——全组织可读是本表的可见性口径
 *   （见 `project-ports.ts` 头注），与草稿仓储的每条 SQL 都带 `owner_id = $n` 正相反。
 *   写方法（`update`/`delete`/`appendChat`/`pushToInbox`）**必须**带 `owner_id = $n`
 *   谓词——这是「仅 owner 可改/删/推送」这条规则的唯一实现位置。
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import { designPrototype, designWorkbench } from "@repo/contracts";
import type {
  CreateOrGetByLinkedFeedbackResult,
  DesignProjectChatTurn,
  DesignProjectPatch,
  DesignProjectRepository,
  DesignProjectRepositoryFactory,
  DesignProjectRow,
  NewDesignProject,
  NewPrototypeVersionMeta,
  ProjectTemplate,
  PrototypeNode,
  PrototypeVersionRow,
  PushToInboxResult,
} from "../../application/design-workbench/project-ports";

interface ProjectDbRow {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly template: string;
  readonly problem: string;
  readonly criteria: unknown;
  readonly frames: unknown;
  /** B5.3：jsonb 数组，每项一棵树——迁移 `20260906160000_uc178_b53_design_prototype.sql` */
  readonly prototype: unknown;
  readonly frame_notes: unknown;
  /**
   * 迭代 11（delta §5 取舍 ②A）：一屏一项 `{frame, root?, notes?, links?}`——**事实源**。
   * 上面三列旧数据保留一个版本供回滚，本版本双写；读一律从这里来。
   */
  readonly screens: unknown;
  /** 迭代 13（delta §5.2）：原型自己的明暗主题；旧行由迁移的 DEFAULT 填成 'dark'。 */
  readonly theme: string | null;
  /** 迭代 13（delta §4）：项目标签的 jsonb 数组；老行由迁移的 DEFAULT 填成 `[]`。 */
  readonly tags: unknown;
  /** 迭代 13：`SELECT_COLUMNS` 里那个子查询聚出来的 jsonb 数组，形状即契约 `RefImage`。 */
  readonly ref_images: unknown;
  readonly pushed: boolean;
  readonly pushed_at: Date | string | null;
  readonly push_note: string | null;
  readonly linked_feedback_id: string | null;
  readonly github_issue_url: string | null;
  readonly github_issue_number: number | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ChatDbRow {
  readonly role: string;
  readonly text: string;
  readonly created_at: Date | string;
  /** B5.2：`model` / `fallback` / NULL（user 记录与旧记录）——迁移 `20260905130000_uc178_b52_design_chat_source.sql` */
  readonly source: string | null;
}

function toStringArray(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

/** 迭代 8：与 frames 同长才有意义（按位置对应），否则按「没写」。 */
function toNotes(raw: unknown, frames: readonly string[]): readonly string[] {
  const arr = toStringArray(raw);
  return arr.length === frames.length ? arr : [];
}

/**
 * 迭代 11：一屏一项——`{frame, root?, notes?, links?}`，`root` 缺 = 这页还没生成树
 * （新建项目只有页标签，是合法初始状态）。这是**唯一**的解析入口，四份派生视图都从它来，
 * 所以「对不上」这种状态在读侧不可能出现——delta §5 说的"长度不变量消失"落在这里。
 */
interface StoredScreen {
  readonly frame: string;
  readonly root?: PrototypeNode;
  readonly notes?: string;
  readonly links?: readonly designPrototype.PrototypeLink[];
}

function toScreens(raw: unknown): readonly StoredScreen[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredScreen[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
    const o = item as Record<string, unknown>;
    if (typeof o.frame !== "string" || o.frame === "") return [];
    let root: PrototypeNode | undefined;
    if (o.root !== undefined && o.root !== null) {
      // 库里只可能有当时过了契约的树，但契约会演进（原语闭集加减）——一页不合法整份按
      // 「还没生成」处理，而不是渲染半套。同 `toPrototype` 此前的纪律。
      const parsed = designPrototype.PrototypeNode.safeParse(o.root);
      if (!parsed.success) return [];
      root = parsed.data;
    }
    const links = designPrototype.PrototypeLink.array().safeParse(o.links ?? []);
    out.push({
      frame: o.frame,
      ...(root === undefined ? {} : { root }),
      ...(typeof o.notes === "string" ? { notes: o.notes } : {}),
      links: links.success ? links.data : [],
    });
  }
  return out;
}

/**
 * 迭代 11：把一次 `DesignProjectPatch` 合进 `screens`。**纯函数**，所以它可以被单测直接钉住——
 * 上一版这套合并逻辑住在 SQL 的 CASE 里，本机没有 Postgres 就验不了，而它出错的代价是
 * 用户整份原型消失（#2900）。
 *
 * 规则（`screens` 是一列之后，"长度对不上"这种状态在读侧不再存在，这里是唯一可能造出它的地方）：
 * - 给了 `frames`：页数以它为准。页数不变 ⇒ 逐位保留 root/notes/links（纯改标签）；
 *   页数变了 ⇒ 新增的页没有 root（回到"还没生成"），多出来的页连同其 root/links 一起丢。
 * - 给了 `prototype` / `frameNotes` / `frameLinks`：按位置覆盖；没给的保持原样。
 */
export function mergeScreens(current: readonly StoredScreen[], patch: DesignProjectPatch): readonly StoredScreen[] {
  const frames = patch.frames ?? current.map((x) => x.frame);
  return frames.map((frame, i) => {
    const keep = patch.frames === undefined || patch.frames.length === current.length ? current[i] : undefined;
    const root = patch.prototype !== undefined ? patch.prototype[i] : keep?.root;
    const notes = patch.frameNotes !== undefined ? patch.frameNotes[i] : keep?.notes;
    const links = patch.frameLinks !== undefined ? patch.frameLinks[i] : keep?.links;
    return {
      frame,
      ...(root === undefined ? {} : { root }),
      ...(notes === undefined || notes === "" ? {} : { notes }),
      links: [...(links ?? [])],
    };
  });
}

/** 全部页都有树才算「有原型」——与既有语义一致（要么空、要么与页数等长）。 */
function prototypeOf(screens: readonly StoredScreen[]): readonly PrototypeNode[] {
  return screens.length > 0 && screens.every((s) => s.root !== undefined) ? screens.map((s) => s.root!) : [];
}

/**
 * 读出来的树逐页过契约——库里只可能有服务端写进去的、当时过了契约的树，但契约会演进（原语
 * 闭集加减）；一页不合法整份 `prototype` 按「还没生成」处理，而不是渲染半套：契约不变量要求
 * 长度要么 0 要么等于 frames，缺一页就没法按位置对应。
 */
function toPrototype(raw: unknown, frames: readonly string[]): readonly PrototypeNode[] {
  if (!Array.isArray(raw) || raw.length !== frames.length) return [];
  const out: PrototypeNode[] = [];
  for (const item of raw) {
    const parsed = designPrototype.PrototypeNode.safeParse(item);
    if (!parsed.success) return [];
    out.push(parsed.data);
  }
  // 迭代 1 之前写入的树没有 id：读出时按遍历序补（确定性），模型与 patch 看到的 id 一致；下次写回即落库。
  return designPrototype.ensurePrototypeIds(out);
}

function toChat(rows: readonly ChatDbRow[]): readonly DesignProjectChatTurn[] {
  return rows.map((r) => ({
    role: r.role === "ai" ? "ai" : "user",
    text: r.text,
    at: new Date(r.created_at).toISOString(),
    // 「无」≠「模型说的」：NULL 就不带键（契约 `.optional()`），不猜默认值。
    ...(r.source === "model" || r.source === "fallback" ? { source: r.source } : {}),
  }));
}

/**
 * 逐条过契约 `RefImage`。不合法的丢掉而不是整份返回空——一张读不出来的参考图不该让
 * 项目打不开（同 `toPrototype` 对坏树的态度）。
 */
function toRefImages(raw: unknown): readonly designWorkbench.RefImage[] {
  if (!Array.isArray(raw)) return [];
  const out: designWorkbench.RefImage[] = [];
  for (const item of raw) {
    const parsed = designWorkbench.RefImage.safeParse(
      item !== null && typeof item === "object" && "createdAt" in item
        ? { ...item, createdAt: new Date((item as { createdAt: string }).createdAt).toISOString() }
        : item,
    );
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function toRow(row: ProjectDbRow, chat: readonly ChatDbRow[]): DesignProjectRow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    template: row.template as ProjectTemplate,
    problem: row.problem,
    criteria: toStringArray(row.criteria),
    // 迭代 11：`screens` 是事实源；为空时回落旧三列——部署窗口里旧代码可能刚写过一行，
    // 迁移的回填只跑一次。回落不是长期路径，旧三列下个版本删掉时这一支一起删。
    ...(() => {
      const screens = toScreens(row.screens);
      if (screens.length === 0) {
        const frames = toStringArray(row.frames);
        return { frames, prototype: toPrototype(row.prototype, frames), frameNotes: toNotes(row.frame_notes, frames), frameLinks: [] };
      }
      return {
        frames: screens.map((x) => x.frame),
        prototype: prototypeOf(screens),
        frameNotes: screens.some((x) => (x.notes ?? "") !== "") ? screens.map((x) => x.notes ?? "") : [],
        frameLinks: screens.some((x) => (x.links ?? []).length > 0) ? screens.map((x) => [...(x.links ?? [])]) : [],
      };
    })(),
    theme: row.theme === "light" ? "light" : "dark",
    tags: toStringArray(row.tags),
    refImages: toRefImages(row.ref_images),
    pushed: row.pushed,
    pushedAt: row.pushed_at === null ? null : new Date(row.pushed_at).toISOString(),
    pushNote: row.push_note,
    linkedFeedbackId: row.linked_feedback_id,
    githubIssueUrl: row.github_issue_url,
    githubIssueNumber: row.github_issue_number,
    chat: toChat(chat),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * 迭代 13：参考图的**元信息**随项目一次读出来（不含字节）。做成 `SELECT_COLUMNS` 里的子查询，
 * 而不是让用例层再查一次仓储：`DesignProject` 的每条读路径（list / get / update 的 RETURNING）
 * 都要带上它，分开查意味着四处各写一次"别忘了补 refImages"，漏一处的表现是
 * 「传了图、刷新就没了」。
 *
 * ⚠ 这个字符串是模板字面量：里面**不许**出现反引号——它会提前终止字符串，
 *   而报错点会落在几行之后，看起来像是别的地方写错了。SQL 注释就写普通的话。
 */
const SELECT_COLUMNS = `
  id, owner_id, name, template, problem, criteria, frames, prototype, frame_notes, screens,
  theme, tags,
  pushed, pushed_at, push_note, linked_feedback_id,
  github_issue_url, github_issue_number, created_at, updated_at,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'name', r.name, 'size', r.size_bytes,
             'mime', r.content_type, 'createdAt', r.created_at)
             ORDER BY r.created_at ASC, r.id ASC)
      FROM design_project_ref_images r
     WHERE r.org_id = design_projects.org_id AND r.project_id = design_projects.id
  ), '[]'::jsonb) AS ref_images`;

interface VersionDbRow {
  readonly id: string;
  readonly project_id: string;
  readonly seq: number;
  readonly source: string;
  readonly summary: string;
  readonly frames: unknown;
  readonly prototype?: unknown;
  readonly notes: unknown;
  /** 迭代 11：同 `design_projects.screens`，那一版的屏（含 links）。 */
  readonly screens?: unknown;
  readonly created_at: Date | string;
}

function toVersionSummary(row: VersionDbRow): Omit<PrototypeVersionRow, "prototype"> {
  return {
    id: row.id,
    projectId: row.project_id,
    seq: row.seq,
    source: row.source === "user" || row.source === "restore" ? row.source : "model",
    summary: row.summary,
    ...(() => {
      const screens = toScreens(row.screens);
      if (screens.length === 0) {
        const frames = toStringArray(row.frames);
        return { frames, notes: toNotes(row.notes, frames), links: [] };
      }
      return {
        frames: screens.map((x) => x.frame),
        notes: screens.some((x) => (x.notes ?? "") !== "") ? screens.map((x) => x.notes ?? "") : [],
        links: screens.some((x) => (x.links ?? []).length > 0) ? screens.map((x) => [...(x.links ?? [])]) : [],
      };
    })(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

class ScopedPgDesignProjectRepository implements DesignProjectRepository {
  constructor(
    private readonly db: DatabasePort,
    private readonly orgId: string,
  ) {}

  private async chatFor(s: TenantSession, projectId: string): Promise<readonly ChatDbRow[]> {
    const { rows } = await s.query<ChatDbRow>(
      `SELECT role, text, created_at, source
         FROM design_project_chat_messages
        WHERE org_id = $1 AND project_id = $2
        ORDER BY created_at ASC, id ASC`,
      [this.orgId, projectId],
    );
    return rows;
  }

  async create(project: NewDesignProject): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      await s.query(
        `INSERT INTO design_projects
           (id, org_id, owner_id, name, template, problem, criteria, frames, linked_feedback_id, screens, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb)`,
        [
          project.id,
          this.orgId,
          project.ownerId,
          project.name,
          project.template,
          project.problem,
          JSON.stringify(project.criteria),
          JSON.stringify(project.frames),
          project.linkedFeedbackId,
          // 迭代 11：新项目只有页标签、还没有树——`screens` 每项只带 frame，`root` 缺位就是
          // 「这页还没生成」。在 TS 里算好整份传下去，SQL 里不做 zip（同 update 的理由）。
          JSON.stringify(project.frames.map((frame) => ({ frame, links: [] }))),
          JSON.stringify(project.tags ?? []),
        ],
      );
    });
  }

  /**
   * B4.4 `deepenFeedback`——见 `project-ports.ts` 头注的幂等说明。`ON CONFLICT` 目标必须
   * 精确匹配迁移里的部分唯一索引（`(org_id, linked_feedback_id) WHERE linked_feedback_id
   * IS NOT NULL`）,否则 Postgres 不认这条索引,`DO NOTHING` 就不会生效。
   */
  async createOrGetByLinkedFeedback(
    project: NewDesignProject & { readonly linkedFeedbackId: string },
  ): Promise<CreateOrGetByLinkedFeedbackResult> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows: inserted } = await s.query<{ id: string }>(
        `INSERT INTO design_projects
           (id, org_id, owner_id, name, template, problem, criteria, frames, linked_feedback_id, screens)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb)
         ON CONFLICT (org_id, linked_feedback_id) WHERE linked_feedback_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          project.id,
          this.orgId,
          project.ownerId,
          project.name,
          project.template,
          project.problem,
          JSON.stringify(project.criteria),
          JSON.stringify(project.frames),
          project.linkedFeedbackId,
          // 迭代 11：新项目只有页标签、还没有树——`screens` 每项只带 frame，`root` 缺位就是
          // 「这页还没生成」。在 TS 里算好整份传下去，SQL 里不做 zip（同 update 的理由）。
          JSON.stringify(project.frames.map((frame) => ({ frame, links: [] }))),
        ],
      );

      if (inserted.length > 0) {
        const { rows } = await s.query<ProjectDbRow>(
          `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND id = $2`,
          [this.orgId, project.id],
        );
        const row = rows[0];
        if (row === undefined) throw new Error("design-workbench: inserted row vanished within the same transaction");
        return { project: toRow(row, await this.chatFor(s, row.id)), created: true };
      }

      // 冲突：已经有一行占了这条反馈——复用它,不是本次传入的字段（见 project-ports.ts 头注）。
      const { rows } = await s.query<ProjectDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND linked_feedback_id = $2`,
        [this.orgId, project.linkedFeedbackId],
      );
      const row = rows[0];
      if (row === undefined) throw new Error("design-workbench: conflicting linked_feedback_id row not found");
      return { project: toRow(row, await this.chatFor(s, row.id)), created: false };
    });
  }

  async listForOrg(): Promise<readonly DesignProjectRow[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ProjectDbRow>(
        // 迭代 13（V65）：排序在**服务端**，`updated_at` 倒序——"最近改过的排最前"。
        // `id` 作次序键是为了同一毫秒的两行有稳定顺序（否则翻页/刷新时顺序会跳）。
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 ORDER BY updated_at DESC, id DESC`,
        [this.orgId],
      );
      const out: DesignProjectRow[] = [];
      for (const row of rows) out.push(toRow(row, await this.chatFor(s, row.id)));
      return out;
    });
  }

  async get(projectId: string): Promise<DesignProjectRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ProjectDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND id = $2`,
        [this.orgId, projectId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return toRow(row, await this.chatFor(s, row.id));
    });
  }

  private lastVersion: Omit<PrototypeVersionRow, "prototype"> | null = null;
  lastRecordedVersion(): Omit<PrototypeVersionRow, "prototype"> | null {
    return this.lastVersion;
  }

/**
 * ⚠ 2026-09-07 用户实测的数据丢失 —— 下面 UPDATE 里 `prototype` / `frame_notes` 那两个
 * CASE 为什么按**长度**判，而不是「只写 frames 就置 `[]`」：
 *
 * 原先是一律清空，为的是守住契约不变量（`prototype` 要么空、要么与 `frames` 等长）。代价是
 * **纯改标签也会清掉整份原型**：用户说「增加设置页」，模型只回了 `writeback.frames`，
 * 三页画好的原型当场全没，屏上就是那句「怎么全部空了？」。
 *
 * 不变量该按长度判——等长（纯改标签）保留，只有长度真的对不上（按位置对应已经不成立）才清。
 * 应用层还有一道门：`append-project-chat.ts` 的 `framesKeepPagesAligned` 直接拒掉会改页数的
 * frames-only 写回，所以这条 SQL 的清空分支在对话链路上已不可达，留着是兜底（别的调用方
 * 写出不一致的行时，库里仍然不会存下半套）。
 */
  async update(projectId: string, ownerId: string, patch: DesignProjectPatch, version?: NewPrototypeVersionMeta): Promise<DesignProjectRow | null> {
    this.lastVersion = null;
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      /**
       * 迭代 11：`screens` 是事实源，但**在 TS 里算**再整份写下去，不在 SQL 里 zip。
       * 上一版把三份数组的合并写成了一条嵌套 `jsonb_to_recordset` + `WITH ORDINALITY` 的
       * 表达式——本机没有 Postgres 验证不了，而这条路径上一次出错就丢了用户整份原型（#2900）。
       * 先锁行读出当前 screens，合并后一次写回：可读、可单测，行锁还顺带把同项目的版本 seq 串行化。
       */
      const { rows: locked } = await s.query<{ readonly screens: unknown }>(
        `SELECT screens FROM design_projects
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          FOR UPDATE`,
        [this.orgId, ownerId, projectId],
      );
      if (locked[0] === undefined) return null;
      const nextScreens = mergeScreens(toScreens(locked[0].screens), patch);
      // 旧三列（frames/prototype/frame_notes）保留一个版本供回滚（delta §5）：从 screens
      // 派生着一起写，不再是事实源；下个版本删列时这三个参数一并去掉。
      const { rows } = await s.query<ProjectDbRow>(
        `UPDATE design_projects
            SET name       = COALESCE($4, name),
                template   = COALESCE($5, template),
                problem    = COALESCE($6, problem),
                criteria   = COALESCE($7::jsonb, criteria),
                screens    = $8::jsonb,
                frames     = $9::jsonb,
                prototype  = $10::jsonb,
                frame_notes = $11::jsonb,
                theme      = COALESCE($12, theme),
                tags       = COALESCE($13::jsonb, tags),
                updated_at = now()
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          RETURNING ${SELECT_COLUMNS}`,
        [
          this.orgId, ownerId, projectId, patch.name ?? null, patch.template ?? null, patch.problem ?? null,
          patch.criteria === undefined ? null : JSON.stringify(patch.criteria),
          JSON.stringify(nextScreens),
          JSON.stringify(nextScreens.map((x) => x.frame)),
          JSON.stringify(prototypeOf(nextScreens)),
          JSON.stringify(nextScreens.some((x) => (x.notes ?? "") !== "") ? nextScreens.map((x) => x.notes ?? "") : []),
          patch.theme ?? null,
          patch.tags === undefined ? null : JSON.stringify(patch.tags),
        ],
      );
      const row = rows[0];
      if (row === undefined) return null;
      if (version !== undefined) {
        // 同一事务：上面的 UPDATE 已锁住项目行，同项目的 MAX(seq)+1 在并发写回之间串行。
        const id = `${projectId}-v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { rows: vrows } = await s.query<VersionDbRow>(
          `INSERT INTO design_project_prototype_versions (id, org_id, project_id, seq, source, summary, frames, prototype, notes, screens)
           SELECT $1, $2, $3, COALESCE(MAX(seq), 0) + 1, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb
             FROM design_project_prototype_versions
            WHERE org_id = $2 AND project_id = $3
           RETURNING id, project_id, seq, source, summary, frames, notes, screens, created_at`,
          // 快照取 UPDATE 之后的那份 `screens`（事实源）；旧三列同样派生着写，供回滚。
          [id, this.orgId, projectId, version.source, version.summary,
            JSON.stringify(nextScreens.map((x) => x.frame)),
            JSON.stringify(prototypeOf(nextScreens)),
            JSON.stringify(nextScreens.some((x) => (x.notes ?? "") !== "") ? nextScreens.map((x) => x.notes ?? "") : []),
            JSON.stringify(nextScreens)],
        );
        const v = vrows[0];
        if (v === undefined) throw new Error("design-workbench: inserted version vanished within the same transaction");
        this.lastVersion = toVersionSummary(v);
      }
      return toRow(row, await this.chatFor(s, row.id));
    });
  }

  /* ── 迭代 3：原型版本（design_project_prototype_versions，append-only）── */

  async listVersions(projectId: string): Promise<readonly Omit<PrototypeVersionRow, "prototype">[]> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<VersionDbRow>(
        `SELECT id, project_id, seq, source, summary, frames, notes, screens, created_at
           FROM design_project_prototype_versions
          WHERE org_id = $1 AND project_id = $2
          ORDER BY seq DESC`,
        [this.orgId, projectId],
      );
      return rows.map(toVersionSummary);
    });
  }

  async getVersion(projectId: string, versionId: string): Promise<PrototypeVersionRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<VersionDbRow>(
        `SELECT id, project_id, seq, source, summary, frames, prototype, notes, screens, created_at
           FROM design_project_prototype_versions
          WHERE org_id = $1 AND project_id = $2 AND id = $3`,
        [this.orgId, projectId, versionId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      const summary = toVersionSummary(row);
      // 迭代 11：树同样优先从 `screens` 取（事实源），旧列只是回落。
      const screens = toScreens(row.screens);
      return { ...summary, prototype: screens.length > 0 ? prototypeOf(screens) : toPrototype(row.prototype, summary.frames) };
    });
  }

  async appendChat(
    projectId: string,
    ownerId: string,
    turns: readonly Omit<DesignProjectChatTurn, "at">[],
  ): Promise<DesignProjectRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      // 先确认这行存在且是本人的——owner 谓词在这条 SELECT 上,不是先插入再回滚。
      const { rows: owned } = await s.query<{ id: string }>(
        `SELECT id FROM design_projects WHERE org_id = $1 AND owner_id = $2 AND id = $3`,
        [this.orgId, ownerId, projectId],
      );
      if (owned.length === 0) return null;

      for (const turn of turns) {
        await s.query(
          `INSERT INTO design_project_chat_messages (id, org_id, project_id, role, text, source)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [`${projectId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, this.orgId, projectId, turn.role, turn.text, turn.source ?? null],
        );
      }
      // ⚠ owner_id 再收窄一次——虽然上面那条 SELECT 已经确认过 owner,但这条 UPDATE 是独立语句,
      //   同 `update`/`delete`/`pushToInbox` 的纪律一致:每一条改 `design_projects` 的语句自己带
      //   谓词,不依赖"前面刚查过"这件事本身作为保护(那不是数据库能强制的东西,是读代码才知道的
      //   顺序)。`tests/design-workbench/project-repository-guard.test.ts` 逐条检查,不放过这条。
      await s.query(
        `UPDATE design_projects SET updated_at = now() WHERE org_id = $1 AND owner_id = $2 AND id = $3`,
        [this.orgId, ownerId, projectId],
      );

      const { rows } = await s.query<ProjectDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM design_projects WHERE org_id = $1 AND id = $2`,
        [this.orgId, projectId],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return toRow(row, await this.chatFor(s, row.id));
    });
  }

  async delete(projectId: string, ownerId: string): Promise<boolean> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<{ id: string }>(
        `DELETE FROM design_projects WHERE org_id = $1 AND owner_id = $2 AND id = $3 RETURNING id`,
        [this.orgId, ownerId, projectId],
      );
      return rows.length > 0;
    });
  }

  /**
   * ⚠ 事务边界：本方法体是**一次** `withTenant` 调用——①标记 pushed ②回写来源反馈的
   *   `resolved_by_design_id` 在同一个数据库事务里执行，见 `project-ports.ts` 头注。
   *   `note` 是 `undefined` 时用 `COALESCE` 保持原值（同 `updateProject` 的 patch 写法）；
   *   传了空字符串则清空（`COALESCE` 不会把空字符串当 NULL，行为符合直觉）。
   */
  async pushToInbox(projectId: string, ownerId: string, note: string | undefined): Promise<PushToInboxResult | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      const { rows } = await s.query<ProjectDbRow>(
        `UPDATE design_projects
            SET pushed     = true,
                pushed_at  = now(),
                push_note  = COALESCE($4, push_note),
                updated_at = now()
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          RETURNING ${SELECT_COLUMNS}`,
        [this.orgId, ownerId, projectId, note ?? null],
      );
      const row = rows[0];
      if (row === undefined) return null;

      let resolvedFeedback: PushToInboxResult["resolvedFeedback"] = null;
      if (row.linked_feedback_id !== null) {
        // `IS DISTINCT FROM`：外键已经指向本项目（重复推送）时不再命中，于是 `resolvedFeedback`
        // 回 `null`——这是 B6.3「同一条反馈只通知一次」的去重依据（见端口头注），不另加
        // 一张"已通知"表。RETURNING 带上 `submitted_by`/`title`，发信要用。
        const { rows: fbRows } = await s.query<{ id: string; submitted_by: string; title: string }>(
          `UPDATE product_feedback
              SET resolved_by_design_id = $3
            WHERE org_id = $1 AND id = $2 AND resolved_by_design_id IS DISTINCT FROM $3
            RETURNING id, submitted_by, title`,
          [this.orgId, row.linked_feedback_id, projectId],
        );
        const fb = fbRows[0];
        if (fb !== undefined) resolvedFeedback = { id: fb.id, submittedBy: fb.submitted_by, title: fb.title };
      }

      const chat = await this.chatFor(s, row.id);
      return { project: toRow(row, chat), resolvedFeedback };
    });
  }

  /**
   * 多旧算"过期"：5 分钟。**逐字同** `pg-product-feedback-repository.ts` 的
   * `CLAIM_STALE_AFTER_SQL`（那里的头注解释了这个数字怎么来的：盖住一次真实 GitHub REST
   * 调用的最长耗时，又不长到让崩溃后的重试等太久）。两处是同一把锁的两个落点，
   * 不是两个各自拍脑袋的常量——将来要调，两处一起调。
   */
  private static readonly CLAIM_STALE_AFTER_SQL = `now() - interval '5 minutes'`;

  async claimGithubIssueCreation(projectId: string, ownerId: string): Promise<boolean> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      // 原子性来源同反馈那侧：Postgres 对同一行的并发 UPDATE 互斥，只有一个能把
      // `github_issue_claimed_at` 从满足 WHERE 的旧值改成 now()，另一个 RETURNING 空集。
      const { rows } = await s.query<{ id: string }>(
        `UPDATE design_projects
            SET github_issue_claimed_at = now()
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
            AND github_issue_url IS NULL
            AND (github_issue_claimed_at IS NULL
                 OR github_issue_claimed_at < ${ScopedPgDesignProjectRepository.CLAIM_STALE_AFTER_SQL})
          RETURNING id`,
        [this.orgId, ownerId, projectId],
      );
      return rows.length > 0;
    });
  }

  async releaseGithubIssueClaim(projectId: string, ownerId: string): Promise<void> {
    await this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      // owner 谓词同本文件其它每一条 UPDATE——见 `project-repository-guard.test.ts` 守的那条不变量。
      await s.query(
        `UPDATE design_projects SET github_issue_claimed_at = NULL
          WHERE org_id = $1 AND owner_id = $2 AND id = $3`,
        [this.orgId, ownerId, projectId],
      );
    });
  }

  async setGithubIssue(
    projectId: string,
    ownerId: string,
    issue: { readonly url: string; readonly number: number },
  ): Promise<DesignProjectRow | null> {
    return this.db.withTenant(toOrgId(this.orgId), async (s: TenantSession) => {
      // owner 谓词同 `update`/`delete`/`pushToInbox` 的纪律：每一条改 design_projects 的
      // 语句自己带，不依赖调用方先查过。
      const { rows } = await s.query<ProjectDbRow>(
        `UPDATE design_projects
            SET github_issue_url    = $4,
                github_issue_number = $5,
                updated_at          = now()
          WHERE org_id = $1 AND owner_id = $2 AND id = $3
          RETURNING ${SELECT_COLUMNS}`,
        [this.orgId, ownerId, projectId, issue.url, issue.number],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return toRow(row, await this.chatFor(s, row.id));
    });
  }
}

export class PgDesignProjectRepository implements DesignProjectRepositoryFactory {
  constructor(private readonly db: DatabasePort) {}

  forOrg(orgId: string): DesignProjectRepository {
    return new ScopedPgDesignProjectRepository(this.db, orgId);
  }
}
