import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source=readFileSync(new URL("../../src/infrastructure/recording/pg-realtime-asr-repository.ts",import.meta.url),"utf8");
describe("realtime ASR repository boundary",()=>{
  it("stays tenant scoped and persists no raw ticket",()=>{
    expect(source).not.toContain("withoutTenant");
    expect(source).not.toMatch(/\bticket\s+text/i);
    expect(source).toContain("withTenant(input.orgId");
    expect(source).toContain("ticket_hash=$1 AND transcription_id=$2 AND capture_id=$3 FOR UPDATE");
    expect(source).toContain("SET used_at=now()");
  });
  it("names only ticket and ASR usage tables",()=>{
    const named=[...source.matchAll(/(?:FROM|INTO|UPDATE)\s+([a-z_]+)/gi)].map(m=>m[1]);
    expect(new Set(named)).toEqual(new Set(["realtime_asr_tickets","realtime_asr_usage_events"]));
  });
});
