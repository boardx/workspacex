import { operations as C, type PlatformModelTestRecord, type PlatformModelTestRequest } from "@repo/contracts/platform-model-test";
import type { z } from "zod";
import { apiRequest } from "./api-client";
export type ModelTestCandidate = z.infer<typeof C.candidates.out>[number];
export type { PlatformModelTestRecord, PlatformModelTestRequest };
export async function getModelTestCandidates(orgId: string, signal?: AbortSignal): Promise<ModelTestCandidate[]> {
  const input = C.candidates.in.parse({ orgId });
  return C.candidates.out.parse(await apiRequest<unknown>(C.candidates.path, { query: input, signal }));
}
export async function startModelTest(input: PlatformModelTestRequest, signal?: AbortSignal): Promise<PlatformModelTestRecord> {
  return C.start.out.parse(await apiRequest<unknown>(C.start.path, { method: C.start.method, body: C.start.in.parse(input), signal }));
}
export async function getModelTest(testId: string, orgId: string, signal?: AbortSignal): Promise<PlatformModelTestRecord> {
  const input = C.get.in.parse({ testId, orgId });
  return C.get.out.parse(await apiRequest<unknown>(C.get.path.replace(":testId", encodeURIComponent(input.testId)), { query: { orgId: input.orgId }, signal }));
}
export async function cancelModelTest(testId: string, orgId: string, signal?: AbortSignal): Promise<PlatformModelTestRecord> {
  const input = C.get.in.parse({ testId, orgId });
  return C.cancel.out.parse(await apiRequest<unknown>(C.cancel.path.replace(":testId", encodeURIComponent(input.testId)), { method: C.cancel.method, body: C.cancel.in.parse({ orgId: input.orgId }), signal }));
}
