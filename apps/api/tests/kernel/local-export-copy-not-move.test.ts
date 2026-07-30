/**
 * F17 V11③ —— 「**复制而非迁移**：本地副本保留」，以及目标侧条目带来源标注。
 *
 * ## 为什么这条值得单独一个文件
 *
 * 「导出」这个词在大多数产品里意味着「拿一份出来」，但实现起来最省事的形态是**搬走**——
 * 尤其当 `artifacts.id` 全局唯一、副本必须换 id 的时候，「改一下 org_id 就完事」
 * 是一行 UPDATE，而正确做法是插一整套新行。
 *
 * 搬走的后果不是「用户少了个文件」这么轻：本地组织是那个人**唯一**被承诺不出本机的地方，
 * 一次导出如果把原件带走了，那份数据从此只存在于一个他不能单方面决定的组织里。
 *
 * ## 断言 / 反证
 *
 *   本地侧行数、id、对象键、字节，导出前后逐项相同   ← 反证：把源行删掉，断言必须红
 *   目标侧出现新行，且 id 不同、键在目标键空间里     ← 没有它，「什么都不做」也能满足上一条
 *   目标侧三个标注列同时齐备且指回源                 ← 半填的行比不填更糟
 *   目标侧的字节与源一致                             ← 只断言行存在会放过一个空副本
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import { asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { importedArtifacts, seedExportFixture, useTempObjectStore, type ExportFixture } from "../support/export-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const OBJECT_ROOT = useTempObjectStore();

const LOCAL_ORG = "org-f17-copy-local";
const REAL_ORG = "org-f17-copy-real";
const PREFIX = "f17copy";

let BASE: string;
let app: NestExpressApplication;
let fx: ExportFixture;

const authFor = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(LOCAL_ORG, REAL_ORG);
});

beforeEach(async () => {
  await resetOrgs(LOCAL_ORG, REAL_ORG);
  fx = await seedExportFixture({
    prefix: PREFIX, localOrg: LOCAL_ORG, realOrg: REAL_ORG, objectRoot: OBJECT_ROOT,
  });
});

interface LocalRow {
  id: string;
  title: string;
  version_id: string;
  object_storage_key: string;
  content_hash: string;
}

async function localRows(): Promise<LocalRow[]> {
  const r = await asApp(LOCAL_ORG, (c) =>
    c.query<LocalRow>(
      `SELECT a.id, a.title, v.id AS version_id, v.object_storage_key, v.content_hash
         FROM artifacts a JOIN artifact_versions v ON v.artifact_id = a.id
        WHERE a.org_id = $1 ORDER BY a.id`,
      [LOCAL_ORG],
    ),
  );
  return r.rows;
}

/** preview -> confirm, the only way an export can happen. */
async function runExport(artifactIds: readonly string[]): Promise<Response> {
  const preview = await fetch(`${BASE}/identity/export/preview`, {
    method: "POST",
    headers: authFor(fx.owner, LOCAL_ORG),
    body: JSON.stringify({ fromLocalOrgId: LOCAL_ORG, toOrgId: REAL_ORG, artifactIds }),
  });
  expect(preview.status, await preview.clone().text()).toBe(200);
  const { token } = (await preview.json()) as { token: string };
  return fetch(`${BASE}/identity/export`, {
    method: "POST",
    headers: authFor(fx.owner, LOCAL_ORG),
    body: JSON.stringify({
      fromLocalOrgId: LOCAL_ORG, toOrgId: REAL_ORG, artifactIds, confirmedPreviewToken: token,
    }),
  });
}

describe("导出是复制：本地副本一个字节都不动", () => {
  it("导出前后，本地侧的行、id、对象键、哈希完全相同", async () => {
    const before = await localRows();
    expect(before.length, "夹具没种出东西——下面的比较会在两个空数组之间成立").toBeGreaterThan(0);

    const r = await runExport(fx.artifactIds);
    expect(r.status, await r.clone().text()).toBe(200);

    const after = await localRows();
    // 断言的是**性质**（逐项相同），不是数量。
    expect(after).toEqual(before);
  });

  it("...而且本地的字节还在，内容未变", async () => {
    await runExport(fx.artifactIds);
    const store = new FsObjectStore(OBJECT_ROOT);
    for (const row of await localRows()) {
      const bytes = await store.get(row.object_storage_key);
      expect(bytes, `${row.object_storage_key} 的字节不见了——那是迁移不是复制`).not.toBeNull();
      expect(new TextDecoder().decode(bytes!)).toBe(fx.bytes.get(row.id));
    }
  });

  it("反证：这条比较认得出本地侧的任何变动——不是两个空数组之间的恒等式", async () => {
    // 没有这一条，上面两条会被一个「什么都没发生」的实现满足：本地行当然没变，
    // 因为根本没有导出。这里在导出之后手工改动本地侧，确认比较会抓到它。
    const before = await localRows();
    await runExport(fx.artifactIds);
    await asApp(LOCAL_ORG, (c) =>
      c.query("UPDATE artifacts SET title = 'moved away' WHERE org_id = $1 AND id = $2",
        [LOCAL_ORG, fx.artifactIds[0]]),
    );
    expect(await localRows()).not.toEqual(before);
  });

  it("...而且最糟的那种「搬走」在数据库层就不可能：定过版的原件删不掉", async () => {
    // ⚠ 这一条是实现过程中被数据库教会的：第一版反证试图 DELETE 本地原件来模拟迁移，
    //   结果被 I-11 的触发器挡下（`SNAPSHOT_IMMUTABLE: ... has pinned versions`）。
    //   也就是说 V11③ 的最坏形态（把原件删掉）**在这条路径上根本写不出来**，
    //   剩下要守的是「有没有真的复制出去」，那由目标侧的断言承担。
    await runExport(fx.artifactIds);
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query("DELETE FROM artifacts WHERE org_id = $1 AND id = $2",
          [LOCAL_ORG, fx.artifactIds[0]]),
      ),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
  });
});

describe("目标侧真的多了东西，且它标着自己是哪来的", () => {
  it("目标组织出现新条目：新 id、新键、键不在本地前缀下", async () => {
    const r = await runExport(fx.artifactIds);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { copiedArtifactIds: string[] };
    // 契约的 `copiedArtifactIds` 只能是源 id（KNOWN_CONTRACT_GAPS.C_F17_2）
    expect([...body.copiedArtifactIds].sort()).toEqual([...fx.artifactIds].sort());

    const rows = await importedArtifacts(REAL_ORG);
    expect(rows.length, "目标侧什么都没多——「复制」里的复制没发生").toBe(fx.artifactIds.length);
    for (const row of rows) {
      // 新 id：`artifacts.id` 全局唯一，副本沿用源 id 是插不进去的
      expect(fx.artifactIds).not.toContain(row.id);
    }

    const keys = await asApp(REAL_ORG, (c) =>
      c.query<{ object_storage_key: string }>(
        "SELECT object_storage_key FROM artifact_versions WHERE org_id = $1", [REAL_ORG],
      ),
    );
    expect(keys.rows.length).toBe(fx.artifactIds.length);
    for (const k of keys.rows) {
      // ⚠ 副本**不再**受「不出本机」保护，它的键必须说出这件事。
      //   迁移 0015 的触发器两个方向都挡，所以这里其实是数据库已经保证过的事——
      //   断言它是为了让「换前缀」这件事在读代码时是显式的而不是偶然的。
      expect(k.object_storage_key.startsWith(C.LOCAL_ORG_STORAGE_PREFIX)).toBe(false);
      expect(k.object_storage_key.startsWith(`${REAL_ORG}/`)).toBe(true);
    }
  });

  it("三个来源标注列同时齐备，指回源组织与源条目，措辞来自契约", async () => {
    await runExport(fx.artifactIds);
    const rows = await importedArtifacts(REAL_ORG);
    const expectedNote = C.localExportUnvettedNote(fx.owner);
    for (const row of rows) {
      expect(row.imported_from_org_id).toBe(LOCAL_ORG);
      expect(fx.artifactIds).toContain(row.imported_from_artifact_id);
      // ⚠ 与契约函数的输出逐字相等。数据库拼一句、界面拼一句是本项目第六次
      //   「同一事实两处声明」的现成候选，而这一句的内容决定了目标组织的人
      //   会不会把它当作已审核的材料。
      expect(row.imported_from_note).toBe(expectedNote);
      expect(row.imported_from_note).toContain("未经本组织入库审核");
    }
  });

  it("反证：半填的标注写不进去——三列同生共死", async () => {
    // 「有来源信息」但答不出是谁的本地组织，比完全没有标注更糟：读的人会因为
    // 看到有字段就不再去查。迁移 0016 的 CHECK 让这种行不可表达。
    await expect(
      asApp(REAL_ORG, (c) =>
        c.query(
          `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized, imported_from_org_id)
           VALUES ($1,$2,NULL,'upload','half-marked','u-x',false,$3)`,
          [`${PREFIX}-half`, REAL_ORG, LOCAL_ORG],
        ),
      ),
    ).rejects.toThrow(/artifacts_import_marks_travel_together/);
  });

  it("目标侧的字节与源一致——只断言行存在会放过一个空副本", async () => {
    await runExport(fx.artifactIds);
    const store = new FsObjectStore(OBJECT_ROOT);
    const rows = await asApp(REAL_ORG, (c) =>
      c.query<{ artifact_id: string; object_storage_key: string }>(
        "SELECT artifact_id, object_storage_key FROM artifact_versions WHERE org_id = $1", [REAL_ORG],
      ),
    );
    const marks = new Map(
      (await importedArtifacts(REAL_ORG)).map((r) => [r.id, r.imported_from_artifact_id!]),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      const bytes = await store.get(row.object_storage_key);
      expect(bytes, `${row.object_storage_key} 是一条指向空对象的记录`).not.toBeNull();
      expect(new TextDecoder().decode(bytes!)).toBe(fx.bytes.get(marks.get(row.artifact_id)!));
    }
  });

  it("可引用性一起过去了：副本的 segment 与 anchor 都在", async () => {
    // 一份不能被引用的副本，在一个「每条结论都要能定位到片段」的产品里只是名义上的副本。
    await runExport(fx.artifactIds);
    const r = await asApp(REAL_ORG, (c) =>
      c.query<{ segments: string; anchors: string }>(
        `SELECT (SELECT count(*)::text FROM segments WHERE org_id = $1) AS segments,
                (SELECT count(*)::text FROM anchors  WHERE org_id = $1) AS anchors`,
        [REAL_ORG],
      ),
    );
    // 性质而非数量：每一条 segment 都有 anchor（I-7），且两者都不为零。
    expect(Number(r.rows[0]!.segments)).toBeGreaterThan(0);
    expect(Number(r.rows[0]!.anchors)).toBeGreaterThanOrEqual(Number(r.rows[0]!.segments));
  });
});
