/**
 * #4245 —— 真实 PG：`sample_projects` 持久标记 × `PgChatRepository.sampleArtifactIds`。
 *
 * 纯单元（`persist-assistant-citations.test.ts`）钉住「只引示例 ⇒ 只记 sample」的分支逻辑；
 * 这里钉住判据本身在数据库里成立：
 *   · 标记由 `PgProjectRepository.markSampleProject` 写（幂等，重复调用不报错）；
 *   · 只有示例项目里的 artifact 被认作示例材料，自己项目里的、无项目的都不是；
 *   · 判据不看标签：给自己的项目打上「内置示例」标签不会让它变成示例；
 *   · 租户隔离：别组织的示例 artifact id 在本组织名下查不出来。
 * 需要 Docker 里的 PostgreSQL，本机无 Docker 时只在 CI 跑。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { PgProjectRepository } from "../../src/infrastructure/project/pg-project-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { SAMPLE_PROJECT_TAG } from "../../src/application/project/sample-project/sample-project-content";
import { toOrgId } from "../../src/domain/org-id";
import { addArtifact, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

const ORG = "i4245-sample-org";
const ORG_B = "i4245-sample-org-b";
const SAMPLE_PRJ = "i4245-prj-sample";
const OWN_PRJ = "i4245-prj-own";
const B_SAMPLE_PRJ = "i4245-prj-b-sample";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;
let chat: PgChatRepository;
let projects: PgProjectRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  chat = new PgChatRepository(db);
  projects = new PgProjectRepository(db, new UuidIdFactory());
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG, ORG_B);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG, ORG_B);
  await seedOrg({ orgId: ORG, projectId: SAMPLE_PRJ, projectKind: "research_project", groupNames: [] });
  await asApp(ORG, async (c) => {
    await c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1, $2, $3, 'research_project')", [OWN_PRJ, ORG, "own"]);
    await c.query("INSERT INTO research_projects (id, org_id) VALUES ($1, $2)", [OWN_PRJ, ORG]);
    // 反例素材：用户给自己的项目打上同名标签——判据不能看标签。
    await c.query("INSERT INTO project_tags (project_id, org_id, tag) VALUES ($1, $2, $3)", [OWN_PRJ, ORG, SAMPLE_PROJECT_TAG]);
  });
  await seedOrg({ orgId: ORG_B, projectId: B_SAMPLE_PRJ, projectKind: "research_project", groupNames: [] });
  await addArtifact({ orgId: ORG, id: "i4245-art-sample", projectId: SAMPLE_PRJ });
  await addArtifact({ orgId: ORG, id: "i4245-art-own", projectId: OWN_PRJ });
  await addArtifact({ orgId: ORG, id: "i4245-art-loose", projectId: null });
  await addArtifact({ orgId: ORG_B, id: "i4245-art-b-sample", projectId: B_SAMPLE_PRJ });
  await projects.markSampleProject(toOrgId(ORG), SAMPLE_PRJ);
  await projects.markSampleProject(toOrgId(ORG), SAMPLE_PRJ); // 幂等
  await projects.markSampleProject(toOrgId(ORG_B), B_SAMPLE_PRJ);
}, HOOK_TIMEOUT_MS);

describe("sample_projects × sampleArtifactIds", () => {
  it("只有示例项目里的 artifact 被认作示例；自己的、无项目的、仅带同名标签的都不是", async () => {
    const got = await chat.sampleArtifactIds(toOrgId(ORG), ["i4245-art-sample", "i4245-art-own", "i4245-art-loose"]);
    expect([...got]).toEqual(["i4245-art-sample"]);
  });

  it("反例：别组织的示例 artifact 在本组织名下查不出来", async () => {
    const got = await chat.sampleArtifactIds(toOrgId(ORG), ["i4245-art-b-sample"]);
    expect(got.size).toBe(0);
  });

  it("标记行受 RLS 约束：本组织看不到别组织的标记", async () => {
    const rows = await asApp(ORG, (c) => c.query("SELECT project_id FROM sample_projects ORDER BY project_id"));
    expect(rows.rows.map((r) => r.project_id)).toEqual([SAMPLE_PRJ]);
  });
});
