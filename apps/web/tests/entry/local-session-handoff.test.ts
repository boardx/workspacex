import { describe, expect, it } from "vitest";
import { parseLocalSessionHash, encodeLocalSessionHash } from "../../lib/local-session-handoff";
// The desktop runtime produces the fragment; decode it with the web parser so the two sides
// cannot drift without this test going red (the format is declared once, in the web lib).
import { localSessionUrl } from "../../../../packages/local-runtime/src/local-session";

const loginOut = { sessionToken: "tok_abc", userId: "u-1", orgs: ["org-a", "org-b"], expiresAt: "2026-10-17T00:00:00.000Z" };

describe("local session handoff", () => {
  it("desktop encoder -> web parser round-trips a LoginOut", () => {
    const url = localSessionUrl("http://127.0.0.1:3100", loginOut);
    expect(url.startsWith("http://127.0.0.1:3100/login#wsx-local-session=")).toBe(true);
    expect(parseLocalSessionHash(new URL(url).hash)).toMatchObject(loginOut);
    expect(parseLocalSessionHash(encodeLocalSessionHash(loginOut as never))).toMatchObject(loginOut);
  });
  it("rejects garbage, a wrong key and a LoginOut missing fields instead of throwing", () => {
    expect(parseLocalSessionHash("#wsx-local-session=not-base64!!")).toBeNull();
    expect(parseLocalSessionHash("#other=1")).toBeNull();
    expect(parseLocalSessionHash("")).toBeNull();
    const bad = Buffer.from(JSON.stringify({ sessionToken: "x" })).toString("base64url");
    expect(parseLocalSessionHash(`#wsx-local-session=${bad}`)).toBeNull();
  });
});
