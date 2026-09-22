/**
 * `contract-route-coverage.ts` 的读盘侧（同 `phase-readiness.ts` / `phase-readiness-fs.ts`
 * 的分层：纯判定 + fixture 单测在那边，这里只负责「把真文件读成判定的入参」）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, findPhaseDir } from "./paths";
import { loadRoadmap } from "./roadmap";
import { loadFeatureList } from "./features";
import { readBundleSignoffs } from "./design-signoff";
import {
  judgeContractRouteCoverage,
  parseNestRoutes,
  type BundleInput,
  type CoverageReport,
  type RouteDecl,
  type UnresolvedRoute,
} from "./contract-route-coverage";

export const CONTRACTS_SRC_DIR = join(REPO_ROOT, "packages/contracts/src");
export const INTERFACE_DIR = join(REPO_ROOT, "apps/api/src/interface");

/** 递归收集 `apps/api/src/interface/` 下的 `.ts`（跳过 `.d.ts` 与测试文件） */
function collectInterfaceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collectInterfaceFiles(full, out);
      continue;
    }
    if (!name.endsWith(".ts") || name.endsWith(".d.ts") || name.includes(".test.")) continue;
    out.push(full);
  }
  return out;
}

export interface LoadedRoutes {
  readonly routes: readonly RouteDecl[];
  readonly unresolved: readonly UnresolvedRoute[];
  readonly filesScanned: number;
}

export function loadInterfaceRoutes(): LoadedRoutes {
  const routes: RouteDecl[] = [];
  const unresolved: UnresolvedRoute[] = [];
  const files = collectInterfaceFiles(INTERFACE_DIR);
  for (const full of files) {
    const rel = relative(REPO_ROOT, full);
    const parsed = parseNestRoutes(rel, readFileSync(full, "utf8"));
    routes.push(...parsed.routes);
    unresolved.push(...parsed.unresolved);
  }
  return { routes, unresolved, filesScanned: files.length };
}

/**
 * 束 → 契约文件：目录名同名的 `packages/contracts/src/<bundle>.ts`。
 *
 * ⚠ 对不上的束（本仓有 18 个，如 `deep-research` / `web-kernel`）**不判**，并在报告里
 *   逐条写明理由。别在这里塞一张手维护的别名表——那就是第二份事实源，会和目录一起漂。
 */
export function bundleContractFile(bundle: string): string | null {
  const full = join(CONTRACTS_SRC_DIR, `${bundle}.ts`);
  return existsSync(full) ? relative(REPO_ROOT, full) : null;
}

export function loadBundleInputs(phaseIds?: readonly string[]): BundleInput[] {
  const ids =
    phaseIds ??
    loadRoadmap()
      .phases.map((p) => p.id)
      .filter((id) => {
        try {
          findPhaseDir(id);
          return true;
        } catch {
          return false;
        }
      });

  const inputs: BundleInput[] = [];
  for (const phase of ids) {
    let featureStatus: Record<string, string>;
    try {
      featureStatus = Object.fromEntries(loadFeatureList(phase).features.map((f) => [f.id, f.status]));
    } catch {
      featureStatus = {}; // 纯 requirements 期的 phase：束会因「查无此 feature」自然落在判定范围外
    }
    for (const b of readBundleSignoffs(phase)) {
      const contractFile = bundleContractFile(b.bundle);
      inputs.push({
        bundle: b.bundle,
        phase,
        contractFile,
        contractSource: contractFile === null ? null : readFileSync(join(REPO_ROOT, contractFile), "utf8"),
        signoffStatus: b.status,
        covers: b.features,
        featureStatus,
      });
    }
  }
  return inputs;
}

export function contractRouteCoverage(phaseIds?: readonly string[]): CoverageReport {
  const { routes, unresolved } = loadInterfaceRoutes();
  return judgeContractRouteCoverage({ bundles: loadBundleInputs(phaseIds), routes, unresolvedRoutes: unresolved });
}
