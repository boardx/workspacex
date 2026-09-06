/**
 * #595 —— URL 导入的**出站取回层**，也就是那两道门**唯一的调用点**。
 *
 * ## 为什么这个文件必须存在
 *
 * `domain/skill/import-source.ts` 里的 `assertResolvedAddressAllowed` 曾经**有实现、
 * 有单测、有反证，却没有任何调用方**。那种状态比没有门更坏：后来者看到
 * 「有 DNS 解析后校验 + 有测试 + 有反证」，会合理推断 SSRF 已经挡住了，
 * **而它一次都没被调用**。反证证明的是「这个函数正确」，不是「这条路径被保护了」。
 *
 * ⇒ 本文件就是把门接到路径上的那一段。**它是出站取回的唯一入口**；
 *   绕过它直接 `fetch()` 的代码路径不受任何保护。
 *
 * ## 校验点在 `lookup`，不在调用前
 *
 * 「先查 DNS 校验一遍，再交给 https 去连」有一个经典缺口：https **会自己再查一次**，
 * 第二次可以返回不同的地址（DNS rebinding）。所以校验必须发生在**连接真正使用的
 * 那一次解析**上——也就是传给 `https.request` 的自定义 `lookup` 回调里。
 * 那是地址进入 socket 之前的最后一个位置。
 *
 * ⚠ 每一跳重定向都重新走完整两道门。重定向是**新的 URL**，
 *   `https://good.example` 可以 302 到 `http://169.254.169.254/`。
 */
import https from "node:https";
import dns from "node:dns";
import {
  ImportSourceRefusedError,
  assertImportUrlAllowed,
  assertResolvedAddressAllowed,
  type ImportUrlPolicy,
} from "../../domain/skill/import-source";

/** 上限都取得保守：导入的是 skill 定义，不是数据集。 */
export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;

export interface FetchedImportSource {
  readonly url: string;
  readonly mediaType: string;
  readonly body: Buffer;
}

/**
 * 测试接缝——**只有两个**，而且都不是「跳过校验」。
 *
 * ⚠ `checkAddress` 默认就是真实那道门。把它做成参数是为了让**正样本**
 *   （真的把字节取回来）能对着一个 loopback 上的测试服务器跑；
 *   负样本一律用**默认值**，否则测的就是替身而不是生产代码。
 */
export interface ImportFetchSeams {
  readonly lookup: typeof dns.lookup;
  readonly checkAddress: (address: string) => void;
}

const PRODUCTION_SEAMS: ImportFetchSeams = {
  lookup: dns.lookup,
  checkAddress: assertResolvedAddressAllowed,
};

/**
 * 把 `checkAddress` 织进 `lookup`：地址进 socket 之前的最后一道关。
 *
 * ⚠ **这就是「接线」本身。** 摘掉这里的 `checkAddress` 调用，
 *   `assertResolvedAddressAllowed` 的所有单测依然全绿——这正是端到端反证要证的事。
 */
function guardedLookup(seams: ImportFetchSeams): typeof dns.lookup {
  const wrapped = (
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void,
  ): void => {
    seams.lookup(hostname, options as dns.LookupOptions, (err, address, family) => {
      if (err) {
        callback(err);
        return;
      }
      const candidates = Array.isArray(address)
        ? address.map((entry) => entry.address)
        : [String(address)];
      try {
        for (const candidate of candidates) seams.checkAddress(candidate);
      } catch (refusal) {
        callback(refusal as NodeJS.ErrnoException);
        return;
      }
      callback(null, address, family);
    });
  };
  return wrapped as unknown as typeof dns.lookup;
}

const GITHUB_DIAGNOSTIC_HEADERS = [
  "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset",
  "retry-after", "x-github-request-id",
] as const;

function githubDiagnosticHeaders(headers: import("node:http").IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of GITHUB_DIAGNOSTIC_HEADERS) {
    const value = headers[name];
    // Reject rather than truncate: no arrays, controls, URLs or arbitrary payloads.
    if (typeof value === "string" && value.length <= 128 && /^[A-Za-z0-9 ,:-]+$/.test(value)) {
      result[name] = value;
    }
  }
  return result;
}

function once(url: URL, seams: ImportFetchSeams): Promise<{
  readonly status: number;
  readonly diagnostics: Record<string, string>;
  readonly location: string | null;
  readonly mediaType: string;
  readonly body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(seams),
        timeout: TIMEOUT_MS,
        /**
         * 实测（真栈 e2e，`skill-agent-import-usecase-audit.spec.ts` ①）：不带任何请求头
         * 打 `api.github.com` 一律 403 `Request forbidden by administrative rules ...
         * make sure your request has a User-Agent header`——这条路径此前只被 loopback
         * 测试替身验证过（替身不强制 UA），从未真的打过 GitHub，所以 `tree/` 目录导入
         * 落地以来一次都没有真的成功过。`Accept` 一并给上是 GitHub 官方文档对 REST API
         * 的推荐值，避免协商到非 JSON 的表示。两者都是**只读取回层加的请求头**，
         * 不影响两道 SSRF 门（校验发生在 `lookup`，与请求头无关）。
         */
        headers: {
          "user-agent": "workspacex-skill-import/1.0",
          accept: "application/vnd.github+json",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_BYTES) {
            response.destroy();
            reject(new ImportSourceRefusedError("IMPORT_PAYLOAD_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            diagnostics: githubDiagnosticHeaders(response.headers),
            location: response.headers.location ?? null,
            mediaType: (response.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim(),
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new ImportSourceRefusedError("IMPORT_FETCH_TIMEOUT"));
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * 取回一个导入源。**两道门都在这条路径上**：
 *   ① `assertImportUrlAllowed`（字面量）—— 每一跳都走；
 *   ② `assertResolvedAddressAllowed`（解析后）—— 由 `guardedLookup` 在 socket 前调用。
 */
export async function fetchImportSource(
  rawUrl: string,
  policy: ImportUrlPolicy,
  seams: ImportFetchSeams = PRODUCTION_SEAMS,
): Promise<FetchedImportSource> {
  let target = assertImportUrlAllowed(rawUrl, policy);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await once(target, seams);
    if (result.status >= 300 && result.status < 400 && result.location !== null) {
      // 重定向目标要按**当前 URL** 解析相对地址，然后重新过第一道门。
      target = assertImportUrlAllowed(new URL(result.location, target).toString(), policy);
      continue;
    }
    if (result.status !== 200) {
      if (target.protocol === "https:" && target.hostname === "api.github.com" && !target.port) {
        console.warn("[skill-import] upstream-http-failure", {
          host: "api.github.com", status: result.status, headers: result.diagnostics,
        });
      }
      throw new ImportSourceRefusedError("IMPORT_FETCH_FAILED");
    }
    return { url: target.toString(), mediaType: result.mediaType, body: result.body };
  }
  throw new ImportSourceRefusedError("IMPORT_TOO_MANY_REDIRECTS");
}
