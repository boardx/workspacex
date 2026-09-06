import { expect, type Page, type Response } from "@playwright/test";

/** New tasks are persisted immediately; rename uses the actual card menu. */
export async function createNamedWorkbenchThread(page: Page, title: string, projectId: string): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  const before = await page.request.get(`/__fullstack_api/chat/projects/${projectId}/threads`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(before.ok()).toBe(true);
  const previous = (await before.json()).groups.flatMap((group: {cards: Array<{id: string; status: string}>}) => group.cards) as Array<{id: string; status: string}>;
  const created: Response[] = [];
  const observeCreate = (response: Response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/chat/threads/mutate")
      && response.request().postDataJSON()?.op === "create") created.push(response);
  };
  page.on("response", observeCreate);
  let threadId: string;
  try {
    await page.getByTestId("chat-thread-create").click();
    await page.waitForURL(url => /^\/chat\/[^/]+$/.test(url.pathname) && url.searchParams.get("projectId") === projectId);
    threadId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
    await expect(page.getByTestId(`chat-thread-${threadId}`)).toHaveAttribute("data-selected", "true");
    if (created.length) {
      expect(created).toHaveLength(1);
      expect(created[0]!.ok()).toBe(true);
      expect((await created[0]!.json()).threadId).toBe(threadId);
    } else {
      // Reusing a real empty draft is supported. Never predict whether a POST
      // should occur from an initial, possibly still loading DOM snapshot.
      expect(previous.find(card => card.id === threadId)?.status).toBe("not-started");
    }
  } finally {
    page.off("response", observeCreate);
  }
  const card = page.getByTestId(`chat-thread-${threadId}`);
  await expect(card).toBeVisible();
  await card.locator("..").getByTestId("chat-thread-card-menu-trigger").click();
  await page.getByTestId("chat-thread-rename").click();
  await page.getByTestId("chat-thread-title-input").fill(title);
  await page.getByTestId("chat-thread-title-submit").click();
  await expect(card).toContainText(title);
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

