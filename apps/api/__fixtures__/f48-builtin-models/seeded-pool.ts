/**
 * COUNTER-PROOF FIXTURE. Not product code, not compiled (`__fixtures__` is excluded from
 * tsconfig), never imported by anything that ships.
 *
 * `no-hardcoded-model-list.test.ts` runs its "no prototype model name appears in product
 * code" scan against this directory and asserts it FIRES. The names below are taken from
 * the prototype's own eighteen rows, which is the point: a scanner that derives its needles
 * from `apps/web/lib/mock/admin.ts` and then fails to match them would report a clean tree
 * for the exact reason it is broken.
 */
export const STARTER_POOL = [
  { id: "m-gpt52", name: "gpt-5.2" },
  { id: "m-qwen32", name: "qwen3-32b" },
];

/** The other shape a built-in arrives in: a fallback on an empty read. */
export function poolForOrg(rows: readonly { id: string }[]): readonly { id: string }[] {
  return rows.length === 0 ? STARTER_POOL : rows;
}
