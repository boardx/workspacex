import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { inflateSync } from "node:zlib";
import { research as C } from "@repo/contracts";
import { ResearchRuntimeError, type GuidedSearchPort } from "../../application/research/guided-runtime-ports";

const MAX_DOCUMENT_BYTES = 1_048_576;
const MAX_DOCUMENT_TEXT = 60_000;
const DOCUMENT_TYPES = new Set(["text/html", "text/plain", "text/markdown", "application/pdf"]);

/** BoardX's existing Google Custom Search proxy returns excerpts, not full-page content. */
export class GoogleGuidedSearch implements GuidedSearchPort {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = process.env.KERNEL_GUIDED_SEARCH_URL ?? "https://www.web-search.boardx.us/",
  ) {}

  async search(query: string) {
    if (!this.endpoint.trim()) throw new ResearchRuntimeError("RESEARCH_SEARCH_NOT_CONFIGURED");
    try {
      const url = new URL(this.endpoint);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        throw new ResearchRuntimeError("RESEARCH_SEARCH_NOT_CONFIGURED");
      }
      url.searchParams.set("q", query);
      const response = await this.fetcher(url.href, {
        method: "GET", headers: { Accept: "application/json", "User-Agent": "boardx-research-agent" },
        signal: AbortSignal.timeout(45000), redirect: "error",
      });
      if (!response.ok) throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
      const hits = C.GuidedResearchSearchProviderResponse.parse(await response.json()).results;
      return hits.slice(0, 5).map((hit) => {
        const sourceUrl = new URL(hit.url);
        if (!["http:", "https:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password) {
          throw new ResearchRuntimeError("RESEARCH_CONTENT_REFERENCE_INVALID");
        }
        const content = hit.snippet.trim().slice(0, 30000);
        if (!content) throw new ResearchRuntimeError("RESEARCH_SEARCH_CONTENT_EMPTY");
        return { title: hit.title, url: sourceUrl.href, content };
      });
    } catch (error) {
      if (error instanceof ResearchRuntimeError) throw error;
      throw new ResearchRuntimeError("RESEARCH_SEARCH_UNAVAILABLE");
    }
  }

  async read(url: string) {
    try {
      const parsed = new URL(url);
      await assertPublicDocumentUrl(parsed, trustedLoopbackOrigin(this.endpoint));
      const response = await this.fetcher(parsed.href, { headers: { Accept: "text/html,text/plain,text/markdown,application/pdf" }, signal: AbortSignal.timeout(10000), redirect: "error" });
      if (!response.ok) throw new Error("unavailable");
      const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (!DOCUMENT_TYPES.has(type)) throw new Error("unsupported");
      const bytes = await readLimitedBytes(response, MAX_DOCUMENT_BYTES);
      const text = type === "application/pdf" ? extractPdfText(bytes) : new TextDecoder().decode(bytes).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
      const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_DOCUMENT_TEXT);
      if (!clean) throw new Error("empty");
      return { text: clean, contentKind: type === "application/pdf" ? "pdf" as const : type === "text/plain" || type === "text/markdown" ? "text" as const : "html" as const, truncated: text.length > MAX_DOCUMENT_TEXT };
    } catch (error) {
      if (error instanceof ResearchRuntimeError) throw error;
      throw new ResearchRuntimeError(`RESEARCH_DOCUMENT_${error instanceof Error ? error.message.toUpperCase() : "UNAVAILABLE"}`);
    }
  }
}

async function assertPublicDocumentUrl(url: URL, allowedLoopbackOrigin?: string): Promise<void> {
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("blocked");
  const hostname = url.hostname.replace(/^\[(.*)]$/, "$1").toLowerCase();
  if (!hostname) throw new Error("blocked");
  if (allowedLoopbackOrigin && url.origin === allowedLoopbackOrigin && isLoopbackHost(hostname)) return;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("blocked");
  const literal = isIP(hostname) ? hostname : null;
  if (literal) {
    if (isPrivateAddress(literal)) throw new Error("blocked");
    return;
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateAddress(record.address))) throw new Error("blocked");
}

function trustedLoopbackOrigin(endpoint: string): string | undefined {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.replace(/^\[(.*)]$/, "$1").toLowerCase();
    return isLoopbackHost(hostname) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  const literal = isIP(hostname) ? hostname : null;
  return literal ? isLoopbackAddress(literal) : false;
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeIp(address);
  if (normalized.includes(":")) return normalized === "::1";
  const [first] = normalized.split(".").map((part) => Number(part));
  return first === 127;
}

function isPrivateAddress(address: string): boolean {
  const normalized = normalizeIp(address);
  if (normalized.includes(":")) return isPrivateIpv6(normalized);
  return isPrivateIpv4(normalized);
}

function normalizeIp(address: string): string {
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? mapped[1]! : lower;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
}

async function readLimitedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function extractPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  const pieces: string[] = [];
  for (const stream of pdfStreams(raw)) pieces.push(...extractPdfStreamText(stream));
  pieces.push(...extractPdfStreamText(raw));
  const text = pieces.join(" ").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || /%pdf/i.test(text.slice(0, 100))) throw new Error("empty");
  return text;
}

function pdfStreams(raw: string): string[] {
  const streams: string[] = [];
  const re = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = re.exec(raw); match; match = re.exec(raw)) {
    const dict = match[1] ?? "";
    const body = Buffer.from(match[2] ?? "", "latin1");
    if (/\/Filter\s*\/FlateDecode/.test(dict)) {
      try { streams.push(inflateSync(body).toString("latin1")); } catch { /* ignore corrupt streams */ }
    } else {
      streams.push(body.toString("latin1"));
    }
  }
  return streams;
}

function extractPdfStreamText(value: string): string[] {
  const out: string[] = [];
  const tj = /\((?:\\.|[^\\)])*\)\s*Tj|\[(.*?)\]\s*TJ|<([0-9a-fA-F\s]+)>\s*Tj/g;
  for (let match = tj.exec(value); match; match = tj.exec(value)) {
    const token = match[0];
    if (token.includes("TJ")) {
      for (const item of token.match(/\((?:\\.|[^\\)])*\)|<([0-9a-fA-F\s]+)>/g) ?? []) out.push(decodePdfToken(item));
    } else {
      out.push(decodePdfToken(token.replace(/\s*Tj$/, "")));
    }
  }
  return out.filter(Boolean);
}

function decodePdfToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.startsWith("<")) return decodePdfHex(trimmed.slice(1, -1));
  if (!trimmed.startsWith("(")) return "";
  return trimmed.slice(1, -1).replace(/\\([nrtbf()\\])/g, (_m, esc: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[esc] ?? esc);
}

function decodePdfHex(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  if (!clean) return "";
  const bytes = Buffer.from(clean.length % 2 ? `${clean}0` : clean, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return bytes.toString("utf8");
}
