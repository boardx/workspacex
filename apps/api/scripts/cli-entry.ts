/**
 * "Am I the process entry script?" for `apps/api/scripts/*.ts`.
 *
 * Every backfill script used to compare `import.meta.url === \`file://${process.argv[1]}\``.
 * That literal comparison is false whenever the path contains a character that a file URL
 * percent-encodes (a space is the common one: `.../WorkspaceX Local.app/...`), so the
 * script printed nothing, changed nothing and **exited 0** — the caller recorded "seeded".
 * WorkspaceX Local ran its whole first start that way on 2026-09-17: platform org, four
 * official skills and the 19 built-in canvas templates all silently absent (#3716).
 *
 * `pathToFileURL` applies the same encoding Node used to build `import.meta.url`.
 */
import { pathToFileURL } from "node:url";

export function isCliEntry(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === moduleUrl;
  } catch {
    return false;
  }
}
