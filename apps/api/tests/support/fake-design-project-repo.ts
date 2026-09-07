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

  async listForOrg(): Promise<readonly DesignProjectRow[]> {
    return [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
      ...(patch.frames !== undefined ? { frames: [...patch.frames] } : {}),
      // 同 pg 仓储：只改 frames 不给 prototype ⇒ 清空；给了 ⇒ 替换。
      ...(patch.prototype !== undefined ? { prototype: [...patch.prototype] } : patch.frames !== undefined ? { prototype: [] } : {}),
      ...(patch.frameNotes !== undefined ? { frameNotes: [...patch.frameNotes] } : patch.frames !== undefined ? { frameNotes: [] } : {}),
      updatedAt: this.stamp(),
    };
    this.rows.set(projectId, next);
    if (version !== undefined) {
      // 同真实仓储：与 UPDATE 同一步落版本，frames/prototype 取更新后的行。
      const seq = this.versions.filter((v) => v.projectId === projectId).length + 1;
      const row: PrototypeVersionRow = { id: `${projectId}-v${seq}`, projectId, seq, ...version, frames: [...next.frames], prototype: [...next.prototype], notes: [...next.frameNotes], createdAt: this.stamp() };
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
}

export function designProjectRow(over: Partial<DesignProjectRow> = {}): DesignProjectRow {
  return {
    id: "dp-1",
    ownerId: "u-owner",
    name: "项目 A",
    template: "wireframe",
    problem: "",
    criteria: [],
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
