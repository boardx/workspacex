import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(import.meta.dirname, "..");

describe("skill-sandbox Docker npm dependency lock", () => {
  it("locks the package manifest and installs both stages with npm ci", async () => {
    const [dockerfile, packageJsonRaw, packageLockRaw] = await Promise.all([
      readFile(join(APP_ROOT, "Dockerfile"), "utf8"),
      readFile(join(APP_ROOT, "package.json"), "utf8"),
      readFile(join(APP_ROOT, "package-lock.json"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageJsonRaw) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const packageLock = JSON.parse(packageLockRaw) as {
      lockfileVersion: number;
      packages: Record<
        string,
        { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      >;
    };

    expect(packageLock.lockfileVersion).toBe(3);
    expect(packageLock.packages[""]?.dependencies).toEqual(packageJson.dependencies);
    expect(packageLock.packages[""]?.devDependencies).toEqual(packageJson.devDependencies);
    expect(dockerfile.match(/COPY package\.json package-lock\.json \.\//g)).toHaveLength(2);
    expect(dockerfile.match(/npm_config_registry="\$NPM_REGISTRY" npm ci/g)).toHaveLength(2);
    expect(dockerfile).toContain('ARG NPM_REGISTRY=https://registry.npmjs.org');
    expect(dockerfile).toContain('npm_config_registry="$NPM_REGISTRY" npm ci --omit=dev');
    expect(dockerfile).not.toMatch(/^RUN .*\bnpm install\b/m);
    expect(dockerfile).not.toMatch(/^RUN .*--(?:no-save|no-package-lock)\b/m);
    expect(dockerfile).not.toMatch(/^ENV\s+(?:NPM_REGISTRY|npm_config_registry)\b/m);
  });

  it("keeps Python analysis dependencies hash locked", async () => {
    const dockerfile = await readFile(join(APP_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile.match(/--require-hashes/g)).toHaveLength(2);
  });

  it("counterproof detects a floating runtime install", async () => {
    const dockerfile = await readFile(join(APP_ROOT, "Dockerfile"), "utf8");
    const floating = dockerfile.replace(
      'npm_config_registry="$NPM_REGISTRY" npm ci --omit=dev',
      "npm install --omit=dev --no-package-lock",
    );
    expect(floating).toMatch(/\bnpm install\b|--no-package-lock/);
    expect(floating.match(/npm_config_registry="\$NPM_REGISTRY" npm ci/g)).toHaveLength(1);
  });
});
