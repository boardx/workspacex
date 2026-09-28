/**
 * E9 放心（06-UX R4 / R2 M5）：面板常驻可见范围说明；另一个账号访问同一条记忆返回 404（与不存在逐字相同，不暴露资源是否存在），界面显示「无权查看」。
 *
 * - c1 「仅你可见」常驻：列表视图、关系图视图、刷新之后，面板头部都在；
 * - c2 另一个账号（同组织）请求这条记忆的来源：404，响应体与请求一条根本不存在的记忆逐字相同（除 traceId），且拿不到内容
 *   （rubric 修订 R5，人类 2026-09-27：「404（不暴露资源是否存在）」「我批准你可以改」；原判据是 403，会暴露「这条存在」）；
 * - c3 另一个账号打开这条记忆的链接（大脑页「去对话里看」的那种链接）：界面上写着「无权查看」，且看不到内容。
 */
import { expect, test } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { apiGet, claimIdOf, newThread, openMemoryPanel, tell } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;
const SECRET = "北极星项目的负责人是王芳";

test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000);
  j = await runJourney("E9", browser, async (ctx) => {
    ctx.step("登录，说一件事");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const thread = await newThread(page);
    await tell(page, thread, ["M1"]);
    const claimId = await claimIdOf(page, thread, SECRET);
    ctx.step("面板头部的可见范围");
    const panel = await openMemoryPanel(page);
    const read = async () => (await panel.getByTestId("kg-visibility").innerText().catch(() => "")).trim();
    const list = await read();
    await panel.getByTestId("kg-view-graph").click();
    const graph = await read();
    await ctx.shot("panel", panel);
    await page.reload();
    const panel2 = await openMemoryPanel(page);
    const reloaded = (await panel2.getByTestId("kg-visibility").innerText().catch(() => "")).trim();
    ctx.see("visibility", { list, graph, reloaded });

    ctx.step("另一个账号请求这条记忆");
    const other = await ctx.pageAs(KG_EVAL.other);
    const r = await apiGet(other, `/knowledge-graph/claims/${encodeURIComponent(claimId)}/sources`);
    const missing = await apiGet(other, `/knowledge-graph/claims/${encodeURIComponent(`${claimId}-does-not-exist`)}/sources`);
    const noTrace = (b: unknown) => JSON.stringify(b !== null && typeof b === "object" ? { ...(b as Record<string, unknown>), traceId: undefined } : b);
    ctx.see("otherApi", {
      status: r.status, leaked: JSON.stringify(r.body).includes(SECRET) || JSON.stringify(r.body).includes(claimId),
      missingStatus: missing.status, sameAsMissing: noTrace(r.body) === noTrace(missing.body),
    });
    ctx.step("另一个账号打开这条记忆的链接");
    await other.goto(`/chat/${encodeURIComponent(thread)}?memory=${encodeURIComponent(claimId)}`);
    await other.waitForTimeout(6_000);
    const body = await other.locator("body").innerText();
    ctx.see("otherUi", { saysNoAccess: body.includes("无权查看"), leaked: body.includes(SECRET) });
    await ctx.shot("other", other);
  });
});

test("[E9.c1] 记忆面板头部常驻「仅你可见」（列表、关系图、刷新后都在）", async ({}, testInfo) => {
  await attach(testInfo, j, ["panel"], { visibility: j.seen.visibility ?? null });
  const v = seen<{ list: string; graph: string; reloaded: string }>(j, "visibility");
  expect([v.list, v.graph, v.reloaded]).toEqual(["仅你可见", "仅你可见", "仅你可见"]);
});

test("[E9.c2] 另一个账号请求同一条记忆：404，与不存在的记忆逐字相同，且拿不到内容", async ({}, testInfo) => {
  await attach(testInfo, j, ["other"], { otherApi: j.seen.otherApi ?? null });
  const r = seen<{ status: number; leaked: boolean; missingStatus: number; sameAsMissing: boolean }>(j, "otherApi");
  expect(r.leaked).toBe(false);
  expect(r.status).toBe(404);
  expect(r.missingStatus).toBe(404);
  expect(r.sameAsMissing, "与请求一条不存在的记忆，响应应当无法区分").toBe(true);
});

test("[E9.c3] 另一个账号打开这条记忆的链接：界面显示「无权查看」，看不到内容", async ({}, testInfo) => {
  await attach(testInfo, j, ["other"], { otherUi: j.seen.otherUi ?? null });
  const u = seen<{ saysNoAccess: boolean; leaked: boolean }>(j, "otherUi");
  expect(u.leaked).toBe(false);
  expect(u.saysNoAccess).toBe(true);
});
