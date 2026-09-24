/**
 * UC-17.8 B4.3 —— 内存 fake `DesignProjectRepository`，供 `tests/design-workbench/**`
 * 与 `tests/inbox/**`（收件箱聚合需要接入 design 那一半）共用。
 */
import type {
  CreateOrGetByLinkedFeedbackResult,
  DesignProjectChatTurn,
  DesignProjectPatch,
  DesignProjectRepository,
  DesignProjectRow,
  NewPrototypeVersionMeta,
  PrototypeVersionRow,
  NewDesignProject,
  PushToInboxResult,
} from "../../src/application/design-workbench/project-ports";
// 页那一组字段的合并规则只有一份（见 `update` 里的 ⚠）。
import { mergeScreens, mergeTokens, prototypeOf, toTokens } from "../../src/infrastructure/design-workbench/pg-design-project-repository";
import type { ShareSnapshot } from "../../src/application/design-workbench/share-snapshot";
import type { DesignCommentRepository, DesignCommentRow } from "../../src/application/design-workbench/design-comments";

export class FakeDesignProjectRepo implements DesignProjectRepository {
  readonly rows = new Map<string, DesignProjectRow>();
  /** 测试断言用：`pushToInbox` 时是否真的回写了反馈的 `resolved_by_design_id`。 */
  readonly resolvedFeedbackIds: string[] = [];
  /**
   * 同真实仓储 `resolved_by_design_id IS DISTINCT FROM $3`：记住哪条反馈已经被哪个项目
   * 回写过，重复推送回 `resolvedFeedback: null`（B6.3 通知去重的依据）。
   */
  private readonly resolvedBy = new Map<string, string>();
  /** `seedFeedback` 放进来的提交人/标题；没 seed 的 id 按固定规则合成（只看 id 的既有用例不用改）。 */
  private readonly feedback = new Map<string, { submittedBy: string; title: string }>();

  seedFeedback(feedbackId: string, fb: { submittedBy: string; title: string }): void {
    this.feedback.set(feedbackId, fb);
  }
  /** 迭代 3：版本快照，按写入顺序；seq 每项目递增。 */
  readonly versions: PrototypeVersionRow[] = [];
  private tick = 0;

  async listVersions(projectId: string): Promise<readonly Omit<PrototypeVersionRow, "prototype">[]> {
    return this.versions.filter((v) => v.projectId === projectId).map(({ prototype: _p, ...rest }) => rest).sort((a, b) => b.seq - a.seq);
  }
  async getVersion(projectId: string, versionId: string): Promise<PrototypeVersionRow | null> {
    return this.versions.find((v) => v.projectId === projectId && v.id === versionId) ?? null;
  }
  private lastVersion: Omit<PrototypeVersionRow, "prototype"> | null = null;
  lastRecordedVersion(): Omit<PrototypeVersionRow, "prototype"> | null {
    return this.lastVersion;
  }

  private stamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 8, 4, 0, 0, this.tick)).toISOString();
  }

  seed(row: DesignProjectRow): void {
    this.rows.set(row.id, row);
  }

  async create(project: NewDesignProject): Promise<void> {
    const at = this.stamp();
    this.rows.set(project.id, {
      ...project,
      tags: [...(project.tags ?? [])],
      frameLinks: [],
      pushed: false,
      pushedAt: null,
      pushNote: null,
      githubIssueUrl: null,
      githubIssueNumber: null,
      chat: [],
      createdAt: at,
      updatedAt: at,
    });
  }

  /** B4.4——同真实仓储的 `ON CONFLICT ... DO NOTHING` 语义：线性扫一遍找 `linkedFeedbackId`。 */
  async createOrGetByLinkedFeedback(
    project: NewDesignProject & { readonly linkedFeedbackId: string },
  ): Promise<CreateOrGetByLinkedFeedbackResult> {
    const existing = [...this.rows.values()].find((r) => r.linkedFeedbackId === project.linkedFeedbackId);
    if (existing !== undefined) return { project: existing, created: false };
    await this.create(project);
    const row = this.rows.get(project.id);
    if (row === undefined) throw new Error("fake-design-project-repo: row vanished after create");
    return { project: row, created: true };
  }

  /**
   * 迭代 13（V65）：顺序**必须与真实仓储一致**——`updated_at DESC`，`id` 作稳定次序键。
   * 这个 fake 之前按 `createdAt` 升序返回，那是它自己的顺序，不是产品的顺序：
   * 用它跑「最近改过的排最前」会得到一个与生产相反的结论，而且是绿的。
   * 排序在仓储这一层，`listMyProjects` 只过滤不排序（放前端或用例层排会是第二处声明）。
   */
  async listForOrg(): Promise<readonly DesignProjectRow[]> {
    return [...this.rows.values()].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
    );
  }

  async get(projectId: string): Promise<DesignProjectRow | null> {
    return this.rows.get(projectId) ?? null;
  }

  async update(projectId: string, ownerId: string, patch: DesignProjectPatch, version?: NewPrototypeVersionMeta): Promise<DesignProjectRow | null> {
    this.lastVersion = null;
    const r = this.rows.get(projectId);
    if (r === undefined || r.ownerId !== ownerId) return null;
    const next: DesignProjectRow = {
      ...r,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.template !== undefined ? { template: patch.template } : {}),
      ...(patch.problem !== undefined ? { problem: patch.problem } : {}),
      ...(patch.criteria !== undefined ? { criteria: [...patch.criteria] } : {}),
      /**
       * 页那一组四个字段（frames / prototype / frameNotes / frameLinks）**不在这里各写一份**，
       * 直接借真实仓储的纯函数 `mergeScreens` + `prototypeOf`。
       *
       * ⚠ 2026-09-10 的教训：这个 fake 以前自己实现了一套宽松的合并（给了 prototype 就整份换，
       *   不看 frames 的长度）。真实仓储是**以 frames 定页数**的，于是「patch 追加 5 页但没给
       *   frames」在这里是 8 页、在生产是 3 页——bug 就是从这个缝里漏过去的，测试全绿。
       *   fake 与真实实现在同一件事上各写一份，等于「同一事实声明在两处」。
       */
      ...(() => {
        if (patch.frames === undefined && patch.prototype === undefined
          && patch.frameNotes === undefined && patch.frameLinks === undefined) return {};
        const merged = mergeScreens(
          r.frames.map((frame, i) => ({
            frame,
            ...(r.prototype[i] === undefined || r.prototype[i] === null ? {} : { root: r.prototype[i]! }),
            ...((r.frameNotes[i] ?? "") === "" ? {} : { notes: r.frameNotes[i]! }),
            links: [...(r.frameLinks[i] ?? [])],
          })),
          patch,
        );
        return {
          frames: merged.map((s) => s.frame),
          prototype: [...prototypeOf(merged)],
          frameNotes: merged.some((s) => (s.notes ?? "") !== "") ? merged.map((s) => s.notes ?? "") : [],
          frameLinks: merged.some((s) => (s.links ?? []).length > 0) ? merged.map((s) => [...(s.links ?? [])]) : [],
        };
      })(),
      // 迭代 13：主题与标签都是整份替换（同 pg 仓储的 COALESCE 语义：不给 ⇒ 保持原值）。
      ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
      ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
      ...(patch.accent !== undefined ? { accent: patch.accent } : {}),
      // 对标 R1：同 pg 仓储，按键合并走同一个 `mergeTokens`。
      ...(patch.tokens !== undefined ? { tokens: mergeTokens(toTokens(r.tokens), patch.tokens) } : {}),
      updatedAt: this.stamp(),
    };
    this.rows.set(projectId, next);
    if (version !== undefined) {
      // 同真实仓储：与 UPDATE 同一步落版本，frames/prototype 取更新后的行。
      const seq = this.versions.filter((v) => v.projectId === projectId).length + 1;
      const row: PrototypeVersionRow = { id: `${projectId}-v${seq}`, projectId, seq, ...version, frames: [...next.frames], prototype: [...next.prototype], notes: [...next.frameNotes], links: next.frameLinks.map((l) => [...l]), createdAt: this.stamp() };
      this.versions.push(row);
      const { prototype: _p, ...rest } = row;
      this.lastVersion = rest;
    }
    return next;
  }

  async appendChat(
    projectId: string,
    ownerId: string,
    turns: readonly Omit<DesignProjectChatTurn, "at">[],
  ): Promise<DesignProjectRow | null> {
    const r = this.rows.get(projectId);
    if (r === undefined || r.ownerId !== ownerId) return null;
    const at = this.stamp();
    const next: DesignProjectRow = { ...r, chat: [...r.chat, ...turns.map((t) => ({ ...t, at }))], updatedAt: at };
    this.rows.set(projectId, next);
    return next;
  }

  async delete(projectId: string, ownerId: string): Promise<boolean> {
    const r = this.rows.get(projectId);
    if (r === undefined || r.ownerId !== ownerId) return false;
    this.rows.delete(projectId);
    return true;
  }

  async pushToInbox(projectId: string, ownerId: string, note: string | undefined): Promise<PushToInboxResult | null> {
    const r = this.rows.get(projectId);
    if (r === undefined || r.ownerId !== ownerId) return null;
    const next: DesignProjectRow = {
      ...r,
      pushed: true,
      pushedAt: this.stamp(),
      pushNote: note ?? r.pushNote,
      updatedAt: this.stamp(),
    };
    this.rows.set(projectId, next);
    let resolvedFeedback: PushToInboxResult["resolvedFeedback"] = null;
    if (r.linkedFeedbackId !== null && this.resolvedBy.get(r.linkedFeedbackId) !== projectId) {
      this.resolvedBy.set(r.linkedFeedbackId, projectId);
      this.resolvedFeedbackIds.push(r.linkedFeedbackId);
      const fb = this.feedback.get(r.linkedFeedbackId) ?? {
        submittedBy: `submitter-of-${r.linkedFeedbackId}`,
        title: `反馈 ${r.linkedFeedbackId}`,
      };
      resolvedFeedback = { id: r.linkedFeedbackId, ...fb };
    }
    return { project: next, resolvedFeedback };
  }

  /* ── 2026-09-05「转开发」：建 issue 的认领/回填三件套 ────────────────────────── */

  /** 测试断言用：认领被调用了几次、`releaseGithubIssueClaim` 被调用了几次。 */
  readonly claimCalls: string[] = [];
  readonly releaseCalls: string[] = [];
  /** 置为 true 时下一次认领失败——模拟并发对手已经抢到（真实实现里是 UPDATE 没命中）。 */
  claimUnavailable = false;
  private readonly claimed = new Set<string>();

  async claimGithubIssueCreation(projectId: string, ownerId: string): Promise<boolean> {
    this.claimCalls.push(projectId);
    const row = this.rows.get(projectId);
    if (row === undefined || row.ownerId !== ownerId) return false;
    if (row.githubIssueUrl !== null) return false;
    if (this.claimUnavailable || this.claimed.has(projectId)) return false;
    this.claimed.add(projectId);
    return true;
  }

  async releaseGithubIssueClaim(projectId: string, _ownerId: string): Promise<void> {
    this.releaseCalls.push(projectId);
    this.claimed.delete(projectId);
  }

  async setGithubIssue(
    projectId: string,
    ownerId: string,
    issue: { readonly url: string; readonly number: number },
  ): Promise<DesignProjectRow | null> {
    const row = this.rows.get(projectId);
    if (row === undefined || row.ownerId !== ownerId) return null;
    const next: DesignProjectRow = {
      ...row,
      githubIssueUrl: issue.url,
      githubIssueNumber: issue.number,
      updatedAt: this.stamp(),
    };
    this.rows.set(projectId, next);
    return next;
  }

  /*
   * 迭代 22：发布/取消发布。两处细节刻意与真实仓储逐字对齐，否则单测会在一个
   * 生产里不存在的行为上变绿：
   *   ① 令牌 `COALESCE`——已发布的行**沿用旧令牌**，不因为重新发布就换一条链接；
   *   ② 两条都**不动 `updatedAt`**（发布没有改动设计本身，列表排序不该被它顶起来）。
   */
  async publishShare(
    projectId: string,
    ownerId: string,
    share: { readonly token: string; readonly scope: "prototype" | "full"; readonly snapshot: ShareSnapshot },
  ): Promise<DesignProjectRow | null> {
    const row = this.rows.get(projectId);
    if (row === undefined || row.ownerId !== ownerId) return null;
    const next: DesignProjectRow = {
      ...row,
      share: {
        token: row.share?.token ?? share.token,
        scope: share.scope,
        publishedAt: this.stamp(),
        snapshot: share.snapshot,
      },
    };
    this.rows.set(projectId, next);
    return next;
  }

  async unpublishShare(projectId: string, ownerId: string): Promise<DesignProjectRow | null> {
    const row = this.rows.get(projectId);
    if (row === undefined || row.ownerId !== ownerId) return null;
    const { share: _dropped, ...rest } = row;
    this.rows.set(projectId, rest);
    return rest;
  }
}

export function designProjectRow(over: Partial<DesignProjectRow> = {}): DesignProjectRow {
  return {
    id: "dp-1",
    ownerId: "u-owner",
    name: "项目 A",
    template: "wireframe",
    problem: "",
    criteria: [],
    frameLinks: [],
    tags: [],
    frames: [],
    prototype: [],
    frameNotes: [],
    pushed: false,
    pushedAt: null,
    pushNote: null,
    linkedFeedbackId: null,
    githubIssueUrl: null,
    githubIssueNumber: null,
    chat: [],
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...over,
  };
}

/** 深度 S2（#3988）：批注的内存 fake。只按 project 收窄，同真实仓储（谁能删在用例层判）。 */
export class FakeDesignCommentRepo implements DesignCommentRepository {
  readonly rows: DesignCommentRow[] = [];
  private seq = 0;
  async listComments(projectId: string) { return this.rows.filter((r) => r.projectId === projectId); }
  async countComments(projectId: string) { return this.rows.filter((r) => r.projectId === projectId).length; }
  async getComment(projectId: string, id: string) { return this.rows.find((r) => r.projectId === projectId && r.id === id) ?? null; }
  async insertComment(row: Omit<DesignCommentRow, "createdAt" | "resolved">) {
    const full: DesignCommentRow = { ...row, resolved: false, createdAt: new Date(Date.UTC(2026, 8, 24, 0, 0, ++this.seq)).toISOString() };
    this.rows.push(full);
    return full;
  }
  async setCommentResolved(projectId: string, id: string, resolved: boolean) {
    const i = this.rows.findIndex((r) => r.projectId === projectId && r.id === id);
    if (i < 0) return null;
    this.rows[i] = { ...this.rows[i]!, resolved };
    return this.rows[i]!;
  }
  async deleteComment(projectId: string, id: string) {
    const i = this.rows.findIndex((r) => r.projectId === projectId && r.id === id);
    if (i < 0) return false;
    this.rows.splice(i, 1);
    return true;
  }
}
