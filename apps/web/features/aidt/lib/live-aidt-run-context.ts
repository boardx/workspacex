import { AidtContextReceipt, operations } from "@repo/contracts/aidt-run-context";
import { apiRequest } from "@/lib/api-client";

/** A receipt is a read-only source/status projection, never an invitation to start a run. */
export async function readAidtRunContext(scope: { projectId: string; runId: string }, sessionToken: string, signal?: AbortSignal) {
  const input = operations.receipt.in.parse({ runId: scope.runId });
  const result = AidtContextReceipt.parse(await apiRequest<unknown>(
    operations.receipt.path.replace(":runId", encodeURIComponent(input.runId)),
    { method: "GET", sessionToken, signal },
  ));
  if (result.runId !== scope.runId || result.projectId !== scope.projectId) throw new Error("AIDT_CONTEXT_RECEIPT_SCOPE_MISMATCH");
  return result;
}
