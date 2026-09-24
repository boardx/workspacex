/**
 * E4 有出处（06-UX R4）：回答里 100% 的记忆引用可点，点开就是原话，且原话被高亮。
 *
 * - c1 回答下方的每一个引用都点得开，打开的是那条记忆的原话（证据摘录逐字出自用户当时说的那句话）；
 * - c2 从原话「跳到原消息」：对话里那条消息滚到眼前并被高亮（带 `data-kg-source-highlight` 且看得出一圈强调——
 *   描边或阴影，不只是一个看不见的属性）；
 * - c3 跨会话也一样：新会话里用到的长期记忆，点开是**原会话**里的原话，跳过去、原消息被高亮。
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { KG_EVAL } from "./fixture";
import { claimIdOf, newThread, openMemoryPanel, say, sayText, tell } from "./eval-helpers";
import { attach, runJourney, seen, type Journal } from "./journey";

let j: Journal;

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const CHIP = "[data-testid^='kg-citation-']:not([data-testid='kg-citation-chips']):not([data-testid^='kg-citation-pending-']):not([data-testid^='kg-citation-conflict-'])";

interface ChipResult { readonly statement: string; readonly opened: boolean; readonly excerpt: string | null }

async function openEachChip(page: Page, block: Locator, originals: readonly string[]): Promise<ChipResult[]> {
  await block.getByTestId("kg-answer-footer").waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  const out: ChipResult[] = [];
  const chips = await block.locator(CHIP).all();
  for (const chip of chips) {
    const statement = (await chip.getAttribute("title")) ?? "";
    await chip.click();
    const drawer = page.getByTestId("kg-source-drawer");
    const opened = await drawer.getByTestId("kg-source-evidence-list").waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    let excerpt: string | null = null;
    if (opened) {
      const ev = drawer.locator("[data-testid^='kg-evidence-']:not([data-testid^='kg-evidence-jump-']):not([data-testid^='kg-evidence-revoked-'])").first();
      excerpt = (await ev.locator("p").first().innerText()).trim();
    }
    out.push({ statement, opened: opened && excerpt !== null && originals.some((o) => norm(o).includes(norm(excerpt!))), excerpt });
    if (opened) await drawer.getByTestId("kg-source-drawer-close").first().click();
  }
  return out;
}

/** 点「跳到原消息」，看对话里被高亮的那条：在不在眼前、是不是那句话、看不看得出强调。 */
async function jumpAndLook(page: Page, original: string): Promise<{ url: string; highlighted: boolean; inView: boolean; text: string | null; ring: string | null }> {
  const drawer = page.getByTestId("kg-source-drawer");
  await drawer.locator("[data-testid^='kg-evidence-jump-']").first().click();
  const target = page.locator("[data-kg-source-highlight]").first();
  const highlighted = await target.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
  if (!highlighted) return { url: page.url(), highlighted: false, inView: false, text: null, ring: null };
  const text = (await target.innerText()).trim();
  const inView = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  });
  const ring = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    const hasRing = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== "none" && s.boxShadow !== "");
    return hasRing ? `${s.outlineStyle} ${s.outlineWidth} / ${s.boxShadow}` : null;
  });
  return { url: page.url(), highlighted: norm(text).includes(norm(original)) || norm(original).includes(norm(text)), inView, text, ring };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  j = await runJourney("E4", browser, async (ctx) => {
    const original = sayText("M2");
    ctx.step("登录，在会话 A 里说一句带三件事的话");
    const page = await ctx.pageAs(KG_EVAL.owner);
    await page.goto("/chat");
    const threadA = await newThread(page);
    await tell(page, threadA, ["M2"]);
    ctx.step("问一个用得上它的问题");
    const turn = await say(page, "恒通物流的合同金额是多少？");
    const block = turn.answer.locator("xpath=..");
    ctx.step("逐个点回答下方的引用");
    const chips = await openEachChip(page, block, [original]);
    ctx.see("chips", chips);
    await ctx.shot("chips", block);
    ctx.step("点开一条，跳到原消息");
    await block.locator(CHIP).first().click();
    await page.getByTestId("kg-source-evidence-list").waitFor({ state: "visible", timeout: 10_000 });
    await ctx.shot("drawer", page.getByTestId("kg-source-drawer"));
    const jump = await jumpAndLook(page, original);
    ctx.see("jump", jump);
    await ctx.shot("jump", page.getByTestId("copilotkit-v2-messages"));

    ctx.step("把一条记到长期记忆（跨会话要用）");
    await page.goto(`/chat/${encodeURIComponent(threadA)}`);
    const claimId = await claimIdOf(page, threadA, "恒通物流的对接人是陈静");
    const panel = await openMemoryPanel(page);
    await panel.getByTestId("kg-promote-enter").click();
    await panel.getByTestId(`kg-claim-select-${claimId}`).check();
    await panel.getByTestId("kg-promote-submit").click();
    await expect(panel.getByTestId("kg-promotion-summary")).toBeVisible();

    ctx.step("会话 B：问它，点引用，跳回会话 A 的原话");
    const threadB = await newThread(page);
    const turnB = await say(page, "恒通物流那边的对接人是谁？");
    const blockB = turnB.answer.locator("xpath=..");
    const chipsB = await openEachChip(page, blockB, [original]);
    ctx.see("chipsB", chipsB);
    const personal = blockB.locator("[data-testid^='kg-from-personal-']");
    ctx.see("personalChip", (await personal.count()) > 0);
    const chipB = (await personal.count()) > 0 ? personal.first().locator("xpath=ancestor::button[1]") : blockB.locator(CHIP).first();
    await chipB.click();
    await page.getByTestId("kg-source-evidence-list").waitFor({ state: "visible", timeout: 10_000 });
    await ctx.shot("drawerB", page.getByTestId("kg-source-drawer"));
    const jumpB = await jumpAndLook(page, original);
    ctx.see("jumpB", { ...jumpB, landedInA: new URL(jumpB.url).pathname.endsWith(encodeURIComponent(threadA)) || jumpB.url.includes(threadA), fromB: threadB });
    await ctx.shot("jumpB", page);
  });
});

test("[E4.c1] 回答下方的每一个引用都点得开，打开的就是当时说的原话", async ({}, testInfo) => {
  await attach(testInfo, j, ["chips", "drawer"], { chips: j.seen.chips ?? null });
  const chips = seen<ChipResult[]>(j, "chips");
  expect(chips.length, "回答下方至少要有一个引用").toBeGreaterThan(0);
  expect(chips.filter((c) => !c.opened), "打不开或不是原话的引用").toEqual([]);
});

test("[E4.c2] 「跳到原消息」：原话那条消息滚到眼前，并且被高亮", async ({}, testInfo) => {
  await attach(testInfo, j, ["jump"], { jump: j.seen.jump ?? null });
  const jump = seen<{ highlighted: boolean; inView: boolean; ring: string | null }>(j, "jump");
  expect(jump.highlighted, "被高亮的应当是原话那条消息").toBe(true);
  expect(jump.inView, "它应当在眼前").toBe(true);
  expect(jump.ring, "高亮要看得出来（描边或阴影）").not.toBeNull();
});

test("[E4.c3] 跨会话：新会话里用到的长期记忆，点开是原会话的原话，跳过去原消息被高亮", async ({}, testInfo) => {
  await attach(testInfo, j, ["drawerB", "jumpB"], { chips: j.seen.chipsB ?? null, personalChip: j.seen.personalChip ?? null, jump: j.seen.jumpB ?? null });
  expect(seen<boolean>(j, "personalChip"), "新会话的回答里应当用到长期记忆").toBe(true);
  expect(seen<ChipResult[]>(j, "chipsB").every((c) => c.opened)).toBe(true);
  const jump = seen<{ highlighted: boolean; inView: boolean; ring: string | null; landedInA: boolean }>(j, "jumpB");
  expect(jump.landedInA, "应当跳回原会话").toBe(true);
  expect(jump.highlighted && jump.inView && jump.ring !== null, JSON.stringify(jump)).toBe(true);
});

