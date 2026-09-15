import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const SESSION_TOKEN_KEY = "wsx.sessionToken";

function reject(code) {
  process.stderr.write(`CN_BROWSER_SMOKE_FAILED code=${code}\n`);
  process.exitCode = 1;
}

async function loadChromium() {
  // The dependency belongs to @repo/api, not the monorepo root. Anchor resolution at that
  // workspace so pnpm's strict node_modules layout behaves exactly like production.
  const requireFromApi = createRequire(new URL("../../../apps/api/package.json", import.meta.url));
  const { chromium } = requireFromApi("playwright");
  return chromium;
}

async function browserRuntimePreflight() {
  let browser;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("about:blank");
    process.stdout.write("CN_BROWSER_RUNTIME_PREFLIGHT_PASSED\n");
  } catch {
    reject("BROWSER_RUNTIME_UNAVAILABLE");
  } finally {
    await browser?.close();
  }
}

async function releaseSmoke(baseUrl, bootstrapEnv) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    reject("INVALID_PUBLIC_URL");
    return;
  }
  const values = Object.fromEntries((await readFile(bootstrapEnv, "utf8")).split("\n").filter(Boolean).map(line => {
    const separator = line.indexOf("=");
    return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : ["", ""];
  }));
  const email = values.PROVISION_ADMIN_EMAIL;
  const password = values.PROVISION_ADMIN_PASSWORD;
  if (!email || !password) {
    reject("LOGIN_CREDENTIALS_MISSING");
    return;
  }

  let browser;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(new URL("/login", origin).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(url => url.origin === origin.origin && url.pathname !== "/login", { timeout: 30_000 });
    const probe = await page.evaluate(async ({ tokenKey }) => {
      const token = window.localStorage.getItem(tokenKey);
      if (!token) return { tokenPresent: false, status: 0, notificationsArray: false, unreadCountValid: false };
      try {
        const response = await fetch("/api/notifications", {
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
        });
        const payload = await response.json().catch(() => null);
        return {
          tokenPresent: true,
          status: response.status,
          notificationsArray: Array.isArray(payload?.notifications),
          unreadCountValid: Number.isInteger(payload?.unreadCount) && payload.unreadCount >= 0,
        };
      } catch {
        return { tokenPresent: true, status: 0, notificationsArray: false, unreadCountValid: false };
      }
    }, { tokenKey: SESSION_TOKEN_KEY });
    if (!probe.tokenPresent) reject("SESSION_TOKEN_MISSING");
    else if (probe.status !== 200) reject("NOTIFICATIONS_HTTP_FAILED");
    else if (!probe.notificationsArray || !probe.unreadCountValid) reject("NOTIFICATIONS_CONTRACT_DRIFT");
    else process.stdout.write("CN_BROWSER_SMOKE_PASSED\n");
  } catch {
    reject("BROWSER_JOURNEY_FAILED");
  } finally {
    await browser?.close();
  }
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--preflight") {
  await browserRuntimePreflight();
} else if (args.length === 2) {
  await releaseSmoke(args[0], args[1]);
} else {
  process.stderr.write("usage: cn-release-browser-smoke.mjs --preflight | <https-base-url> <bootstrap-env>\n");
  process.exitCode = 2;
}
