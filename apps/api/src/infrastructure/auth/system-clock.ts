/**
 * The real clock, and the deterministic one used to assert time-dependent rules.
 *
 * Every rule in this bundle is time-dependent: the 15-minute rolling failure window, the
 * 15-minute lock, the 1-hour reset link, the 30-day session, the 60-second resend cooldown.
 * With `Date.now()` called inside the use cases, the SECOND half of each of those rules --
 * "and then it expires" -- can only be tested by sleeping, so in practice it would not be
 * tested at all, and I-3's "unlocks afterwards" clause would quietly stop being true.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Clock, TokenFactory } from "../../application/auth/ports";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test-only. Never wired into the composition root. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
  set(at: Date): void {
    this.current = at;
  }
}

/**
 * ⚠ I-6: session ids must be unguessable -- UUID, never a sequence.
 *
 * A sequential session id is guessable, and a guessable session id makes every other
 * control in this bundle irrelevant: the lockout, the slow hash and the enumeration guard
 * all protect a door that can be walked around. Same reasoning as identity's A-1.
 */
export class UuidTokenFactory implements TokenFactory {
  sessionId(): string {
    return randomUUID();
  }

  opaqueToken(): string {
    // Reset tokens: 256 bits of CSPRNG output, hex.
    //
    // Hex rather than base64url because these travel inside an email link and get handled
    // by mail clients, link scanners and copy-paste. Hex has no characters that anything in
    // that chain is tempted to escape, re-case or wrap -- and a token that arrives back
    // one character different is a support ticket that reads as "the reset link is broken".
    return randomBytes(32).toString("hex");
  }
}
