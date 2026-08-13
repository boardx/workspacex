import { describe, expect, it } from "vitest";
import type { DatabasePort } from "../../src/application/ports/database.port";
import type { QueryResult, TenantSession } from "../../src/application/ports/database.port";
import { PgAsrUsageMeter } from "../../src/infrastructure/recording/pg-realtime-asr-repository";
import { billedPcm16MonoDurationSeconds, pcm16MonoDurationSeconds, providerSessionUsageId } from "../../src/interface/ws/personal-realtime-asr.gateway";
import { toOrgId } from "../../src/domain/org-id";

describe("personal realtime ASR PCM usage", () => {
  it("meters mono 16 kHz PCM16 at exactly 32000 bytes per second", () => {
    expect(pcm16MonoDurationSeconds(0)).toBe(0);
    expect(pcm16MonoDurationSeconds(32_000)).toBe(1);
    expect(pcm16MonoDurationSeconds(48_000)).toBe(1.5);
    expect(billedPcm16MonoDurationSeconds(48_000)).toBe(2);
  });

  it("uses an internal capture/provider-session idempotency key", () => {
    expect(providerSessionUsageId("capture-1", "provider-session-1"))
      .toBe("personal:capture-1:provider-session-1");
  });

  it("passes integer seconds to Postgres and returns false for a duplicate provider session", async () => {
    const params: (readonly unknown[])[] = [];
    let inserted = true;
    const database: DatabasePort = {
      withTenant: async (_orgId, run) => run({
        query: async <R>(_sql: string, nextParams?: readonly unknown[]): Promise<QueryResult<R>> => {
          params.push(nextParams ?? []);
          if (inserted) {
            inserted = false;
            return { rows: [{ provider_task_id: "personal:capture-1:provider-session-1" } as R] };
          }
          return { rows: [] };
        },
      } satisfies TenantSession),
      withoutTenant: async () => { throw new Error("not used"); },
      close: async () => undefined,
    };
    const meter = new PgAsrUsageMeter(database);
    const event = {
      providerTaskId: providerSessionUsageId("capture-1", "provider-session-1"),
      orgId: toOrgId("org-1"), ownerUserId: "user-1", captureId: "capture-1",
      model: "qwen3-asr-flash-realtime", durationSeconds: 2,
    };

    await expect(meter.record(event)).resolves.toBe(true);
    await expect(meter.record(event)).resolves.toBe(false);
    expect(params).toHaveLength(2);
    expect(params[0]?.[5]).toBe(2);
    expect(Number.isInteger(params[0]?.[5])).toBe(true);
  });
});
