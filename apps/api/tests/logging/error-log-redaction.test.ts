/**
 * `redactErrorDetail` -- PR #2444 independent review, finding #1's negative tests: prove
 * credentials/tokens/connection URLs, oversized fields, cyclic input, and non-Error thrown
 * values cannot enter `error_logs` unredacted or unbounded.
 */
import { describe, expect, it } from "vitest";
import { redactErrorDetail } from "../../src/application/ports/error-log.port";

describe("redactErrorDetail -- scrubbing", () => {
  it("redacts a Postgres connection string with embedded credentials", () => {
    const out = redactErrorDetail({
      name: "Error",
      message: "connect failed: postgres://app_rw:s3cr3t-pw@10.0.0.5:5432/workspacex",
    }) as { message: string };
    expect(out.message).not.toContain("s3cr3t-pw");
    expect(out.message).not.toContain("postgres://");
    expect(out.message).toContain("[REDACTED]");
  });

  it("redacts a Redis connection string with embedded credentials", () => {
    const out = redactErrorDetail({ message: "rediss://:hunter2@cache.internal:6380/0" }) as { message: string };
    expect(out.message).not.toContain("hunter2");
  });

  it("redacts a Bearer token", () => {
    const out = redactErrorDetail({
      message: "upstream call failed, Authorization: Bearer abc123.def456-ghi789_JKL",
    }) as { message: string };
    expect(out.message).not.toContain("abc123.def456-ghi789_JKL");
    expect(out.message).toContain("[REDACTED]");
  });

  it("redacts a JWT-shaped string", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactErrorDetail({ message: `token was: ${jwt}` }) as { message: string };
    expect(out.message).not.toContain(jwt);
    expect(out.message).toContain("[REDACTED]");
  });

  it("redacts key=value and key: value secret-shaped pairs", () => {
    const out = redactErrorDetail({
      message: 'config dump: password="hunter2" token=abc.def secret: xyz789',
    }) as { message: string };
    expect(out.message).not.toContain("hunter2");
    expect(out.message).not.toContain("abc.def");
    expect(out.message).not.toContain("xyz789");
  });

  it("does not touch ordinary text with no secret shapes", () => {
    const out = redactErrorDetail({ name: "Error", message: "Connection is closed." }) as { message: string };
    expect(out.message).toBe("Connection is closed.");
  });
});

describe("redactErrorDetail -- bounds", () => {
  it("truncates an oversized message field", () => {
    const huge = "x".repeat(10_000);
    const out = redactErrorDetail({ message: huge }) as { message: string };
    expect(out.message.length).toBeLessThan(3_000);
    expect(out.message.endsWith("…[TRUNCATED]")).toBe(true);
  });

  it("truncates an oversized stack field with a larger, but still bounded, budget", () => {
    const huge = "at fn (\n".repeat(5_000);
    const out = redactErrorDetail({ name: "Error", message: "x", stack: huge }) as { stack: string };
    expect(out.stack.length).toBeLessThan(9_000);
    expect(out.stack.endsWith("…[TRUNCATED]")).toBe(true);
  });

  it("truncates an oversized raw (non-Error thrown value)", () => {
    const out = redactErrorDetail("y".repeat(10_000)) as { raw: string };
    expect(out.raw.length).toBeLessThan(3_000);
  });
});

describe("redactErrorDetail -- non-Error / cyclic / exotic input never enters via JSON.stringify", () => {
  it("a thrown string becomes a bounded, scrubbed raw field", () => {
    const out = redactErrorDetail("plain string with a token=deadbeef1234 in it") as { raw: string };
    expect(out.raw).not.toContain("deadbeef1234");
  });

  it("a thrown number/boolean/null/undefined does not throw and produces a raw field", () => {
    expect(() => redactErrorDetail(42)).not.toThrow();
    expect(() => redactErrorDetail(true)).not.toThrow();
    expect(() => redactErrorDetail(null)).not.toThrow();
    expect(() => redactErrorDetail(undefined)).not.toThrow();
    expect((redactErrorDetail(42) as { raw: string }).raw).toBe("42");
  });

  it("a cyclic object does not throw (never routed through JSON.stringify)", () => {
    const cyclic: Record<string, unknown> = { name: "Error", message: "cycle" };
    cyclic.self = cyclic; // a real cycle
    expect(() => redactErrorDetail(cyclic)).not.toThrow();
    const out = redactErrorDetail(cyclic) as { message: string; self: string };
    expect(out.message).toBe("cycle");
    // The cyclic property is stringified defensively (String(...) never recurses into a
    // cycle the way JSON.stringify does), not silently dropped and not left as a live
    // reference that a later JSON.stringify(entry.detail) in the writer could choke on.
    expect(typeof out.self).toBe("string");
  });

  it("an array thrown value is treated as an exotic non-plain-object shape, not iterated field-by-field", () => {
    const out = redactErrorDetail(["password=hunter2", "b"]) as { raw: string };
    expect(out.raw).not.toContain("hunter2");
  });
});
