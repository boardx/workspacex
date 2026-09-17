import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { apiEnv, deepAgentEnv, loadOrCreateSecrets, resolveLocalConfig, sandboxEnv, webEnv } from "../src/config";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "wsx-local-")); dirs.push(d); return d; }

describe("local config", () => {
  it("generates secrets once, 0600, and reuses them on the next resolve", () => {
    const dataDir = join(tmp(), "data");
    const a = loadOrCreateSecrets(dataDir);
    const b = loadOrCreateSecrets(dataDir);
    expect(b).toEqual(a);
    expect(statSync(join(dataDir, "secrets.json")).mode & 0o777).toBe(0o600);
    expect(a.modelCredentialKey.length).toBeGreaterThanOrEqual(32);
  });

  it("refuses a repo root that is not the monorepo/bundle", () => {
    expect(() => resolveLocalConfig({ repoRoot: tmp(), dataDir: tmp() })).toThrow(/lacks apps\/api/);
  });

  it("points every service at loopback and at the same model endpoint", () => {
    const c = resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir: join(tmp(), "d"), ports: { api: 4200, web: 4100, ollama: 41434 } });
    const api = apiEnv(c);
    const py = deepAgentEnv(c);
    expect(api.KERNEL_MODEL_BASE_URL).toBe("http://127.0.0.1:41434/v1");
    expect(py.KERNEL_MODEL_BASE_URL).toBe(api.KERNEL_MODEL_BASE_URL);
    expect(py.KERNEL_MODEL_API_KEY).toBe(api.KERNEL_MODEL_API_KEY);
    expect(api.KERNEL_MODEL_ID).toBe("qwen3.5:4b");
    expect(api.LOCAL_RUNTIME_ENDPOINT).toBe("http://127.0.0.1:41434");
    expect(api.KERNEL_SESSION_STORE).toBe("file");
    expect(api.WORKSPACEX_OBJECT_STORE).toBe("fs");
    expect(api.KERNEL_SKILL_SANDBOX_BASE_URL).toBe(`http://127.0.0.1:${sandboxEnv(c).SKILL_SANDBOX_PORT}`);
    expect(sandboxEnv(c).SKILL_SANDBOX_HOST).toBe("127.0.0.1");
    expect(api.KERNEL_DEEP_AGENT_BASE_URL).toBe("http://127.0.0.1:2024");
    expect(api.DEEP_AGENT_SERVICE_INTERNAL_KEY).toBe(py.DEEP_AGENT_SERVICE_INTERNAL_KEY);
    // browser talks same-origin through the Next proxy; only WebSockets go straight to the API
    expect(webEnv(c).NEXT_PUBLIC_API_URL).toBe("/");
    expect(webEnv(c).API_INTERNAL_URL).toBe("http://127.0.0.1:4200");
    expect(webEnv(c).NEXT_PUBLIC_API_PATH_PREFIX).toBe("/__fullstack_api");
    expect(webEnv(c).FULLSTACK_E2E_API_ORIGIN).toBe("http://127.0.0.1:4200");
    expect(webEnv(c).NEXT_PUBLIC_API_WS_URL).toBe("http://127.0.0.1:4200");
    for (const v of Object.values({ ...api, ...py })) {
      if (/^https?:\/\//.test(v)) expect(v).toMatch(/^https?:\/\/127\.0\.0\.1[:/]/);
    }
    // vendor-shaped capabilities stay unconfigured rather than pointed at a cloud
    for (const k of ["KERNEL_ASR_BASE_URL", "KERNEL_IMAGE_PROVIDER", "KERNEL_GUIDED_SEARCH_URL", "WORKSPACEX_BROWSER_MCP_ENDPOINT", "REDIS_HOST"]) {
      expect(api[k]).toBeUndefined();
    }
    expect(readFileSync(join(c.dataDir, "secrets.json"), "utf8")).toContain(api.MODEL_CREDENTIAL_KEY);
  });
});
