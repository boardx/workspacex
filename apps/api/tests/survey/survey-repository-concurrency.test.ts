import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SurveyDraftInputSchema } from "@repo/contracts/survey-runtime";
import { SurveyService } from "../../src/application/survey/survey-service";
import { toOrgId } from "../../src/domain/org-id";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgSurveyRepository } from "../../src/infrastructure/survey/pg-survey-repository";
import { migrateOnce, resetOrgs, seedOrg } from "../support/db";

const org = toOrgId("org-survey-state-4037");
let db: PgDatabase;

const draft = SurveyDraftInputSchema.parse({
  title: "可信发布",
  questions: [
    {
      id: "q1",
      order: 1,
      chapterId: "section-1",
      title: "请选择协作成熟度",
      type: "single",
      required: true,
      options: ["初级", "成熟"],
    },
  ],
  template: {
    id: "report-1",
    title: "报告",
    sections: [
      {
        id: "section-1",
        title: "成熟度",
        blocks: [
          {
            id: "block-1",
            title: "选择分布",
            type: "bar",
            questionIds: ["q1"],
            statistic: "distribution",
          },
        ],
      },
    ],
  },
});

beforeAll(async () => {
  await migrateOnce();
  await resetOrgs(org);
  await seedOrg({ orgId: org, projectId: "project-survey-state-4037", teamNames: [] });
  db = new PgDatabase(appConfig());
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(org);
});

describe("survey repository publishing concurrency", () => {
  it("serializes prepare and leaves the complete document unchanged on stale replay", async () => {
    const service = new SurveyService(new PgSurveyRepository(db));
    const created = await service.create(org, "owner", draft);

    expect(created).toMatchObject({
      version: 1,
      status: "draft",
      anonymity: "anonymous",
      publication: null,
    });

    const ready = await service.prepare(org, "owner", created.id, 1);
    expect(ready).toMatchObject({ status: "ready", version: 2 });

    const before = await db.withTenant(org, (session) =>
      session.query<{ document: unknown }>(
        "SELECT document FROM survey_workspaces WHERE org_id=$1 AND id=$2",
        [org, created.id],
      ),
    );
    await expect(
      service.prepare(org, "owner", created.id, 1),
    ).rejects.toMatchObject({ code: "version_conflict" });
    const after = await db.withTenant(org, (session) =>
      session.query<{ document: unknown }>(
        "SELECT document FROM survey_workspaces WHERE org_id=$1 AND id=$2",
        [org, created.id],
      ),
    );

    expect(after.rows[0]?.document).toEqual(before.rows[0]?.document);
    expect((await service.get(org, "owner", created.id)).version).toBe(2);
  });

  it("hydrates legacy JSON without dropping publication or receipt fields", async () => {
    const service = new SurveyService(new PgSurveyRepository(db));
    const created = await service.create(org, "legacy-owner", draft);
    await db.withTenant(org, (session) =>
      session.query(
        "UPDATE survey_workspaces SET document=document #- '{model,status}' #- '{model,anonymity}' WHERE org_id=$1 AND id=$2",
        [org, created.id],
      ),
    );

    const hydrated = await service.get(org, "legacy-owner", created.id);

    expect(hydrated.status).toBe("draft");
    expect(hydrated.anonymity).toBe("anonymous");
    expect(hydrated.publication).toBeNull();
    expect(hydrated.responses).toEqual([]);
  });
});
