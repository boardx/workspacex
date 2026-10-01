import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type WorkspacePackage = { name: string; directory: string; dependencies: Record<string, string> };
const root = resolve(import.meta.dirname, "../../..");

function packagesAt(repository: string): WorkspacePackage[] {
  return ["apps", "packages"].flatMap((area) =>
    readdirSync(resolve(repository, area), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(resolve(repository, area, entry.name, "package.json")))
      .map((entry) => {
        const manifest = JSON.parse(readFileSync(resolve(repository, area, entry.name, "package.json"), "utf8"));
        return {
          name: manifest.name as string,
          directory: `${area}/${entry.name}`,
          dependencies: { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies },
        };
      }),
  );
}

/** Directory COPY coverage before dependency installation, not a package-name string check. */
function missingWorkspaceDirectories(packages: WorkspacePackage[], dockerfile: string): string[] {
  const install = dockerfile.indexOf("pnpm install");
  if (install < 0) throw new Error("API dependency installation missing");
  const copied = dockerfile.slice(0, install).replace(/\\\r?\n/g, " ").split("\n")
    .filter((line) => /^\s*COPY\s/i.test(line) && !/--from(?:=|\s)/.test(line))
    .flatMap((line) => {
      const args = line.replace(/^\s*COPY\s+/i, "").replace(/--[\w-]+=[^\s]+\s*/g, "");
      const tokens: string[] = args.trim().startsWith("[") ? JSON.parse(args) : args.trim().split(/\s+/);
      const normalize = (value: string) => value.replace(/^\.\//, "").replace(/^\/opt\/workspacex\//, "").replace(/\/$/, "") || ".";
      const destination = normalize(tokens.at(-1)!);
      return tokens.slice(0, -1).map(normalize).filter((source) => source === destination);
    });
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const visited = new Set<string>();
  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    const pkg = byName.get(name);
    if (!pkg) throw new Error(`Missing workspace package ${name}`);
    for (const [dependency, version] of Object.entries(pkg.dependencies)) {
      if (version.startsWith("workspace:")) visit(dependency);
    }
  }
  visit("@repo/api");
  return [...visited].map((name) => byName.get(name)!.directory)
    .filter((directory) => !copied.some((source) => source === "." || directory === source || directory.startsWith(`${source}/`)))
    .sort();
}

describe("API image dependency context", () => {
  it("copies every direct and transitive workspace package before pnpm installs API", () => {
    const dockerfile = readFileSync(resolve(root, "deploy/aliyun/images/api.Dockerfile"), "utf8");
    expect(missingWorkspaceDirectories(packagesAt(root), dockerfile)).toEqual([]);
  });

  const graph: WorkspacePackage[] = [
    { name: "@repo/api", directory: "apps/api", dependencies: { "@repo/middle": "workspace:*" } },
    { name: "@repo/middle", directory: "packages/middle", dependencies: { "@repo/local-asr-gateway": "workspace:*" } },
    { name: "@repo/local-asr-gateway", directory: "apps/local-asr-gateway", dependencies: {} },
  ];
  const context = "COPY apps/api ./apps/api\nCOPY packages ./packages\n";
  it("rejects a missing transitive app workspace", () => {
    expect(missingWorkspaceDirectories(graph, context + "RUN pnpm install --filter @repo/api...\n"))
      .toEqual(["apps/local-asr-gateway"]);
  });
  it("rejects copying only its manifest or copying its source after installation", () => {
    for (const text of [
      context + "COPY apps/local-asr-gateway/package.json ./apps/local-asr-gateway/\nRUN pnpm install\n",
      context + "RUN pnpm install\nCOPY apps/local-asr-gateway ./apps/local-asr-gateway\n",
      context + "COPY apps/local-asr-gateway ./wrong-directory\nRUN pnpm install\n",
    ]) expect(missingWorkspaceDirectories(graph, text)).toEqual(["apps/local-asr-gateway"]);
  });
  it("accepts whole directory coverage and JSON COPY syntax", () => {
    expect(missingWorkspaceDirectories(graph, context + 'COPY --chown=node:node ["apps/local-asr-gateway", "./apps/local-asr-gateway"]\nRUN pnpm install\n'))
      .toEqual([]);
  });
});
