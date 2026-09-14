import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const [baseUrl, bootstrapEnv] = process.argv.slice(2);
if (!baseUrl || !bootstrapEnv) process.exit(2);
const origin = new URL(baseUrl);
if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) process.exit(2);
const values = Object.fromEntries((await readFile(bootstrapEnv, "utf8")).split("\n").filter(Boolean).map(line => {
  const separator = line.indexOf("=");
  return separator > 0 ? [line.slice(0, separator), line.slice(separator + 1)] : ["", ""];
}));
const email = values.PROVISION_ADMIN_EMAIL, password = values.PROVISION_ADMIN_PASSWORD;
if (!email || !password) process.exit(1);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(new URL("/login", origin).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(url => url.origin === origin.origin && url.pathname !== "/login", { timeout: 30_000 });
  const status = await page.evaluate(async () => (await fetch("/api/notifications", { credentials: "include" })).status);
  if (status !== 200) process.exitCode = 1;
  else process.stdout.write("CN_BROWSER_SMOKE_PASSED\n");
} finally { await browser.close(); }
