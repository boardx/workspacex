import { afterEach, describe, expect, it, vi } from "vitest";
import { BILLING_PAYMENT_ENV_KEYS } from "../src/parity";
import { runToCompletion, startManaged } from "../src/processes";

afterEach(() => vi.unstubAllEnvs());
const fixtures = Object.fromEntries(BILLING_PAYMENT_ENV_KEYS.map((key) => [key, "test-only-billing-fixture"]));
const probe = "const keys=JSON.parse(process.argv[1]);console.log(JSON.stringify({billing:keys.map(key=>Object.hasOwn(process.env,key)),path:Boolean(process.env.PATH),ordinary:process.env.LOCAL_RUNTIME_ENV_CONTROL}));";
const spec = { name: "billing-env-probe", command: process.execPath, args: ["-e", probe, JSON.stringify(BILLING_PAYMENT_ENV_KEYS)], cwd: process.cwd(), env: { LOCAL_RUNTIME_ENV_CONTROL: "local-override" } };
const expected = { billing: BILLING_PAYMENT_ENV_KEYS.map(() => false), path: true, ordinary: "local-override" };
function inheritedFixtures(): void { for (const key of BILLING_PAYMENT_ENV_KEYS) vi.stubEnv(key, fixtures[key]); }

describe("local processes never enable payment channels", () => {
  it("removes all inherited billing keys from an actual run-to-completion child", async () => {
    inheritedFixtures();
    const child = await runToCompletion(spec);
    expect(child.code).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(expected);
  });

  it("cannot re-enable payments through explicit spawn environment overrides", async () => {
    const child = await runToCompletion({ ...spec, env: { ...fixtures, ...spec.env } });
    expect(child.code).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(expected);
  });

  it("removes both inherited and explicit billing keys from actual managed services", async () => {
    inheritedFixtures();
    const child = startManaged({ ...spec, env: { ...fixtures, ...spec.env } }, () => undefined);
    const closed = new Promise<void>((resolve) => child.child.once("close", () => resolve()));
    try {
      expect(await child.exited).toBe(0);
      await closed;
      expect(JSON.parse(child.recentOutput())).toEqual(expected);
    } finally {
      await child.stop();
    }
  });
});
