import { afterEach, describe, expect, it, vi } from "vitest";
import { parityIndex } from "../src/parity";
import { runToCompletion, startManaged } from "../src/processes";

afterEach(() => vi.unstubAllEnvs());

const acceptanceControls = ["KG_EVAL_FIXTURE", "KG_EVAL_RECALL_MODE"] as const;
const inspect = 'console.log(JSON.stringify({fixture:process.env.KG_EVAL_FIXTURE,mode:process.env.KG_EVAL_RECALL_MODE,html:process.env.DESIGN_HTML_PAGES,ordinary:process.env.LOCAL_RUNTIME_ENV_CONTROL,catalogUser:process.env.PLATFORM_ORG_CATALOG_DB_USER,catalogPassword:process.env.PLATFORM_ORG_CATALOG_DB_PASSWORD}))';
function parentControls(): void {
  vi.stubEnv("KG_EVAL_FIXTURE", "1");
  vi.stubEnv("KG_EVAL_RECALL_MODE", "vector_only");
  vi.stubEnv("DESIGN_HTML_PAGES", "0");
  vi.stubEnv("LOCAL_RUNTIME_ENV_CONTROL", "preserved");
  vi.stubEnv("PLATFORM_ORG_CATALOG_DB_USER", "cloud-catalog-user");
  vi.stubEnv("PLATFORM_ORG_CATALOG_DB_PASSWORD", "test-only-cloud-password");
}
const spec = { name: "parity-env", command: process.execPath, args: ["-e", inspect], cwd: process.cwd(), env: {} };
const expected = { html: "0", ordinary: "preserved" };

describe("local child environment parity", () => {
  it("classifies isolated KG controls as unset and the design override as default-safe", () => {
    for (const name of acceptanceControls) expect(parityIndex().get(name)).toBe("must-stay-unset");
    expect(parityIndex().get("DESIGN_HTML_PAGES")).toBe("default-ok");
  });

  it("does not inherit parent KG controls or cloud catalog credentials into run-to-completion children", async () => {
    parentControls();
    const result = await runToCompletion(spec);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(expected);
  });

  it("does not inherit parent KG controls or cloud catalog credentials into managed services", async () => {
    parentControls();
    const lines: string[] = [];
    const child = startManaged(spec, line => lines.push(line));
    try {
      expect(await child.exited).toBe(0);
      expect(JSON.parse(lines.find(line => line.includes('{'))!.slice('[parity-env] '.length))).toEqual(expected);
    } finally {
      await child.stop();
    }
  });

  it("keeps an explicit isolated seed-runner override possible", async () => {
    parentControls();
    const result = await runToCompletion({ ...spec, env: { KG_EVAL_FIXTURE: "1", KG_EVAL_RECALL_MODE: "hybrid" } });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ ...expected, fixture: "1", mode: "hybrid" });
  });
});
