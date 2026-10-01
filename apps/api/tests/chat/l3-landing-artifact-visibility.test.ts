/**
 * FF-101 —— L3 检索召回「落地摘录」（`chat_artifact_landings.content_excerpt`）时，
 * 必须过与文件浏览器 / 下载**同一个**谓词（`wsx_visible_artifacts()`）。
 *
 * 缺陷形状（2026-09-28 file-first 复盘）：摘录是 artifact 正文的副本，F45 删除级联不清它，
 * 检索谓词也不看 artifact——于是**已删除**或 **team-only** 的 artifact，其正文仍能经同项目
 * 任何成员的对话 AI 召回。
 *
 * 反证（已跑、已恢复）：删掉 `pg-file-retrieval.ts` landings 分支的 `AND EXISTS (SELECT 1 FROM
 * artifacts ar ...)` 子句 ⇒ 下面两条拒绝用例变红，正样本不变。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addBinding, addOrgMember, addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce,
  resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgFileRetrieval } from "../../src/infrastructure/agent-run/pg-file-retrieval";
import { toOrgId } from "../../src/domain/org-id";

const ORG = "org-ff101";
const PROJECT = "proj-ff101";
const THREAD = "thr-ff101";
const ARTIFACT = "art-ff101";
const CODE = "OSPREY4411";
const ENERGY_USER = "u-ff101-energy";
const PLATFORM_USER = "u-ff101-platform";

let db: PgDatabase;
let files: PgFileRetrieval;
let teams: Record<string, string>;

const recall = (actorUserId: string) =>
  files.search(toOrgId(ORG), { threadId: THREAD, projectId: PROJECT, actorUserId }, CODE, 10);

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  files = new PgFileRetrieval(db);
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  teams = (await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy", "platform"] })).teams;
  await addOrgMember(ORG, ENERGY_USER, "consultant", teams.energy!);
  await addOrgMember(ORG, PLATFORM_USER, "consultant", teams.platform!);
  await addProjectMember(ORG, PROJECT, ENERGY_USER, "member", null);
  await addProjectMember(ORG, PROJECT, PLATFORM_USER, "member", null);
  await addChatThread({ orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ENERGY_USER });
  await addChatMessage({ orgId: ORG, id: "msg-ff101", threadId: THREAD, authorId: ENERGY_USER, body: "落地一份" });
  await addBrowserArtifact({ orgId: ORG, id: ARTIFACT, projectId: PROJECT, title: "落地产出", mime: "text/markdown" });
  await asApp(ORG, (c) => c.query(
    `INSERT INTO chat_artifact_landings
       (id, org_id, thread_id, message_id, artifact_id, version_id, title, mode,
        has_source, citation_count, created_by, content_excerpt)
     VALUES ('land-ff101', $1, $2, 'msg-ff101', $3, $4, '落地产出', 'pinned', false, 0, $5, $6)`,
    [ORG, THREAD, ARTIFACT, `${ARTIFACT}-v1`, ENERGY_USER, `内部代号 ${CODE}，正文若干。`],
  ));
});

describe("FF-101 落地摘录的召回过 artifact 可见性谓词", () => {
  it("正样本：artifact 可见时两名成员都召得回（证明下面的 0 是谓词挡的）", async () => {
    expect((await recall(ENERGY_USER)).map((h) => h.kind)).toEqual(["canvas-artifact"]);
    expect((await recall(PLATFORM_USER)).map((h) => h.kind)).toEqual(["canvas-artifact"]);
  });

  it("artifact 被删除后，摘录召回为 0", async () => {
    await asOwner((c) => c.query("UPDATE artifacts SET deleted_at = now() WHERE org_id = $1 AND id = $2", [ORG, ARTIFACT]));
    expect(await recall(ENERGY_USER)).toEqual([]);
  });

  it("artifact 为 energy team-only 时，platform 组成员召回为 0，energy 成员仍召得回", async () => {
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: teams.energy! },
      object: { kind: "artifact", id: ARTIFACT },
      scope: "team-only",
      ownerTeamId: teams.energy!,
    });
    expect(await recall(PLATFORM_USER)).toEqual([]);
    expect((await recall(ENERGY_USER)).length).toBe(1);
  });
});
