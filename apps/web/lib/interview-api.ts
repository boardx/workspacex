import { interview } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type DigitalInterviewHistory = z.infer<typeof interview.operations.listDigitalInterviews.out>;
export type DigitalInterviewHistoryRow = DigitalInterviewHistory["items"][number];
export type DigitalExpertCatalog = z.infer<typeof interview.operations.listDigitalExperts.out>;
export type DigitalExpertCatalogRow = DigitalExpertCatalog["items"][number];

export function loadDigitalInterviewHistory(status?: string): Promise<DigitalInterviewHistory> {
  return apiRequest("/interviews/digital", { query: { status } });
}

export function loadDigitalExperts(domain?: string): Promise<DigitalExpertCatalog> {
  return apiRequest("/interviews/digital/experts", { query: { domain } });
}
