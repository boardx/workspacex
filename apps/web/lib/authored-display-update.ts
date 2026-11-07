import { operations } from "@repo/contracts/portable-package";
import { apiRequest } from "./api-client";
import { notifyUpdated } from "./entity-localization";
export async function getDisplayUpdateOffer(sessionToken: string, signal?: AbortSignal) {
  const op = operations.displayUpdateOffer;
  return op.out.parse(await apiRequest(op.path,{ method: op.method,sessionToken,signal }));
}
export async function applyDisplayUpdate(metadataVersion: string, idempotencyKey: string,
  scope: { orgId: string; sessionToken: string; signal?: AbortSignal }) {
  const op = operations.applyDisplayUpdate;
  const result = op.out.parse(await apiRequest(op.path,{ method: op.method,sessionToken: scope.sessionToken,signal: scope.signal,
    body: op.in.parse({ expectedOrgId: scope.orgId,expectedMetadataVersion: metadataVersion,idempotencyKey }) }));
  if (!scope.signal?.aborted) { notifyUpdated("agent","*"); notifyUpdated("skill","*"); }
  return result;
}
