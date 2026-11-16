import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { chat, chatFileUpload, identity } from "@repo/contracts";
import { AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { z } from "zod";
import { SESSION_TOKEN_STORAGE_KEY } from "../lib/api-client";
import { SESSION_STORAGE_KEY } from "../components/session/session-provider";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
import { V2_SEND_WIRE } from "./chat-v2-send";
import { apiPath } from "./support/real-model-api";
import { acceptAidtMemberText } from "./support/aidt-member-text-acceptance";
import { aidtV2Api, createAidtV2Group, loginAidtV2, openAidtV2Outcome, readAidtV2Stage, saveAidtV2Stage } from "./support/aidt-v2-acceptance";
import { fillAidtV2Field } from "./support/aidt-v2-stage-cases";
import { aidtV2WireMetadata } from "./support/aidt-v2-wire-metadata";

// Discovery is safe. No browser, proof read, account action or generation occurs unless explicitly enabled.
test.skip(process.env.AIDT_NATIVE_DRAFT_ZERO !== "1", "Requires root GO and the fresh owner-attested zero-executor window");
const GuardProof = z.object({
  observedAt: z.string().datetime(), verifiedWhileActualLaunchWasZero: z.literal(true),
  apiOwner: z.object({ pid: z.number().int().positive(), startTicks: z.string().regex(/^\d+$/) }),
  webSource: z.string().regex(/^[a-f0-9]{40}$/),
  allGuards: z.object({ KERNEL_AGENT_RUN_AUTOSTART: z.literal("0"), KERNEL_SKILL_TRIALRUN_AUTOSTART: z.literal("0"),
    KERNEL_ATTACHMENT_EXTRACTION_AUTOSTART: z.literal("0"), KERNEL_THREAD_TITLE_MODEL_ENABLED: z.literal("0"),
    KERNEL_STANDARD_SCHEDULER: z.literal("0") }).catchall(z.literal("0")),
}).passthrough();
let zeroWindow: { source: string; proofSha256: string };
test.beforeAll(() => {
  expect(process.env.AIDT_NATIVE_DRAFT_ROOT_GO).toBe("zero-cost-window-approved");
  expect(process.env.WORKSPACEX_ISOLATION_ID).toBeTruthy();
  for (const origin of [REAL_MODEL_SMOKE.baseUrl, process.env.AIDT_V2_API_ORIGIN ?? ""]) {
    const url = new URL(origin); expect(url.protocol).toBe("http:"); expect(url.hostname).toBe("127.0.0.1");
    expect(url.username + url.password).toBe("");
  }
  const proofFile = process.env.AIDT_NATIVE_DRAFT_ZERO_PREFLIGHT ?? "";
  expect(isAbsolute(proofFile), "An actual owner-generated proof path is required").toBe(true);
  const bytes = readFileSync(proofFile), parsed = GuardProof.safeParse(JSON.parse(bytes.toString()));
  if (!parsed.success) throw new Error("AIDT_NATIVE_DRAFT_ZERO_WINDOW_PROOF_INVALID");
  const proof = parsed.data, age = Date.now() - Date.parse(proof.observedAt);
  expect(age >= -5_000 && age <= 300_000, "Zero-window proof must be fresh").toBe(true);
  expect(String(proof.apiOwner.pid)).toBe(process.env.AIDT_NATIVE_DRAFT_API_OWNER_PID);
  expect(proof.apiOwner.startTicks).toBe(process.env.AIDT_NATIVE_DRAFT_API_OWNER_START_TICKS);
  expect(proof.webSource).toBe(process.env.AIDT_NATIVE_DRAFT_EXPECTED_WEB_SOURCE);
  zeroWindow = { source: proof.webSource, proofSha256: createHash("sha256").update(bytes).digest("hex") };
});

type InterceptedRun = { clientMessageId: string; threadId: string; attachmentIds: string[]; selector: z.infer<typeof AidtContextSelector>; lastUserText: string };
function inspectRun(body: unknown): InterceptedRun {
  const parsed = z.object({ forwardedProps: z.object({ clientMessageId: z.string().uuid(), chatThreadId: z.string().min(1),
    attachmentIds: z.array(z.string()), aidtContext: AidtContextSelector }).passthrough(),
    messages: z.array(z.object({ role: z.string(), content: z.unknown() }).passthrough()) }).passthrough().safeParse(body);
  if (!parsed.success) throw new Error("AIDT_NATIVE_DRAFT_INTERCEPTED_WIRE_INVALID");
  const { forwardedProps, messages } = parsed.data, content = messages.filter(row => row.role === "user").at(-1)?.content;
  const lastUserText = typeof content === "string" ? content : z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).parse(content)
    .filter(part => part.type === "text").map(part => part.text ?? "").join("");
  return { clientMessageId: forwardedProps.clientMessageId, threadId: forwardedProps.chatThreadId,
    attachmentIds: forwardedProps.attachmentIds, selector: forwardedProps.aidtContext, lastUserText };
}

async function uploadPending(page: Page, threadId: string, filename: string) {
  const pending = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === apiPath(`/chat/threads/${threadId}/attachments`));
  await page.getByTestId("chat-attachment-file-input").setInputFiles({ name: filename, mimeType: "text/plain",
    buffer: Buffer.from("Synthetic free failure-path fixture; not student research or model evidence.\n", "utf8") });
  const response = await pending; expect(response.status()).toBe(201);
  const attachment = chatFileUpload.Attachment.parse(await response.json());
  expect(attachment.filename).toBe(filename);
  await expect(page.getByTestId("chat-attachment-list")).toContainText(filename);
  return attachment;
}

async function canonicalEmptyMessages(page: Page, threadId: string) {
  const response = await aidtV2Api(page, `/chat/threads/${threadId}/messages?limit=100`);
  expect(response.status).toBe(200);
  const result = chat.operations.listMessages.out.parse(response.data);
  expect(result.messages).toEqual([]); expect(result.nextCursor).toBeNull();
  return { messages: 0, canonicalRunIdsFromMessages: [] as string[] };
}

test("zero-cost native failure: retry keeps draft B and its file; global member text remains independent", async ({ page }, info) => {
  const rawRuns: unknown[] = [], blockedPaths: string[] = [], pendingAttachments: { threadId: string; id: string }[] = [];
  const cleanup: { id: string; status: number }[] = [], requestFailures: { path: string; error: string | null }[] = [];
  let phase = "registered-abort-before-login";
  page.on("requestfailed", request => { const path = new URL(request.url()).pathname; if (path.includes("/copilotkit")) requestFailures.push({ path, error: request.failure()?.errorText ?? null }); });
  const guard = async (route: Route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const generation = request.method() === "POST" && (path.includes("/api/copilotkit")
      || /\/chat\/threads\/[^/]+\/(messages|queued-messages)$/.test(path)
      || /\/agent-runs\/[^/]+\/(decision|resume|execute|retries)$/.test(path)
      || /\/pm-designs\/[^/]+\/(chat|variants)$/.test(path));
    if (!generation) { await route.continue(); return; }
    blockedPaths.push(path);
    if (V2_SEND_WIRE.test(path)) { try { rawRuns.push(request.postDataJSON()); } catch { rawRuns.push(null); } }
    // A genuine browser transport failure. No response, RUN_ERROR, runId or server receipt is fabricated.
    await route.abort("failed");
  };
  // Install before login/group creation so no generation request can precede the guard.
  await page.route("**/*", guard);
  let projectId = "", threadId = "";
  let actor: { userId: string; orgId: string; orgRole: string } | null = null;
  try {
    await loginAidtV2(page);
    const sessionActor = await page.evaluate(key => { const session = JSON.parse(localStorage.getItem(key)!); return { userId: String(session.userId), orgId: String(session.currentOrgId) }; }, SESSION_STORAGE_KEY);
    const identityResponse = await aidtV2Api(page, `/identity/me?orgId=${encodeURIComponent(sessionActor.orgId)}`); expect(identityResponse.status).toBe(200);
    const me = identity.operations.resolveIdentity.out.parse(identityResponse.data);
    actor = { ...sessionActor, orgRole: me.orgRole }; expect(actor.orgRole, "Dedicated group creation uses the explicitly authorized existing admin, never a role change").toBe("admin");
    phase = "authenticated-admin-creating-own-group";
    projectId = await createAidtV2Group(page, "免费故障草稿与成员文字");
    await openAidtV2Outcome(page, projectId, 1);
    const sourceText = `SYN-ZERO-DRAFT-${randomUUID()}：学生合成观察，尚未进行真人研究。`;
    await fillAidtV2Field(page, "initial", sourceText);
    const saved = await saveAidtV2Stage(page, projectId, 1); phase = "saved-S1-awaiting-native";
    await page.goto(`/aidt/${projectId}?step=1&tool=chat`, { waitUntil: "domcontentloaded" });
    const input = page.getByTestId("copilotkit-v2-input");
    await expect(input).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("aidt-chat-context-pending")).toHaveCount(0);
    threadId = new URL(page.url()).searchParams.get("thread") ?? ""; expect(threadId).toBeTruthy();
    const thread = await aidtV2Api(page, `/chat/threads/${threadId}?projectId=${encodeURIComponent(projectId)}`);
    expect(thread.status).toBe(200); expect(chat.operations.getThread.out.parse(thread.data).thread.projectId).toBe(projectId);
    const before = await canonicalEmptyMessages(page, threadId);
    const aText = "A：请讨论这份合成材料；这是浏览器网络故障注入，不是模型验收。";
    const bText = "B：尚未发送的新观察 @old-A";
    const oldFile = await uploadPending(page, threadId, "old-A.txt"); pendingAttachments.push({ threadId, id: oldFile.id });
    await input.fill(aText); await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled();
    phase = "abort-first-send-A"; await page.getByTestId("copilotkit-v2-send").click();
    await expect(input).toHaveValue(""); await expect(page.getByTestId("chat-attachment-list")).toHaveCount(0);
    await expect.poll(() => rawRuns.length).toBe(1); await expect(page.getByTestId("copilotkit-v2-retry")).toBeVisible();
    const first = inspectRun(rawRuns[0]);
    expect(first.threadId).toBe(threadId); expect(first.lastUserText).toBe(aText); expect(first.attachmentIds).toEqual([oldFile.id]);
    const expected = AidtContextSelector.parse({ schemaVersion: 1, projectId, purpose: "stage", stageId: 1,
      stageRevisions: [{ stageId: 1, revision: saved.revision }] });
    expect(first.selector).toEqual(expected);
    const newFile = await uploadPending(page, threadId, "new-B.txt"); pendingAttachments.push({ threadId, id: newFile.id });
    await input.fill(bText); await input.press("End");
    await expect(page.getByTestId("chat-attachment-mention-picker")).toBeVisible();
    phase = "abort-retry-A-with-unsent-B";
    await expect(page.getByTestId("copilotkit-v2-retry")).toBeEnabled(); await page.getByTestId("copilotkit-v2-retry").click();
    await expect.poll(() => rawRuns.length).toBe(2); await expect(page.getByTestId("copilotkit-v2-retry")).toBeVisible();
    expect(inspectRun(rawRuns[1])).toEqual(first);
    await expect(input).toHaveValue(bText); await expect(page.getByTestId("chat-attachment-list")).toContainText(newFile.filename);
    await expect(page.getByTestId("chat-attachment-mention-picker")).toBeVisible();
    const freshText = "B：学生明确发送新观察，不替换失败A。";
    phase = "abort-fresh-send-B"; await input.fill(freshText); await page.getByTestId("copilotkit-v2-send").click();
    await expect.poll(() => rawRuns.length).toBe(3); await expect(page.getByTestId("copilotkit-v2-retry")).toBeVisible();
    const fresh = inspectRun(rawRuns[2]); expect(fresh.lastUserText).toBe(freshText); expect(fresh.selector).toEqual(expected);
    expect(fresh.attachmentIds).toEqual([newFile.id]); expect(fresh.clientMessageId).not.toBe(first.clientMessageId);
    await expect(input).toHaveValue(""); await expect(page.getByTestId("chat-attachment-list")).toHaveCount(0);
    await expect(page.getByTestId("aidt-run-context-receipt")).toHaveCount(0);
    await expect(page).toHaveURL(url => url.searchParams.get("step") === "1");
    const after = await canonicalEmptyMessages(page, threadId); expect(await readAidtV2Stage(page, projectId, 1)).toEqual(saved);
    const wire = rawRuns.map(body => aidtV2WireMetadata(body, [{ stageId: 1, field: "initial", marker: sourceText }], "aidt-understand", expected, [aText, freshText]));
    phase = "real-member-channel-topic-and-stage-navigation";
    const member = await acceptAidtMemberText({ page, projectId, toStep: 2, request: (path, method, body) => aidtV2Api(page, path, method, body) });
    expect(await readAidtV2Stage(page, projectId, 1)).toEqual(saved);
    expect(rawRuns).toHaveLength(3); await canonicalEmptyMessages(page, threadId); phase = "completed";
    await info.attach("zero-cost-native-draft-and-member-ui", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      zeroWindow, actor, ordinaryStudentPermissionProven: false, projectId, threadId, transportFailureInjection: "page.route abort before server; no fake response or canonical event",
      blockedPaths, first, retried: inspectRun(rawRuns[1]), fresh, wire, before, after,
      savedStageRevisionUnchanged: saved.revision, member, nativeBrowserRequestsReachedServer: false,
      serverAcceptedRunAudit: "pending independent A1 tenant-scoped read-only SQL; no thread run-list GET exists",
      timelineBrowserRetryTested: false, timelineCoverage: "controlled React regression only", actualModelOrTeachingSuccessClaimed: false,
    }, null, 2)) });
  } finally {
    const canonicalRead = threadId ? await aidtV2Api(page, `/chat/threads/${threadId}/messages?limit=100`).then(response => {
      const parsed = chat.operations.listMessages.out.safeParse(response.data);
      return { status: response.status, messages: parsed.success ? parsed.data.messages.length : null,
        canonicalRunIds: parsed.success ? parsed.data.messages.flatMap(message => message.agentRunId ? [message.agentRunId] : []) : null };
    }).catch(() => ({ status: null, messages: null, canonicalRunIds: null })) : null;
    const nativeUi = { error: await page.getByTestId("copilotkit-v2-error").allTextContents().catch(() => []),
      nativeInput: await page.getByTestId("copilotkit-v2-input").inputValue({ timeout: 1_000 }).catch(() => null),
      canonicalReceiptCount: await page.getByTestId("aidt-run-context-receipt").count().catch(() => null) };
    await info.attach("zero-cost-exit-state", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      phase, actor, projectId, threadId, zeroWindow, blockedPaths, requestFailures, canonicalRead, nativeUi,
      interceptedSdkRuns: rawRuns.length, generationReachedServerClaimed: false,
      independentOwnerRunsAndPhysicalAudit: "required separately; browser does not have a thread-run-list API",
    }, null, 2)) });
    // Only our own newly uploaded pending files. Never delete saved research material or another test's files.
    for (const attachment of pendingAttachments) {
      const status = await page.evaluate(async ({ url, key }) => {
        const token = localStorage.getItem(key); if (!token) return 0;
        return (await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })).status;
      }, { url: apiPath(`/chat/threads/${attachment.threadId}/attachments/${attachment.id}`), key: SESSION_TOKEN_STORAGE_KEY }).catch(() => 0);
      cleanup.push({ id: attachment.id, status });
    }
    await info.attach("zero-cost-pending-file-cleanup", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId, threadId, cleanup })) });
    await page.unroute("**/*", guard);
    expect(cleanup.every(item => item.status === 204), "Only our pending attachments must be cancelled through the normal authorized API").toBe(true);
  }
});
