/** Real Chromium PCM -> Nest WS -> explicitly selected local Omni -> real PG.
 * The synthetic provider verifies transport/audio/lifecycle, never vendor model quality.
 * Instrumentation delegates to native media methods; it does not fake their results.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { agentRole } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { OMNI_SAMPLE_USER_TRANSCRIPT } from "../../api/scripts/loopback-omni-realtime";

type MediaEvidence = { streams: MediaStream[]; contexts: AudioContext[]; sourcesStarted: number; sourcesStopped: number; nonzeroOutputSamples: number };
declare global { interface Window { __voiceEvidence: MediaEvidence } }
type Connection = { id: number; model: string; closed: boolean; audioBytes: number; clientEvents: Record<string, number>; serverEvents: Record<string, number> };
type Message = { id: string; text: string; authorKind: string; agentId: string | null };
const providerPort = process.env.WORKSPACEX_ASR_PROVIDER_PORT;
if (!providerPort) throw new Error("WORKSPACEX_ASR_PROVIDER_PORT is required by the isolation wrapper");
const controlUrl = `http://127.0.0.1:${providerPort}/__omni_e2e`;

async function api(page: Page, path: string): Promise<unknown> {
  const token = await page.evaluate(() => localStorage.getItem("wsx.sessionToken"));
  expect(token).toBeTruthy();
  const response = await page.request.get(`/__fullstack_api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function messages(page: Page, threadId: string): Promise<Message[]> {
  return ((await api(page, `/chat/threads/${threadId}/messages?limit=100`)) as { messages: Message[] }).messages;
}
async function observation(page: Page): Promise<Connection[]> {
  const response = await page.request.get(controlUrl);
  expect(response.status(), "explicit local upstream observation must be enabled").toBe(200);
  return ((await response.json()) as { connections: Connection[] }).connections;
}
async function picture(page: Page, info: TestInfo, name: string): Promise<void> {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
}
async function mediaSnapshot(page: Page) {
  return page.evaluate(() => ({
    tracks: window.__voiceEvidence.streams.flatMap(stream => stream.getTracks().map(track => track.readyState)),
    contexts: window.__voiceEvidence.contexts.map(context => context.state),
    started: window.__voiceEvidence.sourcesStarted,
    stopped: window.__voiceEvidence.sourcesStopped,
    nonzero: window.__voiceEvidence.nonzeroOutputSamples,
  }));
}

test("real voice audio, interrupt, persisted hangup and remote disconnect cleanup/retry", async ({ page }, info) => {
  test.setTimeout(180_000);
  await info.attach("verification-boundary", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    browser: "Chromium native getUserMedia with fake-device flag", gatewayAndDatabase: "real Nest and PostgreSQL",
    upstream: "explicit localhost Omni protocol fixture with synthetic PCM tone", vendorAndDevapp: "BLOCKED: not tested",
  })) });
  await page.addInitScript(() => {
    const evidence: MediaEvidence = { streams: [], contexts: [], sourcesStarted: 0, sourcesStopped: 0, nonzeroOutputSamples: 0 };
    window.__voiceEvidence = evidence;
    const rememberContext = (context: AudioContext) => { if (!evidence.contexts.includes(context)) evidence.contexts.push(context); };
    const getUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const stream = await getUserMedia.call(this, constraints);
      evidence.streams.push(stream);
      return stream;
    };
    const createMediaStreamSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      rememberContext(this);
      return createMediaStreamSource.call(this, stream);
    };
    const createBufferSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      rememberContext(this);
      const source = createBufferSource.call(this);
      const start = source.start;
      source.start = function (...args) {
        evidence.sourcesStarted += 1;
        if (source.buffer) for (const sample of source.buffer.getChannelData(0)) if (sample !== 0) evidence.nonzeroOutputSamples += 1;
        return start.apply(this, args);
      };
      const stop = source.stop;
      source.stop = function (...args) { evidence.sourcesStopped += 1; return stop.apply(this, args); };
      return source;
    };
  });
  let binaryFrames = 0;
  let binaryBytes = 0;
  page.on("websocket", socket => {
    if (!new URL(socket.url()).pathname.endsWith("/chat/realtime-digital-human")) return;
    socket.on("framesent", frame => { if (Buffer.isBuffer(frame.payload)) { binaryFrames += 1; binaryBytes += frame.payload.byteLength; } });
  });

  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.memberEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.memberPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  const roles = agentRole.operations.listAgentDirectory.out.parse(await api(page, "/agents/directory")).items;
  const product = roles.find(role => role.avatar?.key === "dh-03-product-manager" && role.catalogSource === "official");
  expect(product, "the real seven-role import must publish D003 first").toBeDefined();
  await page.goto("/agent");
  await page.getByTestId(`agent-card-${product!.agentId}`).getByTestId("agent-card-view-detail").click();
  await page.getByTestId("agent-detail-start-chat").click();
  await expect(page.getByTestId("copilotkit-v2-input")).toBeVisible();
  await page.getByTestId("chat-thread-create").click();
  await page.waitForURL(url => /^\/chat\/[^/]+$/.test(url.pathname));
  const threadId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
  expect(await messages(page, threadId)).toHaveLength(0);
  const baselineIds = new Set((await observation(page)).map(connection => connection.id));

  await page.getByTestId("chat-composer-realtime-voice").click();
  await expect(page.getByTestId("realtime-voice-title")).toHaveText("与产品经理实时对话");
  await expect(page.getByTestId("realtime-voice-status")).toHaveAttribute("data-phase", "live", { timeout: 30_000 });
  await expect(page.getByTestId("realtime-voice-caption-user")).toContainText(OMNI_SAMPLE_USER_TRANSCRIPT);
  await expect.poll(() => binaryFrames).toBeGreaterThan(0);
  await expect.poll(() => binaryBytes).toBeGreaterThanOrEqual(32_000);
  await expect.poll(async () => (await mediaSnapshot(page)).nonzero).toBeGreaterThan(0);
  await expect(page.getByTestId("realtime-voice-caption-assistant")).toContainText("我是产品经理");
  const first = (await observation(page)).find(connection => !baselineIds.has(connection.id) && !connection.closed)!;
  expect(first).toBeDefined();
  expect(first.model).toBe("qwen3.8-omni-flash-realtime");
  expect(first.audioBytes).toBeGreaterThanOrEqual(32_000);
  await expect(page.getByTestId("realtime-voice-interrupt")).toBeEnabled();
  await page.getByTestId("realtime-voice-interrupt").click();
  await expect.poll(async () => (await observation(page)).find(connection => connection.id === first.id)?.clientEvents["response.cancel"] ?? 0).toBe(1);
  await expect.poll(async () => (await mediaSnapshot(page)).stopped).toBeGreaterThan(0);
  await picture(page, info, "01-real-audio-captions-and-interruption");
  await page.getByTestId("realtime-voice-mute").click();
  await expect(page.getByTestId("realtime-voice-mute")).toHaveAttribute("aria-pressed", "true");
  await picture(page, info, "02-interrupted-and-muted");
  await page.getByTestId("realtime-voice-hangup").click();
  await expect(page.getByTestId("realtime-voice-session")).toHaveCount(0);
  await expect.poll(async () => (await messages(page, threadId)).filter(message => message.authorKind === "human" && message.text === OMNI_SAMPLE_USER_TRANSCRIPT).length).toBeGreaterThan(0);
  await expect.poll(async () => (await messages(page, threadId)).some(message => message.authorKind === "agent" && message.agentId === product!.agentId && message.text.includes("我是产品经理"))).toBe(true);
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(OMNI_SAMPLE_USER_TRANSCRIPT);
  await expect.poll(async () => (await mediaSnapshot(page)).tracks.every(state => state === "ended")).toBe(true);
  await expect.poll(async () => (await mediaSnapshot(page)).contexts.every(state => state === "closed")).toBe(true);
  const persisted = await messages(page, threadId);
  await page.reload();
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(OMNI_SAMPLE_USER_TRANSCRIPT);
  expect((await messages(page, threadId)).map(message => message.id).sort()).toEqual(persisted.map(message => message.id).sort());
  await picture(page, info, "03-hangup-persisted-and-restored");

  const beforeRetryIds = new Set((await observation(page)).map(connection => connection.id));
  await page.getByTestId("chat-composer-realtime-voice").click();
  await expect(page.getByTestId("realtime-voice-caption-assistant")).toContainText("我是产品经理");
  await expect.poll(async () => (await mediaSnapshot(page)).nonzero).toBeGreaterThan(0);
  const second = (await observation(page)).find(connection => !beforeRetryIds.has(connection.id) && !connection.closed)!;
  expect(second).toBeDefined();
  const oldMedia = await mediaSnapshot(page);
  const disconnect = await page.request.post(`${controlUrl}?action=close&id=${second.id}`);
  expect(disconnect.status()).toBe(204);
  await expect.poll(async () => {
    const current = await mediaSnapshot(page);
    return current.tracks.slice(0, oldMedia.tracks.length).every(state => state === "ended")
      && current.contexts.slice(0, oldMedia.contexts.length).every(state => state === "closed");
  }).toBe(true);
  await expect.poll(async () => (await observation(page)).some(connection => connection.id > second.id && !connection.closed && connection.audioBytes >= 32_000)).toBe(true);
  await expect(page.getByTestId("realtime-voice-caption-user")).toContainText(OMNI_SAMPLE_USER_TRANSCRIPT);
  await expect(page.getByTestId("realtime-voice-caption-assistant")).toContainText("我是产品经理");
  await picture(page, info, "04-remote-close-retry-with-new-media");
  await page.getByTestId("realtime-voice-mute").click();
  await page.getByTestId("realtime-voice-hangup").click();
  await expect(page.getByTestId("realtime-voice-session")).toHaveCount(0);
  await expect.poll(async () => (await observation(page)).filter(connection => !baselineIds.has(connection.id)).every(connection => connection.closed)).toBe(true);
  await expect.poll(async () => {
    const current = await mediaSnapshot(page);
    return current.tracks.every(state => state === "ended") && current.contexts.every(state => state === "closed");
  }).toBe(true);
  await info.attach("transport-audio-cleanup-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    binaryFrames, binaryBytes, media: await mediaSnapshot(page), connections: (await observation(page)).filter(connection => !baselineIds.has(connection.id)),
  })) });
});
