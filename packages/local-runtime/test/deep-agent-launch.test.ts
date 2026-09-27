import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDeepAgentLaunch, resolveLocalConfig, type LocalConfig } from "../src/config";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

function config(): LocalConfig {
  const root = mkdtempSync(join(tmpdir(), "wsx-launch-"));
  for (const rel of ["apps/api", "apps/web", "apps/skill-sandbox", "apps/deep-agent-service", "packages/local-runtime"]) mkdirSync(join(root, rel), { recursive: true });
  for (const rel of ["apps/api", "apps/web", "apps/skill-sandbox"]) writeFileSync(join(root, rel, "package.json"), "{}");
  return resolveLocalConfig({ repoRoot: root, dataDir: join(root, "data") });
}

// 解释器与 venv 的布局按平台不同（Windows：cpython/python.exe、.venv/Scripts/uvicorn.exe、PYTHONPATH 用 `;`）。
// 原先写死 POSIX 形状，在 windows-latest 上三条全红——那测的是测试自己的假设，不是产品。
const WIN = process.platform === "win32";
const PYTHON = WIN ? ["cpython", "python.exe"] : ["cpython", "bin", "python3"];
const UVICORN = WIN ? ["Scripts", "uvicorn.exe"] : ["bin", "uvicorn"];

describe("resolveDeepAgentLaunch", () => {
  it("prefers the relocatable bundled Python and runs uvicorn as a module with site + src on PYTHONPATH", () => {
    const c = config();
    const bundle = "/Applications/WorkspaceX.app/Contents/Resources/python";
    const launch = resolveDeepAgentLaunch(c, bundle, (p) => p === join(bundle, ...PYTHON));
    expect(launch?.source).toBe("bundled-python");
    expect(launch?.command).toBe(join(bundle, ...PYTHON));
    expect(launch?.args.slice(0, 3)).toEqual(["-m", "uvicorn", "deep_agent_service.http_app:app"]);
    expect(launch?.env.PYTHONPATH).toBe([join(bundle, "site"), join(c.repoRoot, "apps", "deep-agent-service", "src")].join(delimiter));
    expect(launch?.env.PYTHONNOUSERSITE).toBe("1");
  });

  it("falls back to the dev venv's uvicorn when no bundle dir is given", () => {
    const c = config();
    const uvicorn = join(c.repoRoot, "apps", "deep-agent-service", ".venv", ...UVICORN);
    const launch = resolveDeepAgentLaunch(c, undefined, (p) => p === uvicorn);
    expect(launch?.source).toBe("venv");
    expect(launch?.command).toBe(uvicorn);
    expect(launch?.args[0]).toBe("deep_agent_service.http_app:app");
  });

  it("ignores a bundle dir whose interpreter is missing and still finds the venv", () => {
    const c = config();
    const uvicorn = join(c.repoRoot, "apps", "deep-agent-service", ".venv", ...UVICORN);
    expect(resolveDeepAgentLaunch(c, "/nowhere/python", (p) => p === uvicorn)?.source).toBe("venv");
  });

  it("returns null when neither exists (chat without tools, loud warning upstream)", () => {
    expect(resolveDeepAgentLaunch(config(), "/nowhere/python", () => false)).toBeNull();
  });
});
