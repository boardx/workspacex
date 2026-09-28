/**
 * DB-free test files: pure filesystem / pure-function tests that never touch PostgreSQL.
 *
 * Single source for which test files may run without the DB-backed globalSetup. When the
 * vitest CLI is given ONLY file filters that fall under these prefixes, `db-global-setup.ts`
 * skips the isolation/docker/capacity dance entirely, so e.g.
 * `pnpm --filter api exec vitest run tests/work-eval/gates-g0-g4.test.ts` runs on a machine
 * without Docker (EV03 review). A mixed selection (or no filter = full suite) keeps the full
 * DB setup — nothing is skipped silently for DB tests.
 *
 * Guard: a listed file that imports the DB fixtures (`support/db`, `pg`, `createApp`) makes
 * the setup THROW instead of skipping — being on this list is a checked claim, not a hope.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const DB_FREE_TEST_PREFIXES = ["tests/work-eval/"] as const;

const DB_IMPORT = /from\s+["'](?:[^"']*support\/db(?:-[^"']*)?|pg)["']|\bcreateApp\s*\(/;

function positionalFilters(argv: readonly string[]): string[] {
  const i = argv.findIndex(a => a === "run" || a === "watch" || a === "related");
  const rest = i >= 0 ? argv.slice(i + 1) : [];
  const out: string[] = [];
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k]!;
    if (a.startsWith("-")) {
      // `--config x` / `--project x` style options take a value; boolean flags don't matter here.
      if (!a.includes("=") && /^--(config|project|root|dir|reporter|outputFile|shard|testNamePattern)$|^-[ct]$/.test(a)) k++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** True when every CLI file filter targets a DB-free prefix (and the prefix files are verified DB-free). */
export function selectionIsDbFree(apiDir: string, argv: readonly string[] = process.argv, cwd = process.cwd()): boolean {
  const filters = positionalFilters(argv).map(f => relative(apiDir, join(cwd, f)).split(sep).join("/"));
  if (filters.length === 0) return false;
  if (!filters.every(f => DB_FREE_TEST_PREFIXES.some(p => f.startsWith(p)))) return false;
  for (const prefix of DB_FREE_TEST_PREFIXES) {
    for (const file of walk(join(apiDir, prefix)).filter(f => f.endsWith(".ts"))) {
      if (DB_IMPORT.test(readFileSync(file, "utf8"))) {
        throw new Error(`${relative(apiDir, file)} is under DB-free prefix ${prefix} but imports DB fixtures; move it or drop the prefix from tests/support/db-free-tests.ts`);
      }
    }
  }
  return true;
}
