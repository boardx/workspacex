import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";

const SESSION_TOKEN_KEY = "wsx.sessionToken";

function reject(code) {
  process.stderr.write(`DEVAPP_BROWSER_SMOKE_FAILED code=${code}\n`);
  process.exitCode = 1;
}

async function loadChromium() {
  // The dependency belongs to @repo/api, not the monorepo root. Anchor resolution at that
  // workspace so pnpm's strict node_modules layout behaves exactly like production.
  const requireFromApi = createRequire("/usr/local/lib/workspacex-devapp-browser-runtime/package.json");
  const { chromium } = requireFromApi("playwright");
  return chromium;
}

async function browserLaunchOptions() {
  const executablePath = process.env.DEVAPP_BROWSER_EXECUTABLE_PATH || (await loadChromium()).executablePath();
  if (!isAbsolute(executablePath)) throw new Error("browser executable path must be absolute");
  await access(executablePath, fsConstants.X_OK);
  return {
    headless: true,
    executablePath,
    args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
  };
}

async function browserRuntimePreflight() {
  let phase = "launch";
  let browser;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch(await browserLaunchOptions());
    const page = await browser.newPage();
    await page.goto("about:blank");
    process.stdout.write("DEVAPP_BROWSER_RUNTIME_PREFLIGHT_PASSED\n");
  } catch {
    reject("BROWSER_RUNTIME_UNAVAILABLE");
  } finally {
    await browser?.close();
  }
}

async function releaseSmoke(baseUrl, bootstrapEnv, baseline = false) {
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

  let phase = "launch";
  let browser;
  try {
    const chromium = await loadChromium();
    browser = await chromium.launch(await browserLaunchOptions());
    const page = await browser.newPage();
    phase="public_navigation";
    await page.goto(new URL("/login", origin).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    phase="login_fields";
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    phase="login_submit";
    await page.getByTestId("login-submit").click();
    phase="authenticated_redirect";
    await page.waitForURL(url => url.origin === origin.origin && url.pathname !== "/login", { timeout: 30_000 });
    phase="authenticated_notifications";
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
    else {
      phase="application-pages";
      for(const path of ["/home","/chat","/projects","/billing"]){
        const response=await page.goto(new URL(path,origin).href,{waitUntil:"domcontentloaded",timeout:20000});
        if(!response||response.status()>=400)throw new Error("page status");
        await page.waitForFunction(()=>document.body.innerText.length>100,{timeout:15000});
        if(new URL(page.url()).pathname==="/login"||await page.getByText("Application error:",{exact:false}).count())throw new Error("page render");
      }
      phase="billing-contract";
      const valid=await page.evaluate(async({tokenKey,baseline})=>{
        const token=localStorage.getItem(tokenKey);if(!token)return false;
        const headers={Authorization:`Bearer ${token}`};const values=[];
        for(const path of (baseline ? ["/api/billing/config","/api/billing/packages?ownerType=user"] : ["/api/billing/config","/api/billing/packages?ownerType=user","/api/billing/consumption/settings"])){
          const r=await fetch(path,{headers,credentials:"include"});if(r.status!==200)return false;values.push(await r.json());
        }
        return Array.isArray(values[0].enabledProviders)&&Array.isArray(values[1].items)&&(baseline || typeof values[2].creditPreflightEnabled==="boolean");
      },{tokenKey:SESSION_TOKEN_KEY,baseline});
      if(!valid)throw new Error("billing contract");
      process.stdout.write(baseline ? "DEVAPP_BROWSER_BASELINE_PASSED\n" : "DEVAPP_BROWSER_SMOKE_PASSED\n");
    }
  } catch(error) {
    process.stderr.write(`BROWSER_DIAG phase=${phase} errorType=${error?.name === "TimeoutError" ? "TimeoutError" : "Error"} netCode=${String(error?.message ?? "").match(/net::(ERR_[A-Z_]+)/)?.[1] ?? "none"}\n`);
    reject("BROWSER_JOURNEY_FAILED");
  } finally {
    await browser?.close();
  }
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--preflight") {
  await browserRuntimePreflight();
} else if (args.length === 3 && args[2] === "--baseline") {
  await releaseSmoke(args[0], args[1], true);
} else if (args.length === 2) {
  await releaseSmoke(args[0], args[1]);
} else {
  process.stderr.write("usage: cn-release-browser-smoke.mjs --preflight | <https-base-url> <bootstrap-env>\n");
  process.exitCode = 2;
}
