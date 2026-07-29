/**
 * The process-level egress guard -- where "数据不出本机" stops being a sentence (F16 / I-9).
 *
 * ## Why it is installed UNDER the application instead of inside it
 *
 * identity/domain.md is explicit: I-9 must be asserted at the NETWORK layer, because an
 * application-level check proves only "I did not deliberately open a connection". The things
 * that break the promise are mostly not our code -- a vendor SDK's telemetry ping, an
 * analytics beacon in a transitive dependency, a crash reporter. None of them call our
 * helpers, all of them call `net.Socket.prototype.connect`.
 *
 * So this patches that one method. It is the single chokepoint every outbound TCP connection
 * in a Node process passes through, regardless of who opened it: `http`, `https`, `undici`,
 * `fetch`, `pg`, `ioredis` and any library that has ever moved a byte off the machine.
 *
 * ## What "inside the promise" means
 *
 * `AsyncLocalStorage`, not a global flag. Requests interleave: a global "we are local now"
 * would be turned on by one request and switched off by another mid-flight, so the promise
 * would hold or not depending on concurrency -- the failure mode nobody reproduces. The store
 * follows one async call chain, which is exactly the boundary "this request belongs to a
 * personal-local organization" describes.
 *
 * ## What it refuses, and what it deliberately allows
 *
 * Refused: any connection whose destination is not loopback.
 * Allowed: loopback (127.0.0.0/8, ::1) and unix sockets -- the local runtime, the local
 * database, the local cache.
 *
 * ⚠ A LAN address is REFUSED. "Another machine on the same network" is another machine, and
 * the promise says this one. Multi-host self-hosting is served by a real organization with
 * `modelPolicy = "self-hosted-only"` (F15) -- a policy, which a deployment may relax. This is
 * a promise, which it may not.
 *
 * ## What it does NOT prove
 *
 * That the process never egresses at all. Outside `runLocalOnly` the guard counts nothing and
 * blocks nothing -- a real organization's traffic is normal traffic. The claim is narrower and
 * is the one the feature makes: while work belongs to a personal-local organization, nothing
 * leaves. Stated here because a reader who assumed the broader claim would be misled by a
 * green test.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";
import { LocalOrgEgressBlockedError } from "../../application/identity/errors";
import type { EgressGuard } from "../../application/identity/local-org-ports";
import type { OrgId } from "../../domain/org-id";

interface Scope {
  readonly orgId: string;
}

const store = new AsyncLocalStorage<Scope>();

const refusals: { orgId: string; target: string }[] = [];

/** Loopback only. Everything else is off this machine, LAN included. */
export function isLoopbackTarget(host: string | undefined): boolean {
  if (host === undefined || host === "") return true; // unix socket / pipe: never leaves
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    /^127\./.test(h) ||
    /^::ffff:127\./.test(h)
  );
}

/**
 * Extract the destination from the many shapes `Socket.connect` accepts.
 *
 * ⚠ The default when the shape is unrecognised is "not loopback", i.e. REFUSE. A guard whose
 * unknown case is "allow" is a guard with an unbounded bypass: the caller only has to pass an
 * argument shape the parser did not anticipate.
 */
function targetOf(args: unknown[]): { host: string | undefined; label: string } {
  const [first, second] = args;
  /**
   * ⚠ `net.connect(...)` / `net.createConnection(...)` call this method with Node's
   * NORMALIZED argument list -- a single array `[options, callback]` -- rather than with the
   * options object directly.
   *
   * This is not a footnote: the first version of this parser read that array as "an object
   * with no host", concluded "host defaults to localhost", and ALLOWED it. Every connection
   * opened through `net.connect` -- which is what `http`, `https`, `undici` and most
   * libraries use -- sailed straight through a guard that was passing its own tests, because
   * the tests that happened to exist used `new Socket().connect(port, host)`.
   *
   * It was found by the counter-proof required for this feature (deliberately adding an
   * egress path and checking the gate turns red), not by review. Kept as the first branch
   * with this note, because "the guard is installed" and "the guard sees the destination" are
   * two different claims and only the second one matters.
   */
  if (Array.isArray(first)) return targetOf(first as unknown[]);
  if (typeof first === "object" && first !== null) {
    const o = first as { host?: string; port?: number; path?: string };
    if (typeof o.path === "string") return { host: "", label: `unix:${o.path}` };
    // A bare `{ port }` legitimately means localhost (that is Node's own default). An object
    // with neither host, port nor path is a shape this parser does not understand, and the
    // unknown case must be "off machine" -- see the note on this function.
    if (o.host === undefined && o.port === undefined) return { host: "unknown", label: "unknown-destination" };
    return { host: o.host ?? "localhost", label: `${o.host ?? "localhost"}:${o.port ?? "?"}` };
  }
  if (typeof first === "number") {
    // connect(port[, host][, cb]) -- host defaults to localhost when omitted
    const host = typeof second === "string" ? second : "localhost";
    return { host, label: `${host}:${first}` };
  }
  if (typeof first === "string") {
    // connect(path) -- a unix socket, which by definition does not leave the machine
    return { host: "", label: `unix:${first}` };
  }
  return { host: "unknown", label: "unknown-destination" };
}

let installed = false;

/**
 * Patch `net.Socket.prototype.connect`, once.
 *
 * Idempotent because the composition root, the tests and any future worker process may all
 * call it; patching twice would wrap the wrapper and double-count refusals, which would make
 * the counter -- the thing that proves the guard is not idle -- lie in the safe-looking
 * direction.
 */
export function installEgressGuard(): void {
  if (installed) return;
  installed = true;

  const original = net.Socket.prototype.connect;
  // eslint-disable-next-line func-names -- needs `this`
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    const scope = store.getStore();
    if (scope !== undefined) {
      const { host, label } = targetOf(args);
      if (!isLoopbackTarget(host)) {
        refusals.push({ orgId: scope.orgId, target: label });
        // THROWN, not silently dropped. A dropped connection looks like a network blip and
        // gets retried; an exception stops the operation and reaches a human. The promise is
        // that this cannot happen, so its occurrence is an incident, not a condition.
        throw new LocalOrgEgressBlockedError(label);
      }
    }
    return (original as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
}

export class ProcessEgressGuard implements EgressGuard {
  constructor() {
    installEgressGuard();
  }

  runLocalOnly<T>(orgId: OrgId, fn: () => Promise<T>): Promise<T> {
    return store.run({ orgId }, fn);
  }

  attemptedEgress(): number {
    return refusals.length;
  }

  refusals(): readonly { orgId: string; target: string }[] {
    return refusals.slice();
  }
}
