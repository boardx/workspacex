import { expect, type Page } from "@playwright/test";

/** New tasks are persisted immediately; rename uses the actual card menu. */
export async function createNamedWorkbenchThread(page: Page, title: string, projectId: string): Promise<string> {
  const top = page.getByTestId("copilotkit-v2-thread-list").locator("button[data-selected]").first();
  const reusable = await top.count() > 0 && await top.getByTestId("chat-task-workbench-thread-status").getAttribute("data-status") === "not-started";
  let threadId = reusable ? (await top.getAttribute("data-testid"))!.slice("chat-thread-".length) : "";
  const created = reusable ? null : page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/chat/threads/mutate") && response.request().postDataJSON()?.op === "create");
  await page.getByTestId("chat-thread-create").click();
  if (created) {
    const response = await created;
    expect(response.ok()).toBe(true);
    threadId = (await response.json()).threadId;
  }
  expect(threadId).toBeTruthy();
  await page.waitForURL(url => url.pathname === `/chat/${encodeURIComponent(threadId)}` && url.searchParams.get("projectId") === projectId);
  const card = page.getByTestId(`chat-thread-${threadId}`);
  await expect(card).toBeVisible();
  await card.locator("..").getByTestId("chat-thread-card-menu-trigger").click();
  await page.getByTestId("chat-thread-rename").click();
  await page.getByTestId("chat-thread-title-input").fill(title);
  await page.getByTestId("chat-thread-title-submit").click();
  await expect(card).toContainText(title);
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  const detail = await page.request.get(`/__fullstack_api/chat/threads/${threadId}?projectId=${projectId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(detail.ok()).toBe(true);
  expect((await detail.json()).thread.projectId).toBe(projectId);
  return threadId;
}

export async function openWorkbenchRoster(page: Page): Promise<void> {
  await page.getByTestId("chat-task-workbench-inspector-tab-roster").click();
  await expect(page.getByTestId("chat-roster-edit")).toBeVisible();
}

