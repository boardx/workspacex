/**
 * Ports for the personal-local organization (F16). Defined here, implemented by
 * `infrastructure` -- the usual direction inversion, with one port that is unusual enough to
 * deserve its own explanation.
 */
import type { OrgId } from "../../domain/org-id";

/**
 * The local inference runtime -- the thing that has to be running on this machine.
 *
 * ⚠ There is no `fallbackEndpoint`, no `preferLocal` flag and no second implementation that
 * "tries local first". Every one of those is a shape in which a cloud call can happen while
 * the code still reads as local-first, and the feature's own acceptance says the failure must
 * be VISIBLE: "本地运行时没起来时显示依赖失败态并给出启动指引，绝不偷偷改用云端".
 * A port that cannot express a fallback is how that survives the next refactor.
 */
export interface LocalModelRuntime {
  /** Where this runtime lives. Asserted to be loopback by the use case AND by migration 0012. */
  readonly endpoint: string;
  /** Up or down, plus a detail line for the operator. Never throws -- "down" is an answer. */
  probe(): Promise<{ readonly available: boolean; readonly detail: string }>;
  /**
   * Run one completion. Throws `LocalRuntimeUnavailableError` when the runtime is not there.
   * ⚠ It must NOT return a canned string on failure: a plausible-looking answer produced
   * without a model is worse than an error, because nothing downstream can tell.
   */
  complete(prompt: string): Promise<string>;
}

export const LOCAL_MODEL_RUNTIME = Symbol("LocalModelRuntime");

/**
 * The egress guard -- the port whose whole reason for existing is that the application layer
 * cannot be trusted to know whether it went out to the network.
 *
 * ## Why this is not just "do not call fetch"
 *
 * `usecases.md` says it plainly: I-9 must be assertable AT THE NETWORK LAYER, because an
 * application-level check proves only "I did not deliberately open a connection". Telemetry
 * inside a dependency, a vendor SDK phoning home, a DNS prefetch -- none of those go through
 * our code, and every one of them is data leaving the machine.
 *
 * So the implementation sits under `net.Socket.prototype.connect`, which is the single
 * chokepoint every outbound TCP connection in a Node process passes through, whoever opened
 * it. `runLocalOnly` marks a region of async work as belonging to a personal-local
 * organization; anything that tries to leave the machine inside that region is REFUSED, not
 * logged.
 *
 * ⚠ `attemptedEgress` counts refusals. It is not decoration: a guard that blocks everything
 * would look identical to a guard that is never reached, and the difference is the entire
 * question of whether the promise is enforced or merely stated.
 */
export interface EgressGuard {
  /** Run `fn` under the local-only promise. Non-loopback connections inside it are refused. */
  runLocalOnly<T>(orgId: OrgId, fn: () => Promise<T>): Promise<T>;
  /** How many outbound connections have been refused since the process started. */
  attemptedEgress(): number;
  /** Every refusal, most recent last -- what a support engineer needs to see. */
  refusals(): readonly { readonly orgId: string; readonly target: string }[];

  /* ─────────────────────── F17: the one aperture in the promise ─────────────────────── */

  /**
   * Run an export under the local-only promise WITH a named set of approved artifacts.
   *
   * ⚠ Read the shape carefully, because the obvious alternative is the bug this whole
   * feature is about. `runExport` does NOT relax anything: inside it, egress is refused
   * exactly as it is inside `runLocalOnly`. The only thing that opens is
   * `aperture.send(artifactId, ...)`, and only for an artifact in `approvedArtifactIds`.
   *
   * "The guard is switched off during an export" and "the guard opens for the selected
   * items" are INDISTINGUISHABLE on the success path -- both let the export through. They
   * differ only on the path nobody exercises by accident: an unselected artifact, or a
   * connection opened from somewhere else in the same request while the export runs. That
   * is where this API's shape does the work, because the wide version cannot even be
   * expressed through it.
   */
  runExport<T>(
    orgId: OrgId,
    approvedArtifactIds: readonly string[],
    fn: (aperture: ExportAperture) => Promise<T>,
  ): Promise<T>;

  /**
   * Every connection that was PERMITTED through the aperture, most recent last.
   *
   * The counterpart of `refusals()` and needed for the same reason: an aperture that never
   * opens looks exactly like an aperture that is correctly narrow. Without this ledger the
   * whole gate could be satisfied by an export that transferred nothing.
   */
  permits(): readonly { readonly orgId: string; readonly artifactId: string; readonly target: string }[];
}

/**
 * The aperture itself -- a capability object, deliberately not a method on the guard.
 *
 * ## Why an object handed to the callback rather than `guard.openFor(id)`
 *
 * Because it has to CLOSE, and a method on a long-lived guard has no natural end. This one
 * is created by `runExport`, is only usable while that call is on the stack, and is marked
 * dead when it returns. A reference kept beyond that -- stashed in a module variable, closed
 * over by a timer, captured by a "retry later" helper -- is exactly the shape a background
 * uploader takes, and it must fail rather than work.
 */
export interface ExportAperture {
  /**
   * Open the aperture for ONE approved artifact, for the duration of `fn`.
   *
   * Throws before anything is transferred when `artifactId` was not in the approved set, or
   * when the aperture is no longer live. Neither is a user-facing failure: reaching either
   * means the code tried to move something the human did not confirm.
   */
  send<T>(artifactId: string, fn: () => Promise<T>): Promise<T>;
}

export const EGRESS_GUARD = Symbol("EgressGuard");

/**
 * Moving one approved artifact's bytes to the target organization.
 *
 * ## Why this is a port at all, when phase-00 keeps both organizations in one deployment
 *
 * Because the byte movement is THE egress. Everything else an export does -- rows, audit --
 * happens inside PostgreSQL over loopback and could never leave the machine. If there were
 * no seam here, the aperture would guard nothing that exists, and the first cross-deployment
 * implementation would be written by someone who never saw the approval check.
 *
 * ⚠ It is called INSIDE `aperture.send`, so an implementation physically cannot transfer an
 * artifact the human did not confirm: its socket is refused by the process-level guard.
 */
export interface ExportTransport {
  push(input: {
    readonly artifactId: string;
    readonly toOrgId: string;
    readonly sourceObjectKey: string;
    readonly targetObjectKey: string;
    readonly mime: string;
  }): Promise<void>;
}

export const EXPORT_TRANSPORT = Symbol("ExportTransport");
