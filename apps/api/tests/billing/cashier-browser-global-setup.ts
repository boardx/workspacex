import { acquireHeavySuiteLock } from "../../../../.harness/scripts/lib/heavy-suite-lock";
/** This Vitest driver launches a real Playwright browser and Next server. Acquire
 * the shared browser lease before the following DB global setup starts PG. */
export default async function setup() {
  const lock = await acquireHeavySuiteLock({ command: ["playwright", "test", "via-vitest", "billing-cashier-actual-glue"] });
  return () => lock.release();
}
