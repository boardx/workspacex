import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const PROJECT = "devportal";
const CUSTOM_ORIGIN = "https://develop.boardx.us";
const PAGES_ORIGIN = "https://devportal-4mx.pages.dev";
const API_ROOT = "https://api.cloudflare.com/client/v4";

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function cloudflareError(response, body, operation) {
  const codes = Array.isArray(body?.errors)
    ? body.errors.map((entry) => entry?.code).filter((code) => code !== undefined)
    : [];
  const suffix = codes.length > 0 ? `, codes=${codes.join(",")}` : "";
  return new Error(`${operation} failed (HTTP ${response.status}${suffix})`);
}

async function listKnownGoodProduction({ accountId, token, fetchImpl }) {
  const url = new URL(
    `${API_ROOT}/accounts/${encodeURIComponent(accountId)}/pages/projects/${PROJECT}/deployments`,
  );
  url.searchParams.set("env", "production");
  url.searchParams.set("per_page", "25");
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await responseJson(response);
  if (!response.ok || body?.success !== true || !Array.isArray(body.result)) {
    throw cloudflareError(response, body, "list production deployments");
  }
  const knownGood = body.result.find(
    (deployment) =>
      deployment?.environment === "production" &&
      deployment?.latest_stage?.status === "success" &&
      typeof deployment?.id === "string" &&
      deployment.id.length > 0,
  );
  if (!knownGood) {
    throw new Error("no known-good production deployment is available; refusing to publish");
  }
  return knownGood.id;
}

async function rollbackProduction({ accountId, token, deploymentId, fetchImpl }) {
  const url = `${API_ROOT}/accounts/${encodeURIComponent(accountId)}/pages/projects/${PROJECT}/deployments/${encodeURIComponent(deploymentId)}/rollback`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await responseJson(response);
  if (!response.ok || body?.success !== true) {
    throw cloudflareError(response, body, "rollback");
  }
}

async function expectStatus(fetchImpl, url, expected, init = {}) {
  const response = await fetchImpl(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
  if (response.status !== expected) {
    throw new Error(`${new URL(url).pathname} expected HTTP ${expected}, got ${response.status}`);
  }
  return response;
}

/**
 * Production smoke is deliberately credential-free. It validates the Access boundary, the
 * protected coord-gateway proxy, and a complete OAuth state/callback failure path without
 * authorizing a real GitHub user.
 */
export async function smokeProduction({ fetchImpl = fetch }) {
  await expectStatus(fetchImpl, `${CUSTOM_ORIGIN}/`, 302);
  await expectStatus(fetchImpl, `${PAGES_ORIGIN}/api/portal/pulse`, 401);

  const login = await expectStatus(
    fetchImpl,
    `${PAGES_ORIGIN}/api/coord/oauth/github/login?return_to=%2Fme`,
    302,
  );
  const location = login.headers.get("location");
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!location || !cookie) throw new Error("OAuth login did not issue redirect and state cookie");

  const authorize = new URL(location);
  if (
    authorize.origin !== "https://github.com" ||
    authorize.pathname !== "/login/oauth/authorize"
  ) {
    throw new Error("OAuth login did not redirect to GitHub authorize");
  }
  if (!authorize.searchParams.get("client_id")) throw new Error("OAuth client_id is not configured");
  const state = authorize.searchParams.get("state");
  if (!state) throw new Error("OAuth state is missing");

  const callback = new URL("/api/coord/oauth/github/callback", PAGES_ORIGIN);
  callback.searchParams.set("code", "workspacex-production-smoke-invalid");
  callback.searchParams.set("state", state);
  const callbackResponse = await expectStatus(fetchImpl, callback, 401, {
    headers: { cookie },
  });
  const body = await responseJson(callbackResponse);
  if (body?.error !== "oauth_failed" || body?.reason !== "code_exchange_failed") {
    throw new Error("OAuth callback did not reach the fail-closed code exchange boundary");
  }
}

export async function runPagesCutover({
  env = process.env,
  fetchImpl = fetch,
  deploy = defaultDeploy,
  smoke = smokeProduction,
  logger = console,
} = {}) {
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID");
  const token = required(env, "CLOUDFLARE_API_TOKEN");
  required(env, "GITHUB_SHA");

  const previousDeploymentId = await listKnownGoodProduction({ accountId, token, fetchImpl });
  logger.info("Captured the current successful production deployment for rollback.");

  try {
    await deploy({ env });
    await smoke({ fetchImpl });
    logger.info("DevPortal production cutover and OAuth smoke passed.");
  } catch (cutoverError) {
    logger.error(`Production cutover failed: ${cutoverError.message}`);
    try {
      await rollbackProduction({
        accountId,
        token,
        deploymentId: previousDeploymentId,
        fetchImpl,
      });
      await smoke({ fetchImpl });
    } catch (rollbackError) {
      throw new Error(`production cutover failed and rollback failed: ${rollbackError.message}`, {
        cause: cutoverError,
      });
    }
    throw new Error("production cutover failed; rolled back to the previous healthy deployment", {
      cause: cutoverError,
    });
  }
}

function defaultDeploy({ env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "wrangler",
        "pages",
        "deploy",
        ".vercel/output/static",
        "--project-name",
        PROJECT,
        "--branch",
        "main",
        "--commit-hash",
        required(env, "GITHUB_SHA"),
      ],
      { env, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `wrangler deploy exited with code=${code ?? "null"}, signal=${signal ?? "none"}`,
          ),
        );
      }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPagesCutover().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
