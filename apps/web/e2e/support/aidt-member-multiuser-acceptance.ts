import { randomBytes, randomUUID } from "node:crypto";
import { expect, type Browser, type Page, type Request } from "@playwright/test";
import * as identity from "@repo/contracts/identity";
import * as orgAdmin from "@repo/contracts/org-admin";
import * as project from "@repo/contracts/project";
import * as memberChat from "@repo/contracts/project-member-chat";

export type MemberMultiuserOptions = {
  owner: Page;
  browser: Browser;
  apiOrigin: string;
  projectId: string;
  checkpoint?: (phase: string) => Promise<void>;
};
type Reply = { status: number; data: unknown };

/** Actual browser fetch, with only the current browser's authenticated bearer.
 * Return values never contain an echoed request or the credential itself. */
async function api(page: Page, apiOrigin: string, path: string, method = "GET", body?: unknown): Promise<Reply> {
  return page.evaluate(async input => {
    const token = localStorage.getItem("wsx.sessionToken");
    if (!token) throw new Error("Authenticated browser session is required");
    const response = await fetch(`${input.apiOrigin}${input.path}`, { method: input.method,
      headers: { authorization: `Bearer ${token}`, ...(input.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) });
    return { status: response.status, data: await response.json() };
  }, { apiOrigin, path, method, body });
}
function success(reply: Reply, stage: string) {
  if (![200, 201].includes(reply.status)) {
    const reason = memberChat.Reason.safeParse((reply.data as { reasonCode?: unknown } | null)?.reasonCode);
    throw new Error(`Real multiuser acceptance blocked at ${stage}: HTTP ${reply.status}${reason.success ? ` ${reason.data}` : ""}`);
  }
}
async function actor(page: Page) {
  return page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("wsx.session") ?? "null");
    if (!value?.userId || !value.currentOrgId || !localStorage.getItem("wsx.sessionToken")
      || Date.parse(value.expiresAt) <= Date.now()
      || (value.version === 2 && value.revision !== localStorage.getItem("wsx.sessionCommit"))) {
      throw new Error("Current committed native session is required");
    }
    return { userId: String(value.userId), orgId: String(value.currentOrgId) };
  });
}
async function openChannel(page: Page, projectId: string) {
  await page.bringToFront();
  const trigger = page.getByTestId("global-member-chat-open");
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(page.getByTestId("global-member-chat-panel")).toBeVisible();
  const select = page.getByTestId("global-member-chat-project");
  if (await select.inputValue() !== projectId) await select.selectOption(projectId);
  await expect(select).toHaveValue(projectId);
  await expect(page.getByTestId("project-member-topic-close")).toHaveCount(0);
  await expect(page.getByTestId("project-member-input")).toBeEnabled();
  await expect(page.getByTestId("project-member-input")).toHaveValue("");
}
function row(page: Page, id: string) {
  return page.getByTestId("project-member-message").and(page.locator(`[data-message-id="${id}"]`));
}
async function send(page: Page, projectId: string, userId: string, text: string, rootId?: string) {
  await page.bringToFront();
  if (rootId) await expect(page.getByTestId("project-member-topic-root")).toHaveAttribute("data-message-id", rootId);
  else await expect(page.getByTestId("project-member-topic-close")).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: rootId ? "回复此话题" : "发给项目成员", exact: true });
  const submit = page.getByRole("button", { name: rootId ? "发送话题回复" : "发送给项目成员", exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill(text);
  await expect(composer).toHaveValue(text);
  await expect(submit).toBeEnabled();
  const path = `/projects/${encodeURIComponent(projectId)}/member-chat/messages`;
  const [response] = await Promise.all([
    page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith(path) && response.request().postDataJSON()?.text === text),
    submit.click(),
  ]);
  expect([200, 201]).toContain(response.status());
  // Compare bearer equality inside the browser, return only a boolean.
  const sameSession = await page.evaluate(header => {
    const token = localStorage.getItem("wsx.sessionToken");
    return Boolean(token && header === `Bearer ${token}`);
  }, await response.request().headerValue("authorization"));
  expect(sameSession, "real UI send uses its own authenticated session").toBe(true);
  expect((await actor(page)).userId).toBe(userId);
  const input = memberChat.operations.postMessage.in.parse({ projectId, ...response.request().postDataJSON() });
  const receipt = memberChat.operations.postMessage.out.parse(await response.json());
  expect(input.threadRootId).toBe(rootId);
  expect(receipt.message).toMatchObject({ projectId, authorId: userId, text, clientMessageId: input.clientMessageId, threadRootId: rootId ?? null });
  await expect(row(page, receipt.message.id)).toHaveAttribute("data-delivery", "stored");
  return { input, message: receipt.message };
}
async function readSince(page: Page, apiOrigin: string, path: string, from: number) {
  let cursor = from;
  const result: memberChat.MemberMessage[] = [];
  for (let index = 0; index < 10; index++) {
    const response = await api(page, apiOrigin, `${path}?afterSequence=${cursor}&limit=100`);
    success(response, "canonical message readback");
    const pageResult = memberChat.operations.listMessages.out.parse(response.data);
    result.push(...pageResult.items);
    if (pageResult.nextAfterSequence >= pageResult.latestSequence) return result;
    expect(pageResult.nextAfterSequence).toBeGreaterThan(cursor);
    cursor = pageResult.nextAfterSequence;
  }
  throw new Error("Multiuser uniqueness readback exceeded bounded pagination");
}

/** Existing, normally authenticated project members only. No account, invitation or membership writes. */
export async function acceptAidtExistingMemberPair({ owner, member, apiOrigin, projectId, privateProjectId }: {
  owner: Page; member: Page; apiOrigin: string; projectId: string; privateProjectId: string;
}) {
  const first = await actor(owner), second = await actor(member);
  expect(first.orgId).toBe(second.orgId); expect(first.userId).not.toBe(second.userId);
  expect(privateProjectId).not.toBe(projectId);
  const memberships = await api(owner, apiOrigin, `/projects/${projectId}/collaborators`);
  success(memberships, "existing member pair authoritative membership");
  const members = project.operations.listNonWorkshopMembers.out.parse(memberships.data).members;
  expect(members).toEqual(expect.arrayContaining([
    expect.objectContaining({ userId: first.userId, role: "owner" }),
    expect.objectContaining({ userId: second.userId, role: "collaborator" }),
  ]));
  await openChannel(owner, projectId); await openChannel(member, projectId);
  const path = `/projects/${projectId}/member-chat/messages`, initial = await api(owner, apiOrigin, `${path}?limit=1`);
  success(initial, "existing pair channel baseline");
  const baseline = memberChat.operations.listMessages.out.parse(initial.data).latestSequence, marker = randomUUID();
  const a = await send(owner, projectId, first.userId, `双账号验收 ${marker}：成员A讨论分工，合成材料非研究结论。`);
  await member.bringToFront(); await expect(row(member, a.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
  const b = await send(member, projectId, second.userId, `双账号验收 ${marker}：成员B提出不同分工。`);
  await owner.bringToFront(); await expect(row(owner, b.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
  await member.bringToFront(); await member.getByTestId(`project-member-topic-${a.message.id}`).click();
  const replyB = await send(member, projectId, second.userId, `双账号验收 ${marker}：成员B只回复A这条话题。`, a.message.id);
  await owner.bringToFront(); await owner.getByTestId(`project-member-topic-${a.message.id}`).click();
  await expect(row(owner, replyB.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
  await owner.getByTestId("project-member-topic-close").click();
  await owner.getByTestId(`project-member-topic-${b.message.id}`).click();
  const replyA = await send(owner, projectId, first.userId, `双账号验收 ${marker}：成员A只回复B这条话题。`, b.message.id);
  await member.bringToFront(); await member.getByTestId("project-member-topic-close").click();
  await member.getByTestId(`project-member-topic-${b.message.id}`).click();
  await expect(row(member, replyA.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
  await expect(member.getByTestId("project-member-replies").getByTestId(`project-member-topic-${replyA.message.id}`)).toHaveCount(0);
  const sent = [a, b, replyB, replyA];
  for (const reader of [owner, member]) {
    const persisted = await readSince(reader, apiOrigin, path, baseline);
    for (const item of sent) expect(persisted.filter(message => message.clientMessageId === item.input.clientMessageId)).toEqual([item.message]);
  }
  const privateMembers = await api(owner, apiOrigin, `/projects/${privateProjectId}/collaborators`);
  success(privateMembers, "private project existing ownership");
  const privateList = project.operations.listNonWorkshopMembers.out.parse(privateMembers.data).members;
  expect(privateList).toContainEqual(expect.objectContaining({ userId: first.userId, role: "owner" }));
  expect(privateList.some(item => item.userId === second.userId)).toBe(false);
  const privatePath = `/projects/${privateProjectId}/member-chat/messages`, canaryText = `仅限私有组的合成标记 ${marker}`;
  const created = await api(owner, apiOrigin, privatePath, "POST", { projectId: privateProjectId, clientMessageId: randomUUID(), text: canaryText });
  success(created, "normal owner-only canary");
  const canary = memberChat.operations.postMessage.out.parse(created.data).message;
  const denied = [await api(member, apiOrigin, privatePath), await api(member, apiOrigin, `${privatePath}/${canary.id}/replies`),
    await api(member, apiOrigin, privatePath, "POST", { projectId: privateProjectId, clientMessageId: randomUUID(), text: `必须拒绝的跨组写入 ${marker}` })];
  for (const response of denied) {
    expect(response.status).toBe(404); expect((response.data as { reasonCode?: unknown }).reasonCode).toBe("NOT_FOUND");
    expect(JSON.stringify(response.data)).not.toContain(canaryText);
    for (const field of ["items", "message", "root", "text"]) expect(response.data).not.toHaveProperty(field);
  }
  const privateRead = await api(owner, apiOrigin, `${privatePath}?limit=100`); success(privateRead, "private canary remains alone");
  expect(memberChat.operations.listMessages.out.parse(privateRead.data).items).toEqual([canary]);
  return { orgId: first.orgId, projectId, privateProjectId, authors: [first.userId, second.userId], messages: sent.map(item => item.message),
    actualMemberships: members, oneRecordPerClientIdForBothReaders: true, nonmemberDeniedStatuses: denied.map(item => item.status),
    ordinaryExistingAccounts: true, accountsCreated: false, invitationsCreated: false, orgRoleOrBalanceChanged: false };
}

/** PROPOSAL ONLY until root integrates and executes on its isolated native stack.
 * Account creation uses the existing one-use ordinary org invitation API, never
 * test identities, SQL, verification-secret signing, localStorage injection or
 * a fixture mailer. Link activation is the product's existing no-mail flow (the
 * recorded OA12 boundary); it does not establish control of an email inbox.
 *
 * Writes are limited to a new ordinary account in the owned isolated test org,
 * its collaborator membership in projectId, a new owner-only rejection project,
 * four human UI messages and one private canary. No role elevation or global
 * policy mutation. Invite is revoked and second browser context closed finally.
 * Account/messages intentionally remain in the owned test data for audit.
 */
export async function acceptAidtMemberMultiuser(options: MemberMultiuserOptions) {
  const { owner, browser, apiOrigin, projectId, checkpoint } = options;
  const apiUrl = new URL(apiOrigin), webUrl = new URL(owner.url());
  if (!process.env.WORKSPACEX_ISOLATION_ID || apiUrl.protocol !== "http:" || apiUrl.hostname !== "127.0.0.1"
    || webUrl.hostname !== "127.0.0.1" || webUrl.protocol !== "http:") throw new Error("Owned loopback native acceptance only");
  const ownerActor = await actor(owner);
  const id = await api(owner, apiOrigin, `/identity/me?orgId=${encodeURIComponent(ownerActor.orgId)}`);
  success(id, "actual organization identity preflight");
  if (identity.operations.resolveIdentity.out.parse(id.data).orgRole !== "admin") {
    throw new Error("Second-account setup blocked: current local account is not an actual organization admin");
  }
  const existing = await api(owner, apiOrigin, `/projects/${encodeURIComponent(projectId)}/collaborators`);
  success(existing, "project owner preflight");
  if (!project.operations.listNonWorkshopMembers.out.parse(existing.data).members.some(member => member.userId === ownerActor.userId && member.role === "owner")) {
    throw new Error("Second-account setup blocked: caller must own the dedicated acceptance project");
  }

  const context = await browser.newContext({ baseURL: webUrl.origin, viewport: { width: 1280, height: 900 } });
  let linkId: string | undefined;
  let inviteRevoked = false;
  const generationRequests: string[] = [];
  const watch = (request: Request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (/\/agent\/[^/]+\/run$/.test(path) || /\/pm-designs\/[^/]+\/chat$/.test(path)
      || /\/chat\/threads\/[^/]+\/(?:messages|queued-messages)$/.test(path))) generationRequests.push(path);
  };
  owner.on("request", watch);
  try {
    const suffix = randomUUID(), password = randomBytes(24).toString("base64url");
    const email = `aidt-multi-${suffix}@example.test`;
    const issued = await api(owner, apiOrigin, `/organizations/${encodeURIComponent(ownerActor.orgId)}/invite-links`, "POST",
      { orgId: ownerActor.orgId, orgRole: "consultant", expiry: "1d", maxUses: 1 });
    success(issued, "ordinary one-use invitation creation");
    const invitation = orgAdmin.operations.createOrgInviteLink.out.parse(issued.data);
    linkId = invitation.linkId;
    if (invitation.status !== "active" || !invitation.linkToken) throw new Error("Second-account setup blocked: ordinary invitation was not activated");
    const activatedResponse = await context.request.post(`${apiOrigin}${orgAdmin.operations.activateViaOrgInviteLink.path}`, {
      data: { token: invitation.linkToken, email, profile: { name: "自动化多人验收成员", password } },
    });
    if (![200, 201].includes(activatedResponse.status())) throw new Error(`Second-account activation blocked: HTTP ${activatedResponse.status()} (quota/auth details require private review)`);
    const activated = orgAdmin.operations.activateViaOrgInviteLink.out.parse(await activatedResponse.json());
    expect(activated.orgId).toBe(ownerActor.orgId);
    expect(activated.orgRole).toBe("consultant");
    expect(activated.userId).not.toBe(ownerActor.userId);
    const revoked = await api(owner, apiOrigin, `/organizations/${encodeURIComponent(ownerActor.orgId)}/invite-links/${encodeURIComponent(linkId)}/revoke`, "POST", { orgId: ownerActor.orgId, linkId });
    success(revoked, "invitation revocation");
    expect(orgAdmin.operations.revokeOrgInviteLink.out.parse(revoked.data).status).toBe("revoked");
    inviteRevoked = true;

    const added = await api(owner, apiOrigin, `/projects/${encodeURIComponent(projectId)}/collaborators`, "POST", { projectId, userId: activated.userId, role: "collaborator" });
    success(added, "ordinary project collaborator addition");
    expect(project.operations.addNonWorkshopMember.out.parse(added.data)).toMatchObject({ projectId, userId: activated.userId, role: "collaborator" });
    const second = await context.newPage();
    second.on("request", watch);
    await second.goto("/login");
    await second.getByTestId("login-email").fill(email);
    await second.getByTestId("login-password").fill(password);
    await second.getByTestId("login-submit").click();
    await expect(second).toHaveURL(/\/home$/, { timeout: 60_000 });
    expect(await actor(second)).toEqual({ orgId: ownerActor.orgId, userId: activated.userId });
    await second.goto(`/aidt/${encodeURIComponent(projectId)}?step=1&tool=outcome`);
    await expect(second.getByTestId("aidt-workspace")).toBeVisible();
    await openChannel(owner, projectId);
    await openChannel(second, projectId);
    const path = `/projects/${encodeURIComponent(projectId)}/member-chat/messages`;
    const before = await api(owner, apiOrigin, `${path}?limit=1`);
    success(before, "channel baseline");
    const baseline = memberChat.operations.listMessages.out.parse(before.data).latestSequence;

    const ownerRoot = await send(owner, projectId, ownerActor.userId, `多人验收 ${suffix}：第一位成员请对方讨论分工，非访谈证据。`);
    await second.bringToFront();
    await expect(row(second, ownerRoot.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
    const secondRoot = await send(second, projectId, activated.userId, `多人验收 ${suffix}：第二位成员提出不同分工，非研究结论。`);
    await owner.bringToFront();
    await expect(row(owner, secondRoot.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
    await second.bringToFront();
    await second.getByTestId(`project-member-topic-${ownerRoot.message.id}`).click();
    const secondReply = await send(second, projectId, activated.userId, `多人验收 ${suffix}：第二位成员单层回复第一条。`, ownerRoot.message.id);
    await owner.bringToFront();
    await owner.getByTestId(`project-member-topic-${ownerRoot.message.id}`).click();
    await expect(row(owner, secondReply.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
    await owner.bringToFront();
    await owner.getByTestId("project-member-topic-close").click();
    await owner.bringToFront();
    await owner.getByTestId(`project-member-topic-${secondRoot.message.id}`).click();
    const ownerReply = await send(owner, projectId, ownerActor.userId, `多人验收 ${suffix}：第一位成员单层回复第二条。`, secondRoot.message.id);
    await second.bringToFront();
    await second.getByTestId("project-member-topic-close").click();
    await second.bringToFront();
    await second.getByTestId(`project-member-topic-${secondRoot.message.id}`).click();
    await expect(row(second, ownerReply.message.id)).toHaveAttribute("data-delivery", "stored", { timeout: 15_000 });
    await checkpoint?.("two-browser-channel-and-topic-mutual-readback");
    const sent = [{ page: owner, value: ownerRoot }, { page: second, value: secondRoot }, { page: second, value: secondReply }, { page: owner, value: ownerReply }];
    for (const item of sent) {
      const replayed = await api(item.page, apiOrigin, path, "POST", item.value.input);
      success(replayed, "actual same-author idempotent replay");
      const replay = memberChat.operations.postMessage.out.parse(replayed.data);
      expect(replay.replayed).toBe(true);
      expect(replay.message).toEqual(item.value.message);
    }
    for (const viewer of [owner, second]) {
      const persisted = await readSince(viewer, apiOrigin, path, baseline);
      for (const item of sent) expect(persisted.filter(message => message.clientMessageId === item.value.input.clientMessageId)).toEqual([item.value.message]);
    }

    const created = await api(owner, apiOrigin, project.operations.createProject.path, "POST", { orgId: ownerActor.orgId, name: `非成员拒绝验收 ${suffix}`, kind: "general", blueprintVersionId: null });
    success(created, "new owner-only rejection project creation");
    // Existing registered P3 gap: createProject does not fabricate provenanceEventId.
    const privateProjectId = project.operations.createProject.out.omit({ provenanceEventId: true }).parse(created.data).id;
    const privateOwner = await api(owner, apiOrigin, `/projects/${privateProjectId}/collaborators`, "POST", { projectId: privateProjectId, userId: ownerActor.userId, role: "owner" });
    success(privateOwner, "rejection project actual owner membership");
    const privatePath = `/projects/${privateProjectId}/member-chat/messages`, privateText = `同组织但未入组的私有验收标记 ${suffix}`;
    const canary = await api(owner, apiOrigin, privatePath, "POST", { projectId: privateProjectId, clientMessageId: randomUUID(), text: privateText });
    success(canary, "owner-only channel canary");
    const privateMessage = memberChat.operations.postMessage.out.parse(canary.data).message;
    const denied = [
      await api(second, apiOrigin, privatePath),
      await api(second, apiOrigin, `${privatePath}/${privateMessage.id}/replies`),
      await api(second, apiOrigin, privatePath, "POST", { projectId: privateProjectId, clientMessageId: randomUUID(), text: `必须拒绝的跨组写入 ${suffix}` }),
    ];
    for (const response of denied) {
      expect(response.status).toBe(404);
      expect((response.data as { reasonCode?: unknown }).reasonCode).toBe("NOT_FOUND");
      expect(JSON.stringify(response.data).includes(privateText)).toBe(false);
      for (const field of ["items", "message", "root", "text"]) expect(response.data).not.toHaveProperty(field);
    }
    const privateRead = await api(owner, apiOrigin, `${privatePath}?limit=100`);
    success(privateRead, "rejection project authoritative readback");
    expect(memberChat.operations.listMessages.out.parse(privateRead.data).items).toEqual([privateMessage]);
    await owner.bringToFront();
    await owner.getByTestId("project-member-topic-close").click();
    await owner.getByTestId("global-member-chat-close").click();
    expect(generationRequests).toEqual([]);
    return { projectId, orgId: ownerActor.orgId, authors: [ownerActor.userId, activated.userId],
      messages: sent.map(item => item.value.message), oneRecordPerClientIdForBothReaders: true,
      privateProjectId, nonmemberDeniedStatuses: denied.map(response => response.status), invitationRevoked: inviteRevoked,
      secondAccountRole: "consultant", secondProjectRole: "collaborator", generationRequests,
      emailInboxOwnershipVerified: false, note: "real product shared-invite API; no supplier/identity fixture, SQL or email-proof bypass" };
  } finally {
    owner.off("request", watch);
    try {
      if (linkId && !inviteRevoked) {
        const revoked = await api(owner, apiOrigin, `/organizations/${encodeURIComponent(ownerActor.orgId)}/invite-links/${encodeURIComponent(linkId)}/revoke`, "POST", { orgId: ownerActor.orgId, linkId });
        success(revoked, "failed-run invitation cleanup");
      }
    } finally { await context.close(); }
  }
}
