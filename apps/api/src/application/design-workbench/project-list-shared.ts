/** 批量投影一组项目行——一次查询取全部 owner 的显示名，不逐行各查一次（同 `list-feedback.ts`）。 */
import { ownerNamesFor, projectDesignProject, type DesignProjectDeps, type DesignProjectView } from "./project-shared";
import type { DesignProjectRow } from "./project-ports";

export async function loadOwnerNamesAndProject(
  deps: DesignProjectDeps,
  rows: readonly DesignProjectRow[],
): Promise<readonly DesignProjectView[]> {
  const names = await ownerNamesFor(deps, rows.map((r) => r.ownerId));
  return rows.map((row) => projectDesignProject(row, names.get(row.ownerId) ?? null));
}
