#!/usr/bin/env node
/**
 * Liveness + upstream-contract probe for the controlled browser runtime (#2930).
 *
 * Why this exists: the S013 lane used to "verify" the browser runtime by checking that
 * `WORKSPACEX_BROWSER_MCP_ENDPOINT` was a non-empty string. The workflow hardcodes that
 * string in `env:`, so the check could never go red — a green gate that measured nothing.
 * Run 34145225109 then died inside the model turn as an opaque
 * `StandardBrowserError: Browser action refused, failed, or has an unknown outcome`,
 * with no way to tell "browser runtime is not deployed" from "the model did something wrong".
 *
 * This probe speaks the same streamable-HTTP MCP protocol the production adapter speaks
 * (`RemotePlaywrightMcpSessionFactory`), asserts the upstream tool surface the adapter
 * requires, and terminates its own session. It prints no page content and no credentials.
 */
const RAW = process.env.WORKSPACEX_BROWSER_MCP_ENDPOINT;
if (!RAW) fail("WORKSPACEX_BROWSER_MCP_ENDPOINT is not set");

// Mirrors `loopbackMcpEndpoint` in playwright-mcp-browser-adapter.ts: the endpoint must be
// the loopback ingress of the isolated compose stack, never an arbitrary host.
const url = new URL(RAW);
const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
if (url.protocol !== "http:" || !["127.0.0.1", "::1"].includes(host) || url.username || url.password
  || url.pathname !== "/mcp" || url.search || url.hash) {
  fail(`endpoint is not a loopback /mcp endpoint: ${url.protocol}//${url.host}${url.pathname}`);
}

// The adapter refuses to run unless every one of these is present upstream; probing for a
// subset would let a contract change reach the model as an unexplained refusal instead.
const REQUIRED_TOOLS = [
  "browser_navigate", "browser_snapshot", "browser_click", "browser_fill_form",
  "browser_take_screenshot", "browser_resize", "browser_route", "browser_unroute",
];

function fail(message) {
  process.stderr.write(`✗ [browser-mcp] ${message}\n`);
  process.stderr.write(`  ⇒ 这条 lane 需要 apps/browser-runtime 的 compose 栈在本机监听 ${RAW ?? "(endpoint 未设置)"}。\n`);
  process.stderr.write("     起法见 apps/browser-runtime/README.md；不要退回进程内浏览器——那不是被验收的运行时。\n");
  process.exit(1);
}

/** Streamable HTTP replies either as one JSON body or as an SSE stream; accept both. */
async function rpc(method, params, sessionId) {
  const id = Math.floor(Math.random() * 1e9);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
  } catch (error) {
    fail(`${method} could not reach the endpoint: ${error instanceof Error ? error.message : "unknown transport error"}`);
  }
  if (!response.ok) fail(`${method} returned HTTP ${response.status}`);
  const text = await response.text();
  const payload = (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ? text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("")
    : text;
  let parsed;
  try { parsed = JSON.parse(payload); } catch { fail(`${method} did not return JSON-RPC`); }
  if (parsed.error) fail(`${method} returned a JSON-RPC error`);
  return { result: parsed.result, sessionId: response.headers.get("mcp-session-id") ?? sessionId };
}

const initialized = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "workspacex-browser-mcp-probe", version: "1.0.0" },
});
const sessionId = initialized.sessionId;
if (!sessionId) fail("initialize did not return an mcp-session-id");

const listed = await rpc("tools/list", {}, sessionId);
const names = new Set((listed.result?.tools ?? []).map(tool => tool?.name));
const missing = REQUIRED_TOOLS.filter(name => !names.has(name));
if (missing.length) fail(`upstream is missing required tools: ${missing.join(", ")}`);

await fetch(url, {
  method: "DELETE",
  redirect: "error",
  signal: AbortSignal.timeout(15_000),
  headers: { "mcp-session-id": sessionId },
}).catch(() => undefined);

process.stdout.write(`WORKSPACEX_BROWSER_MCP_ENDPOINT=LIVE tools=${REQUIRED_TOOLS.length}\n`);
