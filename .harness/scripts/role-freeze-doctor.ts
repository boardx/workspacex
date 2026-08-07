// role-freeze-doctor.ts — H3A-004 的仓库侧入口。
//
// pnpm harness role-freeze doctor
//
// 判定逻辑在 lib/role-freeze.ts（纯函数，喂 fixture 单测）。这里只做：
// 读 .harness/agents/roles/*.yaml + registry.yaml → 交给判定函数 → 打印
// WARN（不阻断，退出码恒 0——完成契约原文"WARN，不阻断"）。
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";
import { findUnregisteredRoles, type RoleFile } from "./lib/role-freeze";
import { log } from "./lib/log";
import type { Args } from "./lib/args";

const ROLES_DIR = join(REPO_ROOT, ".harness", "agents", "roles");
const REGISTRY_PATH = join(REPO_ROOT, ".harness", "agents", "registry.yaml");

function readRoleFiles(): RoleFile[] {
  if (!existsSync(ROLES_DIR)) return [];
  return readdirSync(ROLES_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const raw = parse(readFileSync(join(ROLES_DIR, file), "utf8")) as { name?: unknown } | null;
      const name = raw && typeof raw.name === "string" ? raw.name : null;
      return { sourceFile: `.harness/agents/roles/${file}`, name };
    });
}

/**
 * registry.yaml 顶层有两组身份数组：`agents:`（coordinator/module-coordinator/
 * worker）和 `reviewers:`（reviewer，`required_for`/`emits` 字段不同，单独
 * 分组）——两者都是"已登记角色"，缺任何一组都会把该组的全部角色误判成
 * "未登记"。实测踩过这个坑：第一版只读 `agents:`，把 rev-feature/rev-e2e
 * 误报成未登记，而它们其实在 `reviewers:` 数组里，PR review 走的是同一份
 * 文件、同一个流程。
 */
const IDENTITY_ARRAY_KEYS = ["agents", "reviewers"] as const;

function readRegisteredIds(): { ids: Set<string>; error: string | null } {
  if (!existsSync(REGISTRY_PATH)) {
    return { ids: new Set(), error: `registry.yaml 不存在：${REGISTRY_PATH}` };
  }
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (e) {
    return { ids: new Set(), error: `registry.yaml 解析失败：${(e as Error).message}` };
  }
  const root = parsed as Record<string, unknown> | null;
  const ids = new Set<string>();
  let sawAnyArray = false;
  for (const key of IDENTITY_ARRAY_KEYS) {
    const arr = root?.[key];
    if (arr === undefined) continue; // 该组本来就可能不存在（比如仓库还没有任何 reviewer）
    if (!Array.isArray(arr)) {
      return { ids: new Set(), error: `registry.yaml 的 ${key} 字段存在但不是数组` };
    }
    sawAnyArray = true;
    for (const a of arr) {
      const id = (a as { id?: unknown } | null)?.id;
      if (typeof id === "string") ids.add(id);
    }
  }
  if (!sawAnyArray) {
    return { ids: new Set(), error: `registry.yaml 里 ${IDENTITY_ARRAY_KEYS.join("/")} 一个都没有——结构可能变了` };
  }
  return { ids, error: null };
}

export function roleFreezeDoctor(_args: Args): void {
  const { ids, error } = readRegisteredIds();
  if (error) {
    // registry.yaml 是权威数据源，读不到时拒绝下判断（P8 fail-closed）——
    // 这条与"WARN 不阻断"不矛盾：不阻断说的是"角色未登记"这个判定本身的
    // 严重度，不是说"权威数据源读不到也不当回事"。
    log.err(`[role-freeze doctor] UNKNOWN —— ${error}，拒绝下判断`);
    process.exitCode = 1;
    return;
  }

  const roleFiles = readRoleFiles();
  const findings = findUnregisteredRoles(roleFiles, ids);

  if (findings.length === 0) {
    log.ok(`[role-freeze doctor] ${roleFiles.length} 个角色文件全部在 registry.yaml 登记`);
  } else {
    log.warn(`[role-freeze doctor] ${findings.length} 条未登记角色（WARN，不阻断）：`);
    for (const f of findings) log.warn(`   ${f.sourceFile}: ${f.message}`);
  }

  // WARN 不阻断——完成契约原文。真正的阻断权在 registry.yaml 自己的 PR review。
  process.exitCode = 0;
}
