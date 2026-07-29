#!/usr/bin/env node
/**
 * lint-no-builtin-capabilities.mjs -- the STATIC half of F15's acceptance V1
 * (uc-0-5 R6 AC1 / R7 / R12 V1, identity domain.md CapabilityListing).
 *
 * ## Why a static gate, when there is already a runtime test
 *
 * The runtime test asserts that an organization with no configuration gets `[]`. That is
 * necessary and it is not sufficient, and V1 says so in as many words: "only verifying that
 * configuration can be READ, without verifying that there is no built-in fallback, means the
 * second customer discovers the list was hardcoded all along."
 *
 * A codebase can pass the runtime test and still ship built-ins -- the fallback simply lives
 * on a branch the test does not take (an empty result, a missing organization, a first-run
 * seed). So this gate does not ask what the system returns. It asks whether a list of
 * agents / skills / models / MCPs / templates / blueprints exists in the source AT ALL.
 *
 * ## The two rules
 *
 *   1. PROTOTYPE ENTRIES. The six agent names the prototype drew as if they were product
 *      content -- Ava / Atlas / Scout / Ledger / Warden / Echo -- may not appear as string
 *      literals in product code. They are one organization's example configuration
 *      (uc-0-5 preamble); a product that knows their names has them built in.
 *
 *   2. LIST-SHAPED CONSTANTS. An array literal of two or more strings bound to a name that
 *      says it is a set of capabilities (`DEFAULT_*`, `SEED_*`, `*Agents`, `*models`, ...).
 *      This is the shape a built-in list actually takes, whatever it is called.
 *
 * Rule 2 is deliberately keyed on the NAME rather than on "any array of strings": an
 * over-firing gate gets muted, and this project has two precedents for exactly that. It
 * means a built-in list called `xs` slips through -- accepted, because rule 1 catches the
 * entries themselves and the runtime two-way assertion catches the behaviour. Three partial
 * checks that fail differently beat one that everyone turns off.
 *
 * ## The prototype UI's mock data is DEBT, and it is counted, not ignored
 *
 * `apps/web/lib/mock/` is full of exactly these lists -- that is what F15 exists to remove,
 * and it is still there because rewiring the console is UI-sign-off work that has not
 * happened (F15 carries `needs_ui_signoff: true`). Silently excluding it would make this
 * gate green on the side where the problem is. So those files are reported as DEBT with
 * their own count, the count is asserted by a test so it cannot grow, and everywhere else is
 * zero tolerance.
 *
 * ## Rule 3 lives in SQL
 *
 * No migration may INSERT into `capability_listings`. A seeded "recommended set" in the
 * schema would be indistinguishable from configuration a human made, and it would enter
 * through the one door a TypeScript scanner cannot see.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATIONS = join(ROOT, "apps/api/migrations");

/** The prototype's six agents. Named here so the gate can say WHY, not just that it fired. */
const PROTOTYPE_ENTRIES = ["Ava", "Atlas", "Scout", "Ledger", "Warden", "Echo"];
const ENTRY_RE = new RegExp(`(["'\`])(${PROTOTYPE_ENTRIES.join("|")})\\1`);

/** A name that claims to hold a set of capabilities. */
const LIST_NAME_RE =
  /(^|[_a-z])(default|builtin|built_in|seed|starter)[_A-Za-z]*$|(agents?|skills?|models?|mcps?|mcpservers?|templates?|blueprints?|capabilities)$/i;

/** `const X = [...]`, `X: [...]`, `X = [...]`. Non-nested on purpose -- see the header. */
const ARRAY_BINDING_RE = /(?:const|let|var)\s+(\w+)\s*(?::[^=]*)?=\s*\[([^\][]*)\]|(\w+)\s*:\s*\[([^\][]*)\]/g;

/**
 * Files whose built-in lists are known prototype debt.
 *
 * A prefix, with a reason, and its size is asserted elsewhere so it cannot quietly grow.
 */
const DEBT_PREFIXES = [
  [
    "apps/web/lib/mock/",
    "the standalone prototype's hand-written mock data -- the very lists F15 removes. Rewiring the admin console to /capabilities is UI-sign-off work (F15 needs_ui_signoff), so these are counted as debt rather than excused.",
  ],
];

const DEFAULT_ROOTS = [
  "apps/api/src",
  "packages/contracts/src",
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
];

const SKIP_DIRS = new Set(["node_modules", "generated", ".next", "dist"]);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n) || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

const isDebt = (rel) => DEBT_PREFIXES.some(([p]) => rel.startsWith(p));

const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;

let scanned = 0;
let violations = 0;
let debt = 0;

function report(rel, line, message, why) {
  if (isDebt(rel)) {
    debt++;
    console.log(`· [debt] ${rel}:${line}  ${message}`);
    return;
  }
  violations++;
  console.error(`✗ ${rel}:${line}  ${message}`);
  console.error(`    ${why}`);
}

for (const root of roots) {
  const abs = root.startsWith("/") ? root : join(ROOT, root);
  if (!existsSync(abs)) {
    console.log(`  (skipping ${root}: does not exist)`);
    continue;
  }
  for (const file of walk(abs)) {
    scanned++;
    const rel = relative(ROOT, file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // A comment naming a prototype agent is documentation of the rule, not a violation of
      // it -- the same exemption lint-permission-paths and lint-error-leak both make.
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;

      const entry = ENTRY_RE.exec(line);
      if (entry) {
        report(
          rel, i + 1,
          `built-in capability entry \`${entry[2]}\``,
          "uc-0-5: the prototype's six agents are ONE organization's example configuration. A product that knows their names has them built in, and the second customer's install becomes a code change.",
        );
      }

      for (const m of line.matchAll(ARRAY_BINDING_RE)) {
        const name = m[1] ?? m[3];
        const body = m[2] ?? m[4] ?? "";
        if (!name || !LIST_NAME_RE.test(name)) continue;
        const strings = body.match(/(["'`])(?:(?!\1).)*\1/g) ?? [];
        if (strings.length < 2) continue;
        report(
          rel, i + 1,
          `list-shaped constant \`${name}\` with ${strings.length} entries`,
          "uc-0-5 R7: capability lists are ORGANIZATION CONFIGURATION. They come from capability_listings, never from source. Move it to the organization's configuration (POST /capabilities/mutate).",
        );
      }
    });
  }
}

/* -- rule 3: no seed rows in SQL either ------------------------------------ */
let migrationsChecked = 0;
if (existsSync(MIGRATIONS)) {
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    migrationsChecked++;
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const [n, line] of sql.split("\n").entries()) {
      if (/^\s*--/.test(line)) continue;
      if (/INSERT\s+INTO\s+capability_listings/i.test(line)) {
        violations++;
        console.error(`✗ apps/api/migrations/${f}:${n + 1}  seeds capability_listings`);
        console.error(
          "    A row installed by a migration is indistinguishable, from every layer above, from configuration a human made -- so V1's empty state would be showing a built-in list that no static scan of the TypeScript could ever find.",
        );
      }
    }
  }
}

console.log(
  violations === 0
    ? `✅ lint-no-builtin-capabilities: no built-in capability list in product code`
    : `\n❌ ${violations} built-in capability list(s). uc-0-5 R7 / R12 V1.`,
);
// Machine-readable, asserted by no-builtin-capability-lists.test.ts. Against an empty tree
// this gate exits 0 while checking nothing -- so the test asserts these numbers, not the
// exit code. That failure mode has occurred nine times in this project.
console.log(`scanned=${scanned} violations=${violations} debt=${debt} migrations=${migrationsChecked}`);
process.exit(violations === 0 ? 0 : 1);
