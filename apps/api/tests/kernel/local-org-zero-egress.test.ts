/**
 * F16 V3 -- "数据不出本机", asserted at the NETWORK layer.
 *
 * ## Why this file does not simply call the API and check a log
 *
 * identity/domain.md says it in one line: an application-level assertion proves only "I did
 * not deliberately open a connection". The failure modes that break this promise are almost
 * all outside our code -- a dependency's telemetry, a crash reporter, an SDK that resolves a
 * hostname on import. So the observation point is `net.Socket.prototype.connect`, which every
 * outbound TCP connection in a Node process passes through no matter who opened it.
 *
 * ## The four things asserted, and the counter-proof each carries
 *
 *   1. inside the promise, our own outbound call is REFUSED
 *        counter-proof: outside the promise, the identical call is allowed -- otherwise
 *        "refused" could just mean "the network does not work in this test"
 *   2. a THIRD-PARTY-style caller (raw `net.connect`, never touching our helpers) is refused
 *        counter-proof: the same raw call succeeds outside the promise
 *   3. loopback still works inside the promise
 *        without it, a guard that refused everything would pass 1 and 2 -- and a local org
 *        in which nothing works at all is not isolation, it is paralysis
 *   4. the refusal COUNTER moves
 *        without it, every assertion above is satisfied by a guard that is never reached
 *
 * ## And the deliberate counter-proof of the gate itself
 *
 * `an egress path added on purpose is caught` builds exactly the regression this feature
 * fears -- code that sends local data out -- and asserts the guard turns red. That test is
 * the reason to believe the other four are not decorative.
 */
import net from "node:net";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProcessEgressGuard, isLoopbackTarget } from "../../src/infrastructure/egress/local-egress-guard";
import { LocalOrgEgressBlockedError } from "../../src/application/identity/errors";
import type { OrgId } from "../../src/domain/org-id";

const LOCAL_ORG = "org-f16-egress" as OrgId;

/**
 * A server on a NON-loopback address, so "reaching it" means leaving the machine as far as
 * the guard's rule is concerned.
 *
 * ⚠ It binds to a real non-loopback interface if one exists, and otherwise the test targets
 * a documentation address that is definitionally off-machine. Either way the assertion is
 * about what the guard DECIDES before any packet moves -- the connection is refused at
 * `connect()`, so no server needs to be reachable for the negative cases.
 */
const OFF_MACHINE_HOST = "203.0.113.9"; // TEST-NET-3, reserved for documentation
const OFF_MACHINE_PORT = 9;

let guard: ProcessEgressGuard;
let loopbackServer: net.Server;
let loopbackPort = 0;

beforeAll(async () => {
  guard = new ProcessEgressGuard();
  // Ends without writing: a server that writes while the client is destroying its socket
  // produces an ECONNRESET that vitest reports as an unhandled error, which is noise in a
  // file whose whole subject is connection behaviour.
  loopbackServer = net.createServer((s) => {
    s.on("error", () => undefined);
    s.end();
  });
  await new Promise<void>((r) => loopbackServer.listen(0, "127.0.0.1", r));
  loopbackPort = (loopbackServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => loopbackServer.close(() => r()));
});

/**
 * Open a TCP connection the plain way -- exactly what a vendor SDK would do.
 *
 * ⚠ Uses `net.connect(...)` rather than `new Socket().connect(port, host)`, and that choice
 * is the reason this file found a real hole: the two reach `Socket.prototype.connect` with
 * DIFFERENT argument shapes (the former passes Node's normalized `[options, cb]` array), and
 * the first version of the guard understood only the latter. A test suite that used only the
 * explicit form would have been green while `http`, `https`, `undici` and `fetch` -- all of
 * which go through `net.connect` -- were unguarded.
 *
 * The timeout is short and explicit: an unreachable off-machine address hangs until the OS
 * gives up, and a gate that takes a minute to fail is a gate people stop running.
 */
function connect(host: string, port: number, timeoutMs = 2000): Promise<"connected"> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port });
    s.setTimeout(timeoutMs, () => s.destroy(new Error(`network timeout to ${host}:${port}`)));
    s.on("connect", () => {
      s.destroy();
      resolve("connected");
    });
    s.on("error", reject);
  });
}

describe("I-9: inside a personal-local organization, egress is zero", () => {
  it("an off-machine connection is REFUSED while the promise is in force", async () => {
    const before = guard.attemptedEgress();
    await expect(
      guard.runLocalOnly(LOCAL_ORG, () => connect(OFF_MACHINE_HOST, OFF_MACHINE_PORT)),
    ).rejects.toBeInstanceOf(LocalOrgEgressBlockedError);
    // The counter is the non-vacuity assertion: a guard that is never reached blocks nothing
    // and looks exactly like a guard that blocks everything.
    expect(guard.attemptedEgress()).toBe(before + 1);
    expect(guard.refusals().at(-1)).toMatchObject({ orgId: LOCAL_ORG });
  });

  it("counter-proof: the SAME call outside the promise is allowed to proceed", async () => {
    // Without this, "refused" would be indistinguishable from "this environment has no
    // network at all", and the test would pass on a machine where nothing works.
    //
    // The connection is not expected to succeed (TEST-NET-3 goes nowhere); what is asserted
    // is that the failure is a NETWORK failure, not our guard's refusal.
    const before = guard.attemptedEgress();
    await expect(connect(OFF_MACHINE_HOST, OFF_MACHINE_PORT)).rejects.not.toBeInstanceOf(
      LocalOrgEgressBlockedError,
    );
    expect(guard.attemptedEgress(), "nothing was refused outside the promise").toBe(before);
  });

  it("a dependency that never heard of this project is refused too", async () => {
    // The point of patching `net.Socket.prototype.connect` rather than wrapping our own HTTP
    // client: this call goes through no code of ours at all.
    await expect(
      guard.runLocalOnly(LOCAL_ORG, async () => {
        const s = new net.Socket();
        s.connect(OFF_MACHINE_PORT, OFF_MACHINE_HOST);
        return "unreachable";
      }),
    ).rejects.toBeInstanceOf(LocalOrgEgressBlockedError);
  });

  it("loopback still works inside the promise -- isolation, not paralysis", async () => {
    // The other direction, and it is the assertion that stops "block everything" from being
    // a passing implementation. The local runtime, the local database and the local cache all
    // live here.
    const r = await guard.runLocalOnly(LOCAL_ORG, () => connect("127.0.0.1", loopbackPort));
    expect(r).toBe("connected");
  });

  it("the scope follows async work, it is not a global flag", async () => {
    // A global would be switched on by one request and off by another mid-flight, so the
    // promise would hold or not depending on concurrency. Here the guarded and unguarded
    // chains run at the same time and each keeps its own answer.
    const [guarded, free] = await Promise.allSettled([
      guard.runLocalOnly(LOCAL_ORG, () => connect(OFF_MACHINE_HOST, OFF_MACHINE_PORT)),
      connect("127.0.0.1", loopbackPort),
    ]);
    expect(guarded.status).toBe("rejected");
    expect((guarded as PromiseRejectedResult).reason).toBeInstanceOf(LocalOrgEgressBlockedError);
    expect(free.status).toBe("fulfilled");
  });
});

describe("the rule about what counts as 'this machine'", () => {
  it("loopback and unix sockets are local; LAN and public addresses are not", () => {
    for (const h of ["127.0.0.1", "127.0.0.53", "localhost", "::1", ""]) {
      expect(isLoopbackTarget(h), `${h} should be local`).toBe(true);
    }
    for (const h of ["10.0.0.5", "192.168.1.20", "172.16.4.4", "example.com", "203.0.113.9"]) {
      // ⚠ A LAN address is NOT local. The promise says "does not leave this machine"; a
      // self-hosted model on the box next door has already left it. Multi-host self-hosting
      // is served by F15's `modelPolicy` -- a policy, which a deployment may relax.
      expect(isLoopbackTarget(h), `${h} should NOT be local`).toBe(false);
    }
  });

  it("an unrecognised destination shape is treated as egress, not waved through", async () => {
    // The default matters more than the parser: a guard whose unknown case is "allow" can be
    // bypassed by passing an argument shape nobody anticipated.
    await expect(
      guard.runLocalOnly(LOCAL_ORG, async () => {
        const s = new net.Socket();
        (s.connect as unknown as (...a: unknown[]) => unknown)(undefined);
        return "unreachable";
      }),
    ).rejects.toBeInstanceOf(LocalOrgEgressBlockedError);
  });
});

describe("counter-proof: an egress path added on purpose turns this gate red", () => {
  it("the exact regression the feature fears is caught", async () => {
    // This is the code somebody writes six months from now: "just post the local summary to
    // our analytics endpoint". It looks harmless, it is the failure this whole feature exists
    // to prevent, and here it is -- refused, and counted.
    const sendLocalDataOut = async (payload: string): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        const s = net.connect({ host: "telemetry.example.com", port: 443 });
        s.on("connect", () => {
          s.end(payload);
          resolve();
        });
        s.on("error", reject);
      });
    };

    const before = guard.attemptedEgress();
    await expect(
      guard.runLocalOnly(LOCAL_ORG, () => sendLocalDataOut("the user's most private notes")),
    ).rejects.toBeInstanceOf(LocalOrgEgressBlockedError);
    expect(guard.attemptedEgress()).toBe(before + 1);
    expect(guard.refusals().at(-1)?.target).toContain("telemetry.example.com");
  });
});
