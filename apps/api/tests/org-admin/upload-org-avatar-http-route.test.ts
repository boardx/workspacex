/**
 * `uploadOrgAvatar` —— **HTTP 路由层**的端到端反证（devapp「卡在上传中…」缺陷的还原试验）。
 *
 * 既有的 `upload-org-avatar-server-validated.test.ts` 直接调用用例函数，从未经过
 * `readRawBody`（controller 手写的原始流读取）。生产（devapp.boardx.us）人类实测
 * 上传按钮永远停在「上传中…」——fetch 不 resolve，说明服务端在 HTTP 层挂起。
 * 本文件用与浏览器完全相同的请求形状（元数据走查询串 + 原始二进制体 + 真实 TCP）
 * 打真实监听端口，证明这条路在超时时间内必然给出响应。
 *
 * ⚠ 每个 it 都带显式超时——「挂住」正是被测缺陷的形态，测试自身绝不许挂住。
 *
 * ## 2026-08-12 第二刀：devapp「第一次成功、第二次 408」（traceId 082a9287-… / 457a6102-…）
 *
 * #921 的 30s 超时是**绝对死线**：头部一到就开表，不看字节有没有在到达。生产链路
 * 浏览器 →（公网）→ Caddy（流式转发）→ Node，慢上行传几 MB 的头像 > 30s 就在
 * 还有进度时被 408 误杀。修法：空闲超时（收到分片即重置）+ 绝对上限（防滴灌
 * 无限续命）+ 字节上限（防 chunked 无限流）。本文件把两个时限用 KERNEL_RAW_BODY_*
 * 缩到秒级，反证四件事：
 *   ① 慢但活着的上传（总时长 > 空闲时限）不再被误杀；
 *   ② 真死流仍然 408（#921 兜底没修没）；
 *   ③ 流断开仍然 400（#921 兜底没修没）；
 *   ④ keep-alive 同连接连发上传全 201（监听器/定时器不跨请求泄漏——
 *      这是本缺陷最初的假说，反证后排除，留门防回归）。
 */
import net from "node:net";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { addCredential, addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
/** 见文件头：只为测试把 30s 空闲 / 10min 总闸缩到秒级；生产不设这两个变量。 */
const IDLE_MS = 1500;
const TOTAL_MS = 6000;
process.env.KERNEL_RAW_BODY_IDLE_TIMEOUT_MS = String(IDLE_MS);
process.env.KERNEL_RAW_BODY_MAX_TOTAL_MS = String(TOTAL_MS);

const ORG = "org-avatar-http-route";
const ADMIN = "u-avatar-http-admin";

const HOOK_TIMEOUT_MS = 60_000;
const CASE_TIMEOUT_MS = 20_000;
/** 单发请求的硬超时：真实服务器在本地环回上正常应在毫秒级返回；10s 足够慷慨。 */
const REQUEST_TIMEOUT_MS = 10_000;

// 8x8 真实 PNG（同 upload-org-avatar-server-validated.test.ts）。
const REAL_PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000800000008080600000098e5a90c0000000a49444154789c6360000002000155ff9db60000000049454e44ae426082",
  "hex",
);

let app: NestExpressApplication;
let base = "";

function uploadUrl(bytes: Buffer, contentType: string): string {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const q = new URLSearchParams({
    filename: "avatar.png",
    sizeBytes: String(bytes.byteLength),
    sha256,
    contentType,
  });
  return `${base}/organizations/${ORG}/avatar?${q.toString()}`;
}

/** 浏览器 `live-org-admin.ts#uploadOrgAvatar` 的忠实复刻：原始字节体 + 元数据查询串。 */
function uploadAvatar(bytes: Buffer, contentType = "image/png"): Promise<Response> {
  return fetch(uploadUrl(bytes, contentType), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": contentType,
      "x-kernel-test-principal": `${ADMIN}:${ORG}`,
    },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await app?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, teamNames: [], projectId: `${ORG}-p` });
  await addCredential(ADMIN, "admin@avatar-http.test", "Admin");
  await addOrgMember(ORG, ADMIN, "admin", null);
}, HOOK_TIMEOUT_MS);

describe("POST /organizations/:orgId/avatar —— 真实 HTTP，必须在超时内响应", () => {
  it(
    "正例：真实 PNG 字节 + admin → 200，返回 orgAvatarArtifactId / avatarUrl",
    async () => {
      const res = await uploadAvatar(REAL_PNG_BYTES);
      expect(res.status).toBe(201);
      const json = (await res.json()) as { orgAvatarArtifactId?: string; avatarUrl?: string };
      expect(json.orgAvatarArtifactId).toMatch(/^org-avatar-/);
      expect(json.avatarUrl).toContain(`/organizations/${ORG}/avatar-file/`);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "负例：声明 image/png 但字节是 JPEG magic → 415 UNSUPPORTED_CONTENT_TYPE（不是挂起）",
    async () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      const res = await uploadAvatar(jpeg, "image/png");
      expect(res.status).toBe(415);
      const json = (await res.json()) as { reasonCode?: string };
      expect(json.reasonCode).toBe("UNSUPPORTED_CONTENT_TYPE");
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "较大文件（1MB，多个 TCP 分片）也必须在超时内完成 —— readRawBody 不许因分片而丢 end 事件",
    async () => {
      // 用真实 PNG 头 + 填充字节构造 1MB 的「PNG」——嗅探只看 magic bytes，
      // 这里测的是流读取，不是图片解码。
      const big = Buffer.concat([REAL_PNG_BYTES, Buffer.alloc(1024 * 1024 - REAL_PNG_BYTES.length)]);
      const res = await uploadAvatar(big);
      expect(res.status).toBe(201);
    },
    CASE_TIMEOUT_MS,
  );
});

/* ═════════════ 2026-08-12 二次上传 408 修复的反证（见文件头「第二刀」） ═════════════ */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function requestHead(bodyLength: number | null): Record<string, string | number> {
  const h: Record<string, string | number> = {
    Accept: "application/json",
    "Content-Type": "image/png",
    "x-kernel-test-principal": `${ADMIN}:${ORG}`,
  };
  if (bodyLength !== null) h["Content-Length"] = bodyLength;
  return h;
}

interface ProbeResult {
  readonly status: number | undefined;
  readonly body: string;
  readonly ms: number;
  readonly reusedSocket: boolean;
}

/**
 * 用 node:http（非 fetch）发上传：fetch/undici 自带连接池策略，无法精确控制
 * 「同一条 keep-alive 连接」与「分片节奏」——而这两样正是被测对象。
 * `writePlan`：[延迟 ms, 分片] 序列，按序滴灌；null Content-Length = chunked。
 */
function probeUpload(
  agent: http.Agent | undefined,
  bytes: Buffer,
  opts: { declaredSize?: number; contentLength?: number | null; writePlan?: Array<[number, Buffer]> } = {},
): Promise<ProbeResult> {
  const declaredSize = opts.declaredSize ?? bytes.byteLength;
  const contentLength = opts.contentLength === undefined ? bytes.byteLength : opts.contentLength;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const q = new URLSearchParams({
    filename: "avatar.png",
    sizeBytes: String(declaredSize),
    sha256,
    contentType: "image/png",
  });
  const { port } = new URL(base);
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.request(
      {
        agent,
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/organizations/${ORG}/avatar?${q}`,
        headers: requestHead(contentLength),
      },
      (res) => {
        responded = true;
        let body = "";
        res.on("data", (c: Buffer) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body, ms: Date.now() - started, reusedSocket: req.reusedSocket === true }),
        );
      },
    );
    // 服务端 settle 之后客户端继续写会 EPIPE/ECONNRESET——那正是预期路径，别让它炸测试；
    // 响应已经开始时的迟到 error 直接忽略（响应侧会 resolve）。
    let responded = false;
    req.on("error", () => {
      if (!responded) resolve({ status: undefined, body: "", ms: Date.now() - started, reusedSocket: false });
    });
    void (async () => {
      if (opts.writePlan) {
        for (const [delayMs, chunk] of opts.writePlan) {
          await sleep(delayMs);
          if (req.destroyed || req.writableEnded) return;
          req.write(chunk);
        }
        if (!req.destroyed) req.end();
      } else {
        req.end(bytes);
      }
    })();
  });
}

describe("readRawBody —— 空闲超时 + 总闸 + 字节上限 + keep-alive 连发（真实 HTTP）", () => {
  it(
    "④ keep-alive 同一连接连发 3 次上传（含超过空闲时限的间隔）→ 全 201，定时器/监听器不跨请求泄漏",
    async () => {
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      try {
        const r1 = await probeUpload(agent, REAL_PNG_BYTES);
        await sleep(200);
        const r2 = await probeUpload(agent, REAL_PNG_BYTES);
        // 间隔 > IDLE_MS：空闲计时若误挂在连接而非请求上，这一发会被上一发的表误杀。
        await sleep(IDLE_MS + 300);
        const r3 = await probeUpload(agent, REAL_PNG_BYTES);
        expect([r1.status, r2.status, r3.status]).toEqual([201, 201, 201]);
        expect(r2.reusedSocket || r3.reusedSocket).toBe(true);
      } finally {
        agent.destroy();
      }
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "① 慢但活着：总时长 ≈ 2.5×空闲时限、分片间隔 < 空闲时限 → 201（绝对死线实现会在这里 408）",
    async () => {
      const step = 400;
      const plan: Array<[number, Buffer]> = [];
      const total = Math.floor((IDLE_MS * 2.5) / step); // ~3.75s，9~10 个分片
      for (let i = 0; i < total; i++) {
        const from = Math.floor((REAL_PNG_BYTES.length * i) / total);
        const to = Math.floor((REAL_PNG_BYTES.length * (i + 1)) / total);
        plan.push([step, REAL_PNG_BYTES.subarray(from, to)]);
      }
      const r = await probeUpload(undefined, REAL_PNG_BYTES, { writePlan: plan });
      expect(r.status).toBe(201);
      expect(r.ms).toBeGreaterThan(IDLE_MS);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "② 真死流：发一半后彻底沉默（连接保持打开）→ 空闲时限内 408 request_timeout",
    async () => {
      const half = REAL_PNG_BYTES.subarray(0, Math.floor(REAL_PNG_BYTES.length / 2));
      // writePlan 只发前一半，然后既不 end 也不 destroy——沉默但活着。
      const r = await new Promise<ProbeResult>((resolve) => {
        const sha256 = createHash("sha256").update(REAL_PNG_BYTES).digest("hex");
        const q = new URLSearchParams({
          filename: "avatar.png",
          sizeBytes: String(REAL_PNG_BYTES.byteLength),
          sha256,
          contentType: "image/png",
        });
        const { port } = new URL(base);
        const started = Date.now();
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            method: "POST",
            path: `/organizations/${ORG}/avatar?${q}`,
            headers: requestHead(REAL_PNG_BYTES.byteLength),
          },
          (res) => {
            let body = "";
            res.on("data", (c: Buffer) => (body += c));
            res.on("end", () => {
              resolve({ status: res.statusCode, body, ms: Date.now() - started, reusedSocket: false });
              req.destroy();
            });
          },
        );
        req.on("error", () => resolve({ status: undefined, body: "", ms: Date.now() - started, reusedSocket: false }));
        req.write(half);
      });
      expect(r.status).toBe(408);
      expect(JSON.parse(r.body)).toMatchObject({ error: "request_timeout" });
      expect(r.ms).toBeGreaterThanOrEqual(IDLE_MS - 50);
      expect(r.ms).toBeLessThan(TOTAL_MS);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "滴灌不能无限续命：分片一直在到达但超过总闸 → 408（slowloris 有硬上限）",
    async () => {
      const step = 400; // < IDLE_MS：空闲表永远打不响，只有总闸能停它
      const plan: Array<[number, Buffer]> = [];
      for (let i = 0; i < Math.ceil((TOTAL_MS * 1.5) / step); i++) {
        plan.push([step, Buffer.from([REAL_PNG_BYTES[i % REAL_PNG_BYTES.length] ?? 0])]);
      }
      const r = await probeUpload(undefined, REAL_PNG_BYTES, { writePlan: plan });
      expect(r.status).toBe(408);
      expect(r.ms).toBeGreaterThanOrEqual(TOTAL_MS - 100);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "③ 流断开：发一半后客户端半关（FIN）→ 400 bad_request，不挂起",
    async () => {
      const sha256 = createHash("sha256").update(REAL_PNG_BYTES).digest("hex");
      const q = new URLSearchParams({
        filename: "avatar.png",
        sizeBytes: String(REAL_PNG_BYTES.byteLength),
        sha256,
        contentType: "image/png",
      });
      const { port } = new URL(base);
      const half = REAL_PNG_BYTES.subarray(0, Math.floor(REAL_PNG_BYTES.length / 2));
      const head =
        `POST /organizations/${ORG}/avatar?${q} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\nContent-Type: image/png\r\n` +
        `Content-Length: ${REAL_PNG_BYTES.byteLength}\r\n` +
        `x-kernel-test-principal: ${ADMIN}:${ORG}\r\n\r\n`;
      const raw = await new Promise<string>((resolve) => {
        const sock = net.connect(Number(port), "127.0.0.1", () => {
          sock.write(head);
          sock.write(half);
          // 半关：写侧 FIN（体不完整），读侧保持打开等响应。
          sock.end();
        });
        let buf = "";
        sock.on("data", (c) => (buf += c));
        sock.on("close", () => resolve(buf));
        sock.on("error", () => resolve(buf));
      });
      // 体不完整的请求拿到的是状态行为 400 的即时响应；请求已断，Node 不再给它
      // 铺 JSON 体（实测为空体 + Connection: close）。要保的性质是「400 且不挂起」，
      // 不是响应体的形状。
      expect(raw).toContain("HTTP/1.1 400");
    },
    CASE_TIMEOUT_MS,
  );

  it(
    "字节上限：chunked（无 Content-Length）灌超过 5MB → 413 payload_too_large，当场截断不憋内存",
    async () => {
      // 声明一个合法的小 sizeBytes 过元数据关；真实流灌 6MB——服务端必须在流层截住。
      const chunk = Buffer.alloc(512 * 1024, 0x61);
      const plan: Array<[number, Buffer]> = [[0, REAL_PNG_BYTES]];
      for (let i = 0; i < 12; i++) plan.push([0, chunk]);
      const r = await probeUpload(undefined, REAL_PNG_BYTES, {
        declaredSize: REAL_PNG_BYTES.byteLength,
        contentLength: null,
        writePlan: plan,
      });
      expect(r.status).toBe(413);
      expect(JSON.parse(r.body)).toMatchObject({ error: "payload_too_large" });
    },
    CASE_TIMEOUT_MS,
  );
});
