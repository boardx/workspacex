/**
 * backlog E2 —— `ensureSampleProject` 的幂等与可续跑，测到仓储边界为止（内存假件）。
 *
 * 真实 PG（`PgProjectTagsRepository.findProjectIdByTag` / RLS / ingestion worker 真索引）
 * 不在这里跑——本机测试没有数据库时这份仍能跑；DB 层由既有的 project/files 套件覆盖其写路径。
 */
import { describe, expect, it } from "vitest";
import {
  ensureSampleProject,
  type EnsureSampleProjectDeps,
  type SampleProjectLookup,
} from "../../src/application/project/sample-project/ensure-sample-project";
import {
  SAMPLE_DOCUMENTS,
  SAMPLE_PROJECT_KIND,
  SAMPLE_PROJECT_NAME,
  SAMPLE_PROJECT_TAG,
} from "../../src/application/project/sample-project/sample-project-content";
import type {
  CreateProjectCommand,
  CreatedProject,
  ProjectRepository,
  ProjectTagsRepository,
  UpdateProjectTagsOutcome,
} from "../../src/application/project/ports";
import type { IdentityRepository } from "../../src/application/identity/ports";
import { toOrgId, type OrgId } from "../../src/domain/org-id";
import { FakeArtifactRepository, FakeObjectStore, SequentialIdFactory } from "../support/artifact-fakes";

class FakeProjects implements ProjectRepository {
  readonly rows = new Map<string, { id: string; name: string; kind: string }>();
  private readonly byFingerprint = new Map<string, string>();
  async create(cmd: CreateProjectCommand): Promise<CreatedProject> {
    const prior = this.byFingerprint.get(cmd.fingerprint);
    if (prior !== undefined) return { id: prior, kind: cmd.kind, status: "active", created: false };
    const id = `prj-${this.rows.size + 1}`;
    this.byFingerprint.set(cmd.fingerprint, id);
    this.rows.set(id, { id, name: cmd.name, kind: cmd.kind });
    return { id, kind: cmd.kind, status: "active", created: true };
  }
}

class FakeTags implements ProjectTagsRepository, SampleProjectLookup {
  readonly tags = new Map<string, readonly string[]>();
  constructor(private readonly projects: FakeProjects) {}
  async updateTags(_orgId: OrgId, projectId: string, tags: readonly string[]): Promise<UpdateProjectTagsOutcome> {
    if (!this.projects.rows.has(projectId)) return { kind: "not-found" };
    this.tags.set(projectId, tags);
    return { kind: "updated", projectId, tags };
  }
  async findProjectIdByTag(_orgId: OrgId, tag: string): Promise<string | null> {
    for (const [id, t] of this.tags) if (t.includes(tag)) return id;
    return null;
  }
}

const adminIdentity = {
  findOrgMembership: async () => ({ orgRole: "admin", teamId: null }),
} as unknown as IdentityRepository;

function harness(store = new FakeObjectStore()) {
  const projects = new FakeProjects();
  const tags = new FakeTags(projects);
  const artifacts = new FakeArtifactRepository();
  const deps: EnsureSampleProjectDeps = {
    project: { repo: projects, identity: adminIdentity },
    upload: {
      store,
      repo: artifacts,
      ids: new SequentialIdFactory(),
      quarantine: { record: async () => {} },
      alerts: { raise: async () => {} },
    },
    tags,
    lookup: tags,
  };
  return { deps, projects, tags, artifacts };
}

const ORG = toOrgId("org-e2-sample");
const ACTOR = "u-e2-admin";

describe("ensureSampleProject", () => {
  it("首次调用：建一个带示例标签的项目并上传全部示例文档", async () => {
    const h = harness();
    const r = await ensureSampleProject(h.deps, { orgId: ORG, actorId: ACTOR });
    expect(r.created).toBe(true);
    const row = h.projects.rows.get(r.projectId)!;
    expect(row.name).toBe(SAMPLE_PROJECT_NAME);
    expect(row.kind).toBe(SAMPLE_PROJECT_KIND);
    expect(h.tags.tags.get(r.projectId)).toEqual([SAMPLE_PROJECT_TAG]);
    expect(h.artifacts.artifacts.size).toBe(SAMPLE_DOCUMENTS.length);
    expect(h.artifacts.versions.size).toBe(SAMPLE_DOCUMENTS.length);
  });

  it("重复调用：零新项目、零新版本（幂等）", async () => {
    const h = harness();
    const first = await ensureSampleProject(h.deps, { orgId: ORG, actorId: ACTOR });
    const second = await ensureSampleProject(h.deps, { orgId: ORG, actorId: ACTOR });
    const third = await ensureSampleProject(h.deps, { orgId: ORG, actorId: "u-another-admin" });
    expect(second).toEqual({ projectId: first.projectId, created: false });
    expect(third).toEqual({ projectId: first.projectId, created: false });
    expect(h.projects.rows.size).toBe(1);
    expect(h.artifacts.versions.size).toBe(SAMPLE_DOCUMENTS.length);
  });

  it("中途失败（对象存储不可用）不打标记；恢复后重跑续上，不重复建项目或版本", async () => {
    const store = new FakeObjectStore();
    const h = harness(store);
    const realPut = store.putOnce.bind(store);
    let down = true;
    store.putOnce = async (k, b, m) => {
      if (down) throw new Error("storage down");
      return realPut(k, b, m);
    };
    await expect(ensureSampleProject(h.deps, { orgId: ORG, actorId: ACTOR })).rejects.toThrow();
    expect(h.tags.tags.size).toBe(0);
    expect(h.projects.rows.size).toBe(1);

    down = false;
    const r = await ensureSampleProject(h.deps, { orgId: ORG, actorId: ACTOR });
    expect(h.projects.rows.size).toBe(1);
    expect(h.tags.tags.get(r.projectId)).toEqual([SAMPLE_PROJECT_TAG]);
    expect(h.artifacts.versions.size).toBe(SAMPLE_DOCUMENTS.length);

    await ensureSampleProject(h.deps, { orgId: ORG, actorId: ACTOR });
    expect(h.artifacts.versions.size).toBe(SAMPLE_DOCUMENTS.length);
  });

  it("种子路径零外部调用：依赖里没有模型/嵌入/网络端口", () => {
    const h = harness();
    expect(Object.keys(h.deps).sort()).toEqual(["lookup", "project", "tags", "upload"]);
    expect(Object.keys(h.deps.upload).sort()).toEqual(["alerts", "ids", "quarantine", "repo", "store"]);
  });
});
