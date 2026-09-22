import { describe, expect, it } from "vitest";
import { rewriteNames } from "../src/pglite-queue";

function fe(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 4 + body.length);
  out[0] = type.charCodeAt(0);
  new DataView(out.buffer).setInt32(1, 4 + body.length);
  out.set(body, 5);
  return out;
}
const enc = new TextEncoder();
const cstr = (s: string) => enc.encode(`${s}\0`);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("rewriteNames", () => {
  it("namespaces named statements per handler and keeps the unnamed one untouched", () => {
    const parseNamed = fe("P", cat(cstr("_pg3_0"), cstr("select 1"), new Uint8Array([0, 0])));
    const out = rewriteNames(7, parseNamed);
    expect(dec(out.subarray(5, 5 + "h7._pg3_0".length))).toBe("h7._pg3_0");
    expect(new DataView(out.buffer).getInt32(1)).toBe(out.length - 1); // length fixed up
    const parseUnnamed = fe("P", cat(cstr(""), cstr("select 1"), new Uint8Array([0, 0])));
    expect(rewriteNames(7, parseUnnamed)).toBe(parseUnnamed);
  });
  it("rewrites portal and statement in Bind, and name in Describe/Close/Execute", () => {
    const bind = fe("B", cat(cstr("p1"), cstr("_pg3_0"), new Uint8Array([0, 0, 0, 0, 0, 0])));
    const b = dec(rewriteNames(3, bind));
    expect(b).toContain("h3.p1\0h3._pg3_0\0");
    const describe = fe("D", cat(enc.encode("S"), cstr("_pg3_0")));
    expect(dec(rewriteNames(3, describe))).toContain("Sh3._pg3_0\0");
    const close = fe("C", cat(enc.encode("S"), cstr("_pg3_0")));
    expect(dec(rewriteNames(3, close))).toContain("Sh3._pg3_0\0");
    const exec = fe("E", cat(cstr("p1"), new Uint8Array([0, 0, 0, 0])));
    expect(dec(rewriteNames(3, exec))).toContain("h3.p1\0");
    const query = fe("Q", cstr("select 1"));
    expect(rewriteNames(3, query)).toBe(query);
  });
});
