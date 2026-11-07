import type { Page, Route } from "@playwright/test";

/** CK-P8: mutate only the current getThread response; child polling stays untouched. */
export async function installArchivedThreadResponse(page: Page, threadUrl: string): Promise<() => Promise<void>> {
  const threadId = new URL(threadUrl, "http://fixture.invalid").pathname.split("/").at(-1);
  if (!threadId) throw new Error("CK-P8 requires the created thread URL");
  const pathname = `/chat/threads/${threadId}`;
  const matches = (url: URL) => url.pathname === pathname;
  const pending = new Set<Promise<void>>();
  const serve = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.method() !== "GET" || !matches(new URL(request.url()))) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    if (response.status() !== 200) {
      await route.fulfill({ response });
      return;
    }
    const body = await response.json();
    if (body?.thread === undefined) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({ response, json: { ...body, thread: { ...body.thread, archived: true } } });
  };
  const handler = async (route: Route): Promise<void> => {
    const work = serve(route);
    pending.add(work);
    try {
      await work;
    } finally {
      pending.delete(work);
    }
  };
  await page.route(matches, handler);
  return async () => {
    // Remove only this fixture's handler before draining; no new matching polls join it.
    await page.unroute(matches, handler);
    await Promise.all([...pending]);
  };
}
