#!/usr/bin/env node
/**
 * #4366（S9，人类决定 2026-09）：记忆体验评测栈专用的**确定性嵌入提供方**——实现 deep-agent-service
 * `/internal/retrieval/embeddings` 的同一份契约（`@repo/contracts/retrieval-embedding`），让评测里的 API 走真实的
 * `LangChainEmbeddingClient` → 真实的嵌入 worker → 真实的 pgvector 查询，「相似」通道因此真的出现。
 *
 * ## 它不在检查指纹里，也不许被用来抬分
 * - 不读语料（cases.json）、不认任何评测句子：向量只由输入文本本身推出——字符 unigram + bigram 哈希到固定维度、L2 归一。
 *   它**不是语义模型**：换了字的同义说法它照样认不出。它只让向量通道在评测里真实运行、被量到（E3.c4 的前提），
 *   「hybrid 比纯向量多答对 ≥ 20%」那一条的判据与阈值一个字不动，量出来是多少就是多少。
 * - 必须被显式选中：API 只有在 `KERNEL_EMBEDDING_MODEL_ID/VERSION`、`KERNEL_DEEP_AGENT_BASE_URL`、
 *   `DEEP_AGENT_SERVICE_INTERNAL_KEY` 都指向它时才会调用它；产品代码不认识它，没有静默回落。
 * - 起来之后等评测库迁移完（`embedding_models` 表出现），用 migration 身份登记这个模型（运维动作，同
 *   `register-retrieval-embedding-model.ts`）；登记触发已有活结论补排嵌入。
 *
 * 由 `apps/web/scripts/run-kg-experience-eval.mjs` 起停（见 evidence/kg-experience-eval/README.md）。
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import pg from "pg";
import { RETRIEVAL_EMBEDDING_LIMITS as L, RetrievalEmbeddingRequest, RetrievalEmbeddingResponse } from "@repo/contracts/retrieval-embedding";
import { migrationConfig } from "../src/infrastructure/db/pg-config";
import { registerEmbeddingModel } from "../src/infrastructure/retrieval/register-embedding-model";

const port = Number(process.env.LOOPBACK_KG_EVAL_EMBEDDING_PORT ?? "");
if (!Number.isInteger(port) || port <= 0) throw new Error("LOOPBACK_KG_EVAL_EMBEDDING_PORT must be a positive integer");
const key = process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY ?? "";
const model = process.env.KERNEL_EMBEDDING_MODEL_ID ?? "";
const modelVersion = process.env.KERNEL_EMBEDDING_MODEL_VERSION ?? "";
if (!key || !model || !modelVersion) throw new Error("DEEP_AGENT_SERVICE_INTERNAL_KEY / KERNEL_EMBEDDING_MODEL_ID / KERNEL_EMBEDDING_MODEL_VERSION are required");

const LOOPBACK_EMBEDDING_DIMS = 256;

/** 字符 unigram（权重 1）+ bigram（权重 2）哈希到 256 维，L2 归一；空白与大小写不计。只由文本本身决定。 */
function loopbackEmbedding(text: string): number[] {
  const t = [...text.toLowerCase().replace(/\s+/g, "")];
  const v = new Array<number>(LOOPBACK_EMBEDDING_DIMS).fill(0);
  const bump = (s: string, w: number) => {
    let h = 2166136261;
    for (const b of Buffer.from(s, "utf8")) h = Math.imul(h ^ b, 16777619) >>> 0;
    const i = h % LOOPBACK_EMBEDDING_DIMS;
    v[i] = (v[i] ?? 0) + w;
  };
  t.forEach((c, i) => { bump(c, 1); if (i + 1 < t.length) bump(c + t[i + 1]!, 2); });
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

async function registerWhenMigrated(): Promise<void> {
  for (let i = 0; i < 600; i += 1) {
    const c = new pg.Client(migrationConfig());
    try {
      await c.connect();
      const r = await c.query<{ ok: boolean }>("SELECT to_regclass('public.embedding_models') IS NOT NULL AS ok");
      if (r.rows[0]?.ok === true) {
        await registerEmbeddingModel(migrationConfig(), model, modelVersion, LOOPBACK_EMBEDDING_DIMS);
        console.log(`[loopback-embedding] registered ${model}/${modelVersion} dims=${LOOPBACK_EMBEDDING_DIMS}`);
        return;
      }
    } catch {
      // 库还没起 / 还没建：稍后再试
    } finally {
      await c.end().catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("loopback embedding: evaluation database never became ready for model registration");
}

const authorized = (supplied: string) => {
  const a = Buffer.from(supplied), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
};

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
    return;
  }
  if (req.method !== "POST" || req.url !== "/internal/retrieval/embeddings") {
    res.writeHead(404).end();
    return;
  }
  if (!authorized(String(req.headers["x-deep-agent-internal-key"] ?? ""))) {
    res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => { size += c.length; if (size <= L.maxRequestBytes) chunks.push(c); });
  req.on("end", () => {
    const parsed = size > L.maxRequestBytes ? null : RetrievalEmbeddingRequest.safeParse((() => {
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return null; }
    })());
    if (parsed === null || !parsed.success) {
      res.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid_embedding_input"}');
      return;
    }
    const out = RetrievalEmbeddingResponse.parse({ model, modelVersion, vectors: parsed.data.texts.map(loopbackEmbedding) });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[loopback-embedding] listening on 127.0.0.1:${port}`);
  registerWhenMigrated().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "loopback embedding registration failed");
    process.exit(1);
  });
});
