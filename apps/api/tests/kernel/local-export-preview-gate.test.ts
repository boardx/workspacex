/**
 * F17 V11② —— 导出前必须**逐项预览**，且预览是**一次人工动作**。
 *
 * ## 这道门要挡的不是「忘了预览」
 *
 * 忘了预览会在联调时被发现。真正会活下来的失效是三种「预览确实存在过」的形态：
 *
 *   令牌可复用       攒一个 token，之后每晚推一次——每次都能出示「人确认过」
 *   令牌可换内容     确认时看到 A，导出时提交 B，签名照样有效
 *   令牌永不过期     「人确认过」变成一句关于过去的话，而不是当下的事实
 *
 * 三种都让一次真实的确认变成一把**长期钥匙**，而这正是 V11① 那句
 * 「禁止任何自动同步 / 后台上传 / 定时推送」在协议层的实现方式。
 *
 * ## 预览必须回答第二个问题
 *
 * 逐项列出「哪些材料会离开本机」只是一半。另一半是「它们进去之后**谁会看到**」——
 * 「导给公司」和「导给公司里这几个人都能读」是两个不同的决定，
 * 而后者才是真实发生的那个。所以 `willBeVisibleTo` 非空是一条断言，不是装饰。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import { asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { seedExportFixture, useTempObjectStore, type ExportFixture } from "../support/export-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const OBJECT_ROOT = useTempObjectStore();

const LOCAL_ORG = "org-f17-gate-local";
const REAL_ORG = "org-f17-gate-real";
const PREFIX = "f17gate";

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

function preview(artifactIds: readonly string[], as = fx.owner): Promise<Response> {
  return fetch(`${BASE}/identity/export/preview`, {
    method: "POST",
    headers: authFor(as, LOCAL_ORG),
    body: JSON.stringify({ fromLocalOrgId: LOCAL_ORG, toOrgId: REAL_ORG, artifactIds }),
  });
}

function doExport(
  artifactIds: readonly string[],
  confirmedPreviewToken: string,
  as = fx.owner,
): Promise<Response> {
  return fetch(`${BASE}/identity/export`, {
    method: "POST",
    headers: authFor(as, LOCAL_ORG),
    body: JSON.stringify({
      fromLocalOrgId: LOCAL_ORG, toOrgId: REAL_ORG, artifactIds, confirmedPreviewToken,
    }),
  });
}

async function tokenFor(artifactIds: readonly string[]): Promise<string> {
  const r = await preview(artifactIds);
  expect(r.status, await r.clone().text()).toBe(200);
  return ((await r.json()) as { token: string }).token;
}

async function copiedCount(): Promise<number> {
  const r = await asApp(REAL_ORG, (c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM artifacts WHERE org_id = $1", [REAL_ORG]),
  );
  return Number(r.rows[0]!.n);
}

/* ═════════════════ 预览本身：它必须说清「谁会看到」 ═════════════════ */

describe("预览逐项列出将离开本机的内容，以及它们在目标组织的可见性", () => {
  it("每一项都带上目标组织里会看到它的人——只列文件名的预览让人不知道自己在同意什么", async () => {
    const r = await preview(fx.artifactIds);
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      items: { artifactId: string; title: string; willBeVisibleTo: { kind: string; id: string; name: string }[] }[];
      token: string;
    };

    // 响应体必须过契约（hard rule 6）。out 是 strict 的，多一个字段就红。
    expect(C.operations.previewExport.out.safeParse(body).success, JSON.stringify(body)).toBe(true);

    expect([...body.items.map((i) => i.artifactId)].sort()).toEqual([...fx.artifactIds].sort());
    for (const item of body.items) {
      expect(item.willBeVisibleTo.length, "可见性是空的——预览只回答了一半的问题")
        .toBeGreaterThan(0);
      // 目标组织里的**同事**必须出现。只有自己出现的话，用户会以为这是一次私人转存。
      expect(item.willBeVisibleTo.map((s) => s.id)).toContain(fx.colleague);
    }
  });

  it("预览**不写任何东西到目标组织**——它是一次询问，不是一次半途的导出", async () => {
    await preview(fx.artifactIds);
    expect(await copiedCount()).toBe(0);
  });

  it("反证：可见性来自目标组织而不是本地组织", async () => {
    // 本地组织恒为单人（I-3）。如果实现拿错了一侧，可见性里就只会有 owner 自己，
    // 而那正是最容易看漏的错——它不报错，只是把一个「40 个人能读」的决定
    // 显示成「只有你自己」。
    const r = await preview(fx.artifactIds);
    const body = (await r.json()) as { items: { willBeVisibleTo: { id: string }[] }[] };
    const ids = body.items[0]!.willBeVisibleTo.map((s) => s.id);
    expect(ids).toContain(fx.colleague);
    expect(ids.length, "只看到一个人——很可能读的是本地组织的成员表").toBeGreaterThan(1);
  });
});

/* ═════════════════ 门：没有确认过的预览就没有导出 ═════════════════ */

describe("导出必须出示一份被确认过的预览", () => {
  it("伪造的令牌被拒，且**在任何东西被复制之前**", async () => {
    const r = await doExport(fx.artifactIds, "xprv-made-up");
    expect(r.status).toBe(409);
    expect((await r.json()) as { reasonCode: string }).toMatchObject({
      reasonCode: "EXPORT_PREVIEW_REQUIRED",
    });
    expect(await copiedCount(), "被拒了，但东西已经过去了").toBe(0);
  });

  it("令牌**一次性**：同一个令牌导第二次被拒", async () => {
    const token = await tokenFor(fx.artifactIds);
    expect((await doExport(fx.artifactIds, token)).status).toBe(200);
    const again = await doExport(fx.artifactIds, token);
    expect(again.status).toBe(409);
    // 第二次一件都没多。「一次确认，两份副本」是这条门控存在的全部理由。
    expect(await copiedCount()).toBe(fx.artifactIds.length);
  });

  it("并发地花同一个令牌，只有一个能成——这是条件 UPDATE 而不是先读后写", async () => {
    // 先读后写的版本在这里会让两个请求都看到「没用过」，于是一次人工确认产生两份副本，
    // 而且不报任何错。这一条是那个失效模式的直接反证。
    const token = await tokenFor(fx.artifactIds);
    const results = await Promise.all([
      doExport(fx.artifactIds, token),
      doExport(fx.artifactIds, token),
    ]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok.length, "两次都成了——令牌不是一次性的").toBe(1);
    // ⚠ loser 必须是**契约里的拒绝**，不是随便一个非 200：#1040 的删谓词反证实测，
    //   谓词删掉后 loser 撞的是下游副本冲突的 500，本条按旧写法（只数 200）照样绿。
    //   钉住 409 + 错误码之后，「loser 是被这道门拒掉的」才是被断言过的事实。
    const loser = results.find((r) => r.status !== 200)!;
    expect(loser.status).toBe(409);
    expect((await loser.json()) as { reasonCode: string }).toMatchObject({
      reasonCode: "EXPORT_PREVIEW_REQUIRED",
    });
    expect(await copiedCount()).toBe(fx.artifactIds.length);
  });

  it("令牌**不能换内容**：确认时看到两件，提交时只导一件，被拒", async () => {
    const token = await tokenFor(fx.artifactIds);
    const r = await doExport([fx.artifactIds[0]!], token);
    expect(r.status).toBe(409);
    expect(await copiedCount()).toBe(0);
  });

  it("...反过来也一样：确认一件，提交两件", async () => {
    const token = await tokenFor([fx.artifactIds[0]!]);
    const r = await doExport(fx.artifactIds, token);
    expect(r.status).toBe(409);
    expect(await copiedCount()).toBe(0);
  });

  it("别人的令牌花不掉——一份确认属于**一个人**", async () => {
    const token = await tokenFor(fx.artifactIds);
    // colleague 不是本地组织的成员，所以他连门都进不来（404，不是 403：
    // 403 会确认那个本地组织存在）。
    const r = await doExport(fx.artifactIds, token, fx.colleague);
    expect(r.status).toBe(404);
    expect(await copiedCount()).toBe(0);
  });

  it("令牌**不能被退回未使用**——「重试上次失败的导出」那段代码写不出来", async () => {
    const token = await tokenFor(fx.artifactIds);
    await doExport(fx.artifactIds, token);
    // 迁移 0016 的触发器：consumed_at 只能被写一次，且不能改回 NULL。
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query("UPDATE local_export_previews SET consumed_at = NULL WHERE token = $1", [token]),
      ),
    ).rejects.toThrow(/EXPORT_PREVIEW_SPENT|EXPORT_PREVIEW_IMMUTABLE/);
  });

  it("冻结的清单**不能被改写**——否则一次旧的确认可以被指向新内容", async () => {
    const token = await tokenFor([fx.artifactIds[0]!]);
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query("UPDATE local_export_previews SET artifact_ids = $2::text[] WHERE token = $1",
          [token, fx.artifactIds]),
      ),
    ).rejects.toThrow(/EXPORT_PREVIEW_IMMUTABLE/);
  });

  it("过期的令牌不能用，而且**过期之后也不退回**", async () => {
    // ⚠ 陈旧令牌是**插出来**的，不是把现有那行改老的：迁移 0016 的触发器只允许改
    //   `consumed_at`，改 `created_at` 会被 EXPORT_PREVIEW_IMMUTABLE 挡下——
    //   而那条限制本身正是上一条断言要的东西，不能为了造夹具把它放松。
    // 有效期取自契约常量（LOCAL_EXPORT_PREVIEW_TTL_MS），这里不另写一个数字。
    const stale = `xprv-${PREFIX}-stale`;
    await asApp(LOCAL_ORG, (c) =>
      c.query(
        `INSERT INTO local_export_previews (token, org_id, to_org_id, actor_id, artifact_ids, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5::text[],
                 date_trunc('milliseconds', now()) - ($6 || ' milliseconds')::interval * 2,
                 date_trunc('milliseconds', now()) - ($6 || ' milliseconds')::interval)`,
        [stale, LOCAL_ORG, REAL_ORG, fx.owner, fx.artifactIds, String(C.LOCAL_EXPORT_PREVIEW_TTL_MS)],
      ),
    );

    const r = await doExport(fx.artifactIds, stale);
    expect(r.status).toBe(409);
    expect(await copiedCount()).toBe(0);

    // 「过期就还给你」的令牌等于没有过期。它已经被花掉了。
    const row = await asApp(LOCAL_ORG, (c) =>
      c.query<{ consumed_at: Date | null }>(
        "SELECT consumed_at FROM local_export_previews WHERE token = $1", [stale],
      ),
    );
    expect(row.rows[0]!.consumed_at).not.toBeNull();

    // 用 token 不放回去，那有效令牌还能用吗？——能。这是「不是全拒」的那一半。
    const fresh = await tokenFor(fx.artifactIds);
    expect((await doExport(fx.artifactIds, fresh)).status).toBe(200);
  });

  it("空清单要不到令牌——一次「导出零件东西」不是一次导出", async () => {
    const r = await preview([`${PREFIX}-does-not-exist`]);
    expect(r.status).toBe(409);
  });
});
