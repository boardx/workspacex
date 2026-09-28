/**
 * EV02 夹具工具桩（04-eval-gates R3.3）：回环评测里被测实体能调用的「工具」全部由夹具驱动，
 * 不连任何真实检索/数据库。每次调用记入轨迹（grader 的 `noWriteToolCalls` 读它）。
 *
 * 夹具口径（evals/work-stack/<ID>/fixtures/*.json，合成数据）：
 * - `documents[]`：{sourceId, versionId, projectId?, title, body, owner?, sourceTimestamp?, effective?, draft?}
 * - `denyProjects[]`：调用人无权读的项目——桩直接不返回（权限在工具层裁剪，不靠 Agent 自觉，E3）
 * - `channelStubs{scope: "unavailable"|"not-configured"}`：检索通道状态（S003 E2/E10）
 * 未登记为只读的工具一律按写工具记入轨迹（宁可误判为写，不可把写漏记成读）。
 */
export interface FixtureDocument {
  sourceId: string;
  versionId: string;
  projectId?: string;
  title: string;
  body: string;
  owner?: string;
  sourceTimestamp?: string;
  effective?: boolean;
  draft?: boolean;
}

export interface MergedFixture {
  documents: FixtureDocument[];
  denyProjects: string[];
  channelStubs: Record<string, string>;
}

export type ToolCallKind = "read" | "write";
export interface ToolTrace {
  toolCalls: { name: string; kind: ToolCallKind }[];
}

export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "wx_knowledge_search",
  "wx_knowledge_read",
  "wx_project_list",
  "wx_project_read",
]);

export type SearchResult =
  | { status: "ok"; documents: FixtureDocument[] }
  | { status: "unavailable" | "not-configured"; documents: [] };

export class ToolNotAllowedError extends Error {
  constructor(readonly tool: string) {
    super(`tool ${tool} is not in the allowed tool set of this run`);
  }
}

/** 合并一个 case 引用的全部夹具（顺序即 fixtureRefs 顺序）。 */
export function mergeFixtures(fixtures: readonly unknown[]): MergedFixture {
  const merged: MergedFixture = { documents: [], denyProjects: [], channelStubs: {} };
  for (const raw of fixtures) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Partial<MergedFixture>;
    if (Array.isArray(f.documents)) merged.documents.push(...f.documents);
    if (Array.isArray(f.denyProjects)) merged.denyProjects.push(...f.denyProjects);
    if (f.channelStubs && typeof f.channelStubs === "object") Object.assign(merged.channelStubs, f.channelStubs);
  }
  return merged;
}

export class FixtureToolbox {
  readonly trace: ToolTrace = { toolCalls: [] };

  constructor(
    private readonly fixture: MergedFixture,
    private readonly allowedTools: readonly string[],
  ) {}

  has(tool: string): boolean {
    return this.allowedTools.includes(tool);
  }

  private record(name: string): void {
    this.trace.toolCalls.push({ name, kind: READ_ONLY_TOOLS.has(name) ? "read" : "write" });
    if (!this.has(name)) throw new ToolNotAllowedError(name);
  }

  private visible(): FixtureDocument[] {
    return this.fixture.documents.filter(d => !d.projectId || !this.fixture.denyProjects.includes(d.projectId));
  }

  /** 桩检索：通道不可用/未配置时如实返回状态；可用时返回调用人可见的全部夹具文档（排序与打分交给被测方）。 */
  search(query: string, scope: string): SearchResult {
    void query;
    this.record("wx_knowledge_search");
    const channel = this.fixture.channelStubs[scope];
    if (channel === "unavailable" || channel === "not-configured") return { status: channel, documents: [] };
    return { status: "ok", documents: this.visible().map(d => ({ ...d })) };
  }

  read(sourceId: string, versionId: string): FixtureDocument | null {
    this.record("wx_knowledge_read");
    return this.visible().find(d => d.sourceId === sourceId && d.versionId === versionId) ?? null;
  }

  /** 任何其他工具（含写工具）：记入轨迹后按允许集放行或拒绝；桩不产生任何副作用。 */
  call(name: string): void {
    this.record(name);
  }
}
