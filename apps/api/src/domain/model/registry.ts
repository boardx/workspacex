/**
 * The model pool row (F48 / uc-20-1 R7, `contracts/agent-runtime/domain.md` A 组).
 *
 * Innermost layer: no HTTP, no SQL, no clock. Every type and every enum here is DERIVED
 * from `@repo/contracts`; restating the eleven registry fields or the four status values
 * would be the same-fact-twice failure this project has hit nine times.
 *
 * ## What this file deliberately does NOT contain
 *
 * A list of models. The prototype's eighteen rows are ONE organization's example
 * configuration (uc-0-5 R2, uc-20-1 R6). `no-hardcoded-model-list.test.ts` asserts that
 * mechanically rather than trusting this paragraph.
 *
 * ## The pool's listing gap (#1381, design-delta `model-pool-listing`)
 *
 * F48's `user_visible_behavior` says the admin list shows kind / vendor / capability tags /
 * context window / unit price / compliance attributes / status. Until #1381 those fields
 * existed in the contract only on the way IN (`registerModel.in`) -- no operation's `out`
 * carried a pool row, and `POOL_LISTING_GAP` below existed to PIN that as a known gap rather
 * than let it go unnoticed (an agent may not add an operation to a contract awaiting
 * sign-off, `contract-design.md` §五 / ADR-020).
 *
 * `listModelPool` (`GET /models`) closes it, added as a design-delta -- merge is still
 * gated on a human flipping `phases/phase-01-run-a-project/design-deltas/model-pool-listing/
 * design-signoff.md` from `proposed` to `confirmed` (ADR-023). `POOL_LISTING_GAP` is left in
 * place as a computed constant rather than deleted: it is derived from `responseSchemas()`,
 * so it now evaluates to `[]` on its own, and `registry-fields.test.ts` asserts that emptiness
 * rather than the old five-field pin -- the reconciliation the original comment asked for.
 * `listSelectableModels` still returns `ModelCandidate`, the PICKER's five fields (I-2),
 * deliberately not the admin row -- a picker that carried unit price and vendor would be a
 * second listing surface.
 */
import { agentRuntime as C } from "@repo/contracts";
import type { z } from "zod";

/** Derived, never restated. */
export type ModelKind = z.infer<typeof C.ModelKind>;
export type ModelShape = z.infer<typeof C.ModelShape>;
export type ModelStatus = z.infer<typeof C.ModelStatus>;
export type RegisterModelInput = z.infer<typeof C.operations.registerModel.in>;
/** F50 · `disableModel.in.mode` — the two-way choice D-U5 forces (I-16). */
export type DisableMode = z.infer<typeof C.DisableMode>;
/** F50 · `listSelectableModels.in.consumer` — the three reuse points (usecases.md 可选范围过滤器). */
export type ModelConsumer = z.infer<typeof C.ModelConsumer>;
/** F50 · `listSelectableModels.in.purpose` — same judgement `routeModelCall` uses for confidential. */
export type ModelPurpose = z.infer<typeof C.ModelPurpose>;

export const MODEL_KINDS = C.ModelKind.options;
export const MODEL_SHAPES = C.ModelShape.options;
export const MODEL_STATUSES = C.ModelStatus.options;
export const DISABLE_MODES = C.DisableMode.options;
export const MODEL_CONSUMERS = C.ModelConsumer.options;
export const MODEL_PURPOSES = C.ModelPurpose.options;

/**
 * The state a freshly accepted model is in.
 *
 * Typed as `ModelStatus` rather than written as a bare string so a rename in the contract
 * is a compile error here instead of a literal that no longer means anything. `待测试` is
 * what I-1 forces: `enableModel` demands five `通过` verdicts, so a model that has just
 * arrived cannot be in any other state.
 */
export const INITIAL_MODEL_STATUS: ModelStatus = "待测试";

/** Every key `registerModel` accepts. Read off the contract, not transcribed. */
export const REGISTER_INPUT_FIELDS: readonly string[] = Object.keys(
  C.operations.registerModel.in.shape,
);

/**
 * The two secrets. **This is the only place they are named**, and naming them is
 * unavoidable: "which of these strings is a secret" is not derivable from a zod schema.
 *
 * What is NOT trusted to this list is the enforcement. `credential-never-echoed.test.ts`
 * scans every one of the contract's `out` schemas for secret-shaped keys independently of
 * this constant, so a third secret added to `registerModel.in` and forgotten here is still
 * caught by the scan the moment it reaches a response.
 */
export const CREDENTIAL_BEARING_FIELDS = ["credential", "endpoint"] as const;

/** Keys the pool row carries: everything registered except the two that only go in. */
export const MODEL_POOL_ROW_FIELDS: readonly string[] = REGISTER_INPUT_FIELDS.filter(
  (f) => !(CREDENTIAL_BEARING_FIELDS as readonly string[]).includes(f),
);

/**
 * Registered fields that no operation's `out` schema mentions anywhere.
 *
 * An OVER-approximation of "write-only". Before #1381 this also contained `vendor`,
 * `unitPrice`, `capabilityTags`, `contextWindow` and `members`, because the pool had no
 * listing operation at all (see the header); `listModelPool` now returns all five, so this
 * set has shrunk to exactly `CREDENTIAL_BEARING_FIELDS`. Two assertions use it, neither of
 * which needs it to be tight: the credentials must be INSIDE it (a containment check, which
 * an over-approximation cannot fake), and the rest of it is `POOL_LISTING_GAP` below.
 */
export const FIELDS_NO_RESPONSE_RETURNS: readonly string[] = REGISTER_INPUT_FIELDS.filter(
  (f) => !responseKeyNames().has(f),
);

/**
 * The registry fields F48 says the admin list shows, which no response currently carries.
 * Pinned so that adding a listing operation makes the gate fail rather than pass silently.
 */
export const POOL_LISTING_GAP: readonly string[] = FIELDS_NO_RESPONSE_RETURNS.filter(
  (f) => !(CREDENTIAL_BEARING_FIELDS as readonly string[]).includes(f),
);

/**
 * The row a member or an admin sees.
 *
 * ⚠ There is no `credential` and no `endpoint` key. The `Omit` is over
 * `CREDENTIAL_BEARING_FIELDS`' members, so the type and the runtime whitelist below cannot
 * disagree about which fields exist.
 */
export type ModelPoolRow = Omit<
  RegisterModelInput,
  (typeof CREDENTIAL_BEARING_FIELDS)[number]
> & {
  readonly modelId: string;
  readonly status: ModelStatus;
};

/**
 * Project an accepted registration into the row the pool exposes.
 *
 * ## Why a whitelist and not `delete row.credential`
 *
 * I-6 is "the credential is not in any response SCHEMA", not "the credential is stripped
 * before responding". The two differ exactly once -- when someone adds a field. A blacklist
 * that has not heard of the new field passes it through; a whitelist built from
 * `MODEL_POOL_ROW_FIELDS` cannot emit a key that list does not name, whatever the caller
 * hands it.
 *
 * ## Why it takes no principal
 *
 * I-6 says "no role". A function that cannot be told who is asking cannot grow the branch
 * that answers differently for an admin -- and that branch is where a "credentials are
 * admin-only" design puts its leak. Who may read the pool AT ALL is `identity`'s judgement
 * (`decideCapabilityVisibility`), taken before this is called; it decides whether a row
 * comes back, never which keys the row has.
 */
export function projectPoolRow(
  input: RegisterModelInput,
  identity: { readonly modelId: string; readonly status: ModelStatus },
): ModelPoolRow {
  const row: Record<string, unknown> = { modelId: identity.modelId, status: identity.status };
  for (const field of MODEL_POOL_ROW_FIELDS) {
    row[field] = (input as unknown as Record<string, unknown>)[field];
  }
  return row as unknown as ModelPoolRow;
}

/** Every key name reachable in any operation's `out` schema. */
function responseKeyNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const op of Object.values(C.operations) as readonly { out?: unknown }[]) {
    if (op.out) collectKeys(op.out as z.ZodTypeAny, names, new Set());
  }
  return names;
}

/**
 * Walk a zod schema and collect object key names.
 *
 * Hand-written rather than borrowed because the walk itself is load-bearing: a walker that
 * stopped at arrays would report `listMcpServers` as key-free and then declare every field
 * inside it unreturned. `seen` guards against recursive schemas.
 */
function collectKeys(schema: z.ZodTypeAny, into: Set<string>, seen: Set<unknown>): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  switch (def?.typeName as string | undefined) {
    case "ZodObject": {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
      for (const [key, value] of Object.entries(shape)) {
        into.add(key);
        collectKeys(value, into, seen);
      }
      return;
    }
    case "ZodArray":
      return collectKeys(def!.type as z.ZodTypeAny, into, seen);
    case "ZodOptional":
    case "ZodNullable":
      return collectKeys(def!.innerType as z.ZodTypeAny, into, seen);
    case "ZodRecord":
      return collectKeys(def!.valueType as z.ZodTypeAny, into, seen);
    case "ZodUnion":
      for (const option of def!.options as readonly z.ZodTypeAny[]) collectKeys(option, into, seen);
      return;
    default:
      return;
  }
}

/**
 * The same walk, over an arbitrary schema. Exported so the credential gate can run it on a
 * PLANTED schema and prove the walk actually finds a leak -- a scanner that never returns a
 * hit reads exactly like a clean codebase.
 */
export function schemaKeyNames(schema: z.ZodTypeAny): ReadonlySet<string> {
  const names = new Set<string>();
  collectKeys(schema, names, new Set());
  return names;
}

/** Every operation's response schema, by operation name. */
export function responseSchemas(): ReadonlyMap<string, z.ZodTypeAny> {
  const out = new Map<string, z.ZodTypeAny>();
  for (const [name, op] of Object.entries(C.operations) as readonly [string, { out?: unknown }][]) {
    if (op.out) out.set(name, op.out as z.ZodTypeAny);
  }
  return out;
}
