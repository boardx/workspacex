import { join } from "node:path";
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

describe("resolveDeepAgentLaunch", () => {
  it("prefers the relocatable bundled Python and runs uvicorn as a module with site + src on PYTHONPATH", () => {
    const c = config();
    const bundle = "/Applications/WorkspaceX.app/Contents/Resources/python";
    const launch = resolveDeepAgentLaunch(c, bundle, (p) => p === join(bundle, "cpython", "bin", "python3"));
    expect(launch?.source).toBe("bundled-python");
    expect(launch?.command).toBe(join(bundle, "cpython", "bin", "python3"));
    expect(launch?.args.slice(0, 3)).toEqual(["-m", "uvicorn", "deep_agent_service.http_app:app"]);
    expect(launch?.env.PYTHONPATH).toBe(`${join(bundle, "site")}:${join(c.repoRoot, "apps", "deep-agent-service", "src")}`);
    expect(launch?.env.PYTHONNOUSERSITE).toBe("1");
  });

  it("falls back to the dev venv's uvicorn when no bundle dir is given", () => {
    const c = config();
    const uvicorn = join(c.repoRoot, "apps", "deep-agent-service", ".venv", "bin", "uvicorn");
    const launch = resolveDeepAgentLaunch(c, undefined, (p) => p === uvicorn);
    expect(launch?.source).toBe("venv");
    expect(launch?.command).toBe(uvicorn);
    expect(launch?.args[0]).toBe("deep_agent_service.http_app:app");
  });

  it("ignores a bundle dir whose interpreter is missing and still finds the venv", () => {
    const c = config();
    const uvicorn = join(c.repoRoot, "apps", "deep-agent-service", ".venv", "bin", "uvicorn");
    expect(resolveDeepAgentLaunch(c, "/nowhere/python", (p) => p === uvicorn)?.source).toBe("venv");
  });

  it("returns null when neither exists (chat without tools, loud warning upstream)", () => {
    expect(resolveDeepAgentLaunch(config(), "/nowhere/python", () => false)).toBeNull();
  });
});
