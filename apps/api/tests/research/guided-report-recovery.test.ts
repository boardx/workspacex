import { describe, it, expect } from "vitest";
import { ModelCallError } from "../../src/application/agent-run/ports";
import { recoverableReportProviderError } from "../../src/application/research/guided-report-recovery";
describe("report provider retry boundary", () => {
  it.each(["429", "500", "503"])("retries HTTP %s", (status) => {
    expect(recoverableReportProviderError(new ModelCallError("MODEL_CALL_FAILED", `model provider responded with HTTP ${status}`))).toBe(true);
  });
  it.each(["401", "403", "400"])("does not retry HTTP %s", (status) => {
    expect(recoverableReportProviderError(new ModelCallError("MODEL_CALL_FAILED", `model provider responded with HTTP ${status}`))).toBe(false);
  });
  it("rejects cancellation, TLS, unknown errors and raw persistence exceptions", () => {
    for (const code of ["ABORTED", "UNCLASSIFIED", "CERT_HAS_EXPIRED"]) expect(recoverableReportProviderError(new ModelCallError("MODEL_CALL_FAILED", `model provider transport failure (${code})`))).toBe(false);
    expect(recoverableReportProviderError(new Error("HTTP 503"))).toBe(false);
  });
});
