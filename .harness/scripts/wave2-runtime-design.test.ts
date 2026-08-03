import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const DESIGN_ROOT = resolve(
  ROOT,
  "phases/phase-01-run-a-project/design-deltas/wave2-runtime",
);

function read(name: string): string {
  return readFileSync(resolve(DESIGN_ROOT, name), "utf8");
}

describe("Wave 2 runtime design packet", () => {
  it("keeps human signoff pending and stores normative decisions once", () => {
    const signoff = read("design-signoff.md");
    const contract = read("contract.md");

    expect(signoff).toMatch(/^status: pending$/m);
    expect(signoff).not.toMatch(/^confirmed_(by|at):/m);
    expect(signoff).toContain("[contract.md](./contract.md)");
    expect(contract).toContain("## 1. Registration email confirmation");
    expect(contract).toContain("## 2. Chat write and pagination");
    expect(contract).toContain("## 3. Skills persistence and explicit import");
    expect(contract).toContain("## 4. Minimal no-tool AgentRun");
    expect(contract).toContain("## 5. Idempotent Chat writeback");
    expect(contract).toContain("## 6. UI delta");
    expect(contract).toContain("## 7. End-to-end dependency order");
  });

  it("mechanically preserves the no-built-in and polling-first boundaries", () => {
    const contract = read("contract.md");

    expect(contract).toContain("POST /admin/skills/starter-pack-imports");
    expect(contract).toContain("MUST NOT seed built-in skills");
    expect(contract).toContain("Polling is the Wave 2 transport");
    expect(contract).toContain("POST /auth/email-verifications/confirm");
    expect(contract).toContain("POST /chat/threads/:threadId/messages");
    expect(contract).toContain("GET /agent-runs/:runId");
  });

  it("defines executable verification without placeholder success", () => {
    const verification = read("verification.md");

    expect(verification).toContain("email-verification-public.test.ts");
    expect(verification).toContain("message-write-roundtrip.test.ts");
    expect(verification).toContain("explicit-starter-import.test.ts");
    expect(verification).toContain("no-tool-run-writeback.test.ts");
    expect(verification).toContain("wave2-runtime.spec.ts");
    expect(verification).toContain("pnpm verify:full --journey wave2-runtime");
    expect(verification).not.toMatch(/\b(?:echo|printf)\b[^\n]*(?:pass|success|ok)/i);
    expect(verification).not.toContain("|| true");
  });
});
