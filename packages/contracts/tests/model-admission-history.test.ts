import { describe, expect, it } from "vitest";
import { modelAdmissionHistoryExchange, ModelAdmissionHistoryRecord } from "../src/model-admission-history";
import { AdmissionTestItem, AdmissionVerdict } from "../src/agent-runtime";

const record = { recordId: "record-1", modelId: "model-1", item: AdmissionTestItem.options[0],
  verdict: AdmissionVerdict.options[0], evidence: "review evidence", judgedBy: "admin-1", judgedAt: "2026-09-10T00:00:00Z", seq: 1, configRevision: null };
const request = { modelId: "model-1", afterSeq: 0, snapshotSeq: null, limit: 1 };
const response = { modelId: "model-1", snapshotSeq: 4, records: [record], nextAfterSeq: 1 };
const valid = (req: unknown, res: unknown) => modelAdmissionHistoryExchange.safeParse({ request: req, response: res }).success;

describe("model admission history read proposal", () => {
  it("retains unknown legacy configuration and separate append-only judgments", () => {
    expect(valid(request, response)).toBe(true);
    expect(ModelAdmissionHistoryRecord.parse(record).configRevision).toBeNull();
    expect(valid({ ...request, limit: 2 }, { ...response, records: [record, { ...record, recordId: "record-2", seq: 2, configRevision: "r2" }], nextAfterSeq: 2 })).toBe(true);
  });
  it("rejects another model, duplicate records, disorder and records past the fence", () => {
    expect(valid(request, { ...response, modelId: "other" })).toBe(false);
    for (const records of [[{ ...record, modelId: "other" }], [record, record], [{ ...record, seq: 5 }], [{ ...record, seq: 2 }, record]]) {
      expect(valid({ ...request, limit: 2 }, { ...response, records, nextAfterSeq: null })).toBe(false);
    }
  });
  it("keeps the same fence across pages while allowing new judgments outside it", () => {
    const continuation = { ...request, afterSeq: 1, snapshotSeq: 4 };
    const page = { ...response, records: [{ ...record, seq: 4 }], nextAfterSeq: null };
    expect(valid(continuation, page)).toBe(true);
    expect(valid(continuation, { ...page, snapshotSeq: 5 })).toBe(false);
    expect(valid(continuation, response)).toBe(false);
    expect(valid({ ...continuation, snapshotSeq: null }, page)).toBe(false);
  });
  it("rejects invented cursors, overlarge pages and additional secret fields", () => {
    expect(valid(request, { ...response, nextAfterSeq: 2 })).toBe(false);
    expect(valid(request, { ...response, records: [], nextAfterSeq: 0 })).toBe(false);
    expect(valid(request, { ...response, records: [record, { ...record, seq: 2, recordId: "record-2" }], nextAfterSeq: 2 })).toBe(false);
    expect(valid(request, { ...response, credential: "hidden" })).toBe(false);
    expect(valid(request, { ...response, records: [{ ...record, credential: "hidden" }] })).toBe(false);
  });
  it("cannot terminate before reaching this model's actual maximum sequence", () => {
    expect(valid(request, { ...response, nextAfterSeq: null })).toBe(false);
    expect(valid(request, { ...response, records: [], nextAfterSeq: null })).toBe(false);
    expect(valid(request, { ...response, snapshotSeq: 0, records: [], nextAfterSeq: null })).toBe(true);
    expect(valid({ ...request, snapshotSeq: 4, afterSeq: 4 }, { ...response, records: [], nextAfterSeq: null })).toBe(true);
  });
});
