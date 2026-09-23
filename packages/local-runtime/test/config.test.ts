import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { apiEnv, deepAgentEnv, loadOrCreateSecrets, ollamaEnv, resolveLocalConfig, sandboxEnv, webEnv } from "../src/config";

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
    // 本地模型慢，第一个字什么时候出现决定这个产品好不好用；流式不是可选项
    expect(api.KERNEL_MODEL_STREAM_ENABLED).toBe("1");
    expect(api.KERNEL_DEEP_AGENT_STREAM_ENABLED).toBe("1");
    expect(api.WORKSPACEX_OBJECT_STORE).toBe("fs");
    expect(api.KERNEL_SKILL_SANDBOX_BASE_URL).toBe(`http://127.0.0.1:${sandboxEnv(c).SKILL_SANDBOX_PORT}`);
    expect(sandboxEnv(c).SKILL_SANDBOX_HOST).toBe("127.0.0.1");
    expect(api.KERNEL_DEEP_AGENT_BASE_URL).toBe("http://127.0.0.1:2024");
    expect(api.DEEP_AGENT_SERVICE_INTERNAL_KEY).toBe(py.DEEP_AGENT_SERVICE_INTERNAL_KEY);
    // browser calls the API directly; the API allows exactly the origins the web is served on
    expect(webEnv(c).NEXT_PUBLIC_API_URL).toBe("http://127.0.0.1:4200");
    expect(webEnv(c).NEXT_PUBLIC_API_WS_URL).toBe("http://127.0.0.1:4200");
    expect(api.KERNEL_CORS_ORIGINS).toBe("http://127.0.0.1:4100,http://localhost:4100");
    for (const [k, v] of Object.entries({ ...api, ...py })) {
      // The isolated download origin is the one deliberate exception: it must NOT be the
      // origin the session lives on (uploaded HTML/SVG would execute there), and
      // `*.localhost` resolves to 127.0.0.1 in every current browser, so it is still local.
      if (k === "WORKSPACEX_DOWNLOAD_ORIGIN") { expect(v).toMatch(/^http:\/\/downloads\.localhost:/); continue; }
      if (/^https?:\/\//.test(v)) expect(v).toMatch(/^https?:\/\/127\.0\.0\.1[:/]/);
    }
    // vendor-shaped capabilities stay unconfigured rather than pointed at a cloud
    for (const k of ["KERNEL_ASR_BASE_URL", "KERNEL_IMAGE_PROVIDER", "KERNEL_GUIDED_SEARCH_URL", "WORKSPACEX_BROWSER_MCP_ENDPOINT", "REDIS_HOST"]) {
      expect(api[k]).toBeUndefined();
    }
    expect(readFileSync(join(c.dataDir, "secrets.json"), "utf8")).toContain(api.MODEL_CREDENTIAL_KEY);
    // a developer's .env.local must not leak into the local shape; native sessions stay off
    expect(api.KERNEL_SKIP_LOCAL_ENV_FILE).toBe("1");
    expect(api.NATIVE_SESSION_SOCKET).toBe("");
    expect(api.KERNEL_NATIVE_RUNTIME).toBe("0");
  });
});

describe("resolveAsrModelDir", () => {
  it("prefers the data dir, falls back to the bundle copy, and reports null when neither has tokens.txt", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolveAsrModelDir, resolveLocalConfig, DEFAULT_ASR_MODEL, paths } = await import("../src/config");
    const dataDir = mkdtempSync(join(tmpdir(), "wsx-data-"));
    const c = resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir });
    const bundle = mkdtempSync(join(tmpdir(), "wsx-asr-bundle-"));
    expect(resolveAsrModelDir(c, bundle)).toBeNull();
    mkdirSync(join(bundle, DEFAULT_ASR_MODEL), { recursive: true });
    writeFileSync(join(bundle, DEFAULT_ASR_MODEL, "tokens.txt"), "x");
    expect(resolveAsrModelDir(c, bundle)).toBe(join(bundle, DEFAULT_ASR_MODEL));
    mkdirSync(paths.asrModelDir(c), { recursive: true });
    writeFileSync(join(paths.asrModelDir(c), "tokens.txt"), "x");
    expect(resolveAsrModelDir(c, bundle)).toBe(paths.asrModelDir(c));
  });
});

/** 与本文件其它用例同一套构造方式：真实 repo root + 临时数据目录。 */
const cfg = () => resolveLocalConfig({ repoRoot: REPO_ROOT, dataDir: join(tmp(), "ka") });

describe("模型保活策略（#3872 R1）", () => {
  it("不是 24 小时——那会让每请求涨 70 MB 的占用一整天不释放", () => {
    const env = ollamaEnv(cfg());
    expect(env.OLLAMA_KEEP_ALIVE).not.toBe("24h");
    expect(env.OLLAMA_KEEP_ALIVE).toBe("30m");
  });
  it("也不是 Ollama 的 5 分钟默认——一次工作会话里不该反复付冷加载", () => {
    expect(ollamaEnv(cfg()).OLLAMA_KEEP_ALIVE).not.toBe("5m");
  });
  it("上下文仍然显式给足，不吃 Ollama 4096 的静默截断", () => {
    expect(Number(ollamaEnv(cfg()).OLLAMA_CONTEXT_LENGTH)).toBeGreaterThanOrEqual(8192);
  });
});
