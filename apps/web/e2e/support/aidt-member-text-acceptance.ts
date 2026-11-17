import { randomUUID } from "node:crypto";
import { expect, type Page, type Request, type Response } from "@playwright/test";
import * as memberChat from "@repo/contracts/project-member-chat";

export type MemberTextAcceptanceRequest = (
  path: string, method: "GET" | "POST", body?: unknown,
) => Promise<{ status: number; data: unknown }>;
export type MemberTextAcceptanceOptions = {
  page: Page;
  projectId: string;
  /** Bind to this page's actual authenticated HTTP transport. No route fixtures. */
  request: MemberTextAcceptanceRequest;
  toStep?: 1 | 2 | 3 | 4 | 5 | 6;
  checkpoint?: (name: "topic-restored" | "channel-restored", page: Page) => Promise<void>;
};

function messageRow(page: Page, id: string) {
  return page.getByTestId("project-member-message").and(page.locator(`[data-message-id="${id}"]`));
}

async function authenticatedActor(page: Page, requestAuthorization?: string | null) {
  return page.evaluate(header => {
    try {
      const session = JSON.parse(localStorage.getItem("wsx.session") ?? "null");
      const token = localStorage.getItem("wsx.sessionToken");
      const ready = Boolean(token && typeof session?.userId === "string" && typeof session.currentOrgId === "string"
        && Array.isArray(session.orgs) && session.orgs.includes(session.currentOrgId) && Date.parse(session.expiresAt) > Date.now()
        && (session.version === 1 || (session.version === 2 && session.revision === localStorage.getItem("wsx.sessionCommit"))));
      return { ready, userId: ready ? String(session.userId) : null, orgId: ready ? String(session.currentOrgId) : null,
        requestSessionMatches: header === undefined || Boolean(token && header === `Bearer ${token}`) };
    } catch { return { ready: false, userId: null, orgId: null, requestSessionMatches: false }; }
  }, requestAuthorization);
}

async function submitMemberText(page: Page, projectId: string, text: string, expectedAuthorId: string, rootId?: string) {
  const path = `/projects/${encodeURIComponent(projectId)}/member-chat/messages`;
  await expect(page.getByTestId("project-member-input")).toBeEnabled();
  await page.getByTestId("project-member-input").fill(text);
  const [response] = await Promise.all([
    page.waitForResponse((value: Response) => {
      if (value.request().method() !== "POST" || !new URL(value.url()).pathname.endsWith(path)) return false;
      try { return value.request().postDataJSON()?.text === text; } catch { return false; }
    }),
    page.getByTestId("project-member-send").click(),
  ]);
  expect([200, 201], "member UI POST must receive a real success response").toContain(response.status());
  const actor = await authenticatedActor(page, await response.request().headerValue("authorization"));
  // Assert only the boolean comparison, so a mismatch cannot dump either token.
  expect(actor.ready && actor.requestSessionMatches, "UI request must use the current committed authenticated session").toBe(true);
  expect(actor.userId).toBe(expectedAuthorId);
  const request = memberChat.operations.postMessage.in.parse({ projectId, ...response.request().postDataJSON() });
  const receipt = memberChat.operations.postMessage.out.parse(await response.json());
  expect(request.projectId).toBe(projectId);
  expect(request.threadRootId).toBe(rootId);
  expect(receipt.message).toMatchObject({ projectId, text, clientMessageId: request.clientMessageId, threadRootId: rootId ?? null });
  expect(receipt.message.authorId).toBe(expectedAuthorId);
  await expect(messageRow(page, receipt.message.id)).toHaveAttribute("data-delivery", "stored");
  return { request, receipt };
}

async function readChannelSince(request: MemberTextAcceptanceRequest, path: string, start: number) {
  let after = start;
  const messages: memberChat.MemberMessage[] = [];
  // Dedicated acceptance projects should be small. Fail visibly instead of
  // treating a truncated timeline as proof that a client ID occurs only once.
  for (let index = 0; index < 10; index++) {
    const response = await request(`${path}?afterSequence=${after}&limit=100`, "GET");
    expect(response.status).toBe(200);
    const result = memberChat.operations.listMessages.out.parse(response.data);
    for (const message of result.items) {
      expect(message.sequence).toBeGreaterThan(after);
      messages.push(message);
    }
    expect(result.nextAfterSequence).toBeGreaterThanOrEqual(after);
    if (result.nextAfterSequence >= result.latestSequence) {
      expect(new Set(messages.map(message => message.id)).size).toBe(messages.length);
      return messages;
    }
    expect(result.nextAfterSequence).toBeGreaterThan(after);
    after = result.nextAfterSequence;
  }
  throw new Error("Member text readback exceeded bounded acceptance pagination; uniqueness was not established");
}

/**
 * Call only after native services/login and a dedicated writable AIDT group
 * already exist, while this page is on one of that group's six steps. This
 * helper neither starts services nor logs in, navigates with page.goto, changes
 * viewport, intercepts HTTP, or installs a supplier/model fixture.
 *
 * It sends two clearly labelled acceptance texts via the real global member UI,
 * then replays their exact IDs through the supplied real HTTP transport. The
 * resulting readback proves one persisted record per ID, not delivery/read
 * receipts, online presence, unread state, model quality or classroom acceptance.
 * Only the two unsent drafts created here are cleared after their restoration
 * assertions. The page finishes on toStep with the global plugin closed.
 */
async function runMemberTextAcceptance(options: MemberTextAcceptanceOptions) {
  const { page, projectId, request, checkpoint } = options;
  const actor = await authenticatedActor(page);
  expect(actor.ready, "a real committed authenticated session is required").toBe(true);
  expect(actor.userId).toBeTruthy();
  const location = new URL(page.url());
  expect(location.pathname).toBe(`/aidt/${encodeURIComponent(projectId)}`);
  const fromStep = Number(location.searchParams.get("step"));
  expect(Number.isInteger(fromStep) && fromStep >= 1 && fromStep <= 6).toBe(true);
  const toStep = options.toStep ?? (fromStep === 1 ? 2 : 1);
  expect(toStep).not.toBe(fromStep);
  await expect(page.getByTestId("aidt-stage-navigation")).toBeVisible();

  const panel = page.getByTestId("global-member-chat-panel");
  const trigger = page.getByTestId("global-member-chat-open");
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(panel).toBeVisible();
  const project = page.getByTestId("global-member-chat-project");
  if (await project.inputValue() !== projectId) await project.selectOption(projectId);
  await expect(project).toHaveValue(projectId);
  // Do not replace a caller's existing channel or topic draft.
  await expect(page.getByTestId("project-member-topic-close")).toHaveCount(0);
  await expect(page.getByTestId("project-member-input")).toBeEnabled();
  await expect(page.getByTestId("project-member-input")).toHaveValue("");
  const path = `/projects/${encodeURIComponent(projectId)}/member-chat/messages`;
  const initial = await request(`${path}?limit=1`, "GET");
  expect(initial.status).toBe(200);
  const baseline = memberChat.operations.listMessages.out.parse(initial.data).latestSequence;
  const marker = randomUUID();
  const rootText = `自动化成员文字验收 ${marker}：请同组讨论访谈分工；不是实际访谈证据。`;
  const replyText = `自动化话题回复 ${marker}：只回复此条分工消息；不是 AI 任务。`;
  const channelDraft = `尚未发送的频道验收草稿 ${marker}`;
  const topicDraft = `尚未发送的话题验收草稿 ${marker}`;
  const root = await submitMemberText(page, projectId, rootText, actor.userId!);
  await page.getByTestId("project-member-input").fill(channelDraft);
  await page.getByTestId(`project-member-topic-${root.receipt.message.id}`).click();
  await expect(page.getByTestId("project-member-topic-root")).toHaveAttribute("data-message-id", root.receipt.message.id);
  await expect(page.getByTestId("project-member-input")).toHaveValue("");
  const reply = await submitMemberText(page, projectId, replyText, actor.userId!, root.receipt.message.id);
  expect(reply.receipt.message.authorId).toBe(root.receipt.message.authorId);
  await expect(page.getByTestId("project-member-replies").getByTestId(`project-member-topic-${reply.receipt.message.id}`)).toHaveCount(0);
  await page.getByTestId("project-member-input").fill(topicDraft);
  await page.getByTestId("global-member-chat-close").click();
  await expect(panel).not.toBeVisible();

  const desktopStep = page.getByTestId(`aidt-stage-desktop-${toStep}`);
  if (await desktopStep.isVisible()) await desktopStep.click();
  else {
    const mobile = page.getByTestId("aidt-mobile-steps");
    if (await mobile.getAttribute("open") === null) await mobile.locator("summary").click();
    await page.getByTestId(`aidt-stage-mobile-${toStep}`).click();
  }
  await expect(page).toHaveURL(url => url.pathname === `/aidt/${encodeURIComponent(projectId)}` && url.searchParams.get("step") === String(toStep));
  await expect(panel).not.toBeVisible();
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(project).toHaveValue(projectId);
  await expect(page.getByTestId("project-member-topic-root")).toHaveAttribute("data-message-id", root.receipt.message.id);
  await expect(page.getByTestId("project-member-input")).toBeEnabled();
  await expect(page.getByTestId("project-member-input")).toHaveValue(topicDraft);
  await expect(messageRow(page, reply.receipt.message.id)).toHaveAttribute("data-delivery", "stored");
  await checkpoint?.("topic-restored", page);
  await page.getByTestId("project-member-topic-close").click();
  await expect(page.getByTestId("project-member-input")).toHaveValue(channelDraft);
  await checkpoint?.("channel-restored", page);

  // Exact immutable UI requests exercise actual server idempotency. No new IDs
  // or alternate text are introduced to disguise a failed/lost receipt.
  for (const sent of [root, reply]) {
    const replay = await request(path, "POST", sent.request);
    expect([200, 201]).toContain(replay.status);
    const receipt = memberChat.operations.postMessage.out.parse(replay.data);
    expect(receipt.replayed).toBe(true);
    expect(receipt.message).toEqual(sent.receipt.message);
  }
  const persisted = await readChannelSince(request, path, baseline);
  for (const sent of [root, reply]) {
    expect(persisted.filter(message => message.clientMessageId === sent.request.clientMessageId)).toEqual([sent.receipt.message]);
  }
  expect(persisted.some(message => message.text === channelDraft || message.text === topicDraft)).toBe(false);
  const topicResponse = await request(`${path}/${root.receipt.message.id}/replies?limit=100`, "GET");
  expect(topicResponse.status).toBe(200);
  const topic = memberChat.operations.listReplies.out.parse(topicResponse.data);
  expect(topic.root).toEqual(root.receipt.message);
  expect(topic.items.filter(message => message.clientMessageId === reply.request.clientMessageId)).toEqual([reply.receipt.message]);

  // Reopening the topic again also proves the two drafts do not overwrite one
  // another. Clear only these generated drafts so later native steps stay clean.
  await page.getByTestId(`project-member-topic-${root.receipt.message.id}`).click();
  await expect(page.getByTestId("project-member-input")).toBeEnabled();
  await expect(page.getByTestId("project-member-input")).toHaveValue(topicDraft);
  await page.getByTestId("project-member-input").fill("");
  await page.getByTestId("project-member-topic-close").click();
  await expect(page.getByTestId("project-member-input")).toHaveValue(channelDraft);
  await page.getByTestId("project-member-input").fill("");
  await page.getByTestId("global-member-chat-close").click();
  await expect(panel).not.toBeVisible();
  return {
    projectId, fromStep, toStep, root: root.receipt.message, reply: reply.receipt.message,
    uniqueClientMessageCounts: { root: 1, reply: 1 },
    exactRequestReplay: true, channelDraftRestored: true, topicDraftRestored: true,
    draftPersistenceScope: "same authenticated page session; no reload or browser restart",
  };
}

/** Keep request observation local to this invocation, including stage changes. */
export async function acceptAidtMemberText(options: MemberTextAcceptanceOptions) {
  const generationRequestPaths: string[] = [];
  const observe = (request: Request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (/\/agent\/[^/]+\/run$/.test(path) || /\/pm-designs\/[^/]+\/chat$/.test(path)
      || /\/chat\/threads\/[^/]+\/(?:messages|queued-messages)$/.test(path)) generationRequestPaths.push(path);
  };
  options.page.on("request", observe);
  try {
    const evidence = await runMemberTextAcceptance(options);
    expect(generationRequestPaths, "member text and stage navigation must not send AI generation requests").toEqual([]);
    return { ...evidence, generationRequestPaths };
  } finally { options.page.off("request", observe); }
}
