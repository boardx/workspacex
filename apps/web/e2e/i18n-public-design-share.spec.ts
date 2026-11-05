import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { designWorkbench as D, designPrototype as P } from "@repo/contracts";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
import { boardApi, boardLogin } from "./board-acceptance-support";

const operationPath = (path: string, id: string) => path.replace(":projectId", encodeURIComponent(id));
const RAW_HTML = "<main><h1>原始 HTML {title}</h1><p>Do not translate 用户内容</p></main>";
const FIRST: P.PrototypeNode = { type: "stack", id: "share-first", children: [
  { type: "text", id: "share-text", props: { content: "模型原文 {name}", variant: "body" } },
  { type: "button", id: "share-next", props: { label: "原始下一页", variant: "primary" } },
] };

// Existing seeded lane and its original timeout/retry policy. No route fulfillment,
// model response, session impersonation, or direct database writes are used.
for (const width of [1280, 375]) {
  test(`public design share real publication, locale/navigation and revocation ${width}`, async ({ page, browser, baseURL }, info) => {
    const token = await boardLogin(page, F.adminEmail, F.adminPassword);
    const created = D.operations.createProject.out.parse(await (await boardApi(page.request, token, "POST", D.operations.createProject.path, {
      name: `原始设计 {name} ${randomUUID()}`, template: "mobile", problem: "原始问题 {problem}",
    })).json());
    const id = created.project.id;
    // The canonical owner patch supports adding screens; create/updateProject do
    // not accept raw frame/prototype fields. This is setup through that real API.
    const ops = P.DesignPrototypePatch.parse([
      { op: "addScreen", at: 0, frame: "原始首页", root: FIRST },
      { op: "addScreen", at: 1, frame: "原始次页" },
      { op: "addScreen", at: 2, frame: "原始HTML", root: { type: "html", id: "share-html", props: { html: RAW_HTML } } },
      { op: "setLinks", screen: 0, links: [{ from: "share-next", to: 1 }] },
    ]);
    D.operations.patchPrototype.out.parse(await (await boardApi(page.request, token, "POST", operationPath(D.operations.patchPrototype.path, id), { ops, summary: "Public share i18n acceptance setup" })).json());
    const published = D.operations.publishProject.out.parse(await (await boardApi(page.request, token, "POST", operationPath(D.operations.publishProject.path, id), { scope: "full" })).json());
    expect(published.project.share).not.toBeNull();
    const shareToken = published.project.share?.token;
    expect(shareToken).toBeTruthy();
    if (!shareToken) throw new Error("Owner publication must return its share token");
    const sharePath = D.operations.getSharedDesign.path.replace(":token", encodeURIComponent(shareToken));
    if (!baseURL) throw new Error("The existing seeded lane must provide baseURL");
    const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
    const visitor = await context.newPage();
    const reads: string[] = [];
    visitor.on("request", request => {
      if (request.method() === "GET" && new URL(request.url()).pathname.endsWith(sharePath)) {
        expect(request.headers()["authorization"]).toBeUndefined();
        reads.push(request.url());
      }
    });
    try {
      await visitor.goto(`/d/${encodeURIComponent(shareToken)}`);
      const view = visitor.getByTestId("shared-design-view");
      await expect(view).toBeVisible();
      await expect(visitor.getByTestId("shared-design-name")).toHaveText(created.project.name);
      await expect(visitor.getByTestId("shared-design-brief")).toContainText("原始问题 {problem}");
      await expect(view).toContainText("模型原文 {name}");
      const picker = visitor.getByTestId("language-switcher");
      await picker.selectOption("en");
      await expect(visitor.getByTestId("shared-design-meta")).toContainText("Read-only");
      await expect(visitor.getByTestId("shared-design-brief")).toContainText("Problem and goals");
      await visitor.screenshot({ path: info.outputPath(`share-en-${width}.png`), fullPage: true });
      const initialReads = reads.length;
      expect(initialReads).toBe(1);
      await visitor.getByRole("button", { name: "原始下一页", exact: true }).click();
      await expect(visitor.getByTestId("shared-design-frame-1")).toHaveAttribute("aria-pressed", "true");
      await expect(view).toContainText("This page could not be drawn.");
      const back = visitor.getByTestId("shared-design-back");
      const backElement = await back.elementHandle();
      await expect(back).toHaveText("Back");
      await picker.selectOption("zh-CN");
      await expect(back).toHaveText("返回");
      expect(await backElement!.evaluate(element => element.isConnected)).toBe(true);
      await expect(visitor.getByTestId("shared-design-frame-1")).toHaveAttribute("aria-pressed", "true");
      await visitor.screenshot({ path: info.outputPath(`share-zh-undrawn-${width}.png`), fullPage: true });
      await back.click();
      await expect(visitor.getByTestId("shared-design-frame-0")).toHaveAttribute("aria-pressed", "true");
      await visitor.getByTestId("shared-design-frame-2").click();
      const iframe = visitor.locator("iframe");
      await expect(iframe).toHaveAttribute("title", "页面预览");
      const iframeElement = await iframe.elementHandle();
      const srcdoc = await iframe.getAttribute("srcdoc");
      expect(srcdoc).toContain(RAW_HTML);
      await picker.selectOption("en");
      await expect(iframe).toHaveAttribute("title", "Page preview");
      expect(await iframe.getAttribute("srcdoc")).toBe(srcdoc);
      expect(await iframeElement!.evaluate(element => element.isConnected)).toBe(true);
      expect(reads).toHaveLength(initialReads);
      await visitor.screenshot({ path: info.outputPath(`share-en-html-${width}.png`), fullPage: true });
      for (const target of [visitor.getByTestId("shared-design-name"), visitor.getByTestId("shared-design-meta"), picker, visitor.locator("footer")]) {
        const box = await target.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      // Freeze proof: owner edit must not replace the anonymously served snapshot.
      D.operations.updateProject.out.parse(await (await boardApi(page.request, token, "PATCH", operationPath(D.operations.updateProject.path, id), { name: "后来修改的标题" })).json());
      await visitor.reload();
      await expect(visitor.getByTestId("shared-design-name")).toHaveText(created.project.name);
      D.operations.unpublishProject.out.parse(await (await boardApi(page.request, token, "DELETE", operationPath(D.operations.unpublishProject.path, id))).json());
      const revoked = visitor.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname.endsWith(sharePath));
      await visitor.reload();
      expect((await revoked).status()).toBe(404);
      const error = visitor.getByTestId("shared-design-error");
      await expect(error).toContainText("This share link cannot be opened");
      await expect(visitor.getByTestId("shared-design-retry")).toHaveCount(0);
      await visitor.screenshot({ path: info.outputPath(`share-en-revoked-${width}.png`), fullPage: true });
      await visitor.getByTestId("language-switcher").selectOption("zh-CN");
      await expect(error).toContainText("这条分享链接打不开");
      await expect(visitor.getByTestId("shared-design-retry")).toHaveCount(0);
      await visitor.screenshot({ path: info.outputPath(`share-zh-revoked-${width}.png`), fullPage: true });
    } finally {
      await context.close();
      await boardApi(page.request, token, "DELETE", operationPath(D.operations.unpublishProject.path, id));
    }
  });
}
