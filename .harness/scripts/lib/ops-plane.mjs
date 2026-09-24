/**
 * 运营平面名单——**唯一事实源**。
 *
 * 开源方案归属表里「不交付 · 内部运营平面」那一行落到代码目录上就是这份名单。
 * 两处要用它，所以放在这里而不是各写一份（本仓硬约束：同一事实不得声明在两处）：
 *   · lint-production-not-on-ops.mjs：生产不得依赖这些目录；
 *   · oss-dependency-inventory.mjs：这些目录不随产品交付，它们的依赖不算再分发。
 *
 * 改这里要同步改开源方案的归属表。
 */
export const OPS_DIRS = ["apps/coord-gateway", "apps/devportal", "apps/ops-console", "apps/ops-telemetry", "packages/coord-*"];

/** 仓库根（`.`）是 harness 工具链，不随产品交付。 */
export const NOT_SHIPPED_ROOT = ".";

/** 把 `packages/coord-*` 这类末尾通配展开成实际存在的目录。 */
export function expandOpsDirs(root, readdirSync, existsSync, join, dirname) {
  return OPS_DIRS.flatMap((pattern) => {
    if (!pattern.endsWith("*")) return existsSync(join(root, pattern)) ? [pattern] : [];
    const base = dirname(pattern);
    const prefix = pattern.slice(base.length + 1, -1);
    if (!existsSync(join(root, base))) return [];
    return readdirSync(join(root, base)).filter((e) => e.startsWith(prefix)).map((e) => `${base}/${e}`);
  });
}
